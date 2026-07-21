import { VaultError } from "./generated/yield_vault";

export const VAULT_ERROR_MESSAGES: Record<number, string> = {
  1: "Contract not initialized",
  2: "Contract already initialized",
  3: "Amount must be strictly greater than zero",
  4: "Insufficient shares available for operation",
  5: "Caller is unauthorized for this operation",
  6: "Total vault supply is zero",
  7: "Vault operations are currently paused",
  8: "Timelock is currently active",
  9: "Invalid oracle price",
  10: "Slippage tolerance exceeded",
  11: "Storage key not found",
  2001: "Invalid donation basis points (must be 0-10,000)",
  2002: "Charity address is not on protocol whitelist",
};

export abstract class SorobanSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ContractExecutionError extends SorobanSdkError {
  public readonly errorCode: number;
  public readonly errorName: string;
  public readonly rawResultXdr?: string;
  public readonly diagnosticEvents?: string[];

  constructor(
    errorCode: number,
    errorName: string,
    message: string,
    rawResultXdr?: string,
    diagnosticEvents?: string[]
  ) {
    super(`Contract Execution Error [${errorCode} ${errorName}]: ${message}`);
    this.errorCode = errorCode;
    this.errorName = errorName;
    this.rawResultXdr = rawResultXdr;
    this.diagnosticEvents = diagnosticEvents;
  }
}

export class WrongNetworkError extends SorobanSdkError {
  public readonly expectedNetwork: string;
  public readonly actualNetwork: string;

  constructor(expectedNetwork: string, actualNetwork: string) {
    super(
      `Network passphrase mismatch: expected '${expectedNetwork}', received '${actualNetwork}'`
    );
    this.expectedNetwork = expectedNetwork;
    this.actualNetwork = actualNetwork;
  }
}

export class SpecMismatchError extends SorobanSdkError {
  public readonly expectedHash: string;
  public readonly actualHash: string;

  constructor(expectedHash: string, actualHash: string) {
    super(
      `Contract spec hash mismatch: expected '${expectedHash}', got '${actualHash}'`
    );
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

export class StaleSimulationError extends SorobanSdkError {
  public readonly currentLedger: number;
  public readonly validUntilLedger: number;

  constructor(currentLedger: number, validUntilLedger: number) {
    super(
      `Simulation snapshot is stale (valid until ledger ${validUntilLedger}, current ledger ${currentLedger})`
    );
    this.currentLedger = currentLedger;
    this.validUntilLedger = validUntilLedger;
  }
}

export class SubmissionTimeoutError extends SorobanSdkError {
  public readonly txHash: string;
  public readonly timeoutMs: number;

  constructor(txHash: string, timeoutMs: number) {
    super(
      `Transaction '${txHash}' pending inclusion timed out after ${timeoutMs}ms. Transaction may still land on-chain; use recoverTransaction() to check.`
    );
    this.txHash = txHash;
    this.timeoutMs = timeoutMs;
  }
}

export class WalletRejectedError extends SorobanSdkError {
  constructor(reason?: string) {
    super(reason ? `Wallet rejected signature: ${reason}` : "Wallet rejected signature");
  }
}

export class InvalidXdrError extends SorobanSdkError {
  public readonly rawXdr: string;

  constructor(rawXdr: string, details?: string) {
    super(`Failed to parse or validate XDR string: ${details || "Invalid XDR"}`);
    this.rawXdr = rawXdr;
  }
}

export class MissingAuthError extends SorobanSdkError {
  public readonly requiredAddress: string;

  constructor(requiredAddress: string) {
    super(
      `Transaction simulation requires authorization entry for '${requiredAddress}'`
    );
    this.requiredAddress = requiredAddress;
  }
}

export function decodeVaultError(code: number): { name: string; message: string } {
  const generatedMeta = (VaultError as Record<number, { message: string }>)[code];
  const name = generatedMeta ? generatedMeta.message : `UnknownError_${code}`;
  const message = VAULT_ERROR_MESSAGES[code] || `Contract error code ${code}`;
  return { name, message };
}

export function parseContractError(
  error: unknown,
  rawResultXdr?: string,
  diagnosticEvents?: string[]
): SorobanSdkError {
  if (error instanceof SorobanSdkError) {
    return error;
  }

  const errString = String(error);
  // Match numeric contract error code patterns e.g. Error(Contract, #5) or ErrorCode(5)
  const codeMatch = errString.match(/(?:Error\(Contract,\s*#(\d+)\)|ErrorCode\((\d+)\)|Error\s*(\d+))/i);
  if (codeMatch) {
    const codeNum = parseInt(codeMatch[1] || codeMatch[2] || codeMatch[3], 10);
    const { name, message } = decodeVaultError(codeNum);
    return new ContractExecutionError(codeNum, name, message, rawResultXdr, diagnosticEvents);
  }

  return new ContractExecutionError(
    999,
    "GenericSorobanError",
    errString || "Unknown Soroban contract execution failure",
    rawResultXdr,
    diagnosticEvents
  );
}
