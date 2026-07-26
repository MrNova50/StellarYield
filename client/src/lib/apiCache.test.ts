import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  getCache,
  setCache,
  clearCache,
  getCacheAge,
  getCacheEntry,
  getCachedEndpointList,
  isEndpointCachable,
  SAFE_CACHE_ENDPOINTS,
} from "./apiCache";

const YIELDS_KEY = "/api/yields";

describe("apiCache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("setCache / getCache", () => {
    it("stores and retrieves data", () => {
      const data = [{ protocol: "Blend", apy: 8.42 }];
      setCache(YIELDS_KEY, data);
      expect(getCache(YIELDS_KEY)).toEqual(data);
    });

    it("returns null for missing key", () => {
      expect(getCache("/api/missing")).toBeNull();
    });

    it("returns null for expired entry", () => {
      setCache(YIELDS_KEY, { apy: 10 }, 0);
      expect(getCache(YIELDS_KEY)).toBeNull();
    });

    it("returns null for entry with negative TTL", () => {
      setCache(YIELDS_KEY, "data", -1000);
      expect(getCache(YIELDS_KEY)).toBeNull();
    });

    it("respects custom TTL", () => {
      const ttl = 10_000;
      setCache(YIELDS_KEY, "fresh", ttl);
      expect(getCache(YIELDS_KEY)).toBe("fresh");
    });
  });

  describe("clearCache", () => {
    it("clears a single entry", () => {
      setCache(YIELDS_KEY, "data");
      setCache("/api/vaults", "other");
      clearCache(YIELDS_KEY);
      expect(getCache(YIELDS_KEY)).toBeNull();
      expect(getCache("/api/vaults")).toBe("other");
    });

    it("clears all entries", () => {
      setCache(YIELDS_KEY, "data");
      setCache("/api/vaults", "other");
      clearCache();
      expect(getCache(YIELDS_KEY)).toBeNull();
      expect(getCache("/api/vaults")).toBeNull();
    });
  });

  describe("getCacheEntry", () => {
    it("returns full entry with metadata", () => {
      setCache(YIELDS_KEY, [1, 2, 3]);
      const entry = getCacheEntry<number[]>(YIELDS_KEY);
      expect(entry).not.toBeNull();
      expect(entry!.data).toEqual([1, 2, 3]);
      expect(entry!.endpoint).toBe(YIELDS_KEY);
      expect(entry!.cachedAt).toBeDefined();
      expect(entry!.ttl).toBeGreaterThan(0);
    });

    it("returns null when entry is expired", () => {
      setCache(YIELDS_KEY, "data", 0);
      expect(getCacheEntry(YIELDS_KEY)).toBeNull();
    });
  });

  describe("getCacheAge", () => {
    it("returns age in ms for cached entry", () => {
      setCache(YIELDS_KEY, "data");
      const age = getCacheAge(YIELDS_KEY);
      expect(age).toBeGreaterThanOrEqual(0);
    });

    it("returns null for missing entry", () => {
      expect(getCacheAge("/api/missing")).toBeNull();
    });
  });

  describe("getCachedEndpointList", () => {
    it("returns list of cached endpoints", () => {
      setCache(YIELDS_KEY, "a");
      setCache("/api/vaults", "b");
      const list = getCachedEndpointList();
      expect(list).toContain(YIELDS_KEY);
      expect(list).toContain("/api/vaults");
    });

    it("returns empty array when nothing cached", () => {
      expect(getCachedEndpointList()).toEqual([]);
    });
  });

  describe("isEndpointCachable", () => {
    it("returns true for safe endpoints", () => {
      for (const ep of SAFE_CACHE_ENDPOINTS) {
        expect(isEndpointCachable(ep)).toBe(true);
      }
    });

    it("returns true for nested paths under safe endpoints", () => {
      expect(isEndpointCachable("/api/yields/summary")).toBe(true);
      expect(isEndpointCachable("/api/vaults/123")).toBe(true);
    });

    it("returns false for write endpoints", () => {
      expect(isEndpointCachable("/api/withdraw")).toBe(false);
      expect(isEndpointCachable("/api/deposit")).toBe(false);
    });
  });

  describe("error handling", () => {
    it("handles corrupted JSON gracefully", () => {
      localStorage.setItem("stellaryield:api:/api/yields", "not-json");
      expect(getCache(YIELDS_KEY)).toBeNull();
    });

    it("handles QuotaExceededError gracefully", () => {
      const originalSetItem = Storage.prototype.setItem;
      let firstCall = true;
      const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(
        (key: string, value: string) => {
          if (firstCall && key.startsWith("stellaryield:api:")) {
            firstCall = false;
            throw new DOMException("Quota exceeded", "QuotaExceededError");
          }
          originalSetItem.call(localStorage, key, value);
        },
      );

      setCache(YIELDS_KEY, "data");
      expect(getCache(YIELDS_KEY)).toBe("data");
      setItem.mockRestore();
    });
  });
});
