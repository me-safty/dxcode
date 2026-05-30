import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  AuthAccessSnapshot,
  AuthBearerBootstrapResult,
  AuthSessionState,
  AuthWebSocketTokenResult,
} from "./auth.ts";

const decodeBearerBootstrap = Schema.decodeUnknownSync(AuthBearerBootstrapResult);
const encodeBearerBootstrap = Schema.encodeUnknownSync(AuthBearerBootstrapResult);
const decodeSessionState = Schema.decodeUnknownSync(AuthSessionState);
const decodeWebSocketToken = Schema.decodeUnknownSync(AuthWebSocketTokenResult);
const decodeAccessSnapshot = Schema.decodeUnknownSync(AuthAccessSnapshot);

describe("auth contracts", () => {
  it("decodes bearer bootstrap JSON timestamps from remote HTTP responses", () => {
    const payload = {
      authenticated: true,
      role: "client",
      sessionMethod: "bearer-session-token",
      expiresAt: "2026-06-29T04:36:01.577Z",
      sessionToken: "session-token",
    };

    const decoded = decodeBearerBootstrap(payload);
    const encoded = encodeBearerBootstrap(decoded);

    expect(encoded).toEqual(payload);
  });

  it("decodes auth JSON timestamps across session and access payloads", () => {
    const expiresAt = "2026-06-29T04:36:01.577Z";

    expect(
      decodeSessionState({
        authenticated: true,
        auth: {
          policy: "remote-reachable",
          bootstrapMethods: ["one-time-token"],
          sessionMethods: ["bearer-session-token"],
          sessionCookieName: "t3_session_3773",
        },
        role: "client",
        sessionMethod: "bearer-session-token",
        expiresAt,
      }).authenticated,
    ).toBe(true);

    expect(
      decodeWebSocketToken({
        token: "ws-token",
        expiresAt,
      }),
    ).toBeDefined();

    expect(
      decodeAccessSnapshot({
        pairingLinks: [
          {
            id: "pairing-link",
            credential: "pairing-credential",
            role: "client",
            subject: "pairing-subject",
            createdAt: "2026-05-29T04:36:01.577Z",
            expiresAt,
          },
        ],
        clientSessions: [
          {
            sessionId: "session-id",
            subject: "client-subject",
            role: "client",
            method: "bearer-session-token",
            client: {
              deviceType: "desktop",
            },
            issuedAt: "2026-05-29T04:36:01.577Z",
            expiresAt,
            lastConnectedAt: null,
            connected: false,
            current: false,
          },
        ],
      }).clientSessions,
    ).toHaveLength(1);
  });
});
