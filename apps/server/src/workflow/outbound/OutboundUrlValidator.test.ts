import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { OutboundUrlValidator } from "./OutboundUrlValidator.ts";

const validateWith = (url: string, addrs: ReadonlyArray<string>) =>
  Effect.exit(OutboundUrlValidator.validate(url, { lookup: () => Effect.succeed(addrs) }));

describe("OutboundUrlValidator", () => {
  it.effect("accepts a public https host", () =>
    Effect.gen(function* () {
      assert.equal(
        (yield* validateWith("https://hooks.slack.com/services/x", ["140.82.112.3"]))._tag,
        "Success",
      );
    }),
  );
  it.effect("rejects http", () =>
    Effect.gen(function* () {
      assert.equal(
        (yield* validateWith("http://hooks.slack.com/x", ["140.82.112.3"]))._tag,
        "Failure",
      );
    }),
  );
  it.effect("rejects loopback", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://localhost/x", ["127.0.0.1"]))._tag, "Failure");
    }),
  );
  it.effect("rejects the cloud-metadata address", () =>
    Effect.gen(function* () {
      assert.equal(
        (yield* validateWith("https://metadata.internal/x", ["169.254.169.254"]))._tag,
        "Failure",
      );
    }),
  );
  it.effect("rejects private 10/8", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://internal.svc/x", ["10.1.2.3"]))._tag, "Failure");
    }),
  );
  it.effect("rejects 172.16/12 and accepts 172.32 (outside range)", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://x/y", ["172.16.0.1"]))._tag, "Failure");
      assert.equal((yield* validateWith("https://x/y", ["172.31.255.255"]))._tag, "Failure");
      assert.equal((yield* validateWith("https://x/y", ["172.32.0.1"]))._tag, "Success");
    }),
  );
  it.effect("rejects 192.168/16", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://x/y", ["192.168.1.1"]))._tag, "Failure");
    }),
  );
  it.effect("rejects IPv6 loopback + link-local + unique-local", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://x/y", ["::1"]))._tag, "Failure");
      assert.equal((yield* validateWith("https://x/y", ["fe80::1"]))._tag, "Failure");
      assert.equal((yield* validateWith("https://x/y", ["fc00::1"]))._tag, "Failure");
    }),
  );
  it.effect("rejects the full fe80::/10 link-local range (boundaries fe80/fe90/febf)", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://x/y", ["fe80::1"]))._tag, "Failure");
      assert.equal((yield* validateWith("https://x/y", ["fe90::1"]))._tag, "Failure");
      assert.equal((yield* validateWith("https://x/y", ["febf::1"]))._tag, "Failure");
    }),
  );
  it.effect("rejects the full fc00::/7 unique-local range (boundaries fc00/fdff)", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://x/y", ["fc00::1"]))._tag, "Failure");
      assert.equal((yield* validateWith("https://x/y", ["fdff::1"]))._tag, "Failure");
    }),
  );
  it.effect("rejects IPv4-mapped IPv6 private (::ffff:10.0.0.1)", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://x/y", ["::ffff:10.0.0.1"]))._tag, "Failure");
    }),
  );
  it.effect("rejects when ANY resolved address is private (mixed)", () =>
    Effect.gen(function* () {
      assert.equal(
        (yield* validateWith("https://x/y", ["140.82.112.3", "10.0.0.1"]))._tag,
        "Failure",
      );
    }),
  );
  it.effect("fails when the host does not resolve (empty)", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("https://x/y", []))._tag, "Failure");
    }),
  );
  it.effect("fails on a malformed URL", () =>
    Effect.gen(function* () {
      assert.equal((yield* validateWith("not a url", ["1.2.3.4"]))._tag, "Failure");
    }),
  );
});
