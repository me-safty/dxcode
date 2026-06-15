/**
 * SSRF-aware outbound URL validator.
 *
 * Honest limitation / DNS-rebinding caveat:
 *   The HTTP stack used at delivery time (global `fetch`) cannot be pinned to a
 *   specific pre-resolved IP address.  Re-validating at delivery time (TOCTOU
 *   mitigation) significantly raises the bar for a rebinding attack, but a
 *   determined attacker who controls DNS could still swap the record between
 *   the validation check and the subsequent `fetch`.  Full prevention would
 *   require a custom HTTP client that connects to the IP returned by our own
 *   resolver.  This is a known, documented limitation — not a silent bug.
 */

import { Data, Effect } from "effect";
import * as dns from "node:dns";

export class OutboundUrlError extends Data.TaggedError("OutboundUrlError")<{
  readonly reason: string;
}> {}

export interface UrlValidatorDeps {
  readonly lookup: (host: string) => Effect.Effect<ReadonlyArray<string>, OutboundUrlError>;
}

const defaultLookup = (host: string): Effect.Effect<ReadonlyArray<string>, OutboundUrlError> =>
  Effect.tryPromise({
    try: async () => {
      const records = await dns.promises.lookup(host, { all: true });
      return records.map((r) => r.address);
    },
    catch: (error) => {
      const code = (error as { code?: unknown })?.code;
      const suffix = typeof code === "string" ? ` (${code})` : "";
      return new OutboundUrlError({ reason: `DNS resolution failed for ${host}${suffix}` });
    },
  });

// INVARIANT: only ever called on canonical dotted-decimal — the host from
// `new URL(...)` (already normalized) or an address string from `dns.lookup`
// output. Because of that, JS `Number()`'s octal/hex leniency
// (e.g. `Number("0177") === 177`) is NOT reachable here, and this MUST stay
// true: never call `isBlocked`/`ipv4Bytes` on a raw, un-normalized host string.
const ipv4Bytes = (ip: string): ReadonlyArray<number> | null => {
  if (!ip.includes(".") || ip.includes(":")) return null;
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
    return null;
  return parts;
};

const isPrivateV4 = (b: ReadonlyArray<number>): boolean => {
  const a = b[0] ?? -1;
  const second = b[1] ?? -1;
  if (a === 127) return true; // loopback 127/8
  if (a === 10) return true; // 10/8
  if (a === 172 && second >= 16 && second <= 31) return true; // 172.16/12
  if (a === 192 && second === 168) return true; // 192.168/16
  if (a === 169 && second === 254) return true; // link-local 169.254/16 (incl. cloud-metadata 169.254.169.254)
  if (a === 0) return true; // 0.0.0.0/8
  return false;
};

const isPrivateV6 = (raw: string): boolean => {
  const ip = raw.toLowerCase().replace(/^\[|\]$/g, "");
  if (ip === "::1" || ip === "::") return true; // loopback / unspecified
  const firstHextet = parseInt(ip.split(":")[0] || "0", 16);
  // fe80::/10 -> first hextet 0xfe80..0xfebf (link-local). String-prefix
  // "fe80" would miss fe90..febf, which are also in /10 (RFC 4291).
  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true;
  // fc00::/7 -> first hextet 0xfc00..0xfdff (unique-local)
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true;
  const mapped = ip.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) {
    const capturedIp = mapped[1];
    if (!capturedIp) return true;
    const v4 = ipv4Bytes(capturedIp);
    return v4 ? isPrivateV4(v4) : true;
  }
  return false;
};

const isBlocked = (ip: string): boolean => {
  const v4 = ipv4Bytes(ip);
  if (v4) return isPrivateV4(v4);
  return isPrivateV6(ip);
};

export const OutboundUrlValidator = {
  validate: (
    rawUrl: string,
    deps: UrlValidatorDeps = { lookup: defaultLookup },
  ): Effect.Effect<URL, OutboundUrlError> =>
    Effect.gen(function* () {
      let parsed: URL;
      // @effect-diagnostics-next-line tryCatchInEffectGen:off -- synchronous URL parse guard; not an Effect failure
      try {
        parsed = new URL(rawUrl);
      } catch {
        return yield* new OutboundUrlError({ reason: "Malformed URL" });
      }
      if (parsed.protocol !== "https:") {
        return yield* new OutboundUrlError({ reason: "Only https:// targets are allowed" });
      }
      const addrs = yield* deps.lookup(parsed.hostname);
      if (addrs.length === 0) {
        return yield* new OutboundUrlError({ reason: "Host did not resolve" });
      }
      for (const addr of addrs) {
        if (isBlocked(addr)) {
          return yield* new OutboundUrlError({
            reason: `Resolved to a disallowed address (${addr})`,
          });
        }
      }
      return parsed;
    }),
};
