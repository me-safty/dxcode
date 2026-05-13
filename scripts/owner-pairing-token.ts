// @effect-diagnostics globalDate:off
// @effect-diagnostics nodeBuiltinImport:off

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const OWNER_PAIRING_TOKEN_ENV = "T3CODE_OWNER_PAIRING_TOKEN";
export const DEFAULT_OWNER_PAIRING_ID = "env-owner-bootstrap";
export const DEFAULT_OWNER_PAIRING_LABEL = "Stable owner bootstrap";

export type OwnerPairingState = "dev" | "userdata";

export interface OwnerPairingConfig {
  readonly token: string;
  readonly dbPath: string;
  readonly id?: string;
  readonly label?: string;
  readonly expiresAt?: Date;
}

export function resolveT3Home(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.T3CODE_HOME?.trim();
  return path.resolve(
    configured && configured.length > 0 ? configured : path.join(homedir(), ".t3"),
  );
}

export function resolveOwnerPairingState(
  env: NodeJS.ProcessEnv = process.env,
  fallback: OwnerPairingState = "userdata",
): OwnerPairingState {
  const configured = env.T3CODE_OWNER_PAIRING_STATE?.trim().toLowerCase();
  if (configured === "dev" || configured === "userdata") {
    return configured;
  }
  return fallback;
}

export function resolveOwnerPairingDbPath(
  env: NodeJS.ProcessEnv = process.env,
  fallbackState: OwnerPairingState = "userdata",
): string {
  return path.join(
    resolveT3Home(env),
    resolveOwnerPairingState(env, fallbackState),
    "state.sqlite",
  );
}

export function resolveOwnerPairingUrl(
  env: NodeJS.ProcessEnv = process.env,
  baseUrl = "https://t3.olumbe.com",
): string | null {
  const token = env[OWNER_PAIRING_TOKEN_ENV]?.trim();
  if (!token) {
    return null;
  }

  const url = new URL("/pair", baseUrl);
  url.hash = new URLSearchParams([["token", token]]).toString();
  return url.toString();
}

export function ensureOwnerPairingSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_pairing_links (
      id TEXT PRIMARY KEY,
      credential TEXT NOT NULL UNIQUE,
      method TEXT NOT NULL,
      role TEXT NOT NULL,
      subject TEXT NOT NULL,
      label TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT
    );
  `);

  const columns = db
    .prepare("PRAGMA table_info(auth_pairing_links)")
    .all() as unknown as ReadonlyArray<{
    readonly name: string;
  }>;
  if (!columns.some((column) => column.name === "label")) {
    db.exec("ALTER TABLE auth_pairing_links ADD COLUMN label TEXT;");
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_auth_pairing_links_active
    ON auth_pairing_links(revoked_at, consumed_at, expires_at);
  `);
}

export function seedOwnerPairingToken(config: OwnerPairingConfig): void {
  const token = config.token.trim();
  if (token.length < 8) {
    throw new Error(`${OWNER_PAIRING_TOKEN_ENV} must be at least 8 characters.`);
  }

  mkdirSync(path.dirname(config.dbPath), { recursive: true });
  const db = new DatabaseSync(config.dbPath);
  try {
    ensureOwnerPairingSchema(db);

    const id = config.id ?? DEFAULT_OWNER_PAIRING_ID;
    const label = config.label ?? DEFAULT_OWNER_PAIRING_LABEL;
    const now = new Date().toISOString();
    const expiresAt = (config.expiresAt ?? new Date("2099-01-01T00:00:00.000Z")).toISOString();

    db.exec("BEGIN IMMEDIATE;");
    try {
      db.prepare("DELETE FROM auth_pairing_links WHERE id = ? AND credential <> ?").run(id, token);
      db.prepare("DELETE FROM auth_pairing_links WHERE credential = ? AND id <> ?").run(token, id);
      db.prepare(
        `
          INSERT INTO auth_pairing_links (
            id,
            credential,
            method,
            role,
            subject,
            label,
            created_at,
            expires_at,
            consumed_at,
            revoked_at
          )
          VALUES (?, ?, 'one-time-token', 'owner', 'owner-bootstrap', ?, ?, ?, NULL, NULL)
          ON CONFLICT(id) DO UPDATE SET
            credential = excluded.credential,
            method = excluded.method,
            role = excluded.role,
            subject = excluded.subject,
            label = excluded.label,
            expires_at = excluded.expires_at,
            consumed_at = NULL,
            revoked_at = NULL
        `,
      ).run(id, token, label, now, expiresAt);
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  } finally {
    db.close();
  }
}

export function seedOwnerPairingTokenFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fallbackState: OwnerPairingState = "userdata",
): string | null {
  const token = env[OWNER_PAIRING_TOKEN_ENV]?.trim();
  if (!token) {
    return null;
  }

  const dbPath = resolveOwnerPairingDbPath(env, fallbackState);
  seedOwnerPairingToken({ token, dbPath });
  return dbPath;
}
