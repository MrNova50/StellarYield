/**
 * Contract address registry (#185).
 *
 * Resolves Soroban contract IDs for the active network. Environment variables
 * always override registry values so deployers can inject addresses without
 * modifying the JSON file.
 *
 * Priority (highest → lowest):
 *   1. VITE_* environment variables
 *   2. contracts/registry.json for the active network
 *   3. Empty string (caller must handle missing IDs)
 */

import * as StellarSdk from "@stellar/stellar-sdk";
import registryJson from "../../../contracts/registry.json";

// #936 — deployment manifest is generated post-deploy and may not exist in
// every checkout (e.g. before a first deployment). Use an eager glob import
// so a missing file resolves to an empty module map at build time instead
// of failing the build.
const manifestModules = import.meta.glob("../../../contracts/scripts/deployment-manifest.json", {
  eager: true,
}) as Record<string, { default: unknown }>;
const deploymentManifest = Object.values(manifestModules)[0]?.default as
  | {
      network?: string;
      contracts?: Record<string, string>;
      provenance?: {
        generatedBy?: string;
        generatedAt?: string;
        git?: { commitSha?: string };
        network?: { name?: string; passphrase?: string };
      };
    }
  | undefined;

export type ContractName =
  | "vault"
  | "zap"
  | "token"
  | "governance"
  | "strategy"
  | "emissionController"
  | "liquidStaking"
  | "stableswap"
  | "vesting";

export type NetworkName = "testnet" | "mainnet" | "local";

type Registry = Record<NetworkName, Record<ContractName, string>>;

const registry = registryJson as Registry;

export function detectNetwork(): NetworkName {
  const passphrase =
    import.meta.env.VITE_NETWORK_PASSPHRASE ?? "";
  if (passphrase.includes("mainnet") || passphrase.includes("Public Global")) {
    return "mainnet";
  }
  if (passphrase === "" || passphrase.includes("local") || passphrase.includes("standalone")) {
    return "local";
  }
  return "testnet";
}

const ENV_OVERRIDES: Partial<Record<ContractName, string | undefined>> = {
  vault: import.meta.env.VITE_CONTRACT_ID,
  zap: import.meta.env.VITE_ZAP_CONTRACT_ID,
  token: import.meta.env.VITE_TOKEN_CONTRACT_ID,
  governance: import.meta.env.VITE_GOVERNANCE_CONTRACT_ID,
  strategy: import.meta.env.VITE_STRATEGY_CONTRACT_ID,
  emissionController: import.meta.env.VITE_EMISSION_CONTROLLER_CONTRACT_ID,
  liquidStaking: import.meta.env.VITE_LIQUID_STAKING_CONTRACT_ID,
  stableswap: import.meta.env.VITE_STABLESWAP_CONTRACT_ID,
  vesting: import.meta.env.VITE_VESTING_CONTRACT_ID,
};

export function getContractId(
  name: ContractName,
  network?: NetworkName,
): string {
  const envOverride = ENV_OVERRIDES[name];
  if (envOverride) return envOverride;

  const net = network ?? detectNetwork();
  return registry[net]?.[name] ?? "";
}

export interface RegistryProvenance {
  available: boolean;
  network?: string;
  commitSha?: string;
  generatedAt?: string;
  networkPassphrase?: string;
  generatedBy?: string;
  issues: string[];
}

