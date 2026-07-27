/**
 * Contract-address sanity checks for deployment configuration (issue #1054).
 *
 * Deployment scripts should fail fast when a configured contract ID is
 * malformed, missing, or accidentally duplicated across incompatible roles
 * (e.g. the vault contract and the stablecoin manager pointing at the same
 * address is almost certainly a copy-paste mistake, not a real deployment).
 *
 * This is a pure, dependency-free module (no @stellar/stellar-sdk import)
 * so it can run as a fast pre-flight check before any RPC/network calls.
 * "Wrong network" detection (does this contract ID actually exist on the
 * configured network?) requires a live Soroban RPC lookup and is out of
 * scope for this static check — left as a follow-up once a network client
 * is wired into the deploy pipeline.
 */

/** Stellar StrKey contract address: version byte 'C' + 55 base32 chars = 56 total. */
const CONTRACT_ADDRESS_PATTERN = /^C[A-Z2-7]{55}$/;

export interface ContractAddressRole {
  /** The environment variable name this contract ID is read from. */
  varName: string;
  /** Human-readable role, e.g. "vault contract" or "stablecoin manager". */
  role: string;
  required: boolean;
}

export interface ContractAddressIssue {
  varName: string;
  role: string;
  code: 'missing' | 'malformed' | 'duplicate_role';
  message: string;
}

/**
 * Validates a set of configured contract-address environment variables
 * against their expected roles. Returns one issue per problem found; an
 * empty array means every configured address is well-formed and no two
 * incompatible roles share the same address.
 */
export function validateContractAddresses(
  env: Record<string, string | undefined>,
  roles: ContractAddressRole[],
): ContractAddressIssue[] {
  const issues: ContractAddressIssue[] = [];
  const seenAddresses = new Map<string, ContractAddressRole>();

  for (const roleSpec of roles) {
    const value = env[roleSpec.varName]?.trim();

    if (!value) {
      if (roleSpec.required) {
        issues.push({
          varName: roleSpec.varName,
          role: roleSpec.role,
          code: 'missing',
          message: `${roleSpec.varName} (${roleSpec.role}) is required but not set.`,
        });
      }
      continue;
    }

    if (!CONTRACT_ADDRESS_PATTERN.test(value)) {
      issues.push({
        varName: roleSpec.varName,
        role: roleSpec.role,
        code: 'malformed',
        message: `${roleSpec.varName} (${roleSpec.role}) = "${value}" is not a valid Stellar contract address (expected "C" followed by 55 base32 characters).`,
      });
      continue;
    }

    const existing = seenAddresses.get(value);
    if (existing) {
      issues.push({
        varName: roleSpec.varName,
        role: roleSpec.role,
        code: 'duplicate_role',
        message: `${roleSpec.varName} (${roleSpec.role}) has the same address as ${existing.varName} (${existing.role}) — this is almost always a misconfiguration.`,
      });
    } else {
      seenAddresses.set(value, roleSpec);
    }
  }

  return issues;
}

/** The contract-role variables this deployment currently configures, mirroring FRONTEND_VARS/BACKEND_VARS in verify-deployment.ts. */
export const DEPLOYMENT_CONTRACT_ROLES: ContractAddressRole[] = [
  { varName: 'VITE_CONTRACT_ID', role: 'frontend vault contract', required: true },
  { varName: 'VAULT_CONTRACT_ID', role: 'keeper vault contract', required: true },
  { varName: 'STABLECOIN_MANAGER_CONTRACT_ID', role: 'stablecoin manager contract', required: true },
];
