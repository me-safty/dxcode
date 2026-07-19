import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";

const HealthMarker = Schema.Struct({ sessionId: Schema.String, healthyAt: Schema.String });
const encodeHealthMarker = Schema.encodeEffect(Schema.fromJsonString(HealthMarker));

function argumentAfter(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

export class LocalDxUpdateRecovery extends Context.Service<
  LocalDxUpdateRecovery,
  { readonly markHealthy: Effect.Effect<void> }
>()("@t3tools/desktop/localUpdate/LocalDxUpdateRecovery") {}

export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = environment.path;
  const markHealthy = Effect.gen(function* () {
    const sessionId = argumentAfter("--dx-update-session");
    const markerInput = argumentAfter("--dx-update-health-marker");
    if (!sessionId || !markerInput || !/^[0-9a-f-]{16,64}$/i.test(sessionId)) return;
    const markerPath = path.resolve(markerInput);
    if (
      path.dirname(markerPath) !== path.resolve(environment.stateDir) ||
      path.basename(markerPath) !== `dx-update-health-${sessionId}.json`
    ) {
      return;
    }
    const encoded = yield* encodeHealthMarker({
      sessionId,
      healthyAt: DateTime.formatIso(yield* DateTime.now),
    });
    const temporaryPath = `${markerPath}.tmp-${process.pid}`;
    yield* fs.writeFileString(temporaryPath, `${encoded}\n`);
    yield* fs.rename(temporaryPath, markerPath);
  }).pipe(Effect.catch(() => Effect.void));
  return LocalDxUpdateRecovery.of({ markHealthy });
});

export const layer = Layer.effect(LocalDxUpdateRecovery, make);
