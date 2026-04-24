import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { expect } from "vitest";

import { ServerConfig } from "../../config.ts";
import { TextGeneration } from "../Services/TextGeneration.ts";
import { sanitizeThreadTitle } from "../Utils.ts";
import { ClaudeTextGenerationLive } from "./ClaudeTextGeneration.ts";
import { ServerSettingsService } from "../../serverSettings.ts";

const ClaudeTextGenerationTestLayer = ClaudeTextGenerationLive.pipe(
  Layer.provideMerge(ServerSettingsService.layerTest()),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), {
      prefix: "marcode-claude-text-generation-test-",
    }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

function makeFakeClaudeBinary(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const binDir = path.join(dir, "bin");
    const claudePath = path.join(binDir, "claude");
    yield* fs.makeDirectory(binDir, { recursive: true });

    yield* fs.writeFileString(
      claudePath,
      [
        "#!/bin/sh",
        'args="$*"',
        'stdin_content="$(cat)"',
        'if [ -n "$MARCODE_FAKE_CLAUDE_ARGS_MUST_CONTAIN" ]; then',
        '  printf "%s" "$args" | grep -F -- "$MARCODE_FAKE_CLAUDE_ARGS_MUST_CONTAIN" >/dev/null || {',
        '    printf "%s\\n" "args missing expected content" >&2',
        "    exit 2",
        "  }",
        "fi",
        'if [ -n "$MARCODE_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN" ]; then',
        '  if printf "%s" "$args" | grep -F -- "$MARCODE_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN" >/dev/null; then',
        '    printf "%s\\n" "args contained forbidden content" >&2',
        "    exit 3",
        "  fi",
        "fi",
        'if [ -n "$MARCODE_FAKE_CLAUDE_STDIN_MUST_CONTAIN" ]; then',
        '  printf "%s" "$stdin_content" | grep -F -- "$MARCODE_FAKE_CLAUDE_STDIN_MUST_CONTAIN" >/dev/null || {',
        '    printf "%s\\n" "stdin missing expected content" >&2',
        "    exit 4",
        "  }",
        "fi",
        'if [ -n "$MARCODE_FAKE_CLAUDE_STDERR" ]; then',
        '  printf "%s\\n" "$MARCODE_FAKE_CLAUDE_STDERR" >&2',
        "fi",
        'printf "%s" "$MARCODE_FAKE_CLAUDE_OUTPUT"',
        'exit "${MARCODE_FAKE_CLAUDE_EXIT_CODE:-0}"',
        "",
      ].join("\n"),
    );
    yield* fs.chmod(claudePath, 0o755);
    return binDir;
  });
}

function withFakeClaudeEnv<A, E, R>(
  input: {
    output: string;
    exitCode?: number;
    stderr?: string;
    argsMustContain?: string;
    argsMustNotContain?: string;
    stdinMustContain?: string;
  },
  effect: Effect.Effect<A, E, R>,
) {
  return Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const tempDir = yield* fs.makeTempDirectoryScoped({ prefix: "marcode-claude-text-" });
      const binDir = yield* makeFakeClaudeBinary(tempDir);
      const previousPath = process.env.PATH;
      const previousOutput = process.env.MARCODE_FAKE_CLAUDE_OUTPUT;
      const previousExitCode = process.env.MARCODE_FAKE_CLAUDE_EXIT_CODE;
      const previousStderr = process.env.MARCODE_FAKE_CLAUDE_STDERR;
      const previousArgsMustContain = process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_CONTAIN;
      const previousArgsMustNotContain = process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN;
      const previousStdinMustContain = process.env.MARCODE_FAKE_CLAUDE_STDIN_MUST_CONTAIN;

      yield* Effect.sync(() => {
        process.env.PATH = `${binDir}:${previousPath ?? ""}`;
        process.env.MARCODE_FAKE_CLAUDE_OUTPUT = input.output;

        if (input.exitCode !== undefined) {
          process.env.MARCODE_FAKE_CLAUDE_EXIT_CODE = String(input.exitCode);
        } else {
          delete process.env.MARCODE_FAKE_CLAUDE_EXIT_CODE;
        }

        if (input.stderr !== undefined) {
          process.env.MARCODE_FAKE_CLAUDE_STDERR = input.stderr;
        } else {
          delete process.env.MARCODE_FAKE_CLAUDE_STDERR;
        }

        if (input.argsMustContain !== undefined) {
          process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_CONTAIN = input.argsMustContain;
        } else {
          delete process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_CONTAIN;
        }

        if (input.argsMustNotContain !== undefined) {
          process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN = input.argsMustNotContain;
        } else {
          delete process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN;
        }

        if (input.stdinMustContain !== undefined) {
          process.env.MARCODE_FAKE_CLAUDE_STDIN_MUST_CONTAIN = input.stdinMustContain;
        } else {
          delete process.env.MARCODE_FAKE_CLAUDE_STDIN_MUST_CONTAIN;
        }
      });

      return {
        previousPath,
        previousOutput,
        previousExitCode,
        previousStderr,
        previousArgsMustContain,
        previousArgsMustNotContain,
        previousStdinMustContain,
      };
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.env.PATH = previous.previousPath;

        if (previous.previousOutput === undefined) {
          delete process.env.MARCODE_FAKE_CLAUDE_OUTPUT;
        } else {
          process.env.MARCODE_FAKE_CLAUDE_OUTPUT = previous.previousOutput;
        }

        if (previous.previousExitCode === undefined) {
          delete process.env.MARCODE_FAKE_CLAUDE_EXIT_CODE;
        } else {
          process.env.MARCODE_FAKE_CLAUDE_EXIT_CODE = previous.previousExitCode;
        }

        if (previous.previousStderr === undefined) {
          delete process.env.MARCODE_FAKE_CLAUDE_STDERR;
        } else {
          process.env.MARCODE_FAKE_CLAUDE_STDERR = previous.previousStderr;
        }

        if (previous.previousArgsMustContain === undefined) {
          delete process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_CONTAIN;
        } else {
          process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_CONTAIN = previous.previousArgsMustContain;
        }

        if (previous.previousArgsMustNotContain === undefined) {
          delete process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN;
        } else {
          process.env.MARCODE_FAKE_CLAUDE_ARGS_MUST_NOT_CONTAIN =
            previous.previousArgsMustNotContain;
        }

        if (previous.previousStdinMustContain === undefined) {
          delete process.env.MARCODE_FAKE_CLAUDE_STDIN_MUST_CONTAIN;
        } else {
          process.env.MARCODE_FAKE_CLAUDE_STDIN_MUST_CONTAIN = previous.previousStdinMustContain;
        }
      }),
  );
}

