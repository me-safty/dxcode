/**
 * Platform adapter types for the orchestrator.
 *
 * Adapters are stateless translators between platform events and
 * orchestration domain events. All durable state lives in Convex tables.
 */

export type PlatformName = "linear" | "slack";

export type PlatformThreadRef =
  | {
      readonly platform: "linear";
      readonly issueId: string;
      readonly issueIdentifier?: string;
      readonly commentId?: string;
      readonly agentSessionId?: string;
    }
  | {
      readonly platform: "slack";
      readonly channelId: string;
      readonly threadTs: string;
      readonly teamId?: string;
    };

export type InboundEventType = "new_task" | "follow_up" | "interrupt" | "status_change";

export interface InboundEvent {
  readonly platform: PlatformName;
  readonly threadKey: string;
  readonly eventKey: string;
  readonly type: InboundEventType;
  readonly author: {
    readonly id: string;
    readonly name: string;
    readonly isBot: boolean;
  };
  readonly content: string;
  readonly attachments?: readonly Attachment[];
  readonly platformRef: PlatformThreadRef;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface Attachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly url?: string;
  readonly sizeBytes?: number;
}

export interface OutboundMessage {
  readonly markdown: string;
  readonly attachments?: readonly Attachment[];
}

export type AgentActivityType = "thought" | "action" | "response" | "error";

export interface AgentActivity {
  readonly type: AgentActivityType;
  readonly body?: string;
  readonly action?: string;
  readonly parameter?: string;
  readonly result?: string;
  readonly ephemeral?: boolean;
}

export type IssueStatus = "backlog" | "in_progress" | "in_review" | "done" | "cancelled";

export interface PlatformMessageRef {
  readonly platform: PlatformName;
  readonly messageId: string;
}

export interface ThreadContext {
  readonly messages: readonly {
    readonly author: string;
    readonly content: string;
    readonly timestamp: string;
  }[];
  readonly formatted: string;
}

export interface PlatformAdapter {
  readonly platform: PlatformName;

  verifyWebhook(request: Request): Promise<boolean>;
  normalizeInbound(rawEvent: unknown): InboundEvent | null;

  postMessage(threadRef: PlatformThreadRef, content: OutboundMessage): Promise<PlatformMessageRef>;

  updateMessage?(ref: PlatformMessageRef, content: OutboundMessage): Promise<void>;

  postActivity?(threadRef: PlatformThreadRef, activity: AgentActivity): Promise<void>;

  updateIssueStatus?(
    threadRef: PlatformThreadRef,
    status: IssueStatus,
    assigneeId?: string,
  ): Promise<void>;

  fetchThreadContext?(threadRef: PlatformThreadRef): Promise<ThreadContext>;
}
