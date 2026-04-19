import * as NodeServices from "@effect/platform-node/NodeServices";
import { DEFAULT_SERVER_SETTINGS, ServerSettingsPatch } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { ServerConfig } from "./config.ts";
import { ServerSettingsLive, ServerSettingsService } from "./serverSettings.ts";

const makeServerSettingsLayer = () =>
  ServerSettingsLive.pipe(
    Layer.provideMerge(
      Layer.fresh(
        ServerConfig.layerTest(process.cwd(), {
          prefix: "t3code-server-settings-test-",
        }),
      ),
    ),
  );

it.layer(NodeServices.layer)("server settings", (it) => {
  it.effect("decodes nested settings patches", () =>
    Effect.sync(() => {
      const decodePatch = Schema.decodeUnknownSync(ServerSettingsPatch);

      assert.deepEqual(decodePatch({ providers: { codex: { binaryPath: "/tmp/codex" } } }), {
        providers: { codex: { binaryPath: "/tmp/codex" } },
      });

      assert.deepEqual(
        decodePatch({
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        }),
        {
          textGenerationModelSelection: {
            options: {
              fastMode: false,
            },
          },
        },
      );
    }),
  );

  it.effect("deep merges nested settings updates without dropping siblings", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/usr/local/bin/codex",
            homePath: "/Users/julius/.codex",
          },
          claudeAgent: {
            profiles: [
              {
                id: "personal",
                label: "Personal",
                binaryPath: "/usr/local/bin/claude",
                homePath: "",
                launchArgs: "",
              },
            ],
            defaultProfileId: "personal",
            customModels: ["claude-custom"],
          },
        },
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
        textGenerationModelSelection: {
          options: {
            fastMode: false,
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "/Users/julius/.codex",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        customModels: ["claude-custom"],
        profiles: [
          {
            id: "personal",
            label: "Personal",
            binaryPath: "/usr/local/bin/claude",
            homePath: "",
            launchArgs: "",
          },
        ],
        defaultProfileId: "personal",
      });
      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        options: {
          reasoningEffort: "high",
          fastMode: false,
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("preserves model when switching providers via textGenerationModelSelection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      // Start with Claude text generation selection
      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "claudeAgent",
          model: "claude-sonnet-4-6",
          options: {
            effort: "high",
          },
        },
      });

      // Switch to Codex — the stale Claude "effort" in options must not
      // cause the update to lose the selected model.
      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: "gpt-5.4",
          options: {
            reasoningEffort: "high",
          },
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: "codex",
        model: "gpt-5.4",
        options: {
          reasoningEffort: "high",
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("drops stale text generation options when resetting model selection", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: "codex",
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
          options: {
            reasoningEffort: "high",
            fastMode: true,
          },
        },
      });

      const next = yield* serverSettings.updateSettings({
        textGenerationModelSelection: {
          provider: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.provider,
          model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
        },
      });

      assert.deepEqual(next.textGenerationModelSelection, {
        provider: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.provider,
        model: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection.model,
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims provider path settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "  /opt/homebrew/bin/codex  ",
            homePath: "   ",
          },
          claudeAgent: {
            profiles: [
              {
                id: "personal",
                label: "Personal",
                binaryPath: "  /opt/homebrew/bin/claude  ",
                homePath: "",
                launchArgs: "",
              },
            ],
            defaultProfileId: "personal",
          },
        },
      });

      assert.deepEqual(next.providers.codex, {
        enabled: true,
        binaryPath: "/opt/homebrew/bin/codex",
        homePath: "",
        customModels: [],
      });
      assert.deepEqual(next.providers.claudeAgent, {
        enabled: true,
        customModels: [],
        profiles: [
          {
            id: "personal",
            label: "Personal",
            binaryPath: "/opt/homebrew/bin/claude",
            homePath: "",
            launchArgs: "",
          },
        ],
        defaultProfileId: "personal",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("trims observability settings when updates are applied", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "  ~/Development  ",
        observability: {
          otlpTracesUrl: "  http://localhost:4318/v1/traces  ",
          otlpMetricsUrl: "  http://localhost:4318/v1/metrics  ",
        },
      });

      assert.equal(next.addProjectBaseDirectory, "~/Development");
      assert.deepEqual(next.observability, {
        otlpTracesUrl: "http://localhost:4318/v1/traces",
        otlpMetricsUrl: "http://localhost:4318/v1/metrics",
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("defaults blank binary paths to provider executables", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;

      const next = yield* serverSettings.updateSettings({
        providers: {
          codex: {
            binaryPath: "   ",
          },
          claudeAgent: {
            profiles: [
              {
                id: "personal",
                label: "Personal",
                binaryPath: "",
                homePath: "",
                launchArgs: "",
              },
            ],
            defaultProfileId: "personal",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "codex");
      assert.equal(next.providers.claudeAgent.profiles[0]!.binaryPath, "claude");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("migrates legacy Claude settings shape to profiles on read", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      // Write a pre-profiles settings.json containing the legacy
      // binaryPath/launchArgs directly under providers.claudeAgent.
      const legacySettings = {
        providers: {
          claudeAgent: {
            binaryPath: "/usr/local/bin/claude",
            launchArgs: "--verbose",
            customModels: ["claude-custom"],
          },
        },
      };
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify(legacySettings, null, 2),
      );

      const serverSettings = yield* ServerSettingsService;
      const settings = yield* serverSettings.getSettings;

      assert.deepEqual(settings.providers.claudeAgent.profiles, [
        {
          id: "personal",
          label: "Personal",
          binaryPath: "/usr/local/bin/claude",
          homePath: "",
          launchArgs: "--verbose",
        },
      ]);
      assert.equal(settings.providers.claudeAgent.defaultProfileId, "personal");
      assert.deepEqual(settings.providers.claudeAgent.customModels, ["claude-custom"]);
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("leaves new-shape Claude settings untouched on read", () =>
    Effect.gen(function* () {
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;

      // A settings.json already in the profiles shape should pass through
      // unchanged — the migration must be a no-op when profiles is set.
      const newShapeSettings = {
        providers: {
          claudeAgent: {
            profiles: [
              {
                id: "work",
                label: "Work",
                binaryPath: "/opt/homebrew/bin/claude",
                homePath: "~/.claude-work",
                launchArgs: "",
              },
            ],
            defaultProfileId: "work",
          },
        },
      };
      yield* fileSystem.writeFileString(
        serverConfig.settingsPath,
        JSON.stringify(newShapeSettings, null, 2),
      );

      const serverSettings = yield* ServerSettingsService;
      const settings = yield* serverSettings.getSettings;

      assert.deepEqual(settings.providers.claudeAgent.profiles, [
        {
          id: "work",
          label: "Work",
          binaryPath: "/opt/homebrew/bin/claude",
          homePath: "~/.claude-work",
          launchArgs: "",
        },
      ]);
      assert.equal(settings.providers.claudeAgent.defaultProfileId, "work");
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );

  it.effect("writes only non-default server settings to disk", () =>
    Effect.gen(function* () {
      const serverSettings = yield* ServerSettingsService;
      const serverConfig = yield* ServerConfig;
      const fileSystem = yield* FileSystem.FileSystem;
      const next = yield* serverSettings.updateSettings({
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });

      assert.equal(next.providers.codex.binaryPath, "/opt/homebrew/bin/codex");

      const raw = yield* fileSystem.readFileString(serverConfig.settingsPath);
      assert.deepEqual(JSON.parse(raw), {
        addProjectBaseDirectory: "~/Development",
        observability: {
          otlpTracesUrl: "http://localhost:4318/v1/traces",
          otlpMetricsUrl: "http://localhost:4318/v1/metrics",
        },
        providers: {
          codex: {
            binaryPath: "/opt/homebrew/bin/codex",
          },
        },
      });
    }).pipe(Effect.provide(makeServerSettingsLayer())),
  );
});
