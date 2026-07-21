export interface VaultConfig {
  contractId: string;
  networkPassphrase: string;
  rpcUrl: string;
  specHash?: string;
}

export interface ApiConfig {
  baseUrl: string;
}

export interface DepositParams {
  from: string;
  amount: bigint | string;
  minSharesOut?: bigint | string;
}

export interface WithdrawParams {
  to: string;
  shares: bigint | string;
}

export interface VaultInfo {
  totalShares: string;
  totalAssets: string;
  token: string;
  admin: string;
}

export interface ApiVaultData {
  apy: number;
  tvl: number;
  historicalData: HistoricalDataPoint[];
}

export interface HistoricalDataPoint {
  timestamp: string;
  apy: number;
  tvl: number;
}

export interface SDKConfig {
  vault: VaultConfig;
  api?: ApiConfig;
}
