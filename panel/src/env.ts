export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;

  /** Shared household password, packed as pbkdf2$sha256$<iter>$<salt>$<hash>. */
  PASSWORD_HASH: string;
  /** Random string that signs the session cookie. */
  SESSION_SECRET: string;
  /** Bearer token the reader agent sends with each reading. */
  INGEST_TOKEN: string;

  /** Comma-separated utilities to show, e.g. "water,electricity". */
  UTILITIES?: string;
  /** IANA zone the household lives in; days and hours are cut on its calendar. */
  TIME_ZONE?: string;
  /** Household size assumed for days nobody filled in. */
  DEFAULT_PERSONS?: string;
}
