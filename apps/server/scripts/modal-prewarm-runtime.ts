import process from "node:process";

import { ModalClient, Probe, type Sandbox, type Secret } from "modal";

const DEFAULT_MODAL_APP_NAME = "t3-task-runtime";
const DEFAULT_MODAL_IMAGE_TAG = "oven/bun:1.3.10";
const DEFAULT_RUNTIME_PORT = 8787;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const DEFAULT_WORKDIR = "/workspace/t3code";
const DEFAULT_COMMAND = ["/app/apps/server/scripts/modal-runtime-entrypoint.sh"] as const;
const BUN_BIN = "/root/.bun/bin/bun";
const DEFAULT_INSTALL_COMMAND = `${BUN_BIN} install --frozen-lockfile`;
const SANDBOX_EXEC_PATH =
  "/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";

type Args = {
  readonly expectedCommit?: string | undefined;
  readonly installCommand?: string | undefined;
  readonly skipSnapshot: boolean;
  readonly skipRuntimeSmoke: boolean;
};

function writeLine(message: string) {
  process.stdout.write(`${message}\n`);
}

function parseArgs(argv: ReadonlyArray<string>): Args {
  let expectedCommit: string | undefined;
  let installCommand: string | undefined;
  let skipSnapshot = false;
  let skipRuntimeSmoke = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--expected-commit") {
      expectedCommit = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--install-command") {
      installCommand = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--skip-snapshot") {
      skipSnapshot = true;
      continue;
    }
    if (arg === "--skip-runtime-smoke") {
      skipRuntimeSmoke = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return {
    expectedCommit: expectedCommit ?? process.env.T3_MODAL_PREWARM_EXPECTED_COMMIT,
    installCommand: installCommand ?? process.env.T3_MODAL_PREWARM_INSTALL_COMMAND,
    skipSnapshot,
    skipRuntimeSmoke,
  };
}

function parseJsonStringArray(value: string | undefined, label: string): ReadonlyArray<string> {
  if (value === undefined || value.trim() === "") {
    return [];
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new Error(`${label} must be a JSON string array.`);
  }
  return parsed;
}

function splitCommand(value: string | undefined): ReadonlyArray<string> {
  if (value === undefined || value.trim() === "") {
    return DEFAULT_COMMAND;
  }
  return ["sh", "-lc", value.trim()];
}

function positiveEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return parsed;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function loadSecrets(
  modal: ModalClient,
  names: ReadonlyArray<string>,
): Promise<Secret[] | undefined> {
  if (names.length === 0) {
    return undefined;
  }
  return Promise.all(names.map((name) => modal.secrets.fromName(name)));
}

function buildSandboxEnv(input: {
  readonly runtimePort: number;
  readonly workdir: string;
  readonly taskBranch: string;
  readonly baseBranch: string;
}): Record<string, string> {
  const sharedSecret = process.env.T3_EXECUTION_BRIDGE_SHARED_SECRET?.trim();
  const orchestratorBaseUrl = process.env.ORCHESTRATOR_BASE_URL?.trim();
  return {
    T3_RUNTIME_PORT: String(input.runtimePort),
    T3_RUNTIME_WORKSPACE: input.workdir,
    T3_TASK_BRANCH: input.taskBranch,
    T3_TASK_BASE_BRANCH: input.baseBranch,
    T3_DISABLE_RUNTIME_SETTINGS_BOOTSTRAP: "1",
    ...(sharedSecret ? { T3_EXECUTION_BRIDGE_SHARED_SECRET: sharedSecret } : {}),
    ...(orchestratorBaseUrl ? { ORCHESTRATOR_BASE_URL: orchestratorBaseUrl } : {}),
  };
}

