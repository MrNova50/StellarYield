import * as StellarSdk from "@stellar/stellar-sdk";
import type { AdminAction, AdminActionOption } from "./types";

export interface ValidationError {
  field: string;
  message: string;
}

export interface ValidationSummary {
  isValid: boolean;
  errors: ValidationError[];
  action: string;
  target: string;
  risk: "low" | "medium" | "high" | "critical";
}

/** Supported signer address formats for governance. */
const SIGNER_FORMAT_REGEX = /^G[A-Z2-7]{55}$/;

/**
 * Validate a list of signer addresses for the governance config panel.
 * Checks:
 *  - Non-empty signer set
 *  - Each address is a valid Stellar G-address
 *  - No duplicate signers
 */
export interface SignerSetValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

export function validateSignerSet(signers: string[]): SignerSetValidationResult {
  const errors: ValidationError[] = [];

  if (signers.length === 0) {
    errors.push({
      field: "signers",
      message: "At least one signer address is required.",
    });
    return { isValid: false, errors };
  }

  const seen = new Set<string>();
  signers.forEach((address, idx) => {
    if (!address) {
      errors.push({
        field: `signers[${idx}]`,
        message: `Signer ${idx + 1}: address cannot be empty.`,
      });
      return;
    }
    if (!SIGNER_FORMAT_REGEX.test(address)) {
      errors.push({
        field: `signers[${idx}]`,
        message: `Signer ${idx + 1}: "${address.slice(0, 8)}..." is not a valid Stellar address (must start with G and be 56 characters).`,
      });
      return;
    }
    if (seen.has(address)) {
      errors.push({
        field: `signers[${idx}]`,
        message: `Signer ${idx + 1}: duplicate address "${address.slice(0, 8)}..." — each signer must be unique.`,
      });
    }
    seen.add(address);
  });

  return { isValid: errors.length === 0, errors };
}

/**
 * Validate the governance threshold against the signer set size.
 * Checks:
 *  - threshold >= 1
 *  - threshold <= signers.length
 */
export interface ThresholdValidationResult {
  isValid: boolean;
  error: ValidationError | null;
}

export function validateThreshold(
  threshold: number,
  signerCount: number,
): ThresholdValidationResult {
  if (!Number.isInteger(threshold) || threshold < 1) {
    return {
      isValid: false,
      error: {
        field: "threshold",
        message: "Threshold must be a whole number of at least 1.",
      },
    };
  }
  if (signerCount === 0) {
    return {
      isValid: false,
      error: {
        field: "threshold",
        message: "Cannot set a threshold when there are no signers.",
      },
    };
  }
  if (threshold > signerCount) {
    return {
      isValid: false,
      error: {
        field: "threshold",
        message: `Threshold (${threshold}) cannot exceed the number of signers (${signerCount}).`,
      },
    };
  }
  return { isValid: true, error: null };
}

export function getRiskLevel(action: AdminAction): "low" | "medium" | "high" | "critical" {
  switch (action) {
    case "emergency_pause":
    case "emergency_unpause":
      return "critical";
    case "rescue_funds":
    case "set_admin":
      return "critical";
    case "remove_keeper":
    case "set_fee_bounds":
      return "high";
    case "register_keeper":
    case "set_keeper_fee":
      return "medium";
    default:
      return "low";
  }
}

export function validateAddress(address: string): boolean {
  if (!address) return false;
  try {
    new StellarSdk.Address(address);
    return address.length === 56 && address.startsWith("G");
  } catch {
    return false;
  }
}

export function validateNumber(value: string, min?: number, max?: number): boolean {
  if (!value) return false;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return false;
  if (min !== undefined && num < min) return false;
  if (max !== undefined && num > max) return false;
  return true;
}

export function validateTransactionBuilder(
  action: AdminActionOption | undefined,
  walletAddress: string | null,
  fieldValues: Record<string, string>,
): ValidationSummary | null {
  if (!action || !walletAddress) return null;

  const errors: ValidationError[] = [];

  // Validate wallet address
  if (!validateAddress(walletAddress)) {
    errors.push({
      field: "wallet",
      message: "Invalid wallet address",
    });
  }

  // Validate action-specific fields
  for (const field of action.fields) {
    const value = fieldValues[field.name] ?? "";

    if (field.required && !value) {
      errors.push({
        field: field.name,
        message: `${field.label} is required`,
      });
      continue;
    }

    if (value) {
      if (field.type === "address" && !validateAddress(value)) {
        errors.push({
          field: field.name,
          message: `${field.label} must be a valid Stellar address`,
        });
      } else if (field.type === "number") {
        // Special validation for specific fields
        if (field.name === "fee_bps" && !validateNumber(value, 0, 10000)) {
          errors.push({
            field: field.name,
            message: `${field.label} must be between 0 and 10000`,
          });
        } else if (field.name === "min_bps" && !validateNumber(value, 0, 10000)) {
          errors.push({
            field: field.name,
            message: `${field.label} must be between 0 and 10000`,
          });
        } else if (field.name === "max_bps" && !validateNumber(value, 0, 10000)) {
          errors.push({
            field: field.name,
            message: `${field.label} must be between 0 and 10000`,
          });
        } else if (field.name === "amount" && !validateNumber(value, 1)) {
          errors.push({
            field: field.name,
            message: `${field.label} must be greater than 0`,
          });
        } else if (!validateNumber(value)) {
          errors.push({
            field: field.name,
            message: `${field.label} must be a valid positive number`,
          });
        }
      }
    }
  }

  // Cross-field validation for fee bounds
  if (action.method === "set_fee_bounds") {
    const minBps = Number(fieldValues.min_bps);
    const maxBps = Number(fieldValues.max_bps);
    if (
      Number.isFinite(minBps) &&
      Number.isFinite(maxBps) &&
      minBps >= maxBps
    ) {
      errors.push({
        field: "max_bps",
        message: "Max fee must be greater than min fee",
      });
    }
  }

  // Build target description
  let target = "N/A";
  if (action.method === "register_keeper" || action.method === "remove_keeper") {
    target = fieldValues.keeper ? `${fieldValues.keeper.slice(0, 8)}...` : "Not specified";
  } else if (action.method === "rescue_funds") {
    target = fieldValues.target ? `${fieldValues.target.slice(0, 8)}...` : "Not specified";
  } else if (action.method === "set_admin") {
    target = fieldValues.new_admin ? `${fieldValues.new_admin.slice(0, 8)}...` : "Not specified";
  } else if (action.method === "set_keeper_fee") {
    target = fieldValues.fee_bps ? `${fieldValues.fee_bps} bps` : "Not specified";
  } else if (action.method === "set_fee_bounds") {
    target = fieldValues.min_bps && fieldValues.max_bps
      ? `${fieldValues.min_bps}-${fieldValues.max_bps} bps`
      : "Not specified";
  }

  return {
    isValid: errors.length === 0,
    errors,
    action: action.label,
    target,
    risk: getRiskLevel(action.method),
  };
}
