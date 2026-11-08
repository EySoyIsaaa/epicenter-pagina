import { callCampaign, getConfig } from "../api.js";
import { decodeCodeFile, MAX_IMPORT_BYTES, previewCodeFile } from "./import.js";

const $ = (id) => document.getElementById(id);
const VISITOR_URL = "https://epicenterdsp.com/puebla2026/";
const TIMEZONE = "America/Mexico_City";
const BATCH_SIZE = 500;
const PAGE_SIZE = 25;
const numberFormat = new Intl.NumberFormat("es-MX");
const dateFormat = new Intl.DateTimeFormat("es-MX", {
  timeZone: TIMEZONE, dateStyle: "medium", timeStyle: "short",
});
const localDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const actionLabels = {
  assigned: "Licencia entregada",
  claim_rejected: "Solicitud rechazada",
  import: "Importación de códigos",
  create_invitations: "Lote de invitaciones generado",
  revoke_invitation: "Revocación de invitación",
  update_campaign: "Campaña actualizada",
  verify_redemption: "Confirmación de canje",
  rate_limited: "Solicitud limitada",
  error: "Error registrado",
};
const errorLabels = {
  invalid_input: "Revisa los datos enviados y vuelve a intentarlo.",
  payload_too_large: "La solicitud supera el tamaño permitido.",
  unauthenticated: "La sesión expiró. Inicia sesión de nuevo.",
  forbidden: "Esta cuenta no tiene acceso al panel.",
  rate_limited: "Hay demasiadas solicitudes. Espera un momento y vuelve a intentarlo.",
};

let config;
let session;
let stats;
let editCampaign;
let campaignDirty = false;
let statsSequence = 0;
let importState;
let fileSequence = 0;
let pinBatch = [];
const lists = {
  logs: { offset: 0, sequence: 0 },
  invitations: { offset: 0, sequence: 0 },
};

class AdminError extends Error {}

function feedback(id, message, tone = "") {
  const target = $(id);
  target.textContent = message;
  target.dataset.tone = tone;
}

function authFailure(error) {
  return error.code === "unauthenticated";
}

function accessDenied(error) {
  return error.code === "forbidden";
}

function errorMessage(error) {
  if (error instanceof AdminError) return error.message;
  if (authFailure(error)) return errorLabels.unauthenticated;
  if (accessDenied(error)) return errorLabels.forbidden;
  return errorLabels[error.code] ?? "No se pudo completar la solicitud. Vuelve a intentarlo.";
}

