use crate::{events, DataKey, VaultError, YieldVault};
use soroban_sdk::xdr::ToXdr;
use soroban_sdk::{symbol_short, Address, Env, IntoVal, Val, Vec};

#[soroban_sdk::contractimpl]
impl YieldVault {
    /// Note: `emergency_pause` and `emergency_unpause` have moved to emergency.rs.
    /// They now support guardian authority, bounded durations, automatic expiry,
    /// and governance oversight. Use `YieldVault::emergency_pause(env, caller, duration)`
    /// and `YieldVault::emergency_unpause(env, caller)` instead.
    /// Rescue tokens sent to the contract by mistake.
    ///
    /// # Arguments
    /// * `admin`  - The admin address authorizing the rescue.
    /// * `target` - The address to receive the rescued funds.
    /// * `amount` - The amount of tokens to rescue.
    ///
    /// # Security
    /// Only the admin can call this. Clamped to actual available balance.
    pub fn rescue_funds(
        env: Env,
        admin: Address,
        target: Address,
        amount: i128,
    ) -> Result<(), VaultError> {
        Self::require_admin(&env, &admin)?;
        if amount <= 0 {
            return Err(VaultError::ZeroAmount);
        }

        let token_addr: Address = Self::get_storage_required(&env, &DataKey::Token)?;
        let total_assets: i128 = Self::get_storage_required(&env, &DataKey::TotalAssets)?;

        // Check balance directly from the token client
        let client = soroban_sdk::token::Client::new(&env, &token_addr);
        let current_balance = client.balance(&env.current_contract_address());

        // Ensure we don't try to send more than we have
        let rescue_amount = if amount > current_balance {
            current_balance
        } else {
            amount
        };

        client.transfer(&env.current_contract_address(), &target, &rescue_amount);

        // Update tracked assets if we pulled from the vault's core
        if rescue_amount > 0 {
            let new_total = if total_assets > rescue_amount {
                total_assets - rescue_amount
            } else {
                0
            };
            env.storage()
                .instance()
                .set(&DataKey::TotalAssets, &new_total);
        }

        env.events()
            .publish((symbol_short!("rescue"),), (admin, target, rescue_amount));
        Ok(())
    }

    /// Initiate or finalize a change of the admin address with a 24-hour timelock.
    ///
    /// To change admin:
    /// 1. Call `set_admin` with the `new_admin` address. This starts the 24h timelock.
    /// 2. After 24h, call `set_admin` again with the same `new_admin` address to finalize.
    pub fn set_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), VaultError> {
        Self::require_admin(&env, &admin)?;

        let now = env.ledger().timestamp();

        // If there's already a pending admin, check timelock
        let pending_admin: Option<(Address, u64)> =
            env.storage().instance().get(&DataKey::PendingAdmin);

        if let Some(pending) = pending_admin {
            if pending.0 == new_admin && now >= pending.1 {
                env.storage().instance().set(&DataKey::Admin, &new_admin);
                env.storage().instance().remove(&DataKey::PendingAdmin);
                env.events()
                    .publish((symbol_short!("set_adm"),), (admin, new_admin));
                return Ok(());
            }
        }

        // Set pending admin with 24-hour timelock (86400 seconds)
        let unlock_time = now + 86400;
        env.storage()
            .instance()
            .set(&DataKey::PendingAdmin, &(new_admin.clone(), unlock_time));
        env.events()
            .publish((symbol_short!("adm_tm"),), (admin, new_admin, unlock_time));

        Err(VaultError::TimelockActive)
    }

    // `is_paused` moved to emergency.rs (handles guardian-based pause state
    // and automatic expiry); `DataKey::Paused` is no longer written anywhere
    // now that `emergency_pause`/`emergency_unpause` above have moved too.
}

