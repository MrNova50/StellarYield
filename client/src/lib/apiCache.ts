const CACHE_KEY_PREFIX = "stellaryield:api:";
const DEFAULT_CACHE_TTL_MS = 45 * 60 * 1000;

export const SAFE_CACHE_ENDPOINTS = new Set(["/api/yields", "/api/vaults", "/api/fees"]);

export interface CacheEntry<T> {
  data: T;
  cachedAt: string;
  endpoint: string;
  ttl: number;
}

export function isEndpointCachable(path: string): boolean {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  for (const safe of SAFE_CACHE_ENDPOINTS) {
    if (normalized === safe || normalized.startsWith(safe + "/")) return true;
  }
  return false;
}

function cacheKey(path: string): string {
  return `${CACHE_KEY_PREFIX}${path}`;
}

export function getCacheEntry<T>(path: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(cacheKey(path));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    const age = Date.now() - new Date(entry.cachedAt).getTime();
    if (age >= entry.ttl) {
      localStorage.removeItem(cacheKey(path));
      return null;
    }
    return entry;
  } catch {
    try {
      localStorage.removeItem(cacheKey(path));
    } catch {
    }
    return null;
  }
}

export function getCache<T>(path: string): T | null {
  const entry = getCacheEntry<T>(path);
  return entry ? entry.data : null;
}

export function setCache<T>(
  path: string,
  data: T,
  ttl: number = DEFAULT_CACHE_TTL_MS,
): void {
  const entry: CacheEntry<T> = {
    data,
    cachedAt: new Date().toISOString(),
    endpoint: path,
    ttl,
  };
  try {
    localStorage.setItem(cacheKey(path), JSON.stringify(entry));
  } catch (err) {
    if (err instanceof DOMException && err.name === "QuotaExceededError") {
      evictOldest();
      try {
        localStorage.setItem(cacheKey(path), JSON.stringify(entry));
      } catch {
      }
    }
  }
}

export function clearCache(path?: string): void {
  if (path) {
    localStorage.removeItem(cacheKey(path));
    return;
  }
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CACHE_KEY_PREFIX)) {
      keys.push(key);
    }
  }
  keys.forEach((k) => localStorage.removeItem(k));
}

export function getCacheAge(path: string): number | null {
  const entry = getCacheEntry<unknown>(path);
  if (!entry) return null;
  return Date.now() - new Date(entry.cachedAt).getTime();
}

export function getCachedEndpointList(): string[] {
  const endpoints: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CACHE_KEY_PREFIX)) {
      endpoints.push(key.slice(CACHE_KEY_PREFIX.length));
    }
  }
  return endpoints;
}

function evictOldest(): void {
  let oldestKey: string | null = null;
  let oldestTime = Infinity;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(CACHE_KEY_PREFIX)) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const entry = JSON.parse(raw);
          const ts = new Date(entry.cachedAt).getTime();
          if (ts < oldestTime) {
            oldestTime = ts;
            oldestKey = key;
          }
        }
      } catch {
      }
    }
  }
  if (oldestKey) {
    localStorage.removeItem(oldestKey);
  }
}