it.layer(ClaudeTextGenerationTestLayer)("ClaudeTextGenerationLive", (it) => {
  it.effect("forwards Claude thinking settings for Haiku without passing effort", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            subject: "Add important change",
            body: "",
          },
        }),
        argsMustContain: '--settings {"alwaysThinkingEnabled":false}',
        argsMustNotContain: "--effort",
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateCommitMessage({
          cwd: process.cwd(),
          branch: "feature/claude-effect",
          stagedSummary: "M README.md",
          stagedPatch: "diff --git a/README.md b/README.md",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-haiku-4-5",
            options: [
              { id: "thinking", value: false },
              { id: "effort", value: "high" },
            ],
          },
        });

        expect(generated.subject).toBe("Add important change");
      }),
    ),
  );

  it.effect("generates thread name from user message", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            title: "Fix login timeout handling",
          },
        }),
        stdinMustContain: "thread titles",
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "The login page times out after 30 seconds, can you fix the timeout handling?",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-haiku-4-5",
          },
        });

        expect(generated.title).toBe("Fix login timeout handling");
      }),
    ),
  );

  it.effect("forwards Claude fast mode and supported effort", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            title: "Improve orchestration flow",
            body: "Body",
          },
        }),
        argsMustContain: '--effort max --settings {"fastMode":true}',
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generatePrContent({
          cwd: process.cwd(),
          baseBranch: "main",
          headBranch: "feature/claude-effect",
          commitSummary: "Improve orchestration",
          diffSummary: "1 file changed",
          diffPatch: "diff --git a/README.md b/README.md",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-opus-4-6",
            options: [
              { id: "effort", value: "max" },
              { id: "fastMode", value: true },
            ],
          },
        });

        expect(generated.title).toBe("Improve orchestration flow");
      }),
    ),
  );

  it.effect("generates thread titles through the Claude provider", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            title:
              '  "Reconnect failures after restart because the session state does not recover"  ',
          },
        }),
        stdinMustContain: "You generate concise thread titles for coding assistant conversations.",
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "Please investigate reconnect failures after restarting the session.",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-6",
          },
        });

        expect(generated.title).toBe(
          sanitizeThreadTitle(
            '"Reconnect failures after restart because the session state does not recover"',
          ),
        );
      }),
    ),
  );

  it.effect("falls back when Claude thread title normalization becomes whitespace-only", () =>
    withFakeClaudeEnv(
      {
        output: JSON.stringify({
          structured_output: {
            title: '  """   """  ',
          },
        }),
      },
      Effect.gen(function* () {
        const textGeneration = yield* TextGeneration;

        const generated = yield* textGeneration.generateThreadTitle({
          cwd: process.cwd(),
          message: "Name this thread.",
          modelSelection: {
            provider: "claudeAgent",
            model: "claude-sonnet-4-6",
          },
        });

        expect(generated.title).toBe("New thread");
      }),
    ),
  );
});