// Internal helper (takes `&Env`/`&Address`, not a valid contract entry-point
// signature) — kept outside the `#[contractimpl]` block above.
impl YieldVault {
    // ── Replay Protection for Admin Operations (#902) ───────────────────
    /// Verify and consume an admin operation intent with domain separation.
    ///
    /// Domain includes:
    /// - Network passphrase (prevents cross-network replay)
    /// - Contract address (prevents cross-contract replay)
    /// - Operation type (pause, unpause, set_admin, etc.)
    /// - Nonce (prevents replay of same operation)
    /// - Expiry timestamp (operations expire after 1 hour)
    ///
    /// # Arguments
    /// * `operation_type` - Symbolic operation identifier (e.g., "pause", "admin")
    /// * `nonce` - Unique nonce for this operation
    /// * `expiry_timestamp` - Unix timestamp when this operation expires
    ///
    /// # Returns
    /// Ok if the operation is valid and hasn't been executed before.
    /// Err if expired or already executed.
    pub fn verify_admin_operation(
        env: &Env,
        operation_type: soroban_sdk::Symbol,
        nonce: u64,
        expiry_timestamp: u64,
    ) -> Result<(), VaultError> {
        let now = env.ledger().timestamp();

        // Check expiry
        if now > expiry_timestamp {
            return Err(VaultError::OperationExpired);
        }

        // Build domain-separated hash
        // Domain = network || contract || operation || nonce || expiry
        let network = env.ledger().network_id();
        let contract = env.current_contract_address();

        let mut op_hash_input: Vec<Val> = Vec::new(env);
        op_hash_input.push_back(network.into_val(env));
        op_hash_input.push_back(contract.into_val(env));
        op_hash_input.push_back(operation_type.into_val(env));
        op_hash_input.push_back(nonce.into_val(env));
        op_hash_input.push_back(expiry_timestamp.into_val(env));

        let op_hash = env.crypto().sha256(&op_hash_input.to_xdr(env));

        // Check if already executed
        if env
            .storage()
            .instance()
            .has(&DataKey::ExecutedAdminOp(op_hash.clone().into()))
        {
            return Err(VaultError::OperationReplayed);
        }

        // Mark as executed
        env.storage()
            .instance()
            .set(&DataKey::ExecutedAdminOp(op_hash.into()), &true);

        Ok(())
    }
}

#[soroban_sdk::contractimpl]
impl YieldVault {
    // ── Cross-Contract Allowlist with Network Binding (#905) ──────────────
    /// Register an allowed contract for a given role on this network.
    ///
    /// Only the admin can call this. Once registered, only that contract
    /// (on this network) can call functions that check this role.
    ///
    /// # Arguments
    /// * `admin` - Must be the vault admin
    /// * `role` - Symbolic role identifier (e.g., "zap", "keeper", "oracle")
    /// * `contract` - The contract address to allowlist for this role
    pub fn set_allowed_contract(
        env: Env,
        admin: Address,
        role: soroban_sdk::Symbol,
        contract: Address,
    ) -> Result<(), VaultError> {
        Self::require_admin(&env, &admin)?;

        // Store the allowed contract for this role
        // Network binding is implicit: contracts are tied to their deployment network
        env.storage()
            .instance()
            .set(&DataKey::AllowedContractRole(role.clone()), &contract);

        env.events().publish(
            (symbol_short!("allow"),),
            (admin, role, contract),
        );
        Ok(())
    }
}

// Internal helper (takes `&Env`/`&Address`) — kept outside `#[contractimpl]`.
impl YieldVault {
    /// Verify that a calling contract is allowed for the given role.
    ///
    /// # Arguments
    /// * `role` - The role to verify (e.g., "zap", "keeper")
    /// * `caller` - The address attempting to call
    ///
    /// # Returns
    /// Ok if caller is the allowed contract for this role.
    /// Err if caller is unknown or wrong for this role.
    pub fn require_allowed_contract(
        env: &Env,
        role: soroban_sdk::Symbol,
        caller: &Address,
    ) -> Result<(), VaultError> {
        let allowed: Option<Address> = env.storage().instance().get(&DataKey::AllowedContractRole(role));

        match allowed {
            Some(allowed_contract) if &allowed_contract == caller => Ok(()),
            _ => Err(VaultError::UnauthorizedContract),
        }
    }

    // ── Governance-Gated Storage Migrations (#896) ───────────────────

    /// Returns the current storage schema version, defaulting to
    /// [`crate::INITIAL_STORAGE_VERSION`] for vaults initialized before
    /// this feature existed.
    pub fn get_storage_version_impl(env: &Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::StorageVersion)
            .unwrap_or(crate::INITIAL_STORAGE_VERSION)
    }

    /// Migrate storage to `to_version`. Admin-gated (governance authority).
    /// Strictly sequential — rejects repeated, skipped, or out-of-order
    /// migrations before mutating any state, and emits a versioned
    /// `migrate` event carrying the old version, new version, and executor
    /// for indexer audit trails.
    pub fn migrate_storage_impl(
        env: Env,
        admin: Address,
        to_version: u32,
    ) -> Result<(), VaultError> {
        Self::require_admin(&env, &admin)?;

        let current_version = Self::get_storage_version_impl(&env);
        if to_version != current_version + 1 {
            return Err(VaultError::InvalidMigrationVersion);
        }

        env.storage()
            .instance()
            .set(&DataKey::StorageVersion, &to_version);

        events::emit_versioned_event(
            &env,
            symbol_short!("migrate"),
            events::MIGRATION_EVENT_V1.schema_version,
            (current_version, to_version, admin),
        );

        Ok(())
    }
}
