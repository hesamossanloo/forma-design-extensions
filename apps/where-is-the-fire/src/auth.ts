import "./style.css";
import { appBaseUrl, callbackUrl, formaClientIdValue } from "./config";

const scopes = ["data:read", "data:write"] as const;
const authUrl =
  "https://developer.api.autodesk.com/authentication/v2/authorize";
const tokenUrl = "https://developer.api.autodesk.com/authentication/v2/token";

function getRequiredElement<T extends HTMLElement>(
  id: string,
  constructor: { new (): T },
) {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing required element: ${id}`);
  }
  return element;
}

const statusEl = getRequiredElement("status", HTMLParagraphElement);
const logEl = getRequiredElement("log", HTMLElement);

function setStatus(text: string, isError = false) {
  statusEl.textContent = text;
  statusEl.className = isError ? "is-error" : "";
}

function base64UrlEncode(bytes: ArrayBuffer | Uint8Array) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const value of u8) {
    binary += String.fromCharCode(value);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBytes(length: number) {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return array;
}

function generateCodeVerifier() {
  return base64UrlEncode(randomBytes(32));
}

async function generateCodeChallenge(verifier: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return base64UrlEncode(digest);
}

function generateState() {
  return base64UrlEncode(randomBytes(16));
}

function buildAuthorizeUrl(challenge: string, state: string) {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: formaClientIdValue,
    redirect_uri: callbackUrl,
    scope: scopes.join(" "),
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "login",
  });
  return `${authUrl}?${query.toString()}`;
}

async function exchangeCode(code: string, codeVerifier: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: formaClientIdValue,
    code,
    redirect_uri: callbackUrl,
    code_verifier: codeVerifier,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: body.toString(),
  });

  const payload = (await response.json().catch(() => ({}))) as Record<
    string,
    string | number
  >;
  if (!response.ok) {
    const message =
      String(
        payload.error_description ??
          payload.developerMessage ??
          payload.error ??
          "",
      ) || `Token request failed (${response.status})`;
    throw new Error(message);
  }

  return payload;
}

function logFormaCallbackHint() {
  const message =
    "[Forma SDK] Popup reached callback with an authorization code. " +
    "The SDK reads this URL from the popup and exchanges the code in the parent window.";
  console.log(message);
  if (window.opener) {
    try {
      window.opener.console.log(message);
    } catch {
      // Ignore cross-origin opener access.
    }
  }
}

async function run() {
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const code = params.get("code");
  const returnedState = params.get("state");

  if (error) {
    setStatus(`Authorization failed: ${error}`, true);
    const description = params.get("error_description");
    if (description) {
      logEl.hidden = false;
      logEl.textContent = description;
    }
    logFormaCallbackHint();
    return;
  }

  if (!code) {
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);
    const state = generateState();
    sessionStorage.setItem("aps_pkce_verifier", verifier);
    sessionStorage.setItem("aps_pkce_state", state);
    window.location.replace(buildAuthorizeUrl(challenge, state));
    return;
  }

  const storedState = sessionStorage.getItem("aps_pkce_state");
  const verifier = sessionStorage.getItem("aps_pkce_verifier");
  const isStandalonePkce =
    Boolean(verifier) &&
    Boolean(storedState) &&
    Boolean(returnedState) &&
    storedState === returnedState;

  if (isStandalonePkce && verifier) {
    sessionStorage.removeItem("aps_pkce_state");
    sessionStorage.removeItem("aps_pkce_verifier");
    setStatus("Exchanging code for tokens...");

    try {
      const tokenResponse = await exchangeCode(code, verifier);
      const accessToken =
        typeof tokenResponse.access_token === "string"
          ? tokenResponse.access_token
          : "";
      console.log("APS access_token:", accessToken);
      if (typeof tokenResponse.refresh_token === "string") {
        console.log("APS refresh_token:", tokenResponse.refresh_token);
      }
      console.log("Full token response:", tokenResponse);
      setStatus("Success. Check the browser console for the token.");
      logEl.hidden = false;
      logEl.textContent = JSON.stringify(
        {
          access_token: accessToken ? `${accessToken.slice(0, 24)}...` : null,
          token_type: tokenResponse.token_type ?? null,
          expires_in: tokenResponse.expires_in ?? null,
          refresh_token: tokenResponse.refresh_token ? "(present)" : null,
          callback_url: callbackUrl,
          app_base_url: appBaseUrl.href,
        },
        null,
        2,
      );

      const cleanUrl = new URL(window.location.href);
      cleanUrl.search = "";
      window.history.replaceState({}, "", cleanUrl.toString());
    } catch (errorValue) {
      const message =
        errorValue instanceof Error ? errorValue.message : String(errorValue);
      setStatus(message, true);
      console.error(errorValue);
      if (/Failed to fetch|NetworkError|load failed/i.test(message)) {
        logEl.hidden = false;
        logEl.textContent = `Browser token exchange was blocked, often due to CORS. Use a backend or proxy for ${tokenUrl}.`;
      }
    }
    return;
  }

  setStatus(
    "Signed in. If this window does not close, you can close it and return to the main app.",
  );
  logFormaCallbackHint();
}

void run();
