/// Shared-password authentication for the household panel.
///
/// One password for the whole household, verified against a packed PBKDF2 hash
/// held in the PASSWORD_HASH secret. A successful login mints an HMAC-signed
/// session cookie; nothing else is stored server side.
///

import type { Env } from "./env";

export const COOKIE_NAME = "__Host-utilities";
const SESSION_TTL_SECONDS = 90 * 24 * 60 * 60; // Long, so older relatives rarely see the login screen.

/** Constant-time compare of two equal-length byte arrays. */
export function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual
    ? crypto.subtle.timingSafeEqual(a, b)
    : slowEqual(new Uint8Array(a), new Uint8Array(b));
}

function slowEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function b64urlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function bytesToB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Verifies a password against a packed hash:
 *   pbkdf2$sha256$<iterations>$<b64url salt>$<b64url derived key>
 * Versioned so the iteration count can be raised later without a code change.
 */
export async function verifyPassword(password: string, packed: string): Promise<boolean> {
  const parts = packed.split("$");
  if (parts.length !== 5 || parts[0] !== "pbkdf2" || parts[1] !== "sha256") return false;

  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100_000) return false;

  const salt = b64urlToBytes(parts[3]!);
  const expected = b64urlToBytes(parts[4]!);
  if (expected.byteLength !== 32) return false;

  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    key,
    256,
  );
  return sameBytes(derived, expected.buffer as ArrayBuffer);
}

interface SessionPayload {
  /** Subject: always "household" today, kept so the token shape can grow. */
  s: string;
  /** Issued at, seconds. */
  i: number;
  /** Expires at, seconds. */
  e: number;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

export async function signSession(secret: string, subject = "household"): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { s: subject, i: now, e: now + SESSION_TTL_SECONDS };
  const body = "v1." + bytesToB64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  return body + "." + bytesToB64url(new Uint8Array(signature));
}

export async function verifySession(secret: string, value: string): Promise<string | null> {
  const parts = value.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;

  // Sign the encoded string, never a re-serialized object: canonicalisation
  // differences are how signature schemes quietly break.
  const body = parts[0] + "." + parts[1];
  const expected = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(body));
  const presented = b64urlToBytes(parts[2]!);
  if (presented.byteLength !== 32) return null;
  if (!sameBytes(expected, presented.buffer as ArrayBuffer)) return null;

  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(parts[1]!))) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.e <= now) return null;
    // Guard against a future-dated token from a skewed clock.
    if (payload.i > now + 60) return null;
    return payload.s;
  } catch {
    return null;
  }
}

export function sessionCookie(value: string, maxAge = SESSION_TTL_SECONDS): string {
  // __Host- forces Secure, Path=/ and no Domain. The missing Domain matters:
  // workers.dev is a public suffix, so a sibling Worker on the same subdomain
  // would otherwise be able to read and set this cookie.
  return `${COOKIE_NAME}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

/** True when the request carries a valid household session. */
export async function isLoggedIn(request: Request, env: Env): Promise<boolean> {
  const raw = readCookie(request, COOKIE_NAME);
  if (!raw || !env.SESSION_SECRET) return false;
  return (await verifySession(env.SESSION_SECRET, raw)) !== null;
}

/** Bearer token a reader agent presents when pushing readings. */
export async function isValidIngestToken(request: Request, env: Env): Promise<boolean> {
  const presented = request.headers.get("Authorization");
  const expected = env.INGEST_TOKEN;
  if (!presented || !expected) return false;
  // Hash both sides so the comparison is always over equal lengths.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(presented)),
    crypto.subtle.digest("SHA-256", enc.encode(`Bearer ${expected}`)),
  ]);
  return sameBytes(a, b);
}

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 10;

/** How many failed logins this IP made inside the rate-limit window. */
export async function recentFailures(env: Env, ip: string): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - WINDOW_SECONDS;
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?")
    .bind(ip, cutoff)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function recordFailure(env: Env, ip: string): Promise<void> {
  await env.DB.prepare("INSERT INTO login_attempts (ip, ts) VALUES (?, ?)")
    .bind(ip, Math.floor(Date.now() / 1000))
    .run();
}

export async function clearFailures(env: Env, ip: string): Promise<void> {
  await env.DB.prepare("DELETE FROM login_attempts WHERE ip = ?").bind(ip).run();
}

export { MAX_ATTEMPTS };
