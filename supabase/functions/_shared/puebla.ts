import { isIP } from "node:net";

type ObjectValue = Record<string, unknown>;
type Env = Record<string, string | undefined>;
type Route = "public" | "admin";

const PIN_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PIN_PATTERN = /^[0-9A-HJKMNP-TV-Z]{16}$/;
const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{3,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const CLAIM_ACTION = "puebla_claim";
const SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_BODY_BYTES = 64 * 1024;
const RATE_WINDOW_SECONDS = 60;
const encoder = new TextEncoder();

class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function invalid(): never {
  throw new ApiError(400, "invalid_input");
}

function record(value: unknown): ObjectValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as ObjectValue
    : null;
}

async function readBody(request: Request): Promise<ObjectValue> {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json"
  ) {
    throw new ApiError(415, "invalid_input");
  }
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large");
  }
  if (!request.body) return invalid();

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new ApiError(413, "payload_too_large");
      text += decoder.decode(value, { stream: true });
    }
    return record(JSON.parse(text + decoder.decode())) ?? invalid();
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof ApiError) throw error;
    return invalid();
  } finally {
    reader.releaseLock();
  }
}

function defaultKey(dictionary?: string) {
  try {
    const key = record(JSON.parse(dictionary || "{}"))?.default;
    return typeof key === "string" ? key : undefined;
  } catch {
    return undefined;
  }
}

async function digest(pepper: string | undefined, value: string) {
  if (!pepper || !/^[0-9a-f]{64}$/i.test(pepper)) {
    throw new Error("missing pepper");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(value),
  );
  return Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function generatePin() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => PIN_ALPHABET[byte & 31]).join("");
}

function normalizedPin(value: unknown) {
  if (
    typeof value !== "string" || value.length > 32 ||
    !/^[A-Za-z0-9\s-]+$/.test(value)
  ) {
    return invalid();
  }
  const pin = value.toUpperCase().replace(/[\s-]/g, "");
  return PIN_PATTERN.test(pin) ? pin : invalid();
}

function platform(value: unknown) {
  return value === "android" || value === "ios" ? value : invalid();
}

function uuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value
    : invalid();
}

function integer(value: unknown, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min &&
      value <= max
    ? value
    : invalid();
}

function importPayload(body: ObjectValue) {
  const { codes } = body;
  if (!Array.isArray(codes) || codes.length < 1 || codes.length > 500) {
    return invalid();
  }
  return {
    platform: platform(body.platform),
    codes: codes.map((value) => {
      if (typeof value !== "string" || !/^[A-Za-z0-9-]+$/.test(value.trim())) {
        return invalid();
      }
      const code = value.trim().toUpperCase();
      return CODE_PATTERN.test(code) ? code : invalid();
    }),
  };
}

function campaignPatch(body: ObjectValue) {
  const patch: ObjectValue = {};
  for (const [key, value] of Object.entries(body)) {
    switch (key) {
      case "action":
        break;
      case "name":
        if (
          typeof value !== "string" || !value.trim() ||
          value.trim().length > 100
        ) return invalid();
        patch[key] = value.trim();
        break;
      case "enabled":
      case "android_enabled":
      case "ios_enabled":
        if (typeof value !== "boolean") return invalid();
        patch[key] = value;
        break;
      case "starts_at":
      case "ends_at":
        if (
          typeof value !== "string" || !DATE_PATTERN.test(value) ||
          !Number.isFinite(Date.parse(value))
        ) {
          return invalid();
        }
        patch[key] = new Date(value).toISOString();
        break;
      case "delivery_limit":
      case "android_limit":
      case "ios_limit":
        patch[key] = value === null ? null : integer(value, 0, 1_000_000);
        break;
      default:
        return invalid();
    }
  }
  return Object.keys(patch).length ? patch : invalid();
}

function listPayload(body: ObjectValue, invitations: boolean) {
  const payload: ObjectValue = {
    limit: integer(body.limit ?? 25, 1, 100),
    offset: integer(body.offset ?? 0, 0, 1_000_000),
  };
  if (invitations && body.status !== undefined) {
    if (
      body.status !== "unused" && body.status !== "used" &&
      body.status !== "revoked"
    ) return invalid();
    payload.status = body.status;
  }
  return payload;
}

