import { assert, it } from "@effect/vitest";

import { buildDiscordReleaseAnnouncement } from "./notify-discord-release.ts";

it("builds a prerelease Discord announcement for nightly subscribers", () => {
  assert.deepStrictEqual(
    buildDiscordReleaseAnnouncement({
      target: "prerelease",
      mention: "@t3-code-nightly-announcements",
      releaseName: "T3 Code Nightly 1.2.4-nightly.20260501.17 (abcdef123456)",
      version: "1.2.4-nightly.20260501.17",
      tag: "v1.2.4-nightly.20260501.17",
      releaseUrl: "https://github.com/t3dotgg/t3-code/releases/tag/v1.2.4-nightly.20260501.17",
      timestamp: "2026-05-01T01:41:00.000Z",
    }),
    {
      content:
        "@t3-code-nightly-announcements Prerelease published: T3 Code Nightly 1.2.4-nightly.20260501.17 (abcdef123456)",
      allowed_mentions: {
        parse: ["roles"],
      },
      embeds: [
        {
          title: "T3 Code Nightly 1.2.4-nightly.20260501.17 (abcdef123456)",
          url: "https://github.com/t3dotgg/t3-code/releases/tag/v1.2.4-nightly.20260501.17",
          description: "A new T3 Code prerelease is available for nightly testers.",
          color: 0x5865f2,
          fields: [
            {
              name: "Version",
              value: "1.2.4-nightly.20260501.17",
              inline: true,
            },
            {
              name: "Tag",
              value: "v1.2.4-nightly.20260501.17",
              inline: true,
            },
          ],
          timestamp: "2026-05-01T01:41:00.000Z",
        },
      ],
    },
  );
});

it("builds a latest Discord announcement for stable subscribers", () => {
  assert.deepStrictEqual(
    buildDiscordReleaseAnnouncement({
      target: "latest",
      mention: "@t3-code-announcements",
      releaseName: "T3 Code v1.2.3",
      version: "1.2.3",
      tag: "v1.2.3",
      releaseUrl: "https://github.com/t3dotgg/t3-code/releases/tag/v1.2.3",
      timestamp: "2026-05-01T01:41:00.000Z",
    }),
    {
      content: "@t3-code-announcements Latest published: T3 Code v1.2.3",
      allowed_mentions: {
        parse: ["roles"],
      },
      embeds: [
        {
          title: "T3 Code v1.2.3",
          url: "https://github.com/t3dotgg/t3-code/releases/tag/v1.2.3",
          description: "A new T3 Code latest release is available.",
          color: 0x2ecc71,
          fields: [
            {
              name: "Version",
              value: "1.2.3",
              inline: true,
            },
            {
              name: "Tag",
              value: "v1.2.3",
              inline: true,
            },
          ],
          timestamp: "2026-05-01T01:41:00.000Z",
        },
      ],
    },
  );
});
