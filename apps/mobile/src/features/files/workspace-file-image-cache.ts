import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/unstable/reactivity";

const WORKSPACE_IMAGE_IDLE_TTL_MS = 30 * 60_000;

type ImagePrefetch = (uri: string) => Promise<boolean>;

class WorkspaceImageCacheKey extends Data.Class<{ readonly uri: string }> {}

export class WorkspaceImagePrefetchUnavailableError extends Schema.TaggedErrorClass<WorkspaceImagePrefetchUnavailableError>()(
  "WorkspaceImagePrefetchUnavailableError",
  {
    uri: Schema.String,
  },
) {
  override get message(): string {
    return `Image prefetch did not cache ${this.uri}.`;
  }
}

export class WorkspaceImagePrefetchFailedError extends Schema.TaggedErrorClass<WorkspaceImagePrefetchFailedError>()(
  "WorkspaceImagePrefetchFailedError",
  {
    uri: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Image prefetch failed for ${this.uri}.`;
  }
}

export const WorkspaceImagePrefetchError = Schema.Union([
  WorkspaceImagePrefetchUnavailableError,
  WorkspaceImagePrefetchFailedError,
]);
export type WorkspaceImagePrefetchError = typeof WorkspaceImagePrefetchError.Type;

async function prefetchWithNativeImage(uri: string): Promise<boolean> {
  const { Image } = await import("react-native");
  return Image.prefetch(uri);
}

export function createWorkspaceFileImageAtomFamily(options?: {
  readonly idleTtlMs?: number;
  readonly prefetch?: ImagePrefetch;
}) {
  const idleTtlMs = options?.idleTtlMs ?? WORKSPACE_IMAGE_IDLE_TTL_MS;
  const prefetch = options?.prefetch ?? prefetchWithNativeImage;
  const family = Atom.family((key: WorkspaceImageCacheKey) =>
    Atom.make(
      Effect.gen(function* () {
        const cached = yield* Effect.tryPromise({
          try: () => prefetch(key.uri),
          catch: (cause) => new WorkspaceImagePrefetchFailedError({ uri: key.uri, cause }),
        });
        if (!cached) {
          return yield* new WorkspaceImagePrefetchUnavailableError({ uri: key.uri });
        }
        return key.uri;
      }),
    ).pipe(Atom.setIdleTTL(idleTtlMs), Atom.withLabel(`mobile:workspace-image:${key.uri}`)),
  );

  return (uri: string) => family(new WorkspaceImageCacheKey({ uri }));
}

export const workspaceFileImageAtom = createWorkspaceFileImageAtomFamily();
