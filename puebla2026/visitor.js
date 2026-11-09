import { callCampaign, getConfig } from "./api.js";

const platformNames = { android: "Android", ios: "iPhone" };
const platformButtons = [...document.querySelectorAll("[data-platform]")];
const availabilityStatus = document.querySelector("#availability-status");
const retryAvailability = document.querySelector("#retry-availability");
const claimForm = document.querySelector("#claim-form");
const claimStatus = document.querySelector("#claim-status");
const pinInput = document.querySelector("#invite-pin");
const submitPin = document.querySelector("#submit-pin");
const challenge = document.querySelector("#turnstile-widget");
const claimControls = document.querySelector("#claim-controls");
const claimResult = document.querySelector("#claim-result");
const resultHeading = document.querySelector("#result-heading");
const promoCode = document.querySelector("#promo-code");
const copyStatus = document.querySelector("#copy-status");

const availabilityMessages = {
  upcoming: "La promoción todavía no empieza. Si ya tienes un código, puedes recuperarlo con tu PIN.",
  ended: "La promoción ya terminó. Todavía puedes recuperar tu código con el PIN original.",
  paused: "Las nuevas entregas están pausadas para esta plataforma. Puedes recuperar tu código con el mismo PIN.",
  sold_out: "Se agotaron las licencias para esta plataforma. Puedes elegir la otra plataforma o recuperar tu código con el mismo PIN.",
};

let selectedPlatform;
let availabilityRequest;
let loadingTurnstile;
let submitting = false;

function showNotice(element, message, tone = "info") {
  element.dataset.tone = tone;
  element.textContent = message;
}

function showAvailability(result) {
  if (result.status === "available") {
    const count = result.available;
    const message = Number.isSafeInteger(count) && count > 0
      ? `Disponibles para ${platformNames[selectedPlatform]}: ${count}.`
      : `Hay licencias disponibles para ${platformNames[selectedPlatform]}.`;
    showNotice(availabilityStatus, message, "success");
    return;
  }
  const message = availabilityMessages[result.status];
  if (typeof message !== "string") throw new Error("unexpected_response");
  showNotice(availabilityStatus, message, "warning");
}

function errorMessage(error) {
  switch (error.code) {
    case "not_configured":
      return "El portal todavía no está listo. Vuelve más tarde y conserva tu PIN.";
    case "rate_limited": {
      const seconds = Math.ceil(Number(error.retryAfter));
      const delay = Number.isFinite(seconds) && seconds > 0 ? `${seconds} s` : "un momento";
      return `Hubo demasiadas solicitudes. Espera ${delay} y vuelve a intentar con el mismo PIN.`;
    }
    case "captcha_failed":
    case "captcha_unavailable":
      return "No pudimos completar la comprobación de seguridad. Intenta de nuevo con el mismo PIN.";
    case "invalid_input":
      return "Revisa los 16 caracteres de tu PIN e inténtalo de nuevo.";
    default:
      return "No pudimos completar la solicitud. Intenta de nuevo con el mismo PIN para consultar tu licencia.";
  }
}

async function checkAvailability() {
  availabilityRequest?.abort();
  const request = new AbortController();
  availabilityRequest = request;
  retryAvailability.hidden = true;
  showNotice(availabilityStatus, "Consultando disponibilidad…");

  try {
    const result = await callCampaign("availability", { platform: selectedPlatform }, undefined, { signal: request.signal });
    if (!request.signal.aborted) showAvailability(result);
  } catch (error) {
    if (request.signal.aborted) return;
    const message = error.code === "not_configured" || error.code === "rate_limited"
      ? errorMessage(error)
      : "No pudimos consultar la disponibilidad. Puedes volver a consultar o intentar con tu PIN.";
    showNotice(availabilityStatus, message, "warning");
    retryAvailability.hidden = error.code === "not_configured";
  } finally {
    if (availabilityRequest === request) availabilityRequest = undefined;
  }
}

function selectPlatform(platform) {
  selectedPlatform = platform;
  for (const button of platformButtons) button.setAttribute("aria-pressed", String(button.dataset.platform === platform));
  pinInput.removeAttribute("aria-invalid");
  showNotice(claimStatus, "");
  claimForm.hidden = false;
  checkAvailability();
}

function challengeError() {
  return Object.assign(new Error("captcha_unavailable"), { code: "captcha_unavailable" });
}

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (loadingTurnstile) return loadingTurnstile;
  loadingTurnstile = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;

    const fail = () => {
      clearTimeout(timeout);
      script.remove();
      reject(challengeError());
    };
    const timeout = setTimeout(fail, 15000);

    script.onerror = fail;
    script.onload = () => {
      if (!window.turnstile) {
        fail();
        return;
      }
      clearTimeout(timeout);
      resolve(window.turnstile);
    };
    document.head.append(script);
  }).finally(() => { loadingTurnstile = undefined; });
  return loadingTurnstile;
}

