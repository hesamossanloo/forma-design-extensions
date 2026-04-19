const formaClientId = import.meta.env.VITE_FORMA_CLIENT_ID?.trim();
const nasaMapKey = import.meta.env.VITE_NASA_MAP_KEY?.trim();

if (!formaClientId) {
  throw new Error("Missing VITE_FORMA_CLIENT_ID.");
}

if (!nasaMapKey) {
  throw new Error("Missing VITE_NASA_MAP_KEY.");
}

export const appBaseUrl = new URL(
  import.meta.env.BASE_URL,
  window.location.origin,
);
export const callbackUrl = new URL("auth/", appBaseUrl).href;
export const formaClientIdValue = formaClientId;
export const nasaMapKeyValue = nasaMapKey;
