/**
 * Deterministic fake RPC and Horizon adapters for SDK and client tests.
 *
 * Usage: import the scenario factory you need, pass the resulting fake object
 * wherever SorobanRpc.Server or a fetch-compatible function is expected.
 *
 * Scenarios
 * ---------
 *   simulationSuccess   – simulate returns a well-formed success result
 *   simulationFailure   – simulate returns a contract execution error (code 5)
 *   submissionTimeout   – send returns PENDING; all poll calls return NOT_FOUND
 *   restoreSuccess      – first simulate returns restore preamble; second succeeds
 *   finalFailure        – send returns FAILED status immediately
 */

// ── Type stubs matching the @stellar/stellar-sdk SorobanRpc shapes ──────────
// We replicate only the fields our code actually reads so tests compile without
// importing the full stellar-sdk in every test file.

export interface FakeSimulateSuccess {
  result: { retval: unknown };
  restorePreamble?: never;
  error?: never;
}

export interface FakeSimulateRestore {
  result?: never;
  restorePreamble: { minResourceFee: string; transactionData: unknown };
  error?: never;
}

export interface FakeSimulateError {
  result?: never;
  restorePreamble?: never;
  error: string;
}

export type FakeSimulateResult = FakeSimulateSuccess | FakeSimulateRestore | FakeSimulateError;

export interface FakeSendResult {
  hash: string;
  status: "PENDING" | "ERROR" | "DUPLICATE" | "TRY_AGAIN_LATER";
  errorResultXdr?: string;
}

export interface FakePollResult {
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  resultMetaXdr?: string;
  resultXdr?: string;
}

// ── FakeSorobanRpc ───────────────────────────────────────────────────────────

/**
 * Fake SorobanRpc.Server that returns scripted responses.
 * Extend via `overrides` to adjust individual method behaviour per test.
 */
export class FakeSorobanRpc {
  private simulateResponses: FakeSimulateResult[];
  private sendResponse: FakeSendResult;
  private pollResponses: FakePollResult[];
  private simulateCallCount = 0;
  private pollCallCount = 0;

  constructor(opts: {
    simulateResponses: FakeSimulateResult[];
    sendResponse: FakeSendResult;
    pollResponses: FakePollResult[];
  }) {
    this.simulateResponses = opts.simulateResponses;
    this.sendResponse = opts.sendResponse;
    this.pollResponses = opts.pollResponses;
  }

  simulateTransaction(_tx: unknown): Promise<FakeSimulateResult> {
    const resp =
      this.simulateResponses[this.simulateCallCount] ??
      this.simulateResponses[this.simulateResponses.length - 1];
    this.simulateCallCount++;
    return Promise.resolve(resp);
  }

  sendTransaction(_tx: unknown): Promise<FakeSendResult> {
    return Promise.resolve(this.sendResponse);
  }

  getTransaction(_hash: string): Promise<FakePollResult> {
    const resp =
      this.pollResponses[this.pollCallCount] ??
      this.pollResponses[this.pollResponses.length - 1];
    this.pollCallCount++;
    return Promise.resolve(resp);
  }
}

// ── Scenario factories ───────────────────────────────────────────────────────

/** Simulate succeeds, returning a BigInt 1000n as retval. */
export function simulationSuccess(retval: unknown = BigInt(1000)): FakeSorobanRpc {
  return new FakeSorobanRpc({
    simulateResponses: [{ result: { retval } }],
    sendResponse: { hash: "AAA0000", status: "PENDING" },
    pollResponses: [{ status: "SUCCESS", resultXdr: "" }],
  });
}

/** Simulate returns a contract execution error (code 5 — unauthorized). */
export function simulationFailure(): FakeSorobanRpc {
  return new FakeSorobanRpc({
    simulateResponses: [{ error: "Error(Contract, #5)" }],
    sendResponse: { hash: "BBB0000", status: "ERROR" },
    pollResponses: [{ status: "NOT_FOUND" }],
  });
}

/**
 * Send returns PENDING; all poll calls return NOT_FOUND, simulating a timeout
 * where the transaction never lands.
 */
export function submissionTimeout(): FakeSorobanRpc {
  return new FakeSorobanRpc({
    simulateResponses: [{ result: { retval: BigInt(1000) } }],
    sendResponse: { hash: "CCC0000", status: "PENDING" },
    pollResponses: [{ status: "NOT_FOUND" }],
  });
}

/**
 * First simulate returns a restore preamble; second simulate (after restore
 * footprint is applied) returns a normal success. Send + poll succeed.
 */
export function restoreSuccess(): FakeSorobanRpc {
  return new FakeSorobanRpc({
    simulateResponses: [
      {
        restorePreamble: {
          minResourceFee: "500",
          transactionData: null,
        },
      },
      { result: { retval: BigInt(1000) } },
    ],
    sendResponse: { hash: "DDD0000", status: "PENDING" },
    pollResponses: [{ status: "SUCCESS", resultXdr: "" }],
  });
}

/** Send returns PENDING; first poll returns FAILED. */
export function finalFailure(): FakeSorobanRpc {
  return new FakeSorobanRpc({
    simulateResponses: [{ result: { retval: BigInt(1000) } }],
    sendResponse: { hash: "EEE0000", status: "PENDING" },
    pollResponses: [
      { status: "FAILED", resultXdr: "AAAAAAAAAA==" },
    ],
  });
}

// ── FakeHorizonFetch ─────────────────────────────────────────────────────────

export interface FakeHorizonAccount {
  id: string;
  balances: Array<{ asset_type: string; balance: string }>;
}

/**
 * Returns a fetch-compatible function that responds to Horizon account
 * endpoint calls with scripted data. Pass as `globalThis.fetch` in unit tests.
 *
 * @example
 * const fetchFn = fakeHorizonFetch({ id: "GB...", balances: [{ asset_type: "native", balance: "100.0000000" }] });
 * const resp = await fetchFn("https://horizon.stellar.org/accounts/GB...");
 */
export function fakeHorizonFetch(
  account: FakeHorizonAccount,
  status = 200
): typeof fetch {
  return (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
    if (status !== 200) {
      return Promise.resolve(
        new Response(JSON.stringify({ detail: "server error" }), { status })
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(account), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
  };
}

/** A Horizon fetch that always returns HTTP 500. */
export function fakeHorizonFetchError(): typeof fetch {
  return fakeHorizonFetch({ id: "", balances: [] }, 500);
}
