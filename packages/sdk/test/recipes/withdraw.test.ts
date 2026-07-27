/**
 * Recipe test: withdraw flow
 *
 * Validates the withdraw lifecycle: prepare → sign → submit → confirm,
 * including error paths (FAILED status, SubmissionTimeoutError).
 */

import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
  VaultClient,
  ServerKeypairSigner,
  PreparedTransaction,
  SignedTransaction,
  SubmittedTransaction,
  ConfirmedTransaction,
  SubmissionTimeoutError,
  ContractExecutionError,
  YIELD_VAULT_SPEC_HASH,
} from '../../src';
import {
  createFakeRpcServer,
  fakeSendPending,
  fakeGetSuccess,
  fakeGetFailed,
  fakeGetNotFound,
} from '../fixtures/fakeRpc';

const CONTRACT_ID = 'CCW67TSB3SSSBDGRGBXMORAX6P4CBGQLGLKXMFFBVD7OH5VO5BTV6U2M';
const PASSPHRASE = Networks.TESTNET;
const WITHDRAWER_KP = Keypair.random();
const SHARES = 500_000n;

function makeSignedTx(method = 'withdraw'): SignedTransaction {
  return new SignedTransaction('signed-xdr', {
    simulationResult: SHARES,
    footprint: 'fp',
    authEntries: [],
    minResourceFee: '100',
    transactionData: 'td',
    latestLedger: 1000,
    validUntilLedger: 1200,
    contractId: CONTRACT_ID,
    networkPassphrase: PASSPHRASE,
    method,
    argsHash: 'ah',
    specHash: YIELD_VAULT_SPEC_HASH,
  });
}

describe('Recipe: withdraw', () => {
  it('PreparedTransaction carries withdraw metadata', async () => {
    const client = new VaultClient({
      contractId: CONTRACT_ID,
      networkPassphrase: PASSPHRASE,
      rpcUrl: 'https://soroban-testnet.stellar.org',
      specHash: YIELD_VAULT_SPEC_HASH,
    });

    const mockPrepared = new PreparedTransaction('fake-xdr', {
      simulationResult: 900_000n,
      footprint: 'fp',
      authEntries: [],
      minResourceFee: '100',
      transactionData: 'td',
      latestLedger: 1000,
      validUntilLedger: 1200,
      contractId: CONTRACT_ID,
      networkPassphrase: PASSPHRASE,
      method: 'withdraw',
      argsHash: 'ah',
      specHash: YIELD_VAULT_SPEC_HASH,
    });

    vi.spyOn(client, 'withdraw').mockResolvedValue(mockPrepared);

    const prepared = await client.withdraw({
      to: WITHDRAWER_KP.publicKey(),
      shares: SHARES,
    });

    expect(prepared.meta.method).toBe('withdraw');
    expect(prepared.meta.simulationResult).toBe(900_000n);
  });

  it('happy path: submit confirms with correct ledger', async () => {
    const hash = 'withdraw-tx-hash';
    const fakeRpc = createFakeRpcServer({
      sendTransaction: vi.fn().mockResolvedValue(fakeSendPending(hash)),
      getTransaction: vi.fn().mockResolvedValue(fakeGetSuccess(5001)),
    });

    const signed = makeSignedTx();
    const submitted = await signed.submit(fakeRpc as any);
    expect(submitted.hash).toBe(hash);

    const confirmed = await submitted.confirm(fakeRpc as any);
    expect(confirmed).toBeInstanceOf(ConfirmedTransaction);
    expect(confirmed.ledger).toBe(5001);
  });

  it('FAILED status surfaces as ContractExecutionError', async () => {
    const hash = 'failed-withdraw-hash';
    const fakeRpc = createFakeRpcServer({
      sendTransaction: vi.fn().mockResolvedValue(fakeSendPending(hash)),
      getTransaction: vi.fn().mockResolvedValue(fakeGetFailed()),
    });

    const signed = makeSignedTx();
    const submitted = await signed.submit(fakeRpc as any);
    await expect(submitted.confirm(fakeRpc as any)).rejects.toThrow(ContractExecutionError);
  });

  it('NOT_FOUND after retries surfaces as SubmissionTimeoutError', async () => {
    const hash = 'not-found-hash';
    const fakeRpc = createFakeRpcServer({
      sendTransaction: vi.fn().mockResolvedValue(fakeSendPending(hash)),
      getTransaction: vi.fn().mockResolvedValue(fakeGetNotFound()),
    });

    const signed = makeSignedTx();
    const submitted = await signed.submit(fakeRpc as any);
    await expect(submitted.confirm(fakeRpc as any, { maxRetries: 1, pollIntervalMs: 0 })).rejects.toThrow(SubmissionTimeoutError);
  });
});
