import { campaignConfig } from "./config.js";

const visitorActions = new Set(["availability", "claim"]);

export class CampaignApiError extends Error {
  constructor(code, retryAfter = 0) {
    super(code);
    this.name = "CampaignApiError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

export function getConfig() {
  return campaignConfig;
}

export async function callCampaign(action, payload = {}, accessToken, { signal } = {}) {
  const { supabaseUrl, supabasePublishableKey } = getConfig();
  if (!supabaseUrl || !supabasePublishableKey) throw new CampaignApiError("not_configured");

  const visitor = visitorActions.has(action);
  if (!visitor && !accessToken) throw new CampaignApiError("unauthenticated");
  const endpoint = visitor ? "puebla-public" : "puebla-admin";
  const headers = { "Content-Type": "application/json", apikey: supabasePublishableKey };
  if (!visitor) headers.Authorization = `Bearer ${accessToken}`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(abort, 25_000);

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...payload, action }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok || !result) {
      const retryAfter = Number(response.headers.get("Retry-After")) || 0;
      const fallback = { 401: "unauthenticated", 403: "forbidden", 429: "rate_limited" };
      const error = typeof result?.error === "string" ? result.error : fallback[response.status];
      throw new CampaignApiError(error || "temporarily_unavailable", retryAfter);
    }
    return result;
  } catch (error) {
    if (signal?.aborted || error instanceof CampaignApiError) throw error;
    throw new CampaignApiError("temporarily_unavailable");
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
