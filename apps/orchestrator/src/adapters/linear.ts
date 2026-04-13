import { LinearClient } from "@linear/sdk";

import { normalizeLinearWebhookInput } from "../linear/ingress.ts";
import { hasValidLinearSignature } from "../linear/webhookVerification.ts";
import type {
  AgentActivity,
  InboundEvent,
  IssueStatus,
  OutboundMessage,
  PlatformAdapter,
  PlatformMessageRef,
  PlatformThreadRef,
} from "./types.ts";

const LINEAR_OAUTH_TOKEN_URL = "https://api.linear.app/oauth/token";
const DEFAULT_CLIENT_CREDENTIALS_SCOPE = "read,write,comments:create,app:mentionable";

const STATUS_NAME_MAP: Record<IssueStatus, string> = {
  backlog: "Backlog",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  cancelled: "Cancelled",
};

function readRequiredEnvVar(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

// -------------------------------------------------------------------
// Client-credentials token management
// -------------------------------------------------------------------

let cachedAccessToken: {
  readonly accessToken: string;
  readonly expiresAt: number;
} | null = null;

async function fetchClientCredentialsToken(): Promise<string> {
  const directToken = process.env.LINEAR_ACCESS_TOKEN?.trim();
  if (directToken) return directToken;

  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.accessToken;
  }

  const clientId = readRequiredEnvVar("LINEAR_CLIENT_ID");
  const clientSecret = readRequiredEnvVar("LINEAR_CLIENT_SECRET");
  const scope =
    process.env.LINEAR_CLIENT_CREDENTIALS_SCOPE?.trim() ?? DEFAULT_CLIENT_CREDENTIALS_SCOPE;

  const response = await fetch(LINEAR_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Linear client credentials token request failed (${response.status}): ${await response.text()}`,
    );
  }

  const json = (await response.json()) as {
    readonly access_token: string;
    readonly expires_in: number;
  };

  cachedAccessToken = {
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(0, json.expires_in - 300) * 1000,
  };

  return cachedAccessToken.accessToken;
}

// -------------------------------------------------------------------
// Linear-specific extensions beyond the PlatformAdapter interface
// -------------------------------------------------------------------

export interface LinearPlatformAdapter extends PlatformAdapter {
  readonly platform: "linear";

  postActivity(threadRef: PlatformThreadRef, activity: AgentActivity): Promise<void>;

  updateIssueStatus(
    threadRef: PlatformThreadRef,
    status: IssueStatus,
    assigneeId?: string,
  ): Promise<void>;

  createAgentSession(issueId: string): Promise<string | null>;

  updateAgentSession(
    sessionId: string,
    updates: {
      plan?: Array<{ title: string; completed: boolean }>;
      externalUrls?: Array<{ url: string; label: string }>;
    },
  ): Promise<void>;
}

function assertLinearRef(
  ref: PlatformThreadRef,
): asserts ref is Extract<PlatformThreadRef, { platform: "linear" }> {
  if (ref.platform !== "linear") {
    throw new Error(`Expected linear thread ref, got ${ref.platform}`);
  }
}

// -------------------------------------------------------------------
// Factory
// -------------------------------------------------------------------

export function createLinearPlatformAdapter(): LinearPlatformAdapter {
  let clientPromise: Promise<LinearClient> | null = null;

  function getClient(): Promise<LinearClient> {
    if (!clientPromise) {
      clientPromise = fetchClientCredentialsToken().then(
        (accessToken) => new LinearClient({ accessToken }),
      );
    }
    return clientPromise;
  }

  return {
    platform: "linear" as const,

    // -----------------------------------------------------------------
    // Webhook verification
    // -----------------------------------------------------------------

    async verifyWebhook(request: Request): Promise<boolean> {
      const secret = process.env.LINEAR_WEBHOOK_SECRET?.trim();
      if (!secret) {
        throw new Error("Missing LINEAR_WEBHOOK_SECRET environment variable");
      }
      const body = await request.clone().text();
      return hasValidLinearSignature({ body, request, secret });
    },

    // -----------------------------------------------------------------
    // Inbound normalization
    // -----------------------------------------------------------------

    normalizeInbound(rawEvent: unknown): InboundEvent | null {
      const botUserName = process.env.LINEAR_BOT_USERNAME?.trim();
      const envelope = botUserName
        ? normalizeLinearWebhookInput(rawEvent, { botUserName })
        : normalizeLinearWebhookInput(rawEvent);

      if (!envelope) return null;

      const isFollowUp =
        envelope.commentId !== undefined && envelope.commentId !== envelope.messageId;
      return {
        platform: "linear",
        threadKey: envelope.linearThreadKey,
        eventKey: envelope.eventId,
        type: isFollowUp ? "follow_up" : "new_task",
        author: {
          id: envelope.authorName ?? "unknown",
          name: envelope.authorName ?? "Unknown",
          isBot: false,
        },
        content: envelope.body,
        platformRef: {
          platform: "linear",
          issueId: envelope.issueId,
          ...(envelope.issueIdentifier ? { issueIdentifier: envelope.issueIdentifier } : {}),
          ...(envelope.commentId ? { commentId: envelope.commentId } : {}),
        },
        metadata: {
          shouldStartRun: envelope.shouldStartRun,
          messageId: envelope.messageId,
          commentUrl: envelope.commentUrl,
          receivedAt: envelope.receivedAt,
        },
      };
    },

    // -----------------------------------------------------------------
    // Post message (Linear comment)
    // -----------------------------------------------------------------

    async postMessage(
      threadRef: PlatformThreadRef,
      content: OutboundMessage,
    ): Promise<PlatformMessageRef> {
      assertLinearRef(threadRef);
      const client = await getClient();
      const result = await client.createComment({
        issueId: threadRef.issueId,
        body: content.markdown,
        ...(threadRef.commentId ? { parentId: threadRef.commentId } : {}),
      });

      if (!result.success) {
        throw new Error("Linear createComment did not succeed");
      }

      const comment = await result.comment;
      if (!comment?.id) {
        throw new Error("Linear createComment did not return a comment id");
      }

      return { platform: "linear", messageId: comment.id };
    },

    // -----------------------------------------------------------------
    // Post agent activity
    // -----------------------------------------------------------------

    async postActivity(threadRef: PlatformThreadRef, activity: AgentActivity): Promise<void> {
      assertLinearRef(threadRef);
      if (!threadRef.agentSessionId) return;

      const client = await getClient();
      try {
        const content: Record<string, unknown> = { type: activity.type };
        if (activity.body) content.body = activity.body;
        if (activity.action) content.action = activity.action;
        if (activity.parameter) content.parameter = activity.parameter;
        if (activity.result) content.result = activity.result;

        await client.createAgentActivity({
          agentSessionId: threadRef.agentSessionId,
          content,
          ...(activity.ephemeral !== undefined ? { ephemeral: activity.ephemeral } : {}),
        });
      } catch (error) {
        console.warn(
          `Failed to post agent activity (session=${threadRef.agentSessionId}):`,
          error instanceof Error ? error.message : error,
        );
      }
    },

    // -----------------------------------------------------------------
    // Update issue status
    // -----------------------------------------------------------------

    async updateIssueStatus(
      threadRef: PlatformThreadRef,
      status: IssueStatus,
      assigneeId?: string,
    ): Promise<void> {
      assertLinearRef(threadRef);
      const client = await getClient();
      const issue = await client.issue(threadRef.issueId);
      const team = await issue.team;
      if (!team) {
        throw new Error(`Could not resolve team for issue ${threadRef.issueId}`);
      }

      const states = await team.states();
      const targetName = STATUS_NAME_MAP[status];
      const match = states.nodes.find((s) =>
        s.name.toLowerCase().includes(targetName.toLowerCase()),
      );
      if (!match) {
        throw new Error(
          `No workflow state matching "${targetName}" found for team ${team.name ?? team.id}`,
        );
      }

      await issue.update({
        stateId: match.id,
        ...(assigneeId ? { assigneeId } : {}),
      });
    },

    // -----------------------------------------------------------------
    // Agent session lifecycle (Linear-specific, not on generic interface)
    // -----------------------------------------------------------------

    async createAgentSession(issueId: string): Promise<string | null> {
      try {
        const client = await getClient();
        const result = await client.agentSessionCreateOnIssue({ issueId });
        const sessionId = result.agentSessionId;
        if (!sessionId) {
          console.warn("agentSessionCreateOnIssue did not return a session ID");
          return null;
        }
        return sessionId;
      } catch (error) {
        console.warn(
          "Failed to create Linear agent session:",
          error instanceof Error ? error.message : error,
        );
        return null;
      }
    },

    async updateAgentSession(
      sessionId: string,
      updates: {
        plan?: Array<{ title: string; completed: boolean }>;
        externalUrls?: Array<{ url: string; label: string }>;
      },
    ): Promise<void> {
      const client = await getClient();
      await client.updateAgentSession(sessionId, updates);
    },
  };
}
