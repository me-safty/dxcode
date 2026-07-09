import { describe, expect, it } from "vite-plus/test";

import type { RecentThreadShortcut } from "../../persistence/imperative";
import {
  buildShortcutActions,
  MAX_RECENT_THREAD_SHORTCUTS,
  NEW_TASK_SHORTCUT_ID,
  shortcutHref,
  withRecentThreadShortcut,
} from "./appShortcuts";

function thread(suffix: string, title = `Thread ${suffix}`): RecentThreadShortcut {
  return { environmentId: `env-${suffix}`, threadId: `thread-${suffix}`, title };
}

describe("withRecentThreadShortcut", () => {
  it("prepends a newly opened thread", () => {
    const next = withRecentThreadShortcut([thread("a")], thread("b"));
    expect(next.map((entry) => entry.threadId)).toEqual(["thread-b", "thread-a"]);
  });

  it("moves a reopened thread to the front without duplicating it", () => {
    const next = withRecentThreadShortcut([thread("a"), thread("b")], thread("b"));
    expect(next.map((entry) => entry.threadId)).toEqual(["thread-b", "thread-a"]);
  });

  it("caps the list at the shortcut budget", () => {
    const current = [thread("a"), thread("b"), thread("c")];
    const next = withRecentThreadShortcut(current, thread("d"));
    expect(next).toHaveLength(MAX_RECENT_THREAD_SHORTCUTS);
    expect(next[0]?.threadId).toBe("thread-d");
    expect(next.map((entry) => entry.threadId)).not.toContain("thread-c");
  });

  it("returns the same array when the thread already leads with the same title", () => {
    const current = [thread("a"), thread("b")];
    expect(withRecentThreadShortcut(current, thread("a"))).toBe(current);
  });

  it("keeps the known title when a reopen records an empty one", () => {
    const current = [thread("a", "Fix the build")];
    const next = withRecentThreadShortcut(current, thread("a", ""));
    expect(next).toBe(current);
  });

  it("updates the title once the shell provides one", () => {
    const current = [thread("a", "")];
    const next = withRecentThreadShortcut(current, thread("a", "Fix the build"));
    expect(next[0]?.title).toBe("Fix the build");
    expect(next).toHaveLength(1);
  });
});

describe("buildShortcutActions", () => {
  it("leads with the static new-task action", () => {
    const actions = buildShortcutActions([thread("a")]);
    expect(actions[0]?.id).toBe(NEW_TASK_SHORTCUT_ID);
    expect(actions[0]?.params?.href).toBe("/new");
    expect(actions).toHaveLength(2);
  });

  it("deep-links threads with encoded route params", () => {
    const actions = buildShortcutActions([
      { environmentId: "env 1", threadId: "thread/2", title: "Spaced out" },
    ]);
    expect(actions[1]?.params?.href).toBe("/threads/env%201/thread%2F2");
    expect(actions[1]?.title).toBe("Spaced out");
  });

  it("falls back to a generic label for missing titles", () => {
    const actions = buildShortcutActions([thread("a", "  ")]);
    expect(actions[1]?.title).toBe("Thread");
  });
});

describe("shortcutHref", () => {
  it("accepts in-app hrefs and rejects anything else", () => {
    expect(shortcutHref({ id: "x", title: "x", params: { href: "/new" } })).toBe("/new");
    expect(shortcutHref({ id: "x", title: "x", params: { href: "https://evil.example" } })).toBe(
      null,
    );
    expect(shortcutHref({ id: "x", title: "x", params: { href: 3 } })).toBe(null);
    expect(shortcutHref({ id: "x", title: "x" })).toBe(null);
  });
});