async function runSandboxCommand(input: {
  readonly sandbox: Sandbox;
  readonly command: string;
  readonly label: string;
  readonly workdir: string;
  readonly timeoutMs: number;
}) {
  writeLine(`- ${input.label}`);
  const proc = await input.sandbox.exec(["sh", "-lc", input.command], {
    mode: "text",
    stdout: "pipe",
    stderr: "pipe",
    workdir: input.workdir,
    env: {
      PATH: SANDBOX_EXEC_PATH,
    },
    timeoutMs: input.timeoutMs,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.readText(),
    proc.stderr.readText(),
    proc.wait(),
  ]);

  if (stdout.trim() !== "") {
    writeLine(stdout.trimEnd());
  }
  if (stderr.trim() !== "") {
    process.stderr.write(`${stderr.trimEnd()}\n`);
  }
  if (exitCode !== 0) {
    throw new Error(`${input.label} failed with exit code ${exitCode}.`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const appName = process.env.T3_MODAL_APP_NAME ?? DEFAULT_MODAL_APP_NAME;
  const environment = process.env.MODAL_ENVIRONMENT;
  const imageTag = process.env.T3_MODAL_IMAGE_TAG ?? DEFAULT_MODAL_IMAGE_TAG;
  const workdir = process.env.T3_MODAL_WORKDIR ?? DEFAULT_WORKDIR;
  const runtimePort = positiveEnv("T3_MODAL_RUNTIME_PORT", DEFAULT_RUNTIME_PORT);
  const timeoutMs = positiveEnv("T3_MODAL_PREWARM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const idleTimeoutMs = positiveEnv("T3_MODAL_PREWARM_IDLE_TIMEOUT_MS", DEFAULT_IDLE_TIMEOUT_MS);
  const installCommand = args.installCommand ?? DEFAULT_INSTALL_COMMAND;
  const dockerfileCommands = parseJsonStringArray(
    process.env.T3_MODAL_IMAGE_DOCKERFILE_COMMANDS_JSON,
    "T3_MODAL_IMAGE_DOCKERFILE_COMMANDS_JSON",
  );
  const secretNames = parseJsonStringArray(
    process.env.T3_MODAL_PREWARM_SECRET_NAMES_JSON ??
      process.env.T3_MODAL_ALLOWED_SECRET_NAMES_JSON,
    "T3_MODAL_PREWARM_SECRET_NAMES_JSON",
  );
  const extraValidationCommands = parseJsonStringArray(
    process.env.T3_MODAL_PREWARM_VALIDATE_COMMANDS_JSON,
    "T3_MODAL_PREWARM_VALIDATE_COMMANDS_JSON",
  );
  const expectedCommit = args.expectedCommit?.trim();
  const safeCommit = expectedCommit?.replace(/[^a-zA-Z0-9._-]/g, "").slice(0, 16) ?? "runtime";
  const suffix = `${safeCommit}-${Date.now()}`;

  const modal = new ModalClient(environment !== undefined ? { environment } : {});
  let prepareSandbox: Sandbox | undefined;
  let runtimeSandbox: Sandbox | undefined;

  try {
    writeLine(`Prewarming Modal runtime image for app ${appName}.`);
    const app = await modal.apps.fromName(appName, {
      createIfMissing: true,
      ...(environment !== undefined ? { environment } : {}),
    });
    const baseImage = modal.images.fromRegistry(imageTag);
    const image =
      dockerfileCommands.length > 0
        ? baseImage.dockerfileCommands([...dockerfileCommands])
        : baseImage;

    writeLine("- Building image layers on Modal");
    const builtImage = await image.build(app);
    const secrets = await loadSecrets(modal, secretNames);
    const env = buildSandboxEnv({
      runtimePort,
      workdir,
      taskBranch: `prewarm/${safeCommit}`,
      baseBranch: process.env.T3_MODAL_PREWARM_BASE_BRANCH ?? "main",
    });

    prepareSandbox = await modal.sandboxes.create(app, builtImage, {
      name: `t3-prewarm-prepare-${suffix}`,
      command: ["sh", "-lc", "sleep infinity"],
      workdir,
      env,
      ...(secrets !== undefined ? { secrets } : {}),
      readinessProbe: Probe.withExec(["sh", "-lc", "true"]),
      timeoutMs,
      idleTimeoutMs,
    });
    await prepareSandbox.waitUntilReady(timeoutMs);

    const validations = [
      {
        label: "Validating prepared repository and runtime bundle",
        command: [
          "test -d /app/.git",
          `test -d ${shellQuote(workdir)}/.git`,
          "test -s /app/apps/server/dist/bin.mjs",
          "test -x /app/apps/server/scripts/modal-runtime-entrypoint.sh",
          "node --version",
          `${shellQuote(BUN_BIN)} --version`,
          "git -C /app rev-parse HEAD",
          `git -C ${shellQuote(workdir)} rev-parse HEAD`,
        ].join(" && "),
      },
      ...(expectedCommit !== undefined && expectedCommit !== ""
        ? [
            {
              label: `Checking prepared runtime commit ${expectedCommit}`,
              command: [
                `app_commit="$(git -C /app rev-parse HEAD)"`,
                `workspace_commit="$(git -C ${shellQuote(workdir)} rev-parse HEAD)"`,
                `case "$app_commit" in ${shellQuote(expectedCommit)}*) ;; *) echo "unexpected /app commit: $app_commit"; exit 10;; esac`,
                `case "$workspace_commit" in ${shellQuote(expectedCommit)}*) ;; *) echo "unexpected workspace commit: $workspace_commit"; exit 11;; esac`,
              ].join("; "),
            },
          ]
        : []),
      ...(installCommand.trim() !== ""
        ? [
            {
              label: `Running workspace install command: ${installCommand}`,
              command: installCommand,
            },
          ]
        : []),
      ...extraValidationCommands.map((command, index) => ({
        label: `Running extra validation command ${index + 1}`,
        command,
      })),
    ];

    for (const validation of validations) {
      await runSandboxCommand({
        sandbox: prepareSandbox,
        command: validation.command,
        label: validation.label,
        workdir,
        timeoutMs,
      });
    }

    const preparedImage = args.skipSnapshot
      ? builtImage
      : await prepareSandbox.snapshotFilesystem(timeoutMs);
    writeLine(`Prepared image id: ${preparedImage.imageId}`);

    if (!args.skipRuntimeSmoke) {
      runtimeSandbox = await modal.sandboxes.create(app, preparedImage, {
        name: `t3-prewarm-runtime-${suffix}`,
        command: [...splitCommand(process.env.T3_MODAL_RUNTIME_COMMAND)],
        workdir,
        env,
        ...(secrets !== undefined ? { secrets } : {}),
        encryptedPorts: [runtimePort],
        readinessProbe: Probe.withTcp(runtimePort),
        timeoutMs,
        idleTimeoutMs,
      });
      await runtimeSandbox.waitUntilReady(timeoutMs);
      const tunnels = await runtimeSandbox.tunnels(timeoutMs);
      const runtimeUrl = tunnels[runtimePort]?.url;
      writeLine(`Runtime smoke ready: ${runtimeUrl ?? "(no tunnel url)"}`);
    }

    writeLine("");
    writeLine("Use this prepared image for task materialization:");
    writeLine(`T3_MODAL_IMAGE_ID=${preparedImage.imageId}`);
  } finally {
    if (runtimeSandbox !== undefined) {
      await runtimeSandbox.terminate({ wait: true });
    }
    if (prepareSandbox !== undefined) {
      await prepareSandbox.terminate({ wait: true });
    }
    modal.close();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Modal runtime prewarm failed: ${message}\n`);
  process.exitCode = 1;
});
