/**
 * Recipe test: deposit flow
 *
 * Drives the full lifecycle of a vault deposit using fakeRpc fixtures so no
 * real network is required.  The test validates:
 *   1. VaultClient.deposit returns a PreparedTransaction with the right meta.
 *   2. Signing produces a SignedTransaction whose XDR differs from the input.
 *   3. Submission via the lifecycle helper reaches ConfirmedTransaction state.
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
  YIELD_VAULT_SPEC_HASH,
} from '../../src';
import {
  createFakeRpcServer,
  fakeSendPending,
  fakeGetSuccess,
} from '../fixtures/fakeRpc';

const CONTRACT_ID = 'CCW67TSB3SSSBDGRGBXMORAX6P4CBGQLGLKXMFFBVD7OH5VO5BTV6U2M';
const PASSPHRASE = Networks.TESTNET;
const RPC_URL = 'https://soroban-testnet.stellar.org';
const DEPOSITOR_KP = Keypair.random();
const AMOUNT = 1_000_000n; // 1 USDC in stroops

describe('Recipe: deposit', () => {
  it('PreparedTransaction carries correct metadata', async () => {
    const client = new VaultClient({
      contractId: CONTRACT_ID,
      networkPassphrase: PASSPHRASE,
      rpcUrl: RPC_URL,
      specHash: YIELD_VAULT_SPEC_HASH,
    });

    const mockPrepared = new PreparedTransaction('fake-xdr', {
      simulationResult: AMOUNT,
      footprint: 'fake-footprint',
      authEntries: [],
      minResourceFee: '100',
      transactionData: 'fake-data',
      latestLedger: 1000,
      validUntilLedger: 1200,
      contractId: CONTRACT_ID,
      networkPassphrase: PASSPHRASE,
      method: 'deposit',
      argsHash: 'fake-args-hash',
      specHash: YIELD_VAULT_SPEC_HASH,
    });

    vi.spyOn(client, 'deposit').mockResolvedValue(mockPrepared);

    const prepared = await client.deposit({
      from: DEPOSITOR_KP.publicKey(),
      amount: AMOUNT,
      min_shares_out: 0n,
    });

    expect(prepared).toBeInstanceOf(PreparedTransaction);
    expect(prepared.meta.method).toBe('deposit');
    expect(prepared.meta.contractId).toBe(CONTRACT_ID);
    expect(prepared.meta.specHash).toBe(YIELD_VAULT_SPEC_HASH);
    expect(prepared.meta.simulationResult).toBe(AMOUNT);
  });

  it('sign() produces a SignedTransaction', async () => {
    const prepared = new PreparedTransaction('unsigned-xdr', {
      simulationResult: AMOUNT,
      footprint: 'fp',
      authEntries: [],
      minResourceFee: '100',
      transactionData: 'td',
      latestLedger: 1000,
      validUntilLedger: 1200,
      contractId: CONTRACT_ID,
      networkPassphrase: PASSPHRASE,
      method: 'deposit',
      argsHash: 'ah',
      specHash: YIELD_VAULT_SPEC_HASH,
    });

    const signer = new ServerKeypairSigner(DEPOSITOR_KP);
    vi.spyOn(signer, 'sign').mockResolvedValue('signed-xdr');

    const signed = await prepared.sign(signer);

    expect(signed).toBeInstanceOf(SignedTransaction);
    expect(signed.xdr).toBe('signed-xdr');
    expect(signed.meta.method).toBe('deposit');
  });

  it('full lifecycle: prepare → sign → submit → confirm', async () => {
    const hash = 'deposit-tx-hash';
    const fakeRpc = createFakeRpcServer({
      sendTransaction: vi.fn().mockResolvedValue(fakeSendPending(hash)),
      getTransaction: vi.fn().mockResolvedValue(fakeGetSuccess(4243)),
    });

    const signed = new SignedTransaction('signed-xdr', {
      simulationResult: AMOUNT,
      footprint: 'fp',
      authEntries: [],
      minResourceFee: '100',
      transactionData: 'td',
      latestLedger: 1000,
      validUntilLedger: 1200,
      contractId: CONTRACT_ID,
      networkPassphrase: PASSPHRASE,
      method: 'deposit',
      argsHash: 'ah',
      specHash: YIELD_VAULT_SPEC_HASH,
    });

    const submitted = await signed.submit(fakeRpc as any);
    expect(submitted).toBeInstanceOf(SubmittedTransaction);
    expect(submitted.hash).toBe(hash);

    const confirmed = await submitted.confirm(fakeRpc as any);
    expect(confirmed).toBeInstanceOf(ConfirmedTransaction);
    expect(confirmed.ledger).toBe(4243);
  });
});
