use crate::{DataKey, VaultError, YieldVault};
use soroban_sdk::{contracttype, symbol_short, Address, Env};

/// Storage keys for the referral system.
#[contracttype]
pub enum ReferralKey {
    /// Maps a referee address to their referrer.
    Referrer(Address),
    /// Ledger timestamp when the referee's attribution was recorded.
    /// Used to expire attribution after `REFERRAL_ATTRIBUTION_WINDOW_SECS`.
    AttributedAt(Address),
    /// Tracks total TVL referred by a referrer.
    ReferredTvl(Address),
    /// Tracks unclaimed referral rewards for a referrer.
    ReferralRewards(Address),
    /// Total referral rewards distributed.
    TotalReferralRewards,
    /// Referral fee in basis points (out of protocol fees, NOT user principal).
    ReferralFeeBps,
}

/// Default referral fee: 5% of the protocol performance fee.
const DEFAULT_REFERRAL_FEE_BPS: i128 = 500;

/// Maximum referral fee: 10% of protocol performance fee (1000 bps).
const MAX_REFERRAL_FEE_BPS: i128 = 1_000;

/// Attribution expiry window: 90 days (in seconds). A referral relationship
/// still resolves via `get_referrer_view` after this window (the link itself
/// never disappears), but `accrue_referral_reward` stops paying the referrer
/// once the referee's attribution has aged past this window — protocols
/// commonly bound the reward-earning tail of a referral rather than letting
/// it accrue indefinitely.
pub(crate) const REFERRAL_ATTRIBUTION_WINDOW_SECS: u64 = 7_776_000;

impl YieldVault {
    pub fn register_referral_impl(
        env: Env,
        referee: Address,
        referrer: Address,
    ) -> Result<(), VaultError> {
        Self::require_init(&env)?;
        referee.require_auth();
        Self::register_referral_inner(&env, &referee, &referrer)
    }

    /// Inner registration logic (no auth check, caller must verify auth).
    fn register_referral_inner(
        env: &Env,
        referee: &Address,
        referrer: &Address,
    ) -> Result<(), VaultError> {
        // Prevent self-referral
        if referee == referrer {
            return Err(VaultError::ZeroAmount);
        }

        // Check for existing referral (no duplicate attribution)
        if env
            .storage()
            .persistent()
            .has(&ReferralKey::Referrer(referee.clone()))
        {
            return Ok(());
        }

        // Prevent circular referral chains (A→B→A)
        // Check if referrer was referred by referee (would create cycle)
        let referrer_upstream: Option<Address> = env
            .storage()
            .persistent()
            .get(&ReferralKey::Referrer(referrer.clone()));
        
        if let Some(upstream) = referrer_upstream {
            if upstream == *referee {
                // Circular reference detected
                return Err(VaultError::ZeroAmount);
            }
        }

        env.storage()
            .persistent()
            .set(&ReferralKey::Referrer(referee.clone()), referrer);
        env.storage().persistent().set(
            &ReferralKey::AttributedAt(referee.clone()),
            &env.ledger().timestamp(),
        );

        env.events().publish(
            (symbol_short!("referral"),),
            (referee.clone(), referrer.clone()),
        );

        Ok(())
    }

    pub fn deposit_with_referral_impl(
        env: Env,
        from: Address,
        amount: i128,
        referrer: Address,
    ) -> Result<i128, VaultError> {
        if from != referrer {
            // Auth will be checked by deposit() below, so skip here
            let _ = Self::register_referral_inner(&env, &from, &referrer);

            let current_tvl: i128 = env
                .storage()
                .persistent()
                .get(&ReferralKey::ReferredTvl(referrer.clone()))
                .unwrap_or(0);
            env.storage()
                .persistent()
                .set(&ReferralKey::ReferredTvl(referrer), &(current_tvl + amount));
        }

        Self::deposit(env, from, amount, 0)
    }

    pub fn claim_referral_rewards_impl(env: Env, referrer: Address) -> Result<i128, VaultError> {
        Self::require_init(&env)?;
        referrer.require_auth();

        let rewards: i128 = env
            .storage()
            .persistent()
            .get(&ReferralKey::ReferralRewards(referrer.clone()))
            .unwrap_or(0);

        if rewards <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        env.storage()
            .persistent()
            .set(&ReferralKey::ReferralRewards(referrer.clone()), &0i128);

        let token_addr: Address = Self::get_storage_required(&env, &DataKey::Token)?;
        let client = soroban_sdk::token::Client::new(&env, &token_addr);
        client.transfer(&env.current_contract_address(), &referrer, &rewards);

        env.events()
            .publish((symbol_short!("ref_clm"),), (referrer, rewards));

        Ok(rewards)
    }

