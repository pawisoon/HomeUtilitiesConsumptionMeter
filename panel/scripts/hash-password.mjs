#!/usr/bin/env node
/// Packs a password into the pbkdf2$sha256$<iter>$<salt>$<key> string that the
/// Worker's PASSWORD_HASH secret holds. Usage: node scripts/hash-password.mjs 'haslo'

import { webcrypto as crypto } from "node:crypto";

const password = process.argv[2];
if (!password) {
  console.error("usage: node scripts/hash-password.mjs '<password>'");
  process.exit(1);
}

const ITERATIONS = 100_000;
const salt = crypto.getRandomValues(new Uint8Array(16));

const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
  "deriveBits",
]);
const derived = await crypto.subtle.deriveBits(
  { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
  key,
  256,
);

const b64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

console.log(`pbkdf2$sha256$${ITERATIONS}$${b64url(salt)}$${b64url(new Uint8Array(derived))}`);
