import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { LocalOrchestratorStore } from "./store.ts";
import type { TaskIntakeMessage } from "../taskIntake/contracts.ts";

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "t3-orchestrator-local-"));
  const store = new LocalOrchestratorStore(join(dir, "orchestrator.sqlite"));
  return {
    store,
    cleanup() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function slackMessage(overrides: Partial<TaskIntakeMessage> = {}): TaskIntakeMessage {
  return {
    eventId: "slack:event-1",
    source: "slack",
    conversation: {
      source: "slack",
      externalLinkKind: "slack_thread",
      externalId: "T1:C1:1700000000.000000",
      teamId: "T1",
      channelId: "C1",
    },
    messageId: "1700000000.000000",
    text: "please update t3code",
    receivedAt: "2026-05-25T00:00:00.000Z",
    actor: {
      externalId: "U1",
      displayName: "Vivek",
    },
    ...overrides,
  };
}

describe("LocalOrchestratorStore", () => {
  it("creates an intake task and dedupes repeated events", () => {
    const { store, cleanup } = makeStore();
    try {
      store.upsertProject({
        repoName: "t3code",
        workspaceRoot: "C:\\Users\\Vivek\\Affil\\t3code",
        defaultBranch: "main",
        githubOwner: "pingdotgg",
        githubRepo: "t3code",
      });

      const first = store.resolveTaskIntakeMessage({
        message: slackMessage(),
        externalLink: { kind: "slack_thread", externalId: "T1:C1:1700000000.000000" },
        title: "Update t3code",
      });
      expect(first.status).toBe("created");
      expect("taskId" in first ? first.taskId : undefined).toMatch(/^task_/);

      const second = store.resolveTaskIntakeMessage({
        message: slackMessage(),
        externalLink: { kind: "slack_thread", externalId: "T1:C1:1700000000.000000" },
        title: "Update t3code",
      });
      expect(second.status).toBe("duplicate");
    } finally {
      cleanup();
    }
  });

  it("routes a new Slack message in an existing thread to the existing task", () => {
    const { store, cleanup } = makeStore();
    try {
      store.upsertProject({
        repoName: "t3code",
        workspaceRoot: "C:\\Users\\Vivek\\Affil\\t3code",
        defaultBranch: "main",
        githubOwner: "pingdotgg",
        githubRepo: "t3code",
      });
      const created = store.resolveTaskIntakeMessage({
        message: slackMessage(),
        externalLink: { kind: "slack_thread", externalId: "T1:C1:1700000000.000000" },
        title: "Update t3code",
      });
      const followUp = store.resolveTaskIntakeMessage({
        message: slackMessage({ eventId: "slack:event-2", messageId: "1700000001.000000" }),
        externalLink: { kind: "slack_thread", externalId: "T1:C1:1700000000.000000" },
        title: "Follow up",
      });

      expect(followUp.status).toBe("routed_existing");
      expect("taskId" in followUp && "taskId" in created ? followUp.taskId : undefined).toBe(
        "taskId" in created ? created.taskId : undefined,
      );
    } finally {
      cleanup();
    }
  });
});