async function authRequest(path, body, accessToken, signal) {
  const headers = { apikey: config.supabasePublishableKey };
  if (body) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const request = new AbortController();
  const abort = () => request.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15_000);
  try {
    const response = await fetch(`${config.supabaseUrl.replace(/\/$/, "")}/auth/v1/${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: request.signal,
    });
    const result = response.ok && body ? await response.json() : null;
    return { status: response.status, ok: response.ok, result };
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

function storeTokens(current, result) {
  if (!result.access_token || !result.refresh_token || !Number.isFinite(result.expires_in)) {
    throw new AdminError("Supabase Auth devolvió una sesión incompleta.");
  }
  current.accessToken = result.access_token;
  current.refreshToken = result.refresh_token;
  current.expiresAt = Date.now() + result.expires_in * 1000;
}

async function refreshAuth(current) {
  if (!current.refreshing) {
    current.refreshing = (async () => {
      const response = await authRequest("token?grant_type=refresh_token", {
        refresh_token: current.refreshToken,
      }, undefined, current.controller.signal);
      if (!response.ok) {
        if (response.status === 400 || response.status === 401 || response.status === 403) {
          throw Object.assign(new Error(), { code: "unauthenticated" });
        }
        throw new Error();
      }
      storeTokens(current, response.result);
    })().finally(() => { current.refreshing = null; });
  }
  await current.refreshing;
}

async function requestAdmin(current, action, data = {}) {
  const { signal } = current.controller;
  if (signal.aborted) throw new DOMException("Solicitud cancelada", "AbortError");
  if (Date.now() >= current.expiresAt - 30_000) await refreshAuth(current);
  const token = current.accessToken;
  try {
    return await callCampaign(action, data, token, { signal });
  } catch (error) {
    if (!authFailure(error)) throw error;
    // The Edge Function rejects invalid credentials before executing an operation.
    if (token === current.accessToken) await refreshAuth(current);
    return await callCampaign(action, data, current.accessToken, { signal });
  }
}

function terminateAuth(current) {
  if (current?.accessToken) {
    void authRequest("logout?scope=local", undefined, current.accessToken)
      .catch(() => {});
  }
}

function clearBatch() {
  pinBatch = [];
  $("invite-export").hidden = true;
  $("generate-form").querySelector("fieldset").disabled = false;
  clearPrintSheet();
}

function resetSession(message = "", tone = "", focus = true) {
  const previous = session;
  session = undefined;
  previous?.controller.abort();
  stats = undefined;
  editCampaign = undefined;
  campaignDirty = false;
  clearBatch();
  resetPreview();
  for (const id of ["sign-in", "import-form", "campaign-form", "generate-form", "revoke-form", "redemption-form"]) {
    const form = $(id);
    form.reset();
    form.querySelector("fieldset").disabled = false;
  }
  for (const kind of Object.keys(lists)) {
    lists[kind].sequence += 1;
    lists[kind].offset = 0;
    $(`${kind}-body`).replaceChildren();
    $(`${kind}-wrap`).hidden = true;
    $(`more-${kind}`).hidden = true;
    $(`reload-${kind}`).disabled = false;
    $(`more-${kind}`).disabled = false;
  }
  for (const id of ["dashboard", "import", "campaign", "generate", "revoke", "redemption", "logs", "invitations"]) {
    feedback(`${id}-feedback`, "");
  }
  $("export-stats").disabled = true;
  $("deliveries-body").replaceChildren();
  $("deliveries-wrap").hidden = true;
  $("deliveries-empty").hidden = false;
  for (const counter of $("metrics").querySelectorAll("[data-metric]")) counter.textContent = "—";
  $("reload-dashboard").disabled = false;
  $("dashboard").hidden = true;
  $("sign-out").hidden = true;
  $("login-panel").hidden = false;
  $("sign-in-fields").disabled = !config;
  feedback("login-feedback", message, tone);
  if (focus) $("login-title").focus();
  return previous;
}

function reportError(current, error, target) {
  if (session !== current) return;
  if (authFailure(error) || accessDenied(error)) {
    terminateAuth(resetSession(errorMessage(error), "error"));
    return;
  }
  feedback(target, errorMessage(error), "error");
}

$("sign-in").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!config || $("sign-in-fields").disabled) return;
  $("sign-in-fields").disabled = true;
  const email = $("admin-email").value.trim();
  const password = $("admin-password").value;
  $("admin-password").value = "";
  feedback("login-feedback", "Verificando credenciales y permisos…");
  const current = { controller: new AbortController() };
  try {
    const response = await authRequest("token?grant_type=password", { email, password }, undefined, current.controller.signal);
    if (!response.ok) {
      if (response.status === 429) throw new AdminError(errorLabels.rate_limited);
      if (response.status < 500) throw new AdminError("No se pudo iniciar sesión con esas credenciales.");
      throw new Error();
    }
    storeTokens(current, response.result);
    const result = await requestAdmin(current, "stats");
    session = current;
    renderStats(result, true);
    $("sign-in").reset();
    $("login-panel").hidden = true;
    $("dashboard").hidden = false;
    $("sign-out").hidden = false;
    $("dashboard-title").focus();
    void loadList("logs");
    void loadList("invitations");
  } catch (error) {
    if (session === current) resetSession(errorMessage(error), "error");
    else feedback("login-feedback", errorMessage(error), "error");
    terminateAuth(current);
  } finally {
    $("sign-in-fields").disabled = false;
  }
});

$("sign-out").addEventListener("click", () => {
  terminateAuth(resetSession("Sesión cerrada.", "success"));
});

window.addEventListener("pagehide", () => {
  if (session) resetSession("", "", false);
});

function appendRow(body, cells) {
  const row = body.insertRow();
  for (const content of cells) {
    const cell = row.insertCell();
    if (typeof content === "string") cell.textContent = content;
    else cell.append(content);
  }
}

function localDate(value) {
  const parts = Object.fromEntries(localDateFormat.formatToParts(new Date(value)).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function dateToIso(value, original) {
  if (value === localDate(original)) return new Date(original).toISOString();
  const utcEstimate = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(utcEstimate)) throw new AdminError("Revisa las fechas de inicio y cierre.");
  const localAtEstimate = Date.parse(`${localDate(utcEstimate)}:00Z`);
  const adjusted = new Date(utcEstimate + utcEstimate - localAtEstimate);
  if (localDate(adjusted) !== value) throw new AdminError("Ingresa una fecha y hora válidas en Puebla.");
  return adjusted.toISOString();
}

function metrics(result) {
  return {
    ...result.codes,
    unavailable: result.codes.expired + result.codes.disabled,
    invitations: result.invitations.total,
  };
}

function renderSettings(campaign) {
  editCampaign = campaign;
  campaignDirty = false;
  $("campaign-start").value = localDate(campaign.starts_at);
  $("campaign-end").value = localDate(campaign.ends_at);
  $("campaign-enabled").checked = campaign.enabled;
  $("campaign-android").checked = campaign.android_enabled;
  $("campaign-ios").checked = campaign.ios_enabled;
  $("campaign-limit").value = campaign.delivery_limit ?? "";
  $("android-limit").value = campaign.android_limit ?? "";
  $("ios-limit").value = campaign.ios_limit ?? "";
}

function renderStats(result, fillSettings) {
  stats = result;
  const { campaign, daily } = result;
  const now = Date.now();
  const status = !campaign.enabled ? "Campaña desactivada"
    : now >= Date.parse(campaign.ends_at) ? "Campaña finalizada"
    : now < Date.parse(campaign.starts_at) ? "Campaña programada" : "Campaña activa";
  $("campaign-caption").textContent = campaign.name;
  $("campaign-status").textContent = status;
  $("campaign-status").dataset.active = String(status === "Campaña activa");
  const values = metrics(result);
  for (const counter of $("metrics").querySelectorAll("[data-metric]")) {
    counter.textContent = numberFormat.format(values[counter.dataset.metric]);
  }

  const deliveryRows = $("deliveries-body");
  deliveryRows.replaceChildren();
  for (const row of daily) {
    appendRow(deliveryRows, [row.date, ...[row.android, row.ios, row.total].map((value) => numberFormat.format(value))]);
  }
  $("deliveries-wrap").hidden = daily.length === 0;
  $("deliveries-empty").hidden = daily.length > 0;
  $("export-stats").disabled = false;

  if (fillSettings) renderSettings(campaign);
}

async function refreshStats(showFeedback = false) {
  const current = session;
  if (!current) return;
  const sequence = ++statsSequence;
  $("reload-dashboard").disabled = true;
  if (showFeedback) feedback("dashboard-feedback", "Actualizando estadísticas…");
  try {
    const result = await requestAdmin(current, "stats");
    if (session !== current || sequence !== statsSequence) return;
    renderStats(result, !campaignDirty && !$("campaign-form").querySelector("fieldset").disabled);
    feedback("dashboard-feedback", showFeedback ? "Estadísticas actualizadas." : "", "success");
  } catch (error) {
    if (sequence === statsSequence) reportError(current, error, "dashboard-feedback");
  } finally {
    if (session === current && sequence === statsSequence) $("reload-dashboard").disabled = false;
  }
}

$("reload-dashboard").addEventListener("click", () => void refreshStats(true));

function downloadCsv(name, rows) {
  const serialize = (cell) => `"${String(cell).replaceAll('"', '""')}"`;
  const csv = rows.map((row) => row.map(serialize).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv, "\r\n"], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("export-stats").addEventListener("click", () => {
  if (!session || !stats) return;
  const values = metrics(stats);
  const rows = [
    ["serie", "métrica", "fecha_puebla", "android", "ios", "total"],
    ...[
      ["Códigos totales", "total"], ["Android disponibles", "android_available"], ["iOS disponibles", "ios_available"],
      ["Entregados", "delivered"], ["Canjes verificados", "redeemed_verified"],
      ["Plataformas agotadas", "exhausted_platforms"], ["Caducados", "expired"], ["Deshabilitados", "disabled"],
      ["Invitaciones generadas", "invitations"],
    ].map(([label, key]) => ["resumen", label, "", "", "", values[key]]),
    ...stats.daily.map((row) => ["diaria", "Entregados", row.date, row.android, row.ios, row.total]),
  ];
  downloadCsv("puebla2026-estadisticas.csv", rows);
});

function renderLog(body, entry) {
  const references = document.createDocumentFragment();
  for (const [label, id] of [["Código", entry.code_id], ["Invitación", entry.invitation_id]]) {
    if (!id) continue;
    const reference = document.createElement("span");
    reference.className = "admin-reference";
    reference.textContent = `${label}: ${id}`;
    references.append(reference);
  }
  if (!references.childNodes.length) references.append("—");
  appendRow(body, [
    dateFormat.format(new Date(entry.created_at)),
    actionLabels[entry.action] ?? "Actividad registrada",
    { android: "Android", ios: "iOS" }[entry.platform] ?? "—",
    references,
  ]);
}

function renderInvitation(body, entry) {
  const revoke = document.createElement("button");
  revoke.className = "puebla-button";
  revoke.type = "button";
  revoke.textContent = "Seleccionar para revocar";
  revoke.addEventListener("click", () => {
    $("invitation-id").value = entry.id;
    $("invitation-id").focus();
  });
  appendRow(body, [entry.id, dateFormat.format(new Date(entry.created_at)), revoke]);
}

async function loadList(kind, more = false) {
  const current = session;
  if (!current) return;
  const list = lists[kind];
  const sequence = ++list.sequence;
  const offset = more ? list.offset : 0;
  const reload = $(`reload-${kind}`);
  const next = $(`more-${kind}`);
  const status = `${kind}-feedback`;
  reload.disabled = true;
  next.disabled = true;
  feedback(status, "Cargando registros…");
  try {
    const params = { limit: PAGE_SIZE, offset };
    if (kind === "invitations") params.status = "unused";
    const result = await requestAdmin(current, kind, params);
    if (session !== current || sequence !== list.sequence) return;
    const body = $(`${kind}-body`);
    const render = kind === "logs" ? renderLog : renderInvitation;
    if (!more) body.replaceChildren();
    for (const entry of result[kind]) render(body, entry);
    list.offset = offset + result[kind].length;
    next.hidden = !result.has_more;
    $(`${kind}-wrap`).hidden = body.rows.length === 0;
    const empty = kind === "logs" ? "Aún no hay actividad registrada." : "No hay invitaciones pendientes.";
    feedback(status, body.rows.length ? "" : empty);
  } catch (error) {
    if (sequence === list.sequence) reportError(current, error, status);
  } finally {
    if (session === current && sequence === list.sequence) {
      reload.disabled = false;
      next.disabled = false;
    }
  }
}

for (const kind of Object.keys(lists)) {
  $(`reload-${kind}`).addEventListener("click", () => void loadList(kind));
  $(`more-${kind}`).addEventListener("click", () => void loadList(kind, true));
}

function bindForm(name, handler) {
  const form = $(`${name}-form`);
  const fields = form.querySelector("fieldset");
  const target = `${name}-feedback`;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const current = session;
    if (!current || fields.disabled) return;
    fields.disabled = true;
    try {
      await handler(current, target);
    } catch (error) {
      reportError(current, error, target);
    } finally {
      if (session === current || !session) {
        fields.disabled = name === "generate" && pinBatch.length > 0;
      }
    }
  });
}

