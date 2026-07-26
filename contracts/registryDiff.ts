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

export type Registry = Record<NetworkName, Record<ContractName, string>>;

export type ContractChange = {
  name: ContractName;
  oldAddress: string | null;
  newAddress: string | null;
  type: "added" | "removed" | "changed" | "unchanged";
};

export type RegistryDiff = Record<NetworkName, {
  changes: ContractChange[];
  missing: ContractName[]; // required but empty in new registry
}>;

export function diffRegistries(oldReg: Registry, newReg: Registry): RegistryDiff {
  const networks: NetworkName[] = ["testnet", "mainnet", "local"];
  const contractNames: ContractName[] = ["vault","zap","token","governance","strategy","emissionController","liquidStaking","stableswap"];

  const result = {} as RegistryDiff;

  for (const net of networks) {
    const oldNet = oldReg[net] ?? ({} as Record<ContractName, string>);
    const newNet = newReg[net] ?? ({} as Record<ContractName, string>);

    const changes: ContractChange[] = [];
    const missing: ContractName[] = [];

    for (const name of contractNames) {
      const oldAddr = oldNet[name] ?? "";
      const newAddr = newNet[name] ?? "";

      if ((!oldAddr || oldAddr === "") && (newAddr && newAddr !== "")) {
        changes.push({ name, oldAddress: oldAddr || null, newAddress: newAddr || null, type: 'added' });
      } else if ((oldAddr && oldAddr !== "") && (!newAddr || newAddr === "")) {
        changes.push({ name, oldAddress: oldAddr || null, newAddress: newAddr || null, type: 'removed' });
      } else if ((oldAddr || "") !== (newAddr || "")) {
        changes.push({ name, oldAddress: oldAddr || null, newAddress: newAddr || null, type: 'changed' });
      } else {
        changes.push({ name, oldAddress: oldAddr || null, newAddress: newAddr || null, type: 'unchanged' });
      }

      if (!newAddr || newAddr === "") {
        missing.push(name);
      }
    }

    result[net] = { changes, missing };
  }

  return result;
}

/** Per-network human-readable annotation for CI consumers and maintainers. */
export type NetworkAnnotation = {
  network: NetworkName;
  /** Summary line surfaced in CI output. */
  summary: string;
  /** One annotation line per non-unchanged entry. */
  lines: string[];
  /** True when any unexpected drift (added, removed, or changed) is present. */
  hasDrift: boolean;
};

/**
 * Converts a `RegistryDiff` into per-network human-readable annotations.
 * Designed for CI consumers: each `NetworkAnnotation` carries a `hasDrift`
 * flag so a pipeline can fail fast on unexpected contract ID changes.
 *
 * @param diff - Output of `diffRegistries`.
 * @returns An array of one annotation per network, ordered testnet → mainnet → local.
 */
export function annotateRegistryDiff(diff: RegistryDiff): NetworkAnnotation[] {
  const networks: NetworkName[] = ["testnet", "mainnet", "local"];
  return networks.map((network) => {
    const { changes } = diff[network];
    const lines: string[] = [];

    for (const change of changes) {
      if (change.type === "unchanged") continue;
      switch (change.type) {
        case "added":
          lines.push(`[ADDED]   ${change.name}: (none) → ${change.newAddress}`);
          break;
        case "removed":
          // Was previously deployed but is now absent — flag as MISSING in new registry.
          lines.push(`[REMOVED] ${change.name}: ${change.oldAddress} → (none) [MISSING in new registry]`);
          break;
        case "changed":
          lines.push(`[CHANGED] ${change.name}: ${change.oldAddress} → ${change.newAddress}`);
          break;
      }
    }

    const hasDrift = lines.length > 0;
    const summary = hasDrift
      ? `${network}: ${lines.length} change(s) detected`
      : `${network}: no drift`;

    return { network, summary, lines, hasDrift };
  });
}

/**
 * Severity assigned to a single contract-registry change so maintainers can
 * distinguish harmless metadata drift from dangerous address/network drift.
 *
 *  - `info`     — new deployment (`added`) or no change (`unchanged`); safe.
 *  - `warning`  — an address changed or was removed on testnet/local; worth
 *                 a look but not release-blocking on its own.
 *  - `blocking` — an address changed or was removed on mainnet; the highest
 *                 risk category, since it can silently redirect real funds.
 */
export type Severity = "info" | "warning" | "blocking";

export type SeverityChange = ContractChange & { network: NetworkName; severity: Severity };

/** Stable identifier for a single change, used by `shouldFailCi`'s acknowledgement set. */
export function changeKey(network: NetworkName, name: ContractName): string {
  return `${network}:${name}`;
}

/** Classifies a single `ContractChange` for the given network. */
export function classifyChangeSeverity(change: ContractChange, network: NetworkName): Severity {
  switch (change.type) {
    case "unchanged":
    case "added":
      return "info";
    case "changed":
    case "removed":
      return network === "mainnet" ? "blocking" : "warning";
  }
}

/** Flattens a `RegistryDiff` into every change across all networks, each tagged with its severity. */
export function classifyRegistryDiff(diff: RegistryDiff): SeverityChange[] {
  const networks: NetworkName[] = ["testnet", "mainnet", "local"];
  const result: SeverityChange[] = [];
  for (const network of networks) {
    for (const change of diff[network].changes) {
      result.push({ ...change, network, severity: classifyChangeSeverity(change, network) });
    }
  }
  return result;
}

/**
 * Returns `true` if CI should fail for this diff — i.e. there is at least
 * one `blocking` change whose key is not present in `acknowledged`.
 *
 * @param acknowledged - Set of `changeKey(network, name)` strings (e.g. from
 *   a PR label or a sign-off file) that maintainers have explicitly signed
 *   off on, letting CI pass despite the blocking severity.
 */
export function shouldFailCi(diff: RegistryDiff, acknowledged: ReadonlySet<string> = new Set()): boolean {
  return classifyRegistryDiff(diff).some(
    (change) =>
      change.severity === "blocking" && !acknowledged.has(changeKey(change.network, change.name)),
  );
}

/**
 * Renders a markdown release-notes section summarizing every non-unchanged
 * change across all networks, grouped by severity (blocking → warning →
 * info) so the riskiest changes surface first.
 */
export function generateReleaseNotes(diff: RegistryDiff): string {
  const changes = classifyRegistryDiff(diff).filter((c) => c.type !== "unchanged");

  const lines: string[] = ["## Contract Registry Changes"];

  if (changes.length === 0) {
    lines.push("", "No contract registry changes.");
    return lines.join("\n");
  }

  const order: Severity[] = ["blocking", "warning", "info"];
  const labels: Record<Severity, string> = {
    blocking: "🔴 Blocking",
    warning: "🟡 Warning",
    info: "🟢 Info",
  };

  for (const severity of order) {
    const group = changes.filter((c) => c.severity === severity);
    if (group.length === 0) continue;

    lines.push("", `### ${labels[severity]}`);
    for (const change of group) {
      const from = change.oldAddress ?? "(none)";
      const to = change.newAddress ?? "(none)";
      lines.push(`- **${change.network}/${change.name}**: ${change.type} — ${from} → ${to}`);
    }
  }

  return lines.join("\n");
}

export default diffRegistries;
