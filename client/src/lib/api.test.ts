import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  apiUrl,
  getApiBaseUrl,
  getApiBaseUrlState,
  apiFetch,
  getApiBaseUrlOrNull,
  cachedApiFetch,
} from "./api";

vi.mock("./apiCache", () => ({
  isEndpointCachable: vi.fn(),
  getCacheEntry: vi.fn(),
  setCache: vi.fn(),
  getCache: vi.fn(),
  clearCache: vi.fn(),
  getCacheAge: vi.fn(),
  getCachedEndpointList: vi.fn(),
  SAFE_CACHE_ENDPOINTS: new Set(["/api/yields"]),
}));
vi.mock("../components/dashboard/freshnessDecay", () => ({
  computeDecayedFreshnessConfidence: vi.fn(),
}));

describe("api URL helpers", () => {
  const originalWindow = global.window;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    global.window = originalWindow;
  });

  const env = (values: Record<string, string>): ImportMetaEnv =>
    ({
      BASE_URL: "/",
      MODE: "test",
      DEV: false,
      PROD: false,
      SSR: false,
      ...values,
    }) as ImportMetaEnv;

  it("uses the local backend by default when on localhost", () => {
    global.window = { location: { hostname: "localhost" } } as any;
    expect(getApiBaseUrl(env({}))).toBe("http://localhost:3001");
  });

  it("uses the local backend by default for IPv4 and IPv6 local hosts", () => {
    global.window = { location: { hostname: "127.0.0.1" } } as any;
    expect(getApiBaseUrl(env({}))).toBe("http://localhost:3001");

    global.window = { location: { hostname: "::1" } } as any;
    expect(getApiBaseUrl(env({}))).toBe("http://localhost:3001");
  });

  describe("getApiBaseUrl", () => {
    it("uses the local backend by default when on localhost", () => {
      global.window = { location: { hostname: 'localhost' } } as any;
      expect(getApiBaseUrl(env({}))).toBe("http://localhost:3001");
    });

    it("prefers VITE_API_BASE_URL and trims trailing slashes", () => {
      expect(
        getApiBaseUrl(env({
          VITE_API_BASE_URL: "https://api.example.com///",
          VITE_API_URL: "https://ignored.example.com",
        })),
      ).toBe("https://api.example.com");
    });

    it("falls back to VITE_API_URL", () => {
      expect(
        getApiBaseUrl(env({
          VITE_API_URL: "https://staging.example.com/",
        })),
      ).toBe("https://staging.example.com");
    });

    it("builds normalized API paths", () => {
      const configuredEnv = env({ VITE_API_BASE_URL: "https://api.example.com/" });
      expect(apiUrl("api/yields", configuredEnv)).toBe("https://api.example.com/api/yields");
      expect(apiUrl("/api/yields", configuredEnv)).toBe("https://api.example.com/api/yields");
    });

    it("throws error if no env vars set and hostname is not localhost (preview env)", () => {
      global.window = { location: { hostname: 'stellar-yield-preview.vercel.app' } } as any;
      expect(() => getApiBaseUrl(env({}))).toThrow('API_UNAVAILABLE: Backend URL not configured for preview environment. Please set VITE_API_BASE_URL.');
    });

    it("trims whitespace from configured URLs", () => {
      expect(
        getApiBaseUrl(env({
          VITE_API_BASE_URL: "  https://api.example.com  ",
        })),
      ).toBe("https://api.example.com");
    });

    it("handles URLs with multiple trailing slashes", () => {
      expect(
        getApiBaseUrl(env({
          VITE_API_BASE_URL: "https://api.example.com/////",
        })),
      ).toBe("https://api.example.com");
    });
  });

  describe("getApiBaseUrlOrNull", () => {
    it("returns the API URL when configured", () => {
      expect(
        getApiBaseUrlOrNull(env({
          VITE_API_BASE_URL: "https://api.example.com",
        })),
      ).toBe("https://api.example.com");
    });

    it("returns null instead of throwing when not configured on preview", () => {
      global.window = { location: { hostname: 'stellar-yield-preview.vercel.app' } } as any;
      expect(getApiBaseUrlOrNull(env({}))).toBeNull();
    });

    it("returns localhost default when on localhost", () => {
      global.window = { location: { hostname: 'localhost' } } as any;
      expect(getApiBaseUrlOrNull(env({}))).toBe("http://localhost:3001");
    });
  });

  describe("apiUrl", () => {
    it("appends path without leading slash", () => {
      const configuredEnv = env({ VITE_API_BASE_URL: "https://api.example.com" });
      expect(apiUrl("yields", configuredEnv)).toBe("https://api.example.com/yields");
    });

    it("appends path with leading slash", () => {
      const configuredEnv = env({ VITE_API_BASE_URL: "https://api.example.com" });
      expect(apiUrl("/yields", configuredEnv)).toBe("https://api.example.com/yields");
    });

    it("preserves nested paths", () => {
      const configuredEnv = env({ VITE_API_BASE_URL: "https://api.example.com" });
      expect(apiUrl("api/v1/yields", configuredEnv)).toBe("https://api.example.com/api/v1/yields");
    });
  });

  describe("getApiBaseUrlState", () => {
    it("returns unavailable state when hosted env vars are missing", () => {
      global.window = { location: { hostname: "stellar-yield-preview.vercel.app" } } as any;

      expect(getApiBaseUrlState(env({}))).toEqual({
        available: false,
        reason: "API base URL configuration is missing.",
      });
      expect(() => getApiBaseUrl(env({}))).toThrow("API base URL configuration is missing.");
    });

    it("returns unavailable state for invalid API URL configurations", () => {
      expect(
        getApiBaseUrlState(env({ VITE_API_BASE_URL: "ftp://api.example.com" })),
      ).toEqual({
        available: false,
        reason: 'Invalid API URL configuration: "ftp://api.example.com". Must start with http:// or https://',
      });

      expect(
        getApiBaseUrlState(env({ VITE_API_BASE_URL: "just-a-string" })),
      ).toEqual({
        available: false,
        reason: 'Invalid API URL configuration: "just-a-string". Must start with http:// or https://',
      });
    });

    it("returns unavailable state when VITE_API_BASE_URL is blank in preview", () => {
      global.window = { location: { hostname: "stellaryield-pr-123.vercel.app" } } as any;
      expect(getApiBaseUrlState(env({ VITE_API_BASE_URL: "" }))).toEqual({
        available: false,
        reason: "API base URL configuration is missing.",
      });
    });
  });
});