function updateActivity({ invitations = false } = {}) {
  void refreshStats();
  void loadList("logs");
  if (invitations) void loadList("invitations");
}

function resetPreview() {
  fileSequence += 1;
  importState = undefined;
  $("import-preview").hidden = true;
  $("import-submit").disabled = true;
  $("import-platform").disabled = false;
  $("import-submit").textContent = "Importar códigos válidos";
  $("import-samples").replaceChildren();
}

$("import-file").addEventListener("change", async () => {
  resetPreview();
  const file = $("import-file").files[0];
  if (!file || !session) {
    feedback("import-feedback", "");
    return;
  }
  const current = session;
  const sequence = fileSequence;
  feedback("import-feedback", "Leyendo archivo…");
  try {
    if (!/\.(csv|txt)$/i.test(file.name)) throw new Error("Selecciona un archivo con extensión CSV o TXT.");
    if (file.size > MAX_IMPORT_BYTES) throw new Error("El archivo excede 512 KiB.");
    const preview = previewCodeFile(decodeCodeFile(await file.arrayBuffer()));
    if (session !== current || sequence !== fileSequence) return;
    importState = { ...preview, offset: 0, inserted: 0, omitted: 0, attempted: false };
    $("import-summary").textContent = `${preview.codes.length} válidos y únicos · ${preview.duplicates} repetidos en el archivo · ${preview.invalid} inválidos`;
    for (const code of preview.codes.slice(0, 6)) {
      const item = document.createElement("li");
      item.textContent = `••••${code.slice(-2)}`;
      $("import-samples").append(item);
    }
    $("import-preview").hidden = false;
    $("import-submit").disabled = preview.codes.length === 0;
    feedback("import-feedback", preview.codes.length ? "" : "El archivo no contiene códigos válidos.", "error");
  } catch (error) {
    if (session === current && sequence === fileSequence) {
      feedback("import-feedback", error instanceof Error ? error.message : "No se pudo leer el archivo.", "error");
    }
  }
});

