import type { TaskIntakeMessage } from "./contracts.ts";

const TASK_INTAKE_AGENT_PROMPT = [
  "System context and operating rules:",
  "You are the coding agent behind an internal task intake agent that lets team members request product and code work from Slack and other intake sources. The requester will only see selected relayed responses, so keep responses clear, concrete, and include important URLs when they become available.",
  "",
  "Operational rules:",
  "- Before making code changes or running project commands in a task worktree, run the worktree setup script from the worktree root when it exists. Prefer `bash scripts/worktree-setup.sh`; if that file is not present, use `bash .t3code/worktree-setup.sh`. If setup fails, stop and report the failure.",
  "- If you make code changes, commit them and push the branch before finishing.",
  "- As soon as there are code changes, create or update a GitHub pull request targeting `dev`.",
  "- When you first create the pull request, include the PR URL and the relevant Vercel preview deployment URL in that response.",
  "- If you cannot commit, push, create the PR, or find the preview URL, say exactly why in the response where that failure occurs.",
].join("\n");

function sourceLabel(source: TaskIntakeMessage["source"]) {
  switch (source) {
    case "linear":
      return "Linear";
    case "slack":
      return "Slack";
    case "support_email":
      return "support email";
    case "webhook":
      return "webhook";
  }
}

export function buildTaskIntakeTitle(message: TaskIntakeMessage): string {
  const trimmedText = message.text.trim().replace(/\s+/g, " ");
  if (trimmedText.length > 0) {
    return trimmedText.length > 80 ? `${trimmedText.slice(0, 77)}...` : trimmedText;
  }

  return `${sourceLabel(message.source)} task request`;
}

function buildTaskIntakeRelayPrompt(message: TaskIntakeMessage): string {
  const text = message.text.trim();
  const nativeImageCount =
    message.attachments?.filter((attachment) => "dataUrl" in attachment).length ?? 0;
  const attachmentLines =
    message.attachments
      ?.filter((attachment) => !("dataUrl" in attachment) && attachment.url !== undefined)
      .map((attachment, index) => {
        const label = attachment.name?.trim() || `Attachment ${index + 1}`;
        return `${label}: ${attachment.url}`;
      })
      .filter((line) => line.length > 0) ?? [];

  if (attachmentLines.length === 0) {
    if (text.length > 0) return text;
    return nativeImageCount > 0 ? "(image attachment)" : "(empty message body)";
  }

  return [text.length > 0 ? text : "(empty message body)", "", ...attachmentLines].join("\n");
}

export function buildTaskIntakeInitialPrompt(
  message: TaskIntakeMessage,
  options: {
    readonly agentPrompt?: string;
    readonly context?: string;
    readonly triagePrompt?: string;
  } = {},
): string {
  const relayPrompt = buildTaskIntakeRelayPrompt(message);
  const triagePrompt = options.triagePrompt?.trim();
  const sourceContext = (options.agentPrompt ?? options.context)?.trim();
  const agentPrompt = [TASK_INTAKE_AGENT_PROMPT, sourceContext]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join("\n\n");
  const promptSections = [
    ...(triagePrompt ? [["<triage_prompt>", triagePrompt, "</triage_prompt>"].join("\n")] : []),
    ["<agent_prompt>", agentPrompt, "</agent_prompt>"].join("\n"),
  ];
  return [...promptSections, "", "User request:", relayPrompt].join("\n");
}

export function buildTaskIntakeFollowUpPrompt(message: TaskIntakeMessage): string {
  return buildTaskIntakeRelayPrompt(message);
}
