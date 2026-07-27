/**
 * Tests for portfolio export parameter validation (#1051)
 *
 * Covers:
 *  - date window validation (reversed, oversized, future, missing partner)
 *  - asset filter validation (unknown symbols, malformed strings)
 *  - format validation
 *  - all-clear (valid combinations)
 *  - route-level rejection via supertest
 */

import request from "supertest";
import express from "express";
import {
  validateExportParams,
  EXPORT_MAX_WINDOW_DAYS,
  EXPORT_SUPPORTED_ASSETS,
} from "../services/portfolio/exportValidation";

// ── Unit tests: validateExportParams ────────────────────────────────────────

describe("validateExportParams — unit", () => {
  // ── Happy paths ────────────────────────────────────────────────────────────

  it("returns valid with no params provided", () => {
    const result = validateExportParams({});
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.parsed?.startDate).toBeUndefined();
    expect(result.parsed?.endDate).toBeUndefined();
    expect(result.parsed?.assets).toBeUndefined();
    expect(result.parsed?.format).toBe("csv");
  });

  it("accepts a valid date window within the limit", () => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    expect(result.valid).toBe(true);
    expect(result.parsed?.startDate).toEqual(new Date(start.toISOString()));
    expect(result.parsed?.endDate).toEqual(new Date(end.toISOString()));
  });

  it("accepts a valid single-asset filter", () => {
    const result = validateExportParams({ assets: "USDC" });
    expect(result.valid).toBe(true);
    expect(result.parsed?.assets).toEqual(["USDC"]);
  });

  it("accepts multiple valid assets and deduplicates them", () => {
    const result = validateExportParams({ assets: "USDC,XLM,USDC" });
    expect(result.valid).toBe(true);
    expect(result.parsed?.assets).toEqual(["USDC", "XLM"]);
  });

  it("normalises asset symbols to uppercase", () => {
    const result = validateExportParams({ assets: "usdc,xlm" });
    expect(result.valid).toBe(true);
    expect(result.parsed?.assets).toEqual(["USDC", "XLM"]);
  });

  it('accepts format "json"', () => {
    const result = validateExportParams({ format: "json" });
    expect(result.valid).toBe(true);
    expect(result.parsed?.format).toBe("json");
  });

  it('accepts format "csv"', () => {
    const result = validateExportParams({ format: "csv" });
    expect(result.valid).toBe(true);
    expect(result.parsed?.format).toBe("csv");
  });

  it("accepts format in any case (JSON, Csv)", () => {
    expect(validateExportParams({ format: "JSON" }).parsed?.format).toBe("json");
    expect(validateExportParams({ format: "Csv" }).parsed?.format).toBe("csv");
  });

  it("accepts a date window exactly at the maximum allowed size", () => {
    const start = new Date();
    start.setDate(start.getDate() - EXPORT_MAX_WINDOW_DAYS);
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    expect(result.valid).toBe(true);
  });

  // ── Date: missing partner ──────────────────────────────────────────────────

  it("rejects startDate without endDate", () => {
    const start = new Date();
    start.setDate(start.getDate() - 5);

    const result = validateExportParams({ startDate: start.toISOString() });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("MISSING_END_DATE");
  });

  it("rejects endDate without startDate", () => {
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const result = validateExportParams({ endDate: end.toISOString() });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("MISSING_START_DATE");
  });

  // ── Date: invalid formats ──────────────────────────────────────────────────

  it("rejects a non-date string as startDate", () => {
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const result = validateExportParams({
      startDate: "not-a-date",
      endDate: end.toISOString(),
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("INVALID_START_DATE");
  });

  it("rejects a non-date string as endDate", () => {
    const start = new Date();
    start.setDate(start.getDate() - 10);

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: "31-13-2025", // invalid month
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("INVALID_END_DATE");
  });

  // ── Date: reversed range ───────────────────────────────────────────────────

  it("rejects a reversed date window (startDate > endDate)", () => {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() - 10);

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("DATE_WINDOW_REVERSED");
  });

  it("rejects equal startDate and endDate (zero-length range)", () => {
    const same = new Date();
    same.setDate(same.getDate() - 5);
    const iso = same.toISOString();

    const result = validateExportParams({ startDate: iso, endDate: iso });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("DATE_WINDOW_REVERSED");
  });

  // ── Date: future ───────────────────────────────────────────────────────────

  it("rejects a startDate in the future", () => {
    const future = new Date();
    future.setDate(future.getDate() + 10);
    const end = new Date();
    end.setDate(end.getDate() + 20);

    const result = validateExportParams({
      startDate: future.toISOString(),
      endDate: end.toISOString(),
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("DATE_IN_FUTURE");
  });

  it("rejects an endDate in the future", () => {
    const start = new Date();
    start.setDate(start.getDate() - 10);
    const future = new Date();
    future.setDate(future.getDate() + 5);

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: future.toISOString(),
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("DATE_IN_FUTURE");
  });

  // ── Date: overly large window ──────────────────────────────────────────────

  it("rejects a date window larger than the maximum", () => {
    const start = new Date();
    start.setFullYear(start.getFullYear() - 3); // 3 years back, well over 366 days
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("DATE_WINDOW_TOO_LARGE");
    expect(result.errors[0].details?.maxWindowDays).toBe(EXPORT_MAX_WINDOW_DAYS);
  });

  it("includes the window size and max in the error details", () => {
    const start = new Date("2020-01-01T00:00:00Z");
    const end = new Date("2022-01-01T00:00:00Z");

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
    });

    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "DATE_WINDOW_TOO_LARGE");
    expect(err).toBeDefined();
    expect(typeof err?.details?.windowDays).toBe("number");
    expect((err?.details?.windowDays as number)).toBeGreaterThan(EXPORT_MAX_WINDOW_DAYS);
  });

  // ── Asset filters ──────────────────────────────────────────────────────────

  it("rejects an unknown asset symbol", () => {
    const result = validateExportParams({ assets: "FAKE" });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("UNSUPPORTED_ASSET");
    expect(result.errors[0].details?.unsupported).toContain("FAKE");
  });

  it("rejects a mix of valid and unknown asset symbols", () => {
    const result = validateExportParams({ assets: "USDC,UNKNOWN,XLM" });

    expect(result.valid).toBe(false);
    const err = result.errors.find((e) => e.code === "UNSUPPORTED_ASSET");
    expect(err?.details?.unsupported).toEqual(["UNKNOWN"]);
  });

  it("includes the supported asset list in the error details", () => {
    const result = validateExportParams({ assets: "DOGECOIN" });

    expect(result.valid).toBe(false);
    const err = result.errors[0];
    expect(Array.isArray(err.details?.supported)).toBe(true);
    for (const sym of EXPORT_SUPPORTED_ASSETS) {
      expect((err.details?.supported as string[]).includes(sym)).toBe(true);
    }
  });

  it("rejects a malformed assets param with an empty segment", () => {
    const result = validateExportParams({ assets: "USDC,,XLM" });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("INVALID_ASSETS_PARAM");
  });

  it("rejects assets param with a leading comma", () => {
    const result = validateExportParams({ assets: ",USDC" });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("INVALID_ASSETS_PARAM");
  });

  it("rejects assets param with a trailing comma", () => {
    const result = validateExportParams({ assets: "USDC," });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("INVALID_ASSETS_PARAM");
  });

  // ── Format ─────────────────────────────────────────────────────────────────

  it("rejects an unsupported format value", () => {
    const result = validateExportParams({ format: "xml" });

    expect(result.valid).toBe(false);
    expect(result.errors[0].code).toBe("INVALID_FORMAT");
  });

  it("includes the unsupported format in the error details", () => {
    const result = validateExportParams({ format: "pdf" });
    expect(result.errors[0].details?.provided).toBe("pdf");
  });

  // ── Multiple simultaneous errors ───────────────────────────────────────────

  it("accumulates multiple independent errors in one response", () => {
    const result = validateExportParams({
      assets: "FAKE",
      format: "xml",
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("UNSUPPORTED_ASSET");
    expect(codes).toContain("INVALID_FORMAT");
  });

  it("accumulates date and asset errors together", () => {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() - 10); // reversed

    const result = validateExportParams({
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      assets: "NOTREAL",
    });

    expect(result.valid).toBe(false);
    const codes = result.errors.map((e) => e.code);
    expect(codes).toContain("DATE_WINDOW_REVERSED");
    expect(codes).toContain("UNSUPPORTED_ASSET");
  });

  // ── Error shapes are stable ────────────────────────────────────────────────

  it("every error has a non-empty code and message", () => {
    const result = validateExportParams({
      startDate: "bad",
      endDate: "alsoBad",
      assets: "FAKE",
      format: "xml",
    });

    expect(result.valid).toBe(false);
    for (const err of result.errors) {
      expect(typeof err.code).toBe("string");
      expect(err.code.length).toBeGreaterThan(0);
      expect(typeof err.message).toBe("string");
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});

// ── Route-level integration tests ────────────────────────────────────────────

/**
 * We build a minimal express app that wires up validateWalletAddress and
 * validateExportQuery directly — without the rate-limiter — so the
 * middleware chain can be exercised end-to-end without a real DB or
 * triggering 429s during repeated test runs.
 */
import { validateWalletAddress } from "../middleware/validation";
import {
  validateExportParams as _vep,
  type ExportValidationResult as _EVR,
} from "../services/portfolio/exportValidation";
import { sendError as _sendError } from "../utils/errorResponse";
import { Router, NextFunction } from "express";

// A 56-character Stellar G-address that passes the /^[GC][A-Z2-7]{55}$/ check.
const VALID_ADDRESS = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function makeValidateExportQuery() {
  return function validateExportQuery(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const result: _EVR = _vep({
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      assets: req.query.assets as string | undefined,
      format: req.query.format as string | undefined,
    });
    if (!result.valid) {
      _sendError(res, 400, "INVALID_EXPORT_PARAMS", "One or more export parameters are invalid.", result.errors);
      return;
    }
    res.locals.exportParams = result.parsed;
    next();
  };
}

const testRouter = Router();
testRouter.get("/:address/export/preview", validateWalletAddress, makeValidateExportQuery(), (_req, res) => {
  res.status(503).json({ error: "DB_UNAVAILABLE", message: "stub" });
});
testRouter.get("/:address/export", validateWalletAddress, makeValidateExportQuery(), (_req, res) => {
  res.status(503).json({ error: "DB_UNAVAILABLE", message: "stub" });
});

const app = express();
app.use(express.json());
app.use("/api/users", testRouter);

describe("Export route — validation middleware integration", () => {
  // ── Invalid wallet address ─────────────────────────────────────────────────

  it("rejects a short / invalid wallet address with 400", async () => {
    const res = await request(app).get("/api/users/BADADDR/export/preview");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_ADDRESS");
  });

  // ── Reversed date range ────────────────────────────────────────────────────

  it("rejects a reversed date window on /export/preview with 400", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() - 10);

    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_EXPORT_PARAMS");
    expect(res.body.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "DATE_WINDOW_REVERSED" }),
      ]),
    );
  });

  it("rejects a reversed date window on /export with 400", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() - 10);

    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export`)
      .query({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_EXPORT_PARAMS");
  });

  // ── Overly large range ─────────────────────────────────────────────────────

  it("rejects a date range over the max window on /export/preview", async () => {
    const start = new Date("2019-01-01T00:00:00Z");
    const end = new Date("2022-01-01T00:00:00Z");

    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({ startDate: start.toISOString(), endDate: end.toISOString() });

    expect(res.status).toBe(400);
    const codes = (res.body.details as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("DATE_WINDOW_TOO_LARGE");
  });

  // ── Missing partner date ───────────────────────────────────────────────────

  it("rejects startDate without endDate on /export/preview", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 5);

    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({ startDate: start.toISOString() });

    expect(res.status).toBe(400);
    const codes = (res.body.details as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("MISSING_END_DATE");
  });

  it("rejects endDate without startDate on /export", async () => {
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export`)
      .query({ endDate: end.toISOString() });

    expect(res.status).toBe(400);
    const codes = (res.body.details as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("MISSING_START_DATE");
  });

  // ── Unknown asset filters ──────────────────────────────────────────────────

  it("rejects an unknown asset filter on /export/preview", async () => {
    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({ assets: "DOGECOINER" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_EXPORT_PARAMS");
    const codes = (res.body.details as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("UNSUPPORTED_ASSET");
  });

  it("rejects an unknown asset filter on /export", async () => {
    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export`)
      .query({ assets: "DOGECOINER" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INVALID_EXPORT_PARAMS");
  });

  it("rejects a malformed assets param on /export/preview", async () => {
    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({ assets: "USDC,,XLM" });

    expect(res.status).toBe(400);
    const codes = (res.body.details as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("INVALID_ASSETS_PARAM");
  });

  // ── Invalid format ─────────────────────────────────────────────────────────

  it("rejects an unsupported format on /export/preview", async () => {
    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({ format: "xlsx" });

    expect(res.status).toBe(400);
    const codes = (res.body.details as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("INVALID_FORMAT");
  });

  // ── Multiple errors in one response ───────────────────────────────────────

  it("returns all errors together when multiple params are invalid", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 1);
    const end = new Date();
    end.setDate(end.getDate() - 10);

    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        assets: "NOTREAL",
        format: "xml",
      });

    expect(res.status).toBe(400);
    const codes = (res.body.details as Array<{ code: string }>).map((e) => e.code);
    expect(codes).toContain("DATE_WINDOW_REVERSED");
    expect(codes).toContain("UNSUPPORTED_ASSET");
    expect(codes).toContain("INVALID_FORMAT");
    expect(codes.length).toBeGreaterThanOrEqual(3);
  });

  // ── Valid params pass through ──────────────────────────────────────────────

  it("passes through valid params and does not return 400 for param issues", async () => {
    const start = new Date();
    start.setDate(start.getDate() - 30);
    const end = new Date();
    end.setDate(end.getDate() - 1);

    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        assets: "USDC,XLM",
        format: "json",
      });

    // The stub handler returns 503 — but NOT a 400 from param validation.
    expect(res.status).not.toBe(400);
  });

  // ── Error response structure is stable ────────────────────────────────────

  it("error response always includes error code, message, and details array", async () => {
    const res = await request(app)
      .get(`/api/users/${VALID_ADDRESS}/export/preview`)
      .query({ assets: "FAKE" });

    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
    expect(typeof res.body.message).toBe("string");
    expect(Array.isArray(res.body.details)).toBe(true);
    for (const item of res.body.details as unknown[]) {
      expect(item).toMatchObject({ code: expect.any(String), message: expect.any(String) });
    }
  });
});
