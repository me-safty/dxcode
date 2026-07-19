import * as NodeCrypto from "node:crypto";

import { DxArtifactManifest, DxBuildProvenance } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { ProcessRunner } from "../processRunner.ts";

const DX_BUNDLE_ID = "com.t3tools.dxcode";
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(DxArtifactManifest));
const decodeProvenance = Schema.decodeUnknownEffect(Schema.fromJsonString(DxBuildProvenance));

export class DxBuildAdapterError extends Data.TaggedError("DxBuildAdapterError")<{
  readonly operation: string;
  readonly message: string;
  readonly canRetry: boolean;
}> {}

const buildError = (operation: string, message: string, canRetry = false) =>
  new DxBuildAdapterError({ operation, message, canRetry });

export class DxBuildAdapter extends Context.Service<
  DxBuildAdapter,
  {
    readonly verifySource: (
      cwd: string,
      expectedCommit: string,
    ) => Effect.Effect<void, DxBuildAdapterError>;
    readonly runRequiredChecks: (cwd: string) => Effect.Effect<void, DxBuildAdapterError>;
    readonly build: (
      cwd: string,
      expectedCommit: string,
    ) => Effect.Effect<DxArtifactManifest, DxBuildAdapterError>;
  }
>()("t3/dxLocalUpdate/DxBuildAdapter") {}

