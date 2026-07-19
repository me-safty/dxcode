// @effect-diagnostics nodeBuiltinImport:off

import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";

import {
  DxArtifactManifest,
  type DxLocalInstallInput,
  type DxLocalInstallResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";

const DX_BUNDLE_ID = "com.t3tools.dxcode";
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(DxArtifactManifest));
const InstallRequest = Schema.Struct({
  sessionId: Schema.String,
  parentPid: Schema.Int,
  artifactPath: Schema.String,
  artifactSha256: Schema.String,
  sourceCommit: Schema.String,
  currentAppPath: Schema.String,
  healthMarkerPath: Schema.String,
});
const encodeInstallRequest = Schema.encodeEffect(Schema.fromJsonString(InstallRequest));

export class LocalDxInstaller extends Context.Service<
  LocalDxInstaller,
  {
    readonly install: (input: DxLocalInstallInput) => Effect.Effect<DxLocalInstallResult>;
  }
>()("@t3tools/desktop/localUpdate/LocalDxInstaller") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const electronApp = yield* ElectronApp.ElectronApp;
  const path = environment.path;

  const unavailable = (message: string): DxLocalInstallResult => ({
    status: "unavailable",
    message,
  });

  const installUnsafe = Effect.fn("desktop.localDxInstaller.install")(function* (
    input: DxLocalInstallInput,
  ) {
    if (
      environment.platform !== "darwin" ||
      !environment.isPackaged ||
      environment.flavorId !== "dx"
    ) {
      return unavailable("Local installation is available only in packaged DX Code on macOS.");
    }
    if (input.artifact.bundleId !== DX_BUNDLE_ID || !input.artifact.artifactPath.endsWith(".dmg")) {
      return unavailable("The selected artifact is not a DX Code DMG.");
    }
    const artifactPath = path.resolve(input.artifact.artifactPath);
    const manifestPath = `${artifactPath}.manifest.json`;
    const manifest = yield* fs
      .readFileString(manifestPath)
      .pipe(Effect.flatMap(decodeManifest), Effect.option);
    if (
      manifest._tag === "None" ||
      manifest.value.sourceCommit !== input.artifact.sourceCommit ||
      manifest.value.sha256 !== input.artifact.sha256 ||
      manifest.value.bundleId !== DX_BUNDLE_ID
    ) {
      return unavailable("The artifact manifest is missing or does not match the update.");
    }
    const bytes = yield* fs.readFile(artifactPath).pipe(Effect.option);
    if (
      bytes._tag === "None" ||
      NodeCrypto.createHash("sha256").update(bytes.value).digest("hex") !== input.artifact.sha256
    ) {
      return unavailable("The artifact SHA-256 no longer matches its manifest.");
    }
    const currentAppPath = path.resolve(environment.resourcesPath, "..", "..");
    if (path.basename(currentAppPath) !== "DX Code.app") {
      return unavailable("Could not safely resolve the currently running DX Code.app path.");
    }
    const helperPath = path.join(
      environment.appRoot,
      "apps",
      "desktop",
      "dist-electron",
      "LocalDxInstallHelper.cjs",
    );
    if (!(yield* fs.exists(helperPath))) {
      return unavailable("The external DX install helper is missing from this build.");
    }
    const healthMarkerPath = path.join(
      environment.stateDir,
      `dx-update-health-${input.sessionId}.json`,
    );
    const requestPath = path.join(environment.stateDir, `dx-update-${input.sessionId}.json`);
    yield* fs.remove(healthMarkerPath, { force: true }).pipe(Effect.ignore);
    const request = yield* encodeInstallRequest({
      sessionId: input.sessionId,
      parentPid: process.pid,
      artifactPath,
      artifactSha256: input.artifact.sha256,
      sourceCommit: input.artifact.sourceCommit,
      currentAppPath,
      healthMarkerPath,
    });
    const temporaryRequestPath = `${requestPath}.tmp-${process.pid}`;
    yield* fs.writeFileString(temporaryRequestPath, `${request}\n`);
    yield* fs.rename(temporaryRequestPath, requestPath);
    NodeChildProcess.spawn(process.execPath, [helperPath, requestPath], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    }).unref();
    yield* electronApp.quit;
    return { status: "started" } as const;
  });
  const install = (input: DxLocalInstallInput) =>
    installUnsafe(input).pipe(
      Effect.orElseSucceed(() => unavailable("Could not start the DX install helper.")),
    );

  return LocalDxInstaller.of({ install });
});

export const layer = Layer.effect(LocalDxInstaller, make);
