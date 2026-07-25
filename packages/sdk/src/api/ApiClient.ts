import type { ApiConfig, ApiVaultData, HistoricalDataPoint } from "../types";

export interface ApiRegisteredEndpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  pathPattern: string;
  description: string;
}

export interface YieldItem {
  protocol?: string;
  protocolName?: string;
  asset?: string;
  apy: number;
  totalApy?: number;
  tvl?: number;
  tvlUsd?: number;
  risk?: string;
}

/**
 * ApiClient provides methods to interact with the StellarYield backend API.
 * Every endpoint maps directly to an entry in server/openapi.yaml.
 */
export class ApiClient {
  private config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  public getRegisteredEndpoints(): ApiRegisteredEndpoint[] {
    return [
      { method: "GET", pathPattern: "/api/health", description: "System health check" },
      { method: "GET", pathPattern: "/api/yields", description: "Get current yield data" },
      { method: "GET", pathPattern: "/api/yields/history", description: "Historical APY data" },
      { method: "GET", pathPattern: "/api/users/{walletAddress}/pnl", description: "User PnL data" },
      { method: "GET", pathPattern: "/api/leaderboard", description: "User leaderboard" },
      { method: "GET", pathPattern: "/api/referrals/{walletAddress}", description: "Referral info" },
      { method: "POST", pathPattern: "/api/referrals/claim", description: "Claim referral rewards" },
      { method: "POST", pathPattern: "/api/zap/quote", description: "Get token swap quote" },
      { method: "GET", pathPattern: "/api/zap/supported-assets", description: "Get supported zap assets" },
    ];
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.config.baseUrl}${path}`;
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`API error (${response.status} ${response.statusText}) at ${path}`);
    }
    return response.json() as Promise<T>;
  }

  async getHealth(): Promise<{ database?: string; redis?: string; indexer?: string; horizon?: string }> {
    return this.request<{ database?: string; redis?: string; indexer?: string; horizon?: string }>("/api/health");
  }

  async getYields(): Promise<YieldItem[]> {
    return this.request<YieldItem[]>("/api/yields");
  }

  async getYieldHistory(): Promise<HistoricalDataPoint[]> {
    return this.request<HistoricalDataPoint[]>("/api/yields/history");
  }

  async getCurrentAPY(vaultId: string): Promise<number> {
    const yields = await this.getYields();
    const match = yields.find(
      (y) => (y.protocol || y.protocolName)?.toLowerCase() === vaultId.toLowerCase()
    );
    return match ? (match.apy ?? match.totalApy ?? 0) : 0;
  }

  async getTVL(vaultId: string): Promise<number> {
    const yields = await this.getYields();
    const match = yields.find(
      (y) => (y.protocol || y.protocolName)?.toLowerCase() === vaultId.toLowerCase()
    );
    return match ? (match.tvl ?? match.tvlUsd ?? 0) : 0;
  }

  async getHistoricalData(vaultId: string, days: number = 30): Promise<HistoricalDataPoint[]> {
    return this.getYieldHistory();
  }

  async getVaultData(vaultId: string): Promise<ApiVaultData> {
    const [apy, historicalData] = await Promise.all([
      this.getCurrentAPY(vaultId),
      this.getHistoricalData(vaultId, 30),
    ]);

    const latest = historicalData[historicalData.length - 1];
    return {
      apy,
      tvl: latest?.tvl ?? 0,
      historicalData,
    };
  }

  async getPnL(walletAddress: string): Promise<any> {
    return this.request<any>(`/api/users/${walletAddress}/pnl`);
  }

  async getLeaderboard(params?: { metric?: string; timeframe?: string; limit?: number; offset?: number }): Promise<any> {
    const query = new URLSearchParams();
    if (params?.metric) query.set("metric", params.metric);
    if (params?.timeframe) query.set("timeframe", params.timeframe);
    if (params?.limit) query.set("limit", String(params.limit));
    if (params?.offset) query.set("offset", String(params.offset));

    const path = `/api/leaderboard${query.toString() ? `?${query.toString()}` : ""}`;
    return this.request<any>(path);
  }

  async getReferrals(walletAddress: string): Promise<any> {
    return this.request<any>(`/api/referrals/${walletAddress}`);
  }

  async claimReferral(address: string): Promise<{ amount: string; txHash: string }> {
    return this.request<{ amount: string; txHash: string }>("/api/referrals/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
  }

  async getZapQuote(fromAsset: string, toAsset: string, amount: string): Promise<any> {
    return this.request<any>("/api/zap/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromAsset, toAsset, amount }),
    });
  }

  async getZapSupportedAssets(): Promise<{ code: string; issuer?: string; name?: string }[]> {
    return this.request<{ code: string; issuer?: string; name?: string }[]>("/api/zap/supported-assets");
  }
}
