import { assert, describe, it } from "@effect/vitest";

import {
  compareNightlyTags,
  countNightliesAfter,
  newestNightlyTag,
  parseLsRemoteNightlyTags,
  parseNightlyTag,
} from "./NightlyTag.ts";

describe("NightlyTag", () => {
  it("parses strict nightly tags", () => {
    assert.deepStrictEqual(parseNightlyTag("v0.0.29-nightly.20260719.828"), {
      major: 0,
      minor: 0,
      patch: 29,
      date: 20260719,
      build: 828,
    });
  });

  it("rejects invalid and malicious tags", () => {
    for (const tag of [
      "nightly-v0.0.29-20260719.828",
      "v0.0.29-nightly.2026719.828",
      "v0.0.29-nightly.20260719.828^{commit}",
      "v0.0.29-nightly.20260719.828;touch-pwned",
      "-v0.0.29-nightly.20260719.828",
    ]) {
      assert.equal(parseNightlyTag(tag), null);
    }
  });

  it("orders version, date, and build numerically", () => {
    const tags = [
      "v0.0.30-nightly.20260101.1",
      "v0.0.29-nightly.20260719.10",
      "v0.0.29-nightly.20260719.9",
      "v0.0.29-nightly.20260718.999",
    ].map((tag) => ({ tag, parsed: parseNightlyTag(tag)! }));
    tags.sort((left, right) => compareNightlyTags(left.parsed, right.parsed));
    assert.deepStrictEqual(
      tags.map(({ tag }) => tag),
      [
        "v0.0.29-nightly.20260718.999",
        "v0.0.29-nightly.20260719.9",
        "v0.0.29-nightly.20260719.10",
        "v0.0.30-nightly.20260101.1",
      ],
    );
  });

  it("parses --refs output and ignores peeled or invalid refs", () => {
    const refs = parseLsRemoteNightlyTags(
      [
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/tags/v0.0.29-nightly.20260716.825",
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/tags/v0.0.29-nightly.20260719.828",
        "cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v0.0.29-nightly.20260719.828^{}",
        "dddddddddddddddddddddddddddddddddddddddd\trefs/tags/not-a-nightly",
      ].join("\n"),
    );
    assert.equal(newestNightlyTag(refs)?.tag, "v0.0.29-nightly.20260719.828");
  });

  it("groups three tags after a dismissed target", () => {
    const refs = parseLsRemoteNightlyTags(
      [825, 826, 827, 828]
        .map(
          (build) =>
            `${String(build).padStart(40, "a")}\trefs/tags/v0.0.29-nightly.20260719.${build}`,
        )
        .join("\n"),
    );
    assert.equal(
      countNightliesAfter(refs, "v0.0.29-nightly.20260719.825", "v0.0.29-nightly.20260719.828"),
      3,
    );
  });
});
