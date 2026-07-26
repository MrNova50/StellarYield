import { describe, it, expect } from 'vitest';
import { validateContractAddresses, ContractAddressRole } from './validateContractAddresses';

const VALID_A = 'C'.padEnd(56, 'A'); // 56 chars, all valid base32
const VALID_B = 'C' + 'B'.repeat(55);

const roles: ContractAddressRole[] = [
  { varName: 'VAULT_CONTRACT_ID', role: 'vault', required: true },
  { varName: 'STABLECOIN_MANAGER_CONTRACT_ID', role: 'stablecoin manager', required: true },
  { varName: 'OPTIONAL_CONTRACT_ID', role: 'optional extra', required: false },
];

describe('validateContractAddresses', () => {
  it('returns no issues for a valid, non-duplicated address matrix', () => {
    const issues = validateContractAddresses(
      { VAULT_CONTRACT_ID: VALID_A, STABLECOIN_MANAGER_CONTRACT_ID: VALID_B },
      roles,
    );
    expect(issues).toEqual([]);
  });

  it('flags a missing required contract id', () => {
    const issues = validateContractAddresses({ STABLECOIN_MANAGER_CONTRACT_ID: VALID_B }, roles);
    expect(issues).toEqual([
      expect.objectContaining({ varName: 'VAULT_CONTRACT_ID', code: 'missing' }),
    ]);
  });

  it('does not flag a missing optional contract id', () => {
    const issues = validateContractAddresses(
      { VAULT_CONTRACT_ID: VALID_A, STABLECOIN_MANAGER_CONTRACT_ID: VALID_B },
      roles,
    );
    expect(issues.some((i) => i.varName === 'OPTIONAL_CONTRACT_ID')).toBe(false);
  });

  it('flags a malformed contract address (wrong prefix)', () => {
    const issues = validateContractAddresses(
      { VAULT_CONTRACT_ID: 'G' + 'A'.repeat(55), STABLECOIN_MANAGER_CONTRACT_ID: VALID_B },
      roles,
    );
    expect(issues).toEqual([
      expect.objectContaining({ varName: 'VAULT_CONTRACT_ID', code: 'malformed' }),
    ]);
  });

  it('flags a malformed contract address (wrong length)', () => {
    const issues = validateContractAddresses(
      { VAULT_CONTRACT_ID: 'CTOOSHORT', STABLECOIN_MANAGER_CONTRACT_ID: VALID_B },
      roles,
    );
    expect(issues).toEqual([
      expect.objectContaining({ varName: 'VAULT_CONTRACT_ID', code: 'malformed' }),
    ]);
  });

  it('flags two incompatible roles sharing the same address', () => {
    const issues = validateContractAddresses(
      { VAULT_CONTRACT_ID: VALID_A, STABLECOIN_MANAGER_CONTRACT_ID: VALID_A },
      roles,
    );
    expect(issues).toEqual([
      expect.objectContaining({ varName: 'STABLECOIN_MANAGER_CONTRACT_ID', code: 'duplicate_role' }),
    ]);
  });

  it('identifies the exact variable and role for every issue', () => {
    const issues = validateContractAddresses({}, roles);
    const vaultIssue = issues.find((i) => i.varName === 'VAULT_CONTRACT_ID');
    expect(vaultIssue).toMatchObject({ role: 'vault', code: 'missing' });
    expect(vaultIssue?.message).toContain('VAULT_CONTRACT_ID');
  });
});