bindForm("import", async (current, target) => {
  const batch = importState;
  if (!batch?.codes.length) return;
  if (!batch.attempted) {
    batch.platform = $("import-platform").value;
    batch.attempted = true;
  }
  $("import-platform").disabled = true;
  try {
    while (batch.offset < batch.codes.length) {
      const codes = batch.codes.slice(batch.offset, batch.offset + BATCH_SIZE);
      feedback(target, `Importando lote ${batch.offset / BATCH_SIZE + 1} de ${Math.ceil(batch.codes.length / BATCH_SIZE)}…`);
      const result = await requestAdmin(current, "import", { platform: batch.platform, codes });
      if (session !== current) return;
      batch.offset += codes.length;
      batch.inserted += result.inserted;
      batch.omitted += result.duplicates;
    }
  } catch (error) {
    if (session !== current || authFailure(error) || accessDenied(error)) throw error;
    feedback(target, `Importación interrumpida. Procesados con confirmación: ${batch.offset} de ${batch.codes.length}. Puedes reanudar el mismo archivo; el inventario omitirá los códigos ya registrados.`, "error");
    $("import-submit").textContent = "Reanudar importación";
    updateActivity();
    return;
  }
  feedback(target, `Importación completada. Nuevos confirmados: ${batch.inserted}. Duplicados omitidos por el inventario: ${batch.omitted}.`, "success");
  resetPreview();
  $("import-file").value = "";
  $("import-platform").disabled = false;
  updateActivity();
});