    pub fn set_referral_fee_impl(
        env: Env,
        admin: Address,
        fee_bps: i128,
    ) -> Result<(), VaultError> {
        Self::require_admin(&env, &admin)?;

        let clamped = fee_bps.clamp(0, MAX_REFERRAL_FEE_BPS);

        env.storage()
            .persistent()
            .set(&ReferralKey::ReferralFeeBps, &clamped);

        env.events()
            .publish((symbol_short!("ref_fee"),), (admin, clamped));

        Ok(())
    }

    pub fn get_referrer_view(env: Env, referee: Address) -> Option<Address> {
        env.storage()
            .persistent()
            .get(&ReferralKey::Referrer(referee))
    }

    pub fn get_referred_tvl_view(env: Env, referrer: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&ReferralKey::ReferredTvl(referrer))
            .unwrap_or(0)
    }

    pub fn get_referral_rewards_view(env: Env, referrer: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&ReferralKey::ReferralRewards(referrer))
            .unwrap_or(0)
    }

    pub fn get_referral_fee_bps_view(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&ReferralKey::ReferralFeeBps)
            .unwrap_or(DEFAULT_REFERRAL_FEE_BPS)
    }

    pub fn get_total_referral_rewards_view(env: Env) -> i128 {
        env.storage()
            .persistent()
            .get(&ReferralKey::TotalReferralRewards)
            .unwrap_or(0)
    }

    /// Read-only: `true` if `referee`'s referral attribution is still within
    /// the reward-earning window (i.e. `accrue_referral_reward` would still
    /// pay out for them). `false` once expired or if never referred.
    pub fn is_referral_attribution_active_view(env: Env, referee: Address) -> bool {
        let attributed_at: Option<u64> = env
            .storage()
            .persistent()
            .get(&ReferralKey::AttributedAt(referee));
        match attributed_at {
            Some(ts) => {
                env.ledger().timestamp().saturating_sub(ts) < REFERRAL_ATTRIBUTION_WINDOW_SECS
            }
            None => false,
        }
    }
}

// ── Internal helpers (not exposed as contract endpoints) ─────────────

impl YieldVault {
    /// Accrue referral rewards from a protocol fee event.
    ///
    /// Called internally when protocol fees are collected (e.g. during harvest).
    /// The referral reward is a percentage of the protocol fee, NOT the user's
    /// principal.
    ///
    /// ## Invariants:
    /// 1. Referral reward cannot exceed protocol fee
    /// 2. Total referral rewards cannot exceed sum of individual rewards
    pub fn accrue_referral_reward(env: &Env, referee: &Address, protocol_fee: i128) {
        if protocol_fee <= 0 {
            return;
        }

        let referrer: Option<Address> = env
            .storage()
            .persistent()
            .get(&ReferralKey::Referrer(referee.clone()));

        let referrer = match referrer {
            Some(r) => r,
            None => return,
        };

        // Attribution expiry: stop paying the referrer once the referee's
        // attribution has aged past the reward-earning window.
        let attributed_at: Option<u64> = env
            .storage()
            .persistent()
            .get(&ReferralKey::AttributedAt(referee.clone()));
        let expired = match attributed_at {
            Some(ts) => env.ledger().timestamp().saturating_sub(ts) >= REFERRAL_ATTRIBUTION_WINDOW_SECS,
            None => true,
        };
        if expired {
            env.events()
                .publish((symbol_short!("ref_exp"),), (referee.clone(), referrer));
            return;
        }

        let fee_bps: i128 = env
            .storage()
            .persistent()
            .get(&ReferralKey::ReferralFeeBps)
            .unwrap_or(DEFAULT_REFERRAL_FEE_BPS);

        let reward = (protocol_fee * fee_bps) / 10_000;
        if reward <= 0 {
            return;
        }

        // INVARIANT: Referral reward cannot exceed protocol fee
        if reward > protocol_fee {
            env.events().publish(
                (symbol_short!("ref_err"),),
                (referee.clone(), reward, protocol_fee),
            );
            return;
        }

        let current_rewards: i128 = env
            .storage()
            .persistent()
            .get(&ReferralKey::ReferralRewards(referrer.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &ReferralKey::ReferralRewards(referrer.clone()),
            &(current_rewards.saturating_add(reward)),
        );

        let total: i128 = env
            .storage()
            .persistent()
            .get(&ReferralKey::TotalReferralRewards)
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&ReferralKey::TotalReferralRewards, &(total.saturating_add(reward)));

        env.events().publish(
            (symbol_short!("ref_rew"),),
            (referrer, referee.clone(), reward),
        );
    }
}
