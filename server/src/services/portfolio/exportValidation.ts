/**
 * Portfolio Export Validation (#1051)
 *
 * Validates date windows and asset filters supplied as query parameters
 * to the portfolio export endpoints. All errors are collected up-front so
 * the client receives a complete list of what needs fixing in a single
 * response rather than one error at a time.
 */

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Maximum date range allowed for a single export request.
 * Prevents unbounded DB queries and downstream report timeouts.
 */
export const EXPORT_MAX_WINDOW_DAYS = 366;

/**
 * Canonical set of asset symbols the export pipeline supports.
 * Symbols are stored and compared in uppercase.
 */
export const EXPORT_SUPPORTED_ASSETS = new Set([
  "USDC",
  "XLM",
  "USDT",
  "BTC",
  "ETH",
  "AQUA",
  "BLND",
  "SORO",
]);

// ── Typed error shapes ────────────────────────────────────────────────────────

export type ExportValidationCode =
  | "MISSING_START_DATE"
  | "MISSING_END_DATE"
  | "INVALID_START_DATE"
  | "INVALID_END_DATE"
  | "DATE_WINDOW_REVERSED"
  | "DATE_WINDOW_TOO_LARGE"
  | "DATE_IN_FUTURE"
  | "UNSUPPORTED_ASSET"
  | "INVALID_ASSETS_PARAM"
  | "INVALID_FORMAT";

export interface ExportValidationError {
  /** Machine-readable code — stable across releases for frontend switch-cases. */
  code: ExportValidationCode;
  /** Human-readable description suitable for direct display. */
  message: string;
  /** Optional structured payload for the frontend to render rich error UI. */
  details?: Record<string, unknown>;
}

export interface ExportValidationResult {
  valid: boolean;
  errors: ExportValidationError[];
  /**
   * Parsed and normalised query values, present only when `valid` is true.
   * Use these to avoid re-parsing in the route handler.
   */
  parsed?: {
    startDate: Date | undefined;
    endDate: Date | undefined;
    assets: string[] | undefined;
    format: "csv" | "json";
  };
}

// ── Supported output formats ──────────────────────────────────────────────────

const SUPPORTED_FORMATS = new Set(["csv", "json"]);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Returns true when the string can be parsed as a valid, finite ISO-8601 date. */
function isValidIsoDate(value: string): boolean {
  const d = new Date(value);
  return Number.isFinite(d.getTime());
}

// ── Core validator ────────────────────────────────────────────────────────────

export interface ExportQueryParams {
  startDate?: string;
  endDate?: string;
  /** Comma-separated list of uppercase asset symbols, e.g. "USDC,XLM". */
  assets?: string;
  /** Output format; defaults to "csv". */
  format?: string;
}

/**
 * Validate portfolio export query parameters.
 *
 * Rules applied:
 * - `startDate` and `endDate` must both be absent, or both be present.
 * - When present, each must be a parseable ISO-8601 string.
 * - `startDate` must be strictly before `endDate`.
 * - Neither date may lie in the future.
 * - The range must not exceed {@link EXPORT_MAX_WINDOW_DAYS} days.
 * - `assets`, when provided, must be a comma-separated list where every
 *   symbol is in {@link EXPORT_SUPPORTED_ASSETS}.
 * - `format`, when provided, must be "csv" or "json".
 *
 * The function never throws — it returns a typed result instead.
 */