function visitorResult(
  data: unknown,
  action: "availability" | "claim",
  showCount = false,
) {
  const result = record(data);
  switch (result?.status) {
    case "available":
      return showCount && typeof result.available === "number"
        ? { status: result.status, available: result.available }
        : { status: result.status };
    case "upcoming":
    case "ended":
    case "paused":
    case "sold_out":
    case "invalid_invitation":
      return { status: result.status };
    case "assigned":
    case "recovered":
      if (
        action === "claim" && typeof result.code === "string" &&
        CODE_PATTERN.test(result.code) &&
        (result.platform === "android" || result.platform === "ios")
      ) {
        return {
          status: result.status,
          code: result.code,
          platform: result.platform,
        };
      }
      break;
  }
  throw new Error("unexpected visitor result");
}

export function createHandler(route: Route, env: Env, fetcher = fetch) {
  const allowedOrigins = new Set(
    (env.PUEBLA_ALLOWED_ORIGINS || "https://epicenterdsp.com")
      .split(",").map((origin) => origin.trim()).filter(Boolean),
  );
  const campaign = env.PUEBLA_CAMPAIGN_ID || "puebla2026";
  const project = env.SUPABASE_URL?.replace(/\/$/, "");
  const secret = defaultKey(env.SUPABASE_SECRET_KEYS) ||
    env.SUPABASE_SERVICE_ROLE_KEY;
  const publishable = defaultKey(env.SUPABASE_PUBLISHABLE_KEYS) ||
    env.SUPABASE_ANON_KEY;

  async function postJson(
    url: string,
    headers: HeadersInit,
    body: ObjectValue,
    timeout = 10_000,
  ) {
    const requestHeaders = new Headers(headers);
    requestHeaders.set("Content-Type", "application/json");
    return await fetcher(url, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      redirect: "error",
    });
  }

  async function rpc(name: string, body: ObjectValue, timeout?: number) {
    if (!project || !secret) throw new Error("missing database config");
    const headers: Record<string, string> = { apikey: secret };
    if (!secret.startsWith("sb_secret_")) {
      headers.Authorization = `Bearer ${secret}`;
    }
    const response = await postJson(
      `${project}/rest/v1/rpc/${name}`,
      headers,
      body,
      timeout,
    );
    const data = await response.json();
    if (!response.ok) {
      if (["22023", "22007", "22008", "22P02", "23514"].includes(data?.code)) {
        return invalid();
      }
      if (data?.code === "42501" && name === "puebla_admin") {
        throw new ApiError(403, "forbidden");
      }
      throw new Error("rpc failure");
    }
    return data;
  }

  async function rateLimit(scope: string, key: string, limit: number) {
    const allowed = await rpc("puebla_rate_limit", {
      p_scope: `${campaign}:${scope}`,
      p_key: await digest(env.PUEBLA_RATE_PEPPER, key),
      p_limit: limit,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (allowed === false) throw new ApiError(429, "rate_limited");
    if (allowed !== true) throw new Error("unexpected rate result");
  }

  async function checkCaptcha(
    token: string,
    origin: string,
    ip: string | null,
  ) {
    if (!env.PUEBLA_TURNSTILE_SECRET) throw new Error("missing captcha config");
    const payload = {
      secret: env.PUEBLA_TURNSTILE_SECRET,
      response: token,
      ...(ip && { remoteip: ip }),
    };
    const response = await postJson(SITEVERIFY_URL, {}, payload);
    if (!response.ok) throw new Error("captcha service failure");
    const data = await response.json();
    const errors = Array.isArray(data?.["error-codes"])
      ? data["error-codes"]
      : [];
    if (
      errors.some((code: unknown) =>
        code === "internal-error" || code === "invalid-input-secret" ||
        code === "missing-input-secret"
      )
    ) throw new Error("captcha service failure");
    if (
      data?.success !== true || data.hostname !== new URL(origin).hostname ||
      data.action !== CLAIM_ACTION
    ) {
      throw new ApiError(400, "captcha_failed");
    }
  }

  async function visitor(body: ObjectValue, request: Request, origin: string) {
    const action = body.action;
    if (action !== "claim" && action !== "availability") return invalid();
    const params = {
      p_campaign_id: campaign,
      p_platform: platform(body.platform),
    };
    const ipHeader = request.headers.get("cf-connecting-ip");
    const ip = ipHeader && isIP(ipHeader) ? ipHeader : null;

    await rateLimit(
      `${action}:global`,
      "campaign-wide",
      action === "claim" ? 300 : 1_200,
    );
    if (ip) await rateLimit(`${action}:ip`, ip, action === "claim" ? 45 : 120);
    if (action === "availability") {
      return visitorResult(
        await rpc("puebla_availability", params),
        action,
        env.PUEBLA_SHOW_INVENTORY_COUNTS === "true",
      );
    }

    const pin = normalizedPin(body.pin);
    if (
      typeof body.captcha_token !== "string" || !body.captcha_token ||
      body.captcha_token.length > 2_048
    ) {
      return invalid();
    }
    await checkCaptcha(body.captcha_token, origin, ip);
    return visitorResult(
      await rpc("puebla_claim", {
        ...params,
        p_token_hash: await digest(env.PUEBLA_PIN_PEPPER, pin),
      }),
      action,
    );
  }

  async function adminActor(request: Request) {
    const bearer = request.headers.get("authorization");
    if (!bearer || !/^Bearer [A-Za-z0-9._-]{1,8192}$/i.test(bearer)) {
      throw new ApiError(401, "unauthenticated");
    }
    if (!project || !publishable) throw new Error("missing auth config");
    const response = await fetcher(`${project}/auth/v1/user`, {
      headers: { apikey: publishable, Authorization: bearer },
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    if ([400, 401, 403, 404, 422].includes(response.status)) {
      throw new ApiError(401, "unauthenticated");
    }
    if (!response.ok) throw new Error("auth failure");
    const { id } = await response.json();
    if (typeof id !== "string" || !UUID_PATTERN.test(id)) {
      throw new Error("unexpected auth result");
    }
    if (await rpc("puebla_is_admin", { p_actor: id }) !== true) {
      throw new ApiError(403, "forbidden");
    }
    return id;
  }

  async function admin(body: ObjectValue, request: Request) {
    const actor = await adminActor(request);
    const action = body.action;
    const call = (payload: ObjectValue) =>
      rpc("puebla_admin", {
        p_campaign_id: campaign,
        p_actor: actor,
        p_action: action,
        p_payload: payload,
      });

    switch (action) {
      case "stats":
        return await call({});
      case "logs":
      case "invitations":
        return await call(listPayload(body, action === "invitations"));
      case "revoke_invitation":
      case "verify_redemption":
        return await call({ id: uuid(body.id) });
      case "import":
        return await call(importPayload(body));
      case "update_campaign":
        return await call(campaignPatch(body));
      case "create_invitations": {
        const count = integer(body.count, 1, 200);
        const pairs = await Promise.all(
          Array.from({ length: count }, async () => {
            const pin = generatePin();
            return [await digest(env.PUEBLA_PIN_PEPPER, pin), pin] as const;
          }),
        );
        const pins = new Map(pairs);
        const result = await call({
          token_hashes: pairs.map(([hash]) => hash),
        });
        if (!Array.isArray(result?.created)) {
          throw new Error("unexpected invitations result");
        }
        return {
          pins: result.created.map(
            (row: { id: string; token_hash: string }) => {
              const pin = pins.get(row.token_hash);
              if (!pin) throw new Error("unexpected invitation hash");
              return { id: row.id, pin: pin.match(/.{4}/g)?.join("-") };
            },
          ),
          duplicates: result.duplicates,
        };
      }
      default:
        return invalid();
    }
  }

  return async (request: Request) => {
    const headers = new Headers({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Vary: "Origin",
    });
    const origin = request.headers.get("origin");
    if (!origin || !allowedOrigins.has(origin)) {
      return Response.json({ error: "forbidden" }, { status: 403, headers });
    }
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", "Retry-After");
    if (request.method === "OPTIONS") {
      headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
      headers.set(
        "Access-Control-Allow-Headers",
        "authorization, apikey, content-type",
      );
      headers.set("Access-Control-Max-Age", "600");
      return new Response(null, { status: 204, headers });
    }
    if (request.method !== "POST") {
      headers.set("Allow", "POST, OPTIONS");
      return Response.json({ error: "method_not_allowed" }, {
        status: 405,
        headers,
      });
    }
    try {
      const body = await readBody(request);
      const data = route === "public"
        ? await visitor(body, request, origin)
        : await admin(body, request);
      return Response.json(data, { headers });
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 429) {
          headers.set("Retry-After", String(RATE_WINDOW_SECONDS));
        }
        return Response.json({ error: error.code }, {
          status: error.status,
          headers,
        });
      }
      // Upstream errors may include submitted values. Only log the route and a fixed category.
      console.error(`puebla-${route}: operation failed`);
      await rpc("puebla_audit_error", {
        p_campaign_id: campaign,
        p_route: route,
      }, 1_000)
        .catch(() => {});
      return Response.json({ error: "temporarily_unavailable" }, {
        status: 503,
        headers,
      });
    }
  };
}