const MANIFEST_TO_REGISTRY: Partial<Record<string, ContractName>> = {
  yield_vault: "vault",
  strategies: "strategy",
  optimistic_governance: "governance",
  emission_controller: "emissionController",
  liquid_staking: "liquidStaking",
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Report the deployment manifest's provenance for client-side diagnostics,
 * so the frontend can prove which commit/network produced the contract
 * addresses it is using, and detect tampering against registry.json.
 */
export function getRegistryProvenance(): RegistryProvenance {
  if (!deploymentManifest) {
    return { available: false, issues: ["deployment-manifest.json not found"] };
  }

  const provenance = deploymentManifest.provenance;
  const issues: string[] = [];

  if (!isNonEmptyString(provenance?.git?.commitSha)) issues.push("missing provenance.git.commitSha");
  if (!isNonEmptyString(provenance?.network?.name)) issues.push("missing provenance.network.name");
  if (!isNonEmptyString(provenance?.network?.passphrase)) issues.push("missing provenance.network.passphrase");
  if (!isNonEmptyString(provenance?.generatedAt)) issues.push("missing provenance.generatedAt");
  if (!isNonEmptyString(provenance?.generatedBy)) issues.push("missing provenance.generatedBy");

  const network = deploymentManifest.network as NetworkName | undefined;
  if (network && deploymentManifest.contracts) {
    for (const [manifestKey, manifestAddr] of Object.entries(deploymentManifest.contracts)) {
      if (!manifestAddr) continue;
      const alias = MANIFEST_TO_REGISTRY[manifestKey] ?? (manifestKey as ContractName);
      const registryAddr = (registryJson as any)[network]?.[alias];
      if (registryAddr && registryAddr !== manifestAddr) {
        issues.push(
          `contract ID mismatch for "${manifestKey}": manifest has ${manifestAddr}, registry.json[${network}] has ${registryAddr}`,
        );
      }
    }
  }

  return {
    available: issues.length === 0,
    network,
    commitSha: provenance?.git?.commitSha,
    generatedAt: provenance?.generatedAt,
    networkPassphrase: provenance?.network?.passphrase,
    generatedBy: provenance?.generatedBy,
    issues,
  };
}

export function getAllContractIds(network?: NetworkName): Record<ContractName, string> {
  const net = network ?? detectNetwork();
  const names: ContractName[] = [
    "vault", "zap", "token", "governance", "strategy",
    "emissionController", "liquidStaking", "stableswap", "vesting",
  ];
  return Object.fromEntries(
    names.map((n) => [n, getContractId(n, net)]),
  ) as Record<ContractName, string>;
}

export function validateContractRegistryEntry(
  name: string,
  contractId: string,
  network?: NetworkName,
): void {
  const activeNetwork = network ?? detectNetwork();

  const supportedNames: string[] = [
    "vault",
    "zap",
    "token",
    "governance",
    "strategy",
    "emissionController",
    "liquidStaking",
    "stableswap",
    "vesting",
  ];

  if (!supportedNames.includes(name)) {
    throw new Error(
      `Unsupported contract name: "${name}". Valid contracts are: ${supportedNames.join(", ")}.`
    );
  }

  if (!contractId || contractId.trim() === "") {
    throw new Error(
      `Missing contract ID for "${name}". Please configure it via environment variables (e.g. VITE_${name.toUpperCase()}_CONTRACT_ID or VITE_CONTRACT_ID for vault) or update contracts/registry.json.`
    );
  }

  try {
    new StellarSdk.Address(contractId);
    if (contractId.length !== 56 || !contractId.startsWith("C")) {
      throw new Error(
        `Invalid contract ID format for "${name}": "${contractId}". Soroban contract IDs must start with 'C' and be 56 characters long.`
      );
    }
  } catch (err) {
    throw new Error(
      `Invalid contract ID format for "${name}": "${contractId}". Soroban contract IDs must be valid Stellar contract addresses starting with 'C' and 56 characters long. Original error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const networks: NetworkName[] = ["testnet", "mainnet", "local"];
  let registeredOnDifferentNetwork: NetworkName | null = null;
  for (const net of networks) {
    if (net !== activeNetwork) {
      const regValue = (registryJson as any)[net]?.[name];
      if (regValue && regValue === contractId) {
        registeredOnDifferentNetwork = net;
        break;
      }
    }
  }

  if (registeredOnDifferentNetwork) {
    throw new Error(
      `Network mismatch: Contract "${name}" has ID "${contractId}" which is registered for "${registeredOnDifferentNetwork}", but active network is "${activeNetwork}".`
    );
  }

  for (const otherName of supportedNames) {
    if (otherName !== name) {
      const activeVal = getContractId(otherName as ContractName, activeNetwork);
      if (activeVal && activeVal === contractId) {
        throw new Error(
          `Contract name mismatch: Provided ID "${contractId}" for "${name}" actually matches the configured address for contract "${otherName}" on network "${activeNetwork}".`
        );
      }
    }
  }
}