export function validateExportParams(
  params: ExportQueryParams,
): ExportValidationResult {
  const errors: ExportValidationError[] = [];
  const now = new Date();

  const { startDate: rawStart, endDate: rawEnd, assets: rawAssets, format: rawFormat } = params;

  const hasStart = rawStart !== undefined && rawStart !== "";
  const hasEnd = rawEnd !== undefined && rawEnd !== "";

  // ── Date presence checks ───────────────────────────────────────────────────

  if (hasStart && !hasEnd) {
    errors.push({
      code: "MISSING_END_DATE",
      message: "endDate is required when startDate is provided.",
    });
  }

  if (!hasStart && hasEnd) {
    errors.push({
      code: "MISSING_START_DATE",
      message: "startDate is required when endDate is provided.",
    });
  }

  // ── Date format & range checks ─────────────────────────────────────────────

  let startDate: Date | undefined;
  let endDate: Date | undefined;

  if (hasStart) {
    if (!isValidIsoDate(rawStart!)) {
      errors.push({
        code: "INVALID_START_DATE",
        message: `startDate "${rawStart}" is not a valid ISO-8601 date.`,
        details: { provided: rawStart },
      });
    } else {
      startDate = new Date(rawStart!);
      if (startDate > now) {
        errors.push({
          code: "DATE_IN_FUTURE",
          message: `startDate (${startDate.toISOString()}) cannot be in the future.`,
          details: { provided: startDate.toISOString(), now: now.toISOString() },
        });
      }
    }
  }

  if (hasEnd) {
    if (!isValidIsoDate(rawEnd!)) {
      errors.push({
        code: "INVALID_END_DATE",
        message: `endDate "${rawEnd}" is not a valid ISO-8601 date.`,
        details: { provided: rawEnd },
      });
    } else {
      endDate = new Date(rawEnd!);
      if (endDate > now) {
        errors.push({
          code: "DATE_IN_FUTURE",
          message: `endDate (${endDate.toISOString()}) cannot be in the future.`,
          details: { provided: endDate.toISOString(), now: now.toISOString() },
        });
      }
    }
  }

  // ── Cross-field date checks (only when both dates are individually valid) ───

  if (startDate !== undefined && endDate !== undefined) {
    if (startDate >= endDate) {
      errors.push({
        code: "DATE_WINDOW_REVERSED",
        message: `startDate (${startDate.toISOString()}) must be strictly before endDate (${endDate.toISOString()}).`,
        details: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
      });
    } else {
      const windowDays = Math.ceil(
        (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
      );
      if (windowDays > EXPORT_MAX_WINDOW_DAYS) {
        errors.push({
          code: "DATE_WINDOW_TOO_LARGE",
          message: `Date range (${windowDays} days) exceeds the maximum of ${EXPORT_MAX_WINDOW_DAYS} days.`,
          details: { windowDays, maxWindowDays: EXPORT_MAX_WINDOW_DAYS },
        });
      }
    }
  }

  // ── Asset filter checks ────────────────────────────────────────────────────

  let parsedAssets: string[] | undefined;

  if (rawAssets !== undefined && rawAssets !== "") {
    // Reject obviously malformed values (e.g. leading/trailing commas produce empty segments)
    const segments = rawAssets.split(",").map((s) => s.trim());

    if (segments.some((s) => s === "")) {
      errors.push({
        code: "INVALID_ASSETS_PARAM",
        message:
          'The "assets" parameter must be a comma-separated list of asset symbols with no empty entries (e.g. "USDC,XLM").',
        details: { provided: rawAssets },
      });
    } else {
      const uppercased = segments.map((s) => s.toUpperCase());
      const unknown = uppercased.filter((s) => !EXPORT_SUPPORTED_ASSETS.has(s));

      if (unknown.length > 0) {
        errors.push({
          code: "UNSUPPORTED_ASSET",
          message: `Unsupported asset filter(s): ${unknown.join(", ")}. Supported assets are: ${[...EXPORT_SUPPORTED_ASSETS].join(", ")}.`,
          details: {
            unsupported: unknown,
            supported: [...EXPORT_SUPPORTED_ASSETS],
          },
        });
      } else {
        // Deduplicate while preserving order
        parsedAssets = [...new Set(uppercased)];
      }
    }
  }

  // ── Format check ─────────────────────────────────────────────────────────

  let parsedFormat: "csv" | "json" = "csv";

  if (rawFormat !== undefined && rawFormat !== "") {
    const lower = rawFormat.toLowerCase();
    if (!SUPPORTED_FORMATS.has(lower)) {
      errors.push({
        code: "INVALID_FORMAT",
        message: `Unsupported format "${rawFormat}". Supported formats are: csv, json.`,
        details: { provided: rawFormat, supported: ["csv", "json"] },
      });
    } else {
      parsedFormat = lower as "csv" | "json";
    }
  }

  // ── Result ────────────────────────────────────────────────────────────────

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    errors: [],
    parsed: {
      startDate,
      endDate,
      assets: parsedAssets,
      format: parsedFormat,
    },
  };
}