async function getChallengeToken() {
  const { turnstileSiteKey } = getConfig();
  if (!turnstileSiteKey) throw Object.assign(new Error("not_configured"), { code: "not_configured" });
  const turnstile = await loadTurnstile();
  let widget;
  let timeout;

  try {
    return await new Promise((resolve, reject) => {
      const fail = () => {
        reject(challengeError());
        return true;
      };
      timeout = setTimeout(fail, 110000);
      widget = turnstile.render(challenge, {
        sitekey: turnstileSiteKey,
        action: "puebla_claim",
        theme: "dark",
        language: "es",
        size: "compact",
        appearance: "interaction-only",
        retry: "never",
        "response-field": false,
        callback: resolve,
        "error-callback": fail,
        "expired-callback": fail,
        "timeout-callback": fail,
        "unsupported-callback": fail,
      });
    });
  } finally {
    clearTimeout(timeout);
    if (widget !== undefined) turnstile.remove(widget);
  }
}

function showResult(result) {
  if (!(result.platform === "android" || result.platform === "ios") || typeof result.code !== "string" || !result.code) {
    throw new Error("unexpected_response");
  }
  const recovered = result.status === "recovered";
  const isAndroid = result.platform === "android";
  document.querySelector("#result-platform").textContent = platformNames[result.platform];
  document.querySelector("#result-description").textContent = recovered
    ? "Tu invitación ya se usó. Recuperamos el código original asociado a ese PIN."
    : "Este código quedó asignado a tu invitación.";
  promoCode.textContent = result.code;

  const androidLink = document.querySelector("#redeem-android");
  if (isAndroid) {
    const redeemUrl = new URL("https://play.google.com/redeem");
    redeemUrl.searchParams.set("code", result.code);
    androidLink.href = redeemUrl.href;
    androidLink.hidden = false;
  } else {
    document.querySelector("#redeem-ios").hidden = false;
    document.querySelector("#ios-instructions").hidden = false;
  }

  pinInput.value = "";
  claimControls.hidden = true;
  resultHeading.textContent = recovered ? "Recuperaste tu licencia" : "Tu licencia está lista";
  claimResult.hidden = false;
  resultHeading.focus();
}

function setSubmitting(value) {
  submitting = value;
  pinInput.readOnly = value;
  submitPin.disabled = value;
  retryAvailability.disabled = value;
  for (const button of platformButtons) button.disabled = value;
}

claimForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedPlatform || submitting) return;
  const pin = pinInput.value.trim().toUpperCase().replace(/[\s-]/g, "");
  if (!/^[0-9A-HJKMNP-TV-Z]{16}$/.test(pin)) {
    pinInput.setAttribute("aria-invalid", "true");
    showNotice(claimStatus, "Ingresa los 16 caracteres de tu PIN de invitación.", "error");
    pinInput.focus();
    return;
  }

  setSubmitting(true);
  pinInput.removeAttribute("aria-invalid");
  showNotice(claimStatus, "Verificando invitación. Completa la comprobación de seguridad si aparece…");

  try {
    const captchaToken = await getChallengeToken();
    showNotice(claimStatus, "Buscando o asignando tu licencia…");
    const result = await callCampaign("claim", { platform: selectedPlatform, pin, captcha_token: captchaToken });

    if (result.status === "assigned" || result.status === "recovered") {
      availabilityRequest?.abort();
      showResult(result);
    } else if (result.status === "invalid_invitation") {
      pinInput.setAttribute("aria-invalid", "true");
      showNotice(claimStatus, "Invitación inválida. Revisa los caracteres de tu PIN e inténtalo de nuevo.", "error");
      pinInput.focus();
    } else {
      availabilityRequest?.abort();
      showAvailability(result);
      showNotice(claimStatus, "");
    }
  } catch (error) {
    showNotice(claimStatus, errorMessage(error), "error");
  } finally {
    setSubmitting(false);
  }
});

pinInput.addEventListener("input", () => {
  if (pinInput.hasAttribute("aria-invalid")) showNotice(claimStatus, "");
  pinInput.removeAttribute("aria-invalid");
});

document.querySelector("#copy-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(promoCode.textContent);
    showNotice(copyStatus, "Código copiado.", "success");
  } catch {
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(promoCode);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    showNotice(copyStatus, "Mantén pulsado o selecciona el código para copiarlo manualmente.", "warning");
  }
});

retryAvailability.addEventListener("click", checkAvailability);
for (const button of platformButtons) {
  button.disabled = false;
  button.addEventListener("click", () => selectPlatform(button.dataset.platform));
}

const preselectedPlatform = new URLSearchParams(location.search).get("platform");
if (preselectedPlatform === "android" || preselectedPlatform === "ios") selectPlatform(preselectedPlatform);
