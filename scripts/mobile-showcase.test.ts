import { assert, it } from "@effect/vitest";

import type { ShowcaseConfig } from "./mobile-showcase.config.ts";
import {
  parseShowcaseCliArgs,
  planShowcaseCaptures,
  readPngDimensions,
  selectLanIpv4Address,
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
