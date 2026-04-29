import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";

import { parseGeminiEnvFile } from "./geminiCliFiles.ts";

describe("parseGeminiEnvFile", () => {
  it("parses Gemini CLI dotenv files", () => {
    assert.deepStrictEqual(
      parseGeminiEnvFile(`
# comment
GOOGLE_CLOUD_PROJECT=t3-code-enterprise
export GOOGLE_CLOUD_PROJECT_ID="project-id"
GEMINI_API_KEY='api-key'
INVALID-KEY=ignored
EMPTY=
`),
      {
        GOOGLE_CLOUD_PROJECT: "t3-code-enterprise",
        GOOGLE_CLOUD_PROJECT_ID: "project-id",
        GEMINI_API_KEY: "api-key",
        EMPTY: "",
      },
    );
  });
});
