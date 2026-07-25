/**
 * Recipe test: governance proposal flow
 *
 * Validates that a governance proposal can be prepared, signed, and confirmed
 * via the typed SDK, using fakeRpc fixtures.
 */

import { describe, it, expect, vi } from 'vitest';
import { Keypair, Networks } from '@stellar/stellar-sdk';
import {
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

interface GovernanceProposalArgs {
  proposer: string;
  title: string;
  description: string;
  calldata: string;
  voting_period_ledgers: bigint;
}

function makeGovernancePreparedTx(args: GovernanceProposalArgs): PreparedTransaction<string> {
  return new PreparedTransaction('unsigned-gov-xdr', {
    simulationResult: 'proposal-id-42',
    footprint: 'fp',
    authEntries: [],
    minResourceFee: '200',
    transactionData: 'td',
    latestLedger: 2000,
    validUntilLedger: 2500,
    contractId: CONTRACT_ID,
    networkPassphrase: PASSPHRASE,
    method: 'propose',
    argsHash: 'gov-args-hash',
    specHash: YIELD_VAULT_SPEC_HASH,
  });
}

describe('Recipe: governance proposal', () => {
  const PROPOSER = Keypair.random().publicKey();

  it('PreparedTransaction carries proposal metadata', () => {
    const prepared = makeGovernancePreparedTx({
      proposer: PROPOSER,
      title: 'Raise performance fee cap to 30%',
      description: 'This proposal raises the max performance fee bps from 2000 to 3000.',
      calldata: 'set_max_fee_bps(3000)',
      voting_period_ledgers: 10000n,
    });

    expect(prepared.meta.method).toBe('propose');
    expect(prepared.meta.simulationResult).toBe('proposal-id-42');
    expect(prepared.meta.specHash).toBe(YIELD_VAULT_SPEC_HASH);
  });

  it('sign() transitions to SignedTransaction', async () => {
    const prepared = makeGovernancePreparedTx({
      proposer: PROPOSER,
      title: 'Test',
      description: 'Test proposal',
      calldata: 'noop()',
      voting_period_ledgers: 5000n,
    });

    const mockSigner = { sign: vi.fn().mockResolvedValue('signed-gov-xdr') };
    const signed = await prepared.sign(mockSigner as any);

    expect(signed).toBeInstanceOf(SignedTransaction);
    expect(signed.xdr).toBe('signed-gov-xdr');
  });

  it('full lifecycle: prepare → sign → submit → confirm', async () => {
    const hash = 'governance-proposal-hash';
    const fakeRpc = createFakeRpcServer({
      sendTransaction: vi.fn().mockResolvedValue(fakeSendPending(hash)),
      getTransaction: vi.fn().mockResolvedValue(fakeGetSuccess(6000)),
    });

    const prepared = makeGovernancePreparedTx({
      proposer: PROPOSER,
      title: 'Activate new strategy',
      description: 'Routes 10% of idle reserves into strategy-2.',
      calldata: 'set_strategy_allocation(2, 1000)',
      voting_period_ledgers: 8640n,
    });

    const mockSigner = { sign: vi.fn().mockResolvedValue('signed-gov-xdr') };
    const signed = await prepared.sign(mockSigner as any);
    const submitted = await signed.submit(fakeRpc as any);
    const confirmed = await submitted.confirm(fakeRpc as any);

    expect(confirmed).toBeInstanceOf(ConfirmedTransaction);
    expect(confirmed.ledger).toBe(6000);
    expect(confirmed.meta.method).toBe('propose');
  });
});
