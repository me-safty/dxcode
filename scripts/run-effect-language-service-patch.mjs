import { spawnSync } from "node:child_process";

if (process.env.EFFECT_LANGUAGE_SERVICE_PATCH !== "1") {
  process.exit(0);
}

const result = spawnSync("effect-language-service", ["patch"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: "pipe",
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.status === 0) {
  process.exit(0);
}

const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
if (output.includes("UnableToFindPositionToPatchError")) {
  console.warn(
    "[effect-language-service] Skipping patch because the installed TypeScript version is not patchable by this release.",
  );
  process.exit(0);
}

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
