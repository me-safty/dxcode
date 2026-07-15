import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";

import type { ThreadFeedEntry } from "../../lib/threadActivity";

export const SHOWCASE_SCENES = ["threads", "thread", "terminal", "review"] as const;
export type ShowcaseScene = (typeof SHOWCASE_SCENES)[number];

export const SHOWCASE_ENVIRONMENT_ID = EnvironmentId.make("showcase-studio");
export const SHOWCASE_PROJECT_ID = ProjectId.make("lumen-notes");
export const SHOWCASE_THREAD_ID = ThreadId.make("polish-command-palette");
export const SHOWCASE_NOW = Date.parse("2026-07-15T11:31:00.000Z");

const MODEL_SELECTION = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
} as const;

function minutesBefore(now: number, minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

function makeThread(
  now: number,
  input: {
    readonly id: string;
    readonly title: string;
    readonly branch: string;
    readonly minutesAgo: number;
    readonly state?: "working" | "approval" | "plan";
  },
): OrchestrationThreadShell {
  const threadId = ThreadId.make(input.id);
  const turnId = TurnId.make(`${input.id}-turn`);
  const updatedAt = minutesBefore(now, input.minutesAgo);
  const isWorking = input.state === "working";

  return {
    id: threadId,
    projectId: SHOWCASE_PROJECT_ID,
    title: input.title,
    modelSelection: MODEL_SELECTION,
    runtimeMode: "full-access",
    interactionMode: input.state === "plan" ? "plan" : "default",
    branch: input.branch,
    worktreePath: `/Users/alex/Code/lumen-notes/.worktrees/${input.branch}`,
    latestTurn: {
      turnId,
      state: isWorking ? "running" : "completed",
      requestedAt: minutesBefore(now, input.minutesAgo + 2),
      startedAt: minutesBefore(now, input.minutesAgo + 2),
      completedAt: isWorking ? null : updatedAt,
      assistantMessageId: isWorking ? null : MessageId.make(`${input.id}-answer`),
    },
    createdAt: minutesBefore(now, input.minutesAgo + 120),
    updatedAt,
    archivedAt: null,
    session: {
      threadId,
      status: isWorking ? "running" : "ready",
      providerName: "Codex",
      providerInstanceId: MODEL_SELECTION.instanceId,
      runtimeMode: "full-access",
      activeTurnId: isWorking ? turnId : null,
      lastError: null,
      updatedAt,
    },
    latestUserMessageAt: minutesBefore(now, input.minutesAgo + 1),
    hasPendingApprovals: input.state === "approval",
    hasPendingUserInput: false,
    hasActionableProposedPlan: input.state === "plan",
  };
}

export interface ShowcaseFixture {
  readonly environmentLabel: string;
  readonly project: EnvironmentProject;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly selectedThread: EnvironmentThreadShell;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly feed: ReadonlyArray<ThreadFeedEntry>;
}

export function createShowcaseFixture(now = SHOWCASE_NOW): ShowcaseFixture {
  const project: EnvironmentProject = {
    environmentId: SHOWCASE_ENVIRONMENT_ID,
    id: SHOWCASE_PROJECT_ID,
    title: "Lumen Notes",
    workspaceRoot: "/Users/alex/Code/lumen-notes",
    repositoryIdentity: {
      canonicalKey: "github.com/lumen-labs/lumen-notes",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/lumen-labs/lumen-notes.git",
      },
      provider: "github",
      owner: "lumen-labs",
      name: "lumen-notes",
    },
    defaultModelSelection: MODEL_SELECTION,
    scripts: [
      {
        id: "dev",
        name: "Dev",
        command: "pnpm dev",
        icon: "play",
        runOnWorktreeCreate: false,
      },
      {
        id: "test",
        name: "Tests",
        command: "pnpm test",
        icon: "test",
        runOnWorktreeCreate: false,
      },
    ],
    createdAt: minutesBefore(now, 60 * 24 * 30),
    updatedAt: minutesBefore(now, 2),
  };

  const selectedThread = {
    environmentId: SHOWCASE_ENVIRONMENT_ID,
    ...makeThread(now, {
      id: String(SHOWCASE_THREAD_ID),
      title: "Polish the command palette",
      branch: "feat/command-palette",
      minutesAgo: 2,
    }),
  };
  const threads: ReadonlyArray<EnvironmentThreadShell> = [
    selectedThread,
    {
      environmentId: SHOWCASE_ENVIRONMENT_ID,
      ...makeThread(now, {
        id: "offline-first-sync",
        title: "Make sync feel instant",
        branch: "feat/offline-sync",
        minutesAgo: 14,
        state: "working",
      }),
    },
    {
      environmentId: SHOWCASE_ENVIRONMENT_ID,
      ...makeThread(now, {
        id: "share-sheet",
        title: "Add a beautiful share sheet",
        branch: "feat/share-sheet",
        minutesAgo: 47,
        state: "approval",
      }),
    },
    {
      environmentId: SHOWCASE_ENVIRONMENT_ID,
      ...makeThread(now, {
        id: "editor-motion",
        title: "Smooth editor transitions",
        branch: "perf/editor-motion",
        minutesAgo: 126,
        state: "plan",
      }),
    },
  ];

  const turnId = TurnId.make("palette-turn");
  const feed: ReadonlyArray<ThreadFeedEntry> = [
    {
      type: "message",
      id: "palette-request",
      createdAt: minutesBefore(now, 8),
      message: {
        id: MessageId.make("palette-request"),
        role: "user",
        text: "Make the command palette feel fast, calm, and unmistakably native. Add fuzzy search and keyboard shortcuts.",
        turnId,
        streaming: false,
        createdAt: minutesBefore(now, 8),
        updatedAt: minutesBefore(now, 8),
      },
    },
    {
      type: "activity-group",
      id: "palette-work",
      createdAt: minutesBefore(now, 6),
      turnId,
      activities: [
        {
          id: "inspect-components",
          createdAt: minutesBefore(now, 7),
          turnId,
          summary: "Explored the navigation and command registry",
          detail: "Found shared command metadata and keyboard routing",
          fullDetail: null,
          copyText: "Explored the navigation and command registry",
          icon: "eye",
          toolLike: true,
          status: "success",
        },
        {
          id: "edit-palette",
          createdAt: minutesBefore(now, 6),
          turnId,
          summary: "Built the new palette experience",
          detail: "6 files changed · fuzzy ranking · native shortcuts",
          fullDetail: null,
          copyText: "Built the new palette experience",
          icon: "edit",
          toolLike: true,
          status: "success",
        },
      ],
    },
    {
      type: "message",
      id: "palette-answer",
      createdAt: minutesBefore(now, 2),
      message: {
        id: MessageId.make("palette-answer"),
        role: "assistant",
        text: "The command palette is ready. Search now ranks exact and recent matches first, every action shows its shortcut, and the transition stays smooth even with hundreds of commands.\n\nI also added focused keyboard-navigation tests and verified the full mobile check suite.",
        turnId,
        streaming: false,
        createdAt: minutesBefore(now, 2),
        updatedAt: minutesBefore(now, 2),
      },
    },
  ];

  return {
    environmentLabel: "Alex’s MacBook Pro",
    project,
    projects: [project],
    selectedThread,
    threads,
    feed,
  };
}