export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner;

  const run = Effect.fn("DxBuildAdapter.run")(function* (input: {
    readonly cwd: string;
    readonly operation: string;
    readonly command: string;
    readonly args: ReadonlyArray<string>;
    readonly timeout: Duration.Input;
  }) {
    const result = yield* runner
      .run({
        command: input.command,
        args: input.args,
        cwd: input.cwd,
        timeout: input.timeout,
        outputMode: "truncate",
        maxOutputBytes: 16 * 1024 * 1024,
      })
      .pipe(
        Effect.mapError(() => buildError(input.operation, `Could not run ${input.command}.`, true)),
      );
    if (result.code !== 0 || result.timedOut) {
      return yield* buildError(
        input.operation,
        `${input.operation} failed.${result.stderr.trim() ? ` ${result.stderr.trim().slice(-2_000)}` : ""}`,
        true,
      );
    }
    return result.stdout;
  });

  const verifySource = Effect.fn("DxBuildAdapter.verifySource")(function* (
    cwd: string,
    expectedCommit: string,
  ) {
    const branch = (yield* run({
      cwd,
      operation: "validate-build-branch",
      command: "git",
      args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
      timeout: Duration.seconds(30),
    })).trim();
    const status = (yield* run({
      cwd,
      operation: "validate-build-cleanliness",
      command: "git",
      args: ["status", "--porcelain=v1", "--untracked-files=normal"],
      timeout: Duration.seconds(30),
    })).trim();
    const head = (yield* run({
      cwd,
      operation: "validate-build-commit",
      command: "git",
      args: ["rev-parse", "HEAD"],
      timeout: Duration.seconds(30),
    })).trim();
    if (branch !== "dx/main" || status.length > 0 || head !== expectedCommit) {
      return yield* buildError(
        "validate-build-source",
        "DX build source must be clean dx/main at the exact published commit.",
      );
    }
  });

  const runRequiredChecks = Effect.fn("DxBuildAdapter.runRequiredChecks")(function* (cwd: string) {
    yield* run({
      cwd,
      operation: "vp-check",
      command: "vp",
      args: ["check"],
      timeout: Duration.minutes(30),
    });
    yield* run({
      cwd,
      operation: "vp-typecheck",
      command: "vp",
      args: ["run", "typecheck"],
      timeout: Duration.minutes(30),
    });
  });

  const validateMountedArtifact = Effect.fn("DxBuildAdapter.validateMountedArtifact")(function* (
    artifactPath: string,
    expectedCommit: string,
  ) {
    const mountPoint = yield* fs.makeTempDirectoryScoped({ prefix: "dx-update-mount-" });
    yield* run({
      cwd: path.dirname(artifactPath),
      operation: "mount-dx-artifact",
      command: "hdiutil",
      args: ["attach", "-readonly", "-nobrowse", "-mountpoint", mountPoint, artifactPath],
      timeout: Duration.minutes(2),
    });
    yield* Effect.addFinalizer(() =>
      runner
        .run({
          command: "hdiutil",
          args: ["detach", mountPoint],
          cwd: path.dirname(artifactPath),
          timeout: Duration.minutes(1),
          outputMode: "truncate",
        })
        .pipe(Effect.ignore),
    );
    const appPath = path.join(mountPoint, "DX Code.app");
    if (!(yield* fs.exists(appPath))) {
      return yield* buildError("validate-dx-artifact", "The DMG does not contain DX Code.app.");
    }
    const bundleId = (yield* run({
      cwd: mountPoint,
      operation: "validate-dx-bundle-id",
      command: "plutil",
      args: [
        "-extract",
        "CFBundleIdentifier",
        "raw",
        "-o",
        "-",
        path.join(appPath, "Contents", "Info.plist"),
      ],
      timeout: Duration.seconds(30),
    })).trim();
    if (bundleId !== DX_BUNDLE_ID) {
      return yield* buildError(
        "validate-dx-bundle-id",
        "The artifact is not a DX Code bundle. Production T3 artifacts are refused.",
      );
    }
    const provenancePath = path.join(appPath, "Contents", "Resources", "dx-build-provenance.json");
    const provenance = yield* fs.readFileString(provenancePath).pipe(
      Effect.flatMap(decodeProvenance),
      Effect.mapError(() =>
        buildError("validate-dx-provenance", "The artifact has invalid DX provenance."),
      ),
    );
    if (provenance.sourceCommit !== expectedCommit || provenance.dirty !== false) {
      return yield* buildError(
        "validate-dx-provenance",
        "The artifact provenance does not match the published dx/main commit.",
      );
    }
  });

  const build = Effect.fn("DxBuildAdapter.build")(function* (cwd: string, expectedCommit: string) {
    yield* verifySource(cwd, expectedCommit);
    yield* run({
      cwd,
      operation: "build-dx-artifact",
      command: "bun",
      args: ["run", "dist:desktop:dx:dmg"],
      timeout: Duration.hours(1),
    });
    yield* verifySource(cwd, expectedCommit);
    const outputDir = path.join(cwd, "release-dx");
    const entries = yield* fs
      .readDirectory(outputDir)
      .pipe(
        Effect.mapError(() =>
          buildError("read-dx-manifest", "The build produced no readable artifact manifest."),
        ),
      );
    const manifests = entries.filter((entry) => entry.endsWith(".dmg.manifest.json"));
    const matching: Array<DxArtifactManifest> = [];
    for (const name of manifests) {
      const decoded = yield* fs
        .readFileString(path.join(outputDir, name))
        .pipe(Effect.flatMap(decodeManifest), Effect.option);
      if (decoded._tag === "Some" && decoded.value.sourceCommit === expectedCommit) {
        matching.push(decoded.value);
      }
    }
    if (matching.length !== 1 || !matching[0]) {
      return yield* buildError(
        "read-dx-manifest",
        "The build did not produce exactly one manifest for the published commit.",
      );
    }
    const manifest = matching[0];
    if (manifest.bundleId !== DX_BUNDLE_ID) {
      return yield* buildError("validate-dx-manifest", "The manifest bundle ID is not DX Code.");
    }
    const artifactPath = path.isAbsolute(manifest.artifactPath)
      ? manifest.artifactPath
      : path.resolve(cwd, manifest.artifactPath);
    const bytes = yield* fs
      .readFile(artifactPath)
      .pipe(Effect.mapError(() => buildError("hash-dx-artifact", "Could not read the built DMG.")));
    const actualHash = NodeCrypto.createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== manifest.sha256) {
      return yield* buildError("hash-dx-artifact", "The built DMG SHA-256 does not match.");
    }
    yield* Effect.scoped(validateMountedArtifact(artifactPath, expectedCommit)).pipe(
      Effect.mapError((error) =>
        error instanceof DxBuildAdapterError
          ? error
          : buildError("validate-dx-artifact", "Could not mount and validate the built DMG."),
      ),
    );
    return { ...manifest, artifactPath };
  });

  return DxBuildAdapter.of({ verifySource, runRequiredChecks, build });
});

export const layer = Layer.effect(DxBuildAdapter, make);
