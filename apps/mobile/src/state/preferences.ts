import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { loadPreferences, savePreferencesPatch, type Preferences } from "../lib/storage";

export class MobilePreferencesLoadError extends Data.TaggedError("MobilePreferencesLoadError")<{
  readonly cause: unknown;
}> {}

export class MobilePreferencesSaveError extends Data.TaggedError("MobilePreferencesSaveError")<{
  readonly cause: unknown;
}> {}

export class MobilePreferencesStore extends Context.Service<
  MobilePreferencesStore,
  {
    readonly load: Effect.Effect<Preferences, MobilePreferencesLoadError>;
    readonly savePatch: (
      patch: Partial<Preferences>,
    ) => Effect.Effect<Preferences, MobilePreferencesSaveError>;
  }
>()("@t3tools/mobile/state/preferences/MobilePreferencesStore") {}

const mobilePreferencesStoreLayer = Layer.succeed(
  MobilePreferencesStore,
  MobilePreferencesStore.of({
    load: Effect.tryPromise({
      try: loadPreferences,
      catch: (cause) => new MobilePreferencesLoadError({ cause }),
    }),
    savePatch: (patch) =>
      Effect.tryPromise({
        try: () => savePreferencesPatch(patch),
        catch: (cause) => new MobilePreferencesSaveError({ cause }),
      }),
  }),
);

/**
 * Owns the device preference blob for the lifetime of the app registry.
 * Optimistic patches are kept separately so writes made while SecureStore is
 * still loading cannot be replaced by the eventual read result.
 */
export function createMobilePreferencesState(runtime: Atom.AtomRuntime<MobilePreferencesStore>) {
  const storedPreferencesAtom = runtime
    .atom(
      MobilePreferencesStore.pipe(
        Effect.flatMap((store) => store.load),
        Effect.catch(() => Effect.succeed<Preferences>({})),
      ),
    )
    .pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences:stored"));

  const optimisticPatchAtom = Atom.make<Partial<Preferences>>({}).pipe(
    Atom.keepAlive,
    Atom.withLabel("mobile:preferences:optimistic-patch"),
  );

  const preferencesAtom = Atom.make((get) => {
    const stored = get(storedPreferencesAtom);
    const optimisticPatch = get(optimisticPatchAtom);
    return AsyncResult.map(stored, (preferences) => ({ ...preferences, ...optimisticPatch }));
  }).pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences"));

  const updatePreferencesAtom = runtime
    .fn(
      (patch: Partial<Preferences>, get) => {
        get.set(optimisticPatchAtom, { ...get(optimisticPatchAtom), ...patch });
        return MobilePreferencesStore.pipe(Effect.flatMap((store) => store.savePatch(patch)));
      },
      // The storage layer serializes preference read-modify-write operations.
      // Keep every invocation alive so one preference update cannot interrupt
      // another update to a different field in the shared blob.
      { concurrent: true },
    )
    .pipe(Atom.keepAlive, Atom.withLabel("mobile:preferences:update"));

  return { preferencesAtom, updatePreferencesAtom } as const;
}

const mobilePreferencesRuntime = Atom.runtime(mobilePreferencesStoreLayer);
export const mobilePreferencesState = createMobilePreferencesState(mobilePreferencesRuntime);

export const mobilePreferencesAtom = mobilePreferencesState.preferencesAtom;
export const updateMobilePreferencesAtom = mobilePreferencesState.updatePreferencesAtom;
