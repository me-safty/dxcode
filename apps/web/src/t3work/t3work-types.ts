export type ProjectThread = {
  id: string;
  projectId: string;
  ticketId?: string;
  title: string;
  messageCount: number;
  lastMessageAt: string;
  createdAt: string;
  kickoffMessage?: string;
  kickoffPending?: boolean;
  kickoffModelSelection?: import("@t3tools/contracts").ModelSelection;
  kickoffRuntimeMode?: import("@t3tools/contracts").RuntimeMode;
  kickoffInteractionMode?: import("@t3tools/contracts").ProviderInteractionMode;
  status: "idle" | "running" | "completed" | "error";
};

export type ThreadMessage = {
  id: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
};

export type ProjectTicket = {
  id: string;
  projectId: string;
  parentId?: string;
  ref: {
    provider: string;
    kind: string;
    id: string;
    displayId: string;
    title: string;
    type?: string;
    issueTypeIconUrl?: string;
    url: string;
    projectId: string;
  };
  issueType?: string;
  issueTypeIconUrl?: string;
  status: string;
  priority?: string;
  assignee?: string;
  updatedAt: string;
};

export type ViewState =
  | { type: "dashboard"; projectId: string }
  | { type: "ticket"; projectId: string; ticketId: string }
  | {
      type: "thread";
      projectId: string;
      threadId: string;
    };

export type ProjectSortOrder = "updated_at" | "created_at";
export type ThreadSortOrder = "updated_at" | "created_at";

export type ThreadStatusPill = {
  label: "Working" | "Completed" | "Error" | "Idle";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
};
