/**
 * Recipe test: reward claim flow
 *
 * Validates the reward-claim lifecycle and edge cases: zero rewards, already
 * claimed (FAILED), and the happy path through confirm.
 */

import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  PreparedTransaction,
  SignedTransaction,
  SubmittedTransaction,
  ConfirmedTransaction,
  ContractExecutionError,
  YIELD_VAULT_SPEC_HASH,
} from '../../src';
import {
  createFakeRpcServer,
  fakeSendPending,
  fakeGetSuccess,
  fakeGetFailed,
} from '../fixtures/fakeRpc';

const CONTRACT_ID = 'CCW67TSB3SSSBDGRGBXMORAX6P4CBGQLGLKXMFFBVD7OH5VO5BTV6U2M';
const PASSPHRASE = Networks.TESTNET;
const CLAIMER_KP = Keypair.random();

function makeClaimPreparedTx(rewardAmount = 250_000n): PreparedTransaction<bigint> {
  return new PreparedTransaction('claim-xdr', {
    simulationResult: rewardAmount,
    footprint: 'fp',
    authEntries: [],
    minResourceFee: '100',
    transactionData: 'td',
    latestLedger: 3000,
    validUntilLedger: 3500,
    contractId: CONTRACT_ID,
    networkPassphrase: PASSPHRASE,
    method: 'claim_rewards',
    argsHash: 'claim-hash',
    specHash: YIELD_VAULT_SPEC_HASH,
  });
}

function makeSignedClaimTx(): SignedTransaction {
  return new SignedTransaction('signed-claim-xdr', {
    simulationResult: 250_000n,
    footprint: 'fp',
    authEntries: [],
    minResourceFee: '100',
    transactionData: 'td',
    latestLedger: 3000,
    validUntilLedger: 3500,
    contractId: CONTRACT_ID,
    networkPassphrase: PASSPHRASE,
    method: 'claim_rewards',
    argsHash: 'claim-hash',
    specHash: YIELD_VAULT_SPEC_HASH,
  });
}

describe('Recipe: reward claim', () => {
  it('PreparedTransaction encodes simulated reward amount', () => {
    const prepared = makeClaimPreparedTx(250_000n);
    expect(prepared.meta.method).toBe('claim_rewards');
    expect(prepared.meta.simulationResult).toBe(250_000n);
  });

  it('zero reward amount is a valid simulation result', () => {
    const prepared = makeClaimPreparedTx(0n);
    expect(prepared.meta.simulationResult).toBe(0n);
  });

  it('sign() transitions to SignedTransaction', async () => {
    const prepared = makeClaimPreparedTx();
    const mockSigner = { sign: vi.fn().mockResolvedValue('signed-claim-xdr') };
    const signed = await prepared.sign(mockSigner as any);
    expect(signed).toBeInstanceOf(SignedTransaction);
    expect(signed.meta.method).toBe('claim_rewards');
  });

  it('happy path: confirm returns ConfirmedTransaction with ledger', async () => {
    const hash = 'claim-tx-hash';
    const fakeRpc = createFakeRpcServer({
      sendTransaction: vi.fn().mockResolvedValue(fakeSendPending(hash)),
      getTransaction: vi.fn().mockResolvedValue(fakeGetSuccess(7777)),
    });

    const signed = makeSignedClaimTx();
    const submitted = await signed.submit(fakeRpc as any);
    expect(submitted).toBeInstanceOf(SubmittedTransaction);

    const confirmed = await submitted.confirm(fakeRpc as any);
    expect(confirmed).toBeInstanceOf(ConfirmedTransaction);
    expect(confirmed.ledger).toBe(7777);
  });

  it('already-claimed (FAILED) surfaces as ContractExecutionError', async () => {
    const hash = 'already-claimed-hash';
    const fakeRpc = createFakeRpcServer({
      sendTransaction: vi.fn().mockResolvedValue(fakeSendPending(hash)),
      getTransaction: vi.fn().mockResolvedValue(fakeGetFailed()),
    });

    const signed = makeSignedClaimTx();
    const submitted = await signed.submit(fakeRpc as any);
    await expect(submitted.confirm(fakeRpc as any)).rejects.toThrow(ContractExecutionError);
  });
});