describe("apiFetch", () => {
  beforeEach(() => {
    // crypto.randomUUID is not available in jsdom's non-secure context
    vi.stubGlobal("crypto", { randomUUID: () => "test-uuid-1234-5678-abcd" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects x-correlation-id header on every request", async () => {
    await apiFetch("http://localhost:3001/api/fees");

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("x-correlation-id")).toBe("test-uuid-1234-5678-abcd");
  });

  it("uses a UUID from crypto.randomUUID for the correlation ID", async () => {
    await apiFetch("/api/test");

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("x-correlation-id")).toBe("test-uuid-1234-5678-abcd");
  });

  it("merges caller-supplied headers without dropping them", async () => {
    await apiFetch("/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-correlation-id")).toBe("test-uuid-1234-5678-abcd");
  });

  it("preserves other init options (method, body)", async () => {
    await apiFetch("/api/test", {
      method: "DELETE",
      body: "payload",
    });

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect((init as any).method).toBe("DELETE");
    expect((init as any).body).toBe("payload");
  });
});

describe("cachedApiFetch", () => {
  let apiCacheModule: {
    isEndpointCachable: ReturnType<typeof vi.fn>;
    getCacheEntry: ReturnType<typeof vi.fn>;
    setCache: ReturnType<typeof vi.fn>;
    getCache: ReturnType<typeof vi.fn>;
    clearCache: ReturnType<typeof vi.fn>;
    getCacheAge: ReturnType<typeof vi.fn>;
    getCachedEndpointList: ReturnType<typeof vi.fn>;
    SAFE_CACHE_ENDPOINTS: Set<string>;
  };
  let freshnessDecayModule: {
    computeDecayedFreshnessConfidence: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });
    vi.stubGlobal("fetch", vi.fn());

    apiCacheModule = await import("./apiCache");
    freshnessDecayModule = await import("../components/dashboard/freshnessDecay") as any;

    vi.mocked(apiCacheModule.isEndpointCachable).mockReturnValue(true);
    vi.mocked(freshnessDecayModule.computeDecayedFreshnessConfidence).mockReturnValue({
      confidence: 0.85,
      unusable: false,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns live data on successful fetch", async () => {
    const data = [{ protocol: "Blend", apy: 8.42 }];
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => data,
    });

    const result = await cachedApiFetch<unknown[]>("/api/yields");

    expect(result.source).toBe("live");
    expect(result.data).toEqual(data);
    expect(result.age).toBeNull();
    expect(result.cachedAt).toBeNull();
    expect(result.confidence).toBe(1);
    expect(vi.mocked(apiCacheModule.setCache)).toHaveBeenCalledWith("/api/yields", data, undefined);
  });

  it("caches data on successful fetch", async () => {
    const data = { apy: 12.5 };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => data,
    });

    await cachedApiFetch("/api/yields");

    expect(vi.mocked(apiCacheModule.setCache)).toHaveBeenCalledWith("/api/yields", data, undefined);
  });

  it("returns cached data on network failure", async () => {
    const cachedData = { apy: 10.0 };
    vi.mocked(apiCacheModule.getCacheEntry).mockReturnValue({
      data: cachedData,
      cachedAt: new Date(Date.now() - 120_000).toISOString(),
      endpoint: "/api/yields",
      ttl: 45 * 60 * 1000,
    } as any);

    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    const result = await cachedApiFetch("/api/yields");

    expect(result.source).toBe("cache");
    expect(result.data).toEqual(cachedData);
    expect(result.age).toBeGreaterThan(0);
    expect(result.cachedAt).toBeDefined();
    expect(result.confidence).toBe(0.85);
  });

  it("throws when no cache and network fails", async () => {
    vi.mocked(apiCacheModule.getCacheEntry).mockReturnValue(null);
    (global.fetch as any).mockRejectedValue(new Error("Network error"));

    await expect(cachedApiFetch("/api/yields")).rejects.toThrow();
  });

  it("does not cache non-cachable endpoints", async () => {
    vi.mocked(apiCacheModule.isEndpointCachable).mockReturnValue(false);
    const data = { result: "ok" };
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => data,
    });

    const result = await cachedApiFetch("/api/withdraw");

    expect(result.source).toBe("live");
    expect(vi.mocked(apiCacheModule.setCache)).not.toHaveBeenCalled();
  });

  it("returns correct metadata when serving from cache", async () => {
    const cachedAt = new Date(Date.now() - 300_000).toISOString();
    vi.mocked(apiCacheModule.getCacheEntry).mockReturnValue({
      data: { apy: 5 },
      cachedAt,
      endpoint: "/api/yields",
      ttl: 45 * 60 * 1000,
    } as any);

    (global.fetch as any).mockRejectedValue(new Error("offline"));

    const result = await cachedApiFetch("/api/yields");

    expect(result.source).toBe("cache");
    expect(result.cachedAt).toBe(cachedAt);
    expect(typeof result.age).toBe("number");
    expect(result.age).toBeGreaterThanOrEqual(0);
  });

  it("invokes onCacheHit callback when cache is served", async () => {
    const cachedAt = new Date(Date.now() - 60_000).toISOString();
    vi.mocked(apiCacheModule.getCacheEntry).mockReturnValue({
      data: { apy: 5 },
      cachedAt,
      endpoint: "/api/yields",
      ttl: 45 * 60 * 1000,
    } as any);
    (global.fetch as any).mockRejectedValue(new Error("offline"));

    const onCacheHit = vi.fn();
    await cachedApiFetch("/api/yields", { onCacheHit });

    expect(onCacheHit).toHaveBeenCalledWith({
      age: expect.any(Number),
      cachedAt,
    });
  });
});
