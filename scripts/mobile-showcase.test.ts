import { assert, it } from "@effect/vitest";

import { resolveShowcaseAndroidAbi, type ShowcaseConfig } from "./mobile-showcase.config.ts";
import {
  SHOWCASE_ENVIRONMENTS,
  SHOWCASE_PROJECTS,
  SHOWCASE_THREADS,
} from "./mobile-showcase-environment.ts";
import {
  encodeAndroidPairingUrls,
  parseShowcaseCliArgs,
  parsePairingCredentialOutput,
  planShowcaseCaptures,
  readPngDimensions,
  selectLanIpv4Address,
  showcaseSceneUrl,
} from "./mobile-showcase.ts";

const config: ShowcaseConfig = {
  outputDirectory: "artifacts",
  metroPort: 8199,
  settleDelayMs: 1,
  devices: [
    {
      id: "phone",
      platform: "ios",
      simulator: "iPhone Test",
      appearance: "dark",
      scenes: ["thread", "review"],
    },
    {
      id: "pixel",
      platform: "android",
      avd: "Pixel_Test",
      appearance: "light",
      scenes: ["thread", "terminal"],
    },
  ],
};

it("parses repeatable capture filters", () => {
  const options = parseShowcaseCliArgs([
    "--platform",
    "ios",
    "--device",
    "phone",
    "--scene",
    "review",
    "--skip-build",
  ]);
  assert.deepStrictEqual([...options.platforms], ["ios"]);
  assert.deepStrictEqual([...options.deviceIds], ["phone"]);
  assert.deepStrictEqual([...options.scenes], ["review"]);
  assert.equal(options.skipBuild, true);
});

it("selects an explicit CI Android ABI without changing the local default", () => {
  assert.equal(resolveShowcaseAndroidAbi(undefined), "arm64-v8a");
  assert.equal(resolveShowcaseAndroidAbi("x86_64"), "x86_64");
  assert.throws(() => resolveShowcaseAndroidAbi("mips"), /Unsupported T3_SHOWCASE_ANDROID_ABI/u);
});

it("plans only scenes supported by each selected device", () => {
  const options = parseShowcaseCliArgs(["--platform", "all", "--scene", "terminal"]);
  const captures = planShowcaseCaptures(config, options);
  assert.deepStrictEqual(
    captures.map((capture) => ({ id: capture.device.id, scenes: capture.scenes })),
    [{ id: "pixel", scenes: ["terminal"] }],
  );
});

it("rejects unknown devices instead of silently capturing another target", () => {
  const options = parseShowcaseCliArgs(["--device", "missing"]);
  assert.throws(() => planShowcaseCaptures(config, options), /Unknown device 'missing'/u);
});

it("reads captured PNG dimensions from the IHDR header", () => {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1320);
  view.setUint32(20, 2868);
  assert.deepStrictEqual(readPngDimensions(bytes), { width: 1320, height: 2868 });
});

it("selects a reachable LAN IPv4 address", () => {
  assert.equal(
    selectLanIpv4Address([
      { address: "127.0.0.1", family: "IPv4", internal: true },
      { address: "fe80::1", family: "IPv6", internal: false },
      { address: "169.254.2.4", family: "IPv4", internal: false },
      { address: "192.168.1.80", family: "IPv4", internal: false },
    ]),
    "192.168.1.80",
  );
});

it("maps capture scenes to the real application routes", () => {
  assert.equal(showcaseSceneUrl("threads", "environment-1"), "t3code-dev://");
  assert.equal(
    showcaseSceneUrl("environments", "environment-1"),
    "t3code-dev://settings/environments",
  );
  assert.equal(
    showcaseSceneUrl("thread", "environment-1"),
    "t3code-dev://threads/environment-1/remote-command-center",
  );
  assert.equal(
    showcaseSceneUrl("terminal", "environment-1"),
    "t3code-dev://threads/environment-1/remote-command-center/terminal?terminalId=term-1",
  );
  assert.equal(
    showcaseSceneUrl("review", "environment-1"),
    "t3code-dev://threads/environment-1/remote-command-center/review",
  );
});

it("seeds a playful multi-environment project spectrum", () => {
  assert.deepStrictEqual(
    SHOWCASE_PROJECTS.map((project) => project.title),
    ["T3 Code", "React", "Linux"],
  );
  assert.deepStrictEqual(
    SHOWCASE_ENVIRONMENTS.map((environment) => environment.label),
    ["Moonbase Terminal", "Suspense Station", "Kernel Cabin"],
  );
  assert.equal(SHOWCASE_THREADS.length, 6);
  assert.equal(new Set(SHOWCASE_THREADS.map((thread) => thread.projectId)).size, 3);
  assert.equal(
    SHOWCASE_PROJECTS.every((project) => project.favicon.includes("<svg")),
    true,
  );
});

it("reads multiline JSON from the pairing CLI", () => {
  assert.equal(
    parsePairingCredentialOutput('server log\n{\n  "credential": "PAIR-ME"\n}\n'),
    "PAIR-ME",
  );
});

it("encodes Android pairing URLs without shell-sensitive JSON quotes", () => {
  const urls = ["http://10.0.2.2:65164/#token=ONE", "http://10.0.2.2:65198/#token=TWO"];
  const encoded = encodeAndroidPairingUrls(urls);
  assert.equal(encoded.startsWith("json-uri:"), true);
  assert.deepStrictEqual(JSON.parse(decodeURIComponent(encoded.slice("json-uri:".length))), urls);
  assert.equal(encoded.includes('"'), false);
});
