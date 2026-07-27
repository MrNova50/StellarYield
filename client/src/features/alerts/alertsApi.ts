import { apiUrl } from "../../lib/api";
import type {
  CreateAlertPayload,
  UserAlert,
  WatchlistDigestPreference,
} from "./types";

// Base URLs are resolved lazily, per call: resolving them at module scope
// throws ApiUnavailableError at import time when the backend URL is not
// configured, which blanks the entire app because this module is imported
// (via AlertsModal) from App.tsx (#913).
const alertsBase = () => apiUrl("/api/alerts");
const notificationsBase = () => apiUrl("/api/notifications");

export async function fetchAlerts(walletAddress: string): Promise<UserAlert[]> {
  const res = await fetch(`${alertsBase()}/${encodeURIComponent(walletAddress)}`);
  if (!res.ok) throw new Error("Failed to fetch alerts");
  return res.json() as Promise<UserAlert[]>;
}

export async function createAlert(payload: CreateAlertPayload): Promise<UserAlert> {
  const res = await fetch(alertsBase(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to create alert");
  }
  return res.json() as Promise<UserAlert>;
}

export async function deleteAlert(id: string, walletAddress: string): Promise<void> {
  const res = await fetch(`${alertsBase()}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress }),
  });
  if (!res.ok && res.status !== 204) throw new Error("Failed to delete alert");
}

export async function fetchDigestPreference(
  walletAddress: string,
): Promise<WatchlistDigestPreference> {
  const res = await fetch(
    `${notificationsBase()}/digest/preferences/${encodeURIComponent(walletAddress)}`,
  );
  if (!res.ok) throw new Error("Failed to fetch digest preferences");
  return res.json() as Promise<WatchlistDigestPreference>;
}

export async function saveDigestPreference(
  walletAddress: string,
  payload: WatchlistDigestPreference,
): Promise<WatchlistDigestPreference> {
  const res = await fetch(
    `${notificationsBase()}/digest/preferences/${encodeURIComponent(walletAddress)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to save digest preferences");
  }
  return res.json() as Promise<WatchlistDigestPreference>;
}
