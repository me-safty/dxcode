import { assert, it } from "@effect/vitest";
import { expect } from "vitest";

import {
  parseNpmVersionsJson,
  resolvePublishTargetVersion,
  type PublishTargetVersionOptions,
} from "./publish-npm.ts";

const options = (version: string | null = null): PublishTargetVersionOptions => ({
  bump: "patch",
  version,
});

const publishedLookup =
  (...publishedVersions: ReadonlyArray<string>) =>
  async (version: string) =>
    publishedVersions.includes(version);

it("uses the current package version when npm has not published it yet", async () => {
  const result = await resolvePublishTargetVersion(
    "salchi",
    "0.0.29",
    options(),
    publishedLookup("0.0.28"),
  );

  assert.deepStrictEqual(result, {
    targetVersion: "0.0.29",
    source: "current-unpublished",
  });
});

it("bumps the current package version when npm has already published it", async () => {
  const result = await resolvePublishTargetVersion(
    "salchi",
    "0.0.28",
    options(),
    publishedLookup("0.0.28"),
  );

  assert.deepStrictEqual(result, {
    targetVersion: "0.0.29",
    source: "bumped-current-published",
  });
});

it("rejects a bumped package version that npm has already published", async () => {
  await expect(
    resolvePublishTargetVersion("salchi", "0.0.28", options(), publishedLookup("0.0.28", "0.0.29")),
  ).rejects.toThrow(/salchi@0\.0\.29 is already published/);
});

it("rejects an explicit package version that npm has already published", async () => {
  await expect(
    resolvePublishTargetVersion("salchi", "0.0.28", options("0.0.29"), publishedLookup("0.0.29")),
  ).rejects.toThrow(/salchi@0\.0\.29 is already published/);
});

it("parses npm versions responses with one or many versions", () => {
  assert.deepStrictEqual(Array.from(parseNpmVersionsJson('"0.0.28"')), ["0.0.28"]);
  assert.deepStrictEqual(Array.from(parseNpmVersionsJson('["0.0.27","0.0.28"]')), [
    "0.0.27",
    "0.0.28",
  ]);
});
