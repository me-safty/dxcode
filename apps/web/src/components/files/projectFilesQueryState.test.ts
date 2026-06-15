import type { EnvironmentApi, ProjectListEntriesResult } from "@t3tools/contracts";
import { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, AtomRegistry } from "effect/unstable/reactivity";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  __resetEnvironmentApiOverridesForTests,
  __setEnvironmentApiOverrideForTests,
} from "~/environmentApi";

import { getProjectEntriesQueryAtom } from "./projectFilesQueryState";

const environmentId = EnvironmentId.make("environment-project-files-query-test");

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("project files queries", () => {
  afterEach(() => {
    __resetEnvironmentApiOverridesForTests();
    vi.unstubAllGlobals();
  });

  it("retains cached entries while explicitly revalidating", async () => {
    vi.stubGlobal("window", {});
    const first = {
      entries: [{ path: "README.md", kind: "file" }],
      truncated: false,
    } satisfies ProjectListEntriesResult;
    const second = {
      entries: [
        { path: "README.md", kind: "file" },
        { path: "src", kind: "directory" },
      ],
      truncated: false,
    } satisfies ProjectListEntriesResult;
    const revalidation = deferred<ProjectListEntriesResult>();
    const listEntries = vi
      .fn<EnvironmentApi["projects"]["listEntries"]>()
      .mockResolvedValueOnce(first)
      .mockReturnValueOnce(revalidation.promise);
    __setEnvironmentApiOverrideForTests(environmentId, {
      projects: { listEntries },
    } as unknown as EnvironmentApi);
    const registry = AtomRegistry.make();
    const atom = getProjectEntriesQueryAtom(environmentId, "/repo");

    registry.get(atom);
    await vi.waitFor(() => {
      expect(Option.getOrNull(AsyncResult.value(registry.get(atom)))).toEqual(first);
    });

    registry.refresh(atom);
    await vi.waitFor(() => expect(listEntries).toHaveBeenCalledTimes(2));
    const refreshing = registry.get(atom);
    expect(refreshing.waiting).toBe(true);
    expect(Option.getOrNull(AsyncResult.value(refreshing))).toEqual(first);

    revalidation.resolve(second);
    await vi.waitFor(() => {
      expect(Option.getOrNull(AsyncResult.value(registry.get(atom)))).toEqual(second);
    });
    registry.dispose();
  });
});