export const SHOWCASE_TERMINAL_BUFFER = [
  "\u001b[38;5;75m~/Code/lumen-notes\u001b[0m \u001b[38;5;212mfeat/command-palette\u001b[0m",
  "$ pnpm check",
  "",
  "  ✓ lint             1.3s",
  "  ✓ typecheck        2.1s",
  "  ✓ unit tests      84 passed",
  "  ✓ native checks    0 issues",
  "",
  "\u001b[32mAll checks passed\u001b[0m  ·  ready to ship ✦",
  "",
  "\u001b[38;5;75m~/Code/lumen-notes\u001b[0m \u001b[38;5;212mfeat/command-palette\u001b[0m $ ",
].join("\r\n");

export const SHOWCASE_DIFF = `diff --git a/apps/mobile/src/CommandPalette.tsx b/apps/mobile/src/CommandPalette.tsx
index c45a8f1..9e421ad 100644
--- a/apps/mobile/src/CommandPalette.tsx
+++ b/apps/mobile/src/CommandPalette.tsx
@@ -18,9 +18,16 @@ export function CommandPalette({ commands }: Props) {
-  const visibleCommands = commands.filter((command) =>
-    command.label.toLowerCase().includes(query.toLowerCase()),
-  );
+  const visibleCommands = rankCommands(commands, {
+    query,
+    recentCommandIds,
+    limit: 12,
+  });
 
   return (
-    <Modal visible={open}>
+    <Modal visible={open} animationType="fade">
+      <PaletteHeader
+        title="Jump anywhere"
+        shortcut="⌘ K"
+        resultCount={visibleCommands.length}
+      />
       <CommandList commands={visibleCommands} />
     </Modal>
diff --git a/apps/mobile/src/rankCommands.ts b/apps/mobile/src/rankCommands.ts
new file mode 100644
index 0000000..71a6d09
--- /dev/null
+++ b/apps/mobile/src/rankCommands.ts
@@ -0,0 +1,11 @@
+export function rankCommands(commands: Command[], input: RankInput) {
+  const query = input.query.trim().toLocaleLowerCase();
+  return commands
+    .map((command) => ({
+      command,
+      score: fuzzyScore(command.label, query),
+    }))
+    .filter((match) => match.score > 0)
+    .sort((left, right) => right.score - left.score)
+    .slice(0, input.limit)
+    .map((match) => match.command);
+}
`;
