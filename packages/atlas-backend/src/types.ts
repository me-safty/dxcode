/**
 * Domain types for Vector's FastAPI backend.
 *
 * Best-effort shapes derived from the feature map in AGENTS.md (`../vector/apps/api`).
 * These are the contract the typed HTTP client (Step 4) and Atlas screens share;
 * refine them against real responses when the client is wired.
 */

/** Per-workspace access level (a "deal" is a workspace). */
export type DealRole = "owner" | "member" | "viewer";

export interface AtlasUser {
  readonly id: string;
  readonly email: string;
  readonly name?: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface LoginResponse {
  /** JWT — FastAPI is the source of truth for identity. */
  readonly token: string;
}

export interface Deal {
  readonly id: string;
  readonly name: string;
  readonly stage?: string;
}

export interface DealMember {
  readonly id: string;
  readonly userId: string;
  readonly email: string;
  readonly role: DealRole;
}

export interface DataroomFile {
  /** Path relative to the deal's workspace root on the shared volume. */
  readonly path: string;
  readonly name: string;
  readonly size?: number;
  readonly updatedAt?: string;
}