bindForm("generate", async (current, target) => {
  if (pinBatch.length) return;
  feedback(target, "Generando invitaciones…");
  const result = await requestAdmin(current, "create_invitations", { count: $("invitation-count").valueAsNumber });
  if (session !== current) return;
  pinBatch = result.pins;
  if (!pinBatch.length) throw new AdminError("No se generaron invitaciones. Vuelve a intentarlo.");
  $("invite-export-title").textContent = `Lote de ${pinBatch.length} invitaciones`;
  $("invite-export").hidden = false;
  feedback(target, `Se generaron ${pinBatch.length} invitaciones. Descarga o imprime los PIN antes de cerrar el lote.`, "success");
  updateActivity({ invitations: true });
});

$("export-invitations").addEventListener("click", () => {
  if (!session || !pinBatch.length) return;
  downloadCsv("puebla2026-invitaciones.csv", [
    ["identificador", "pin", "portal"],
    ...pinBatch.map(({ id, pin }) => [id, pin, VISITOR_URL]),
  ]);
});

function clearPrintSheet() {
  $("print-sheet").hidden = true;
  $("print-sheet").replaceChildren();
}

$("hide-invitations").addEventListener("click", () => {
  clearBatch();
  feedback("generate-feedback", "Lote cerrado.", "success");
  $("invitation-count").focus();
});

