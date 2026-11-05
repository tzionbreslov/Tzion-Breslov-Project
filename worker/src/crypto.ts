const encoder = new TextEncoder();

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function base64ToBytes(value: string) {
  try {
    return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function importHmacKey(secret: Uint8Array) {
  const bytes = new Uint8Array(secret.byteLength);
  bytes.set(secret);
  return crypto.subtle.importKey("raw", bytes.buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToHex(new Uint8Array(digest));
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export async function verifyResendSignature(rawBody: string, id: string, timestamp: string, signatureHeader: string, secret: string) {
  const timestampSeconds = Number(timestamp);
  if (!id || !Number.isInteger(timestampSeconds) || Math.abs(Date.now() / 1000 - timestampSeconds) > 300) return false;

  const encodedSecret = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const secretBytes = base64ToBytes(encodedSecret);
  if (!secretBytes.byteLength) return false;
  const key = await importHmacKey(secretBytes);
  const payload = encoder.encode(`${id}.${timestamp}.${rawBody}`);
  const signatures = signatureHeader.split(" ").map((item) => item.split(",", 2)).filter(([version]) => version === "v1");
  for (const [, signature] of signatures) {
    const bytes = base64ToBytes(signature);
    if (bytes.byteLength && await crypto.subtle.verify("HMAC", key, bytes, payload)) return true;
  }
  return false;
}
