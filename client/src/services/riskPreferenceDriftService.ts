export interface DriftDimension {
  dimension: string;
  actualValue: number;
  thresholdValue: number;
  deviationPct: number;
  isDrifting: boolean;
}

export interface DriftResult {
  id?: string;
  userId: string;
  statedPreference: string;
  overallDriftPct: number;
  isDrifting: boolean;
  dimensions: DriftDimension[];
  message: string;
  detectedAt: string;
}

export interface DriftSnapshot {
  id: string;
  userId: string;
  statedPreference: string;
  overallDriftPct: number;
  isDrifting: boolean;
  dimensionData: string;
  reason: string;
  createdAt: string;
}

interface Position {
  protocol: string;
  weightPct: number;
  volatilityPct: number;
  liquidityUsd: number;
}

export async function detectDrift(
  userId: string,
  statedPreference: string,
  positions: Position[],
): Promise<DriftResult> {
  const res = await fetch('/api/risk/drift/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, statedPreference, positions }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to detect drift' }));
    throw new Error(err.error || 'Failed to detect drift');
  }

  const json = await res.json();
  return json.data;
}

export async function resetDrift(
  userId: string,
  statedPreference: string,
  reason: string,
): Promise<DriftSnapshot> {
  const res = await fetch('/api/risk/drift/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId, statedPreference, reason }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to reset drift' }));
    throw new Error(err.error || 'Failed to reset drift');
  }

  const json = await res.json();
  return json.data;
}

export async function getDriftHistory(
  userId: string,
  limit: number = 10,
): Promise<DriftSnapshot[]> {
  const res = await fetch(`/api/risk/drift/history/${userId}?limit=${limit}`);

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to fetch drift history' }));
    throw new Error(err.error || 'Failed to fetch drift history');
  }

  const json = await res.json();
  return json.data;
}