$("print-invitations").addEventListener("click", () => {
  if (!session || !pinBatch.length) return;
  const sheet = $("print-sheet");
  const cards = document.createDocumentFragment();
  for (const { id, pin } of pinBatch) {
    const card = document.createElement("article");
    card.className = "admin-print-card";
    const title = document.createElement("h2");
    title.textContent = "EpicenterDSP Pro";
    const label = document.createElement("p");
    label.textContent = "Puebla 2026 · Tu PIN de invitación";
    const pinLine = document.createElement("p");
    pinLine.className = "admin-print-pin";
    pinLine.textContent = pin;
    const link = document.createElement("p");
    link.textContent = VISITOR_URL;
    const help = document.createElement("p");
    help.textContent = "Conserva esta tarjeta para recuperar tu licencia.";
    const reference = document.createElement("small");
    reference.className = "admin-print-reference";
    reference.textContent = `ID: ${id}`;
    card.append(title, label, pinLine, link, help, reference);
    cards.append(card);
  }
  sheet.replaceChildren(cards);
  sheet.hidden = false;
  window.print();
});

window.addEventListener("afterprint", clearPrintSheet);

bindForm("revoke", async (current, target) => {
  feedback(target, "Revocando invitación…");
  const { revoked } = await requestAdmin(current, "revoke_invitation", { id: $("invitation-id").value.trim() });
  if (session !== current) return;
  if (!revoked) throw new AdminError("La invitación ya fue utilizada, revocada o no existe.");
  feedback(target, "Invitación revocada.", "success");
  $("revoke-form").reset();
  updateActivity({ invitations: true });
});

function optionalLimit(id) {
  return $(id).value === "" ? null : $(id).valueAsNumber;
}

$("campaign-form").addEventListener("input", () => { campaignDirty = true; });

bindForm("campaign", async (current, target) => {
  const starts_at = dateToIso($("campaign-start").value, editCampaign.starts_at);
  const ends_at = dateToIso($("campaign-end").value, editCampaign.ends_at);
  if (Date.parse(ends_at) <= Date.parse(starts_at)) throw new AdminError("El cierre debe ser posterior al inicio.");
  const fields = {
    starts_at, ends_at,
    enabled: $("campaign-enabled").checked,
    android_enabled: $("campaign-android").checked,
    ios_enabled: $("campaign-ios").checked,
    delivery_limit: optionalLimit("campaign-limit"),
    android_limit: optionalLimit("android-limit"),
    ios_limit: optionalLimit("ios-limit"),
  };
  const changes = Object.fromEntries(Object.entries(fields).filter(([key, value]) => {
    const previous = editCampaign[key];
    return key === "starts_at" || key === "ends_at" ? Date.parse(previous) !== Date.parse(value) : previous !== value;
  }));
  if (!Object.keys(changes).length) {
    campaignDirty = false;
    feedback(target, "No hay cambios por guardar.");
    return;
  }
  feedback(target, "Guardando campaña…");
  const { campaign } = await requestAdmin(current, "update_campaign", changes);
  if (session !== current) return;
  renderSettings(campaign);
  feedback(target, "Configuración guardada.", "success");
  updateActivity();
});

bindForm("redemption", async (current, target) => {
  if (!$("redemption-confirmed").checked) return;
  feedback(target, "Registrando confirmación…");
  const { verified } = await requestAdmin(current, "verify_redemption", { id: $("redemption-id").value.trim() });
  if (session !== current) return;
  if (!verified) throw new AdminError("La referencia no corresponde a un código entregado pendiente de confirmar.");
  $("redemption-form").reset();
  feedback(target, "Canje verificado registrado.", "success");
  updateActivity();
});

try {
  config = getConfig();
  if (!config?.supabaseUrl || !config.supabasePublishableKey) throw new Error();
  $("sign-in-fields").disabled = false;
} catch {
  config = undefined;
  feedback("login-feedback", "El acceso administrativo estará disponible cuando se configure Supabase.", "error");
}
