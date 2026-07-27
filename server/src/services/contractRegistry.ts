/**
 * Contract address registry — server side (#185).
 *
 * Reads contract IDs from contracts/registry.json and applies process.env
 * overrides in the same priority order as the client-side version.
 */

import * as path from "path";
import * as fs from "fs";

export type ContractName =
  | "vault"
  | "zap"
  | "token"
  | "governance"
  | "strategy"
  | "emissionController"
  | "liquidStaking"
  | "stableswap";

export type NetworkName = "testnet" | "mainnet" | "local";

type Registry = Record<NetworkName, Record<ContractName, string>>;

const REGISTRY_PATH = path.resolve(
  __dirname,
  "../../../../contracts/registry.json",
);

const MANIFEST_PATH = path.resolve(
  __dirname,
  "../../../../contracts/scripts/deployment-manifest.json",
);

// Maps manifest deploy names to registry aliases (mirrors verify-manifest.js).
const MANIFEST_TO_REGISTRY: Partial<Record<string, ContractName>> = {
  yield_vault: "vault",
  strategies: "strategy",
  optimistic_governance: "governance",
  emission_controller: "emissionController",
  liquid_staking: "liquidStaking",
};

function loadRegistry(): Registry {
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, "utf8");
    return JSON.parse(raw) as Registry;
  } catch {
    return { testnet: {} as Record<ContractName, string>, mainnet: {} as Record<ContractName, string>, local: {} as Record<ContractName, string> };
  }
}

const registry = loadRegistry();

// ── Registry provenance (#936) ─────────────────────────────────────────
//
// Reports the deployment manifest's provenance (commit SHA, network
// passphrase, generation timestamp, per-contract spec) so diagnostics can
// prove which source/network produced the addresses in use, and detects
// tampering where a manifest contract ID no longer matches registry.json.

export interface RegistryProvenance {
  available: boolean;
  network?: string;
  commitSha?: string;
  generatedAt?: string;
  networkPassphrase?: string;
  generatedBy?: string;
  issues: string[];
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function getRegistryProvenance(): RegistryProvenance {
  let raw: string;
  try {
    raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  } catch {
    return { available: false, issues: ["deployment-manifest.json not found"] };
  }

  let manifest: any;
  try {
    manifest = JSON.parse(raw);
  } catch {
    return { available: false, issues: ["deployment-manifest.json is not valid JSON"] };
  }

  const provenance = manifest?.provenance;
  const issues: string[] = [];

  if (!isNonEmptyString(provenance?.git?.commitSha)) issues.push("missing provenance.git.commitSha");
  if (!isNonEmptyString(provenance?.network?.name)) issues.push("missing provenance.network.name");
  if (!isNonEmptyString(provenance?.network?.passphrase)) issues.push("missing provenance.network.passphrase");
  if (!isNonEmptyString(provenance?.generatedAt)) issues.push("missing provenance.generatedAt");
  if (!isNonEmptyString(provenance?.generatedBy)) issues.push("missing provenance.generatedBy");

  // Tamper detection: every manifest contract ID must match registry.json
  // for the manifest's own declared network.
  const network = manifest?.network as NetworkName | undefined;
  if (network && registry[network] && manifest?.contracts && typeof manifest.contracts === "object") {
    for (const [manifestKey, manifestAddr] of Object.entries(manifest.contracts as Record<string, string>)) {
      if (!manifestAddr) continue;
      const alias = MANIFEST_TO_REGISTRY[manifestKey] ?? (manifestKey as ContractName);
      const registryAddr = registry[network]?.[alias];
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

/**
 * Throws when a deployment manifest exists but its provenance is
 * incomplete or tampered with. Call during server startup so a forged or
 * malformed manifest can never be trusted silently. Absence of a manifest
 * (e.g. local dev with no deployment yet) is not fatal on its own, except
 * in production where a provenance record is required.
 */
export function assertRegistryProvenanceOrThrow(env: string = process.env.NODE_ENV ?? "development"): void {
  const provenance = getRegistryProvenance();

  if (!provenance.available) {
    if (provenance.issues[0] === "deployment-manifest.json not found") {
      if (env === "production") {
        throw new Error(
          "Registry provenance missing: deployment-manifest.json is required in production to prove contract registry authenticity.",
        );
      }
      return;
    }
    throw new Error(`Registry provenance verification failed: ${provenance.issues.join("; ")}`);
  }
}

function detectNetwork(): NetworkName {
  const passphrase = process.env.STELLAR_NETWORK_PASSPHRASE ?? "";
  if (passphrase.includes("mainnet") || passphrase.includes("Public Global")) {
    return "mainnet";
  }
  const horizon = process.env.STELLAR_HORIZON_URL ?? "";
  if (horizon.includes("testnet") || passphrase.includes("testnet")) {
    return "testnet";
  }
  if (horizon.includes("local") || horizon.includes("localhost")) {
    return "local";
  }
  return "testnet";
}

const ENV_OVERRIDES: Partial<Record<ContractName, string | undefined>> = {
  vault: process.env.CONTRACT_ID,
  zap: process.env.ZAP_CONTRACT_ID,
  token: process.env.TOKEN_CONTRACT_ID,
  governance: process.env.GOVERNANCE_CONTRACT_ID,
  strategy: process.env.STRATEGY_CONTRACT_ID,
  emissionController: process.env.EMISSION_CONTROLLER_CONTRACT_ID,
  liquidStaking: process.env.LIQUID_STAKING_CONTRACT_ID,
  stableswap: process.env.STABLESWAP_CONTRACT_ID,
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

export function getAllContractIds(
  network?: NetworkName,
): Record<ContractName, string> {
  const net = network ?? detectNetwork();
  const names: ContractName[] = [
    "vault", "zap", "token", "governance", "strategy",
    "emissionController", "liquidStaking", "stableswap",
  ];
  return Object.fromEntries(
    names.map((n) => [n, getContractId(n, net)]),
  ) as Record<ContractName, string>;
}
