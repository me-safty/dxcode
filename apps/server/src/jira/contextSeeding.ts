import { Data, Effect } from "effect";
import * as fs from "node:fs";
import * as path from "node:path";
import { JiraService } from "./Services/JiraService.ts";

export class ContextSeedingError extends Data.TaggedError("ContextSeedingError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Generate a CLAUDE.md context file for a project workspace from Jira ticket data.
 * This seeds the AI agent with relevant project context.
 */
export const generateContextFile = ({
  workspaceRoot,
  ticketKey,
  specContent,
}: {
  workspaceRoot: string;
  ticketKey: string;
  specContent?: string;
}) =>
  Effect.gen(function* () {
    const jiraService = yield* JiraService;

    // Fetch ticket data
    const ticket = yield* jiraService.getTicket({ ticketKey }).pipe(
      Effect.catch(() => Effect.succeed(null)),
    );

    const sections: string[] = [];

    // Header
    sections.push(`# Project Context — ${ticketKey}`);
    sections.push("");

    if (ticket) {
      // Ticket info
      sections.push(`## Jira Ticket: ${ticket.key}`);
      sections.push("");
      sections.push(`- **Summary:** ${ticket.summary}`);
      sections.push(`- **Status:** ${ticket.status}`);
      sections.push(`- **Priority:** ${ticket.priority}`);
      sections.push(`- **Type:** ${ticket.issueType}`);
      if (ticket.assignee) sections.push(`- **Assignee:** ${ticket.assignee}`);
      if (ticket.reporter) sections.push(`- **Reporter:** ${ticket.reporter}`);
      if (ticket.components.length > 0) {
        sections.push(`- **Components:** ${ticket.components.join(", ")}`);
      }
      if (ticket.labels.length > 0) {
        sections.push(`- **Labels:** ${ticket.labels.join(", ")}`);
      }
      if (ticket.parentKey) {
        sections.push(`- **Parent:** ${ticket.parentKey}`);
      }
      sections.push(`- **URL:** ${ticket.url}`);
      sections.push("");

      // Description
      if (ticket.description) {
        sections.push("## Description");
        sections.push("");
        sections.push(ticket.description);
        sections.push("");
      }
    }

    // Spec/planning notes
    if (specContent && specContent.trim().length > 0) {
      sections.push("## Planning Notes");
      sections.push("");
      sections.push(specContent);
      sections.push("");
    }

    // Instructions
    sections.push("## Instructions");
    sections.push("");
    sections.push("- This file was auto-generated from Jira ticket data and planning notes.");
    sections.push("- Focus on implementing the requirements described above.");
    sections.push("- Reference the Jira ticket for additional context and acceptance criteria.");
    sections.push("- Update the ticket status when work is complete.");
    sections.push("");

    const content = sections.join("\n");

    // Write to workspace
    yield* Effect.try({
      try: () => {
        const claudeMdPath = path.join(workspaceRoot, "CLAUDE.md");
        // Don't overwrite if it already exists and has custom content
        if (fs.existsSync(claudeMdPath)) {
          const existing = fs.readFileSync(claudeMdPath, "utf-8");
          if (!existing.includes("# Project Context —")) {
            // File exists with custom content, append instead
            fs.appendFileSync(claudeMdPath, "\n\n" + content);
            return;
          }
        }
        fs.writeFileSync(claudeMdPath, content, "utf-8");
      },
      catch: (cause) => new ContextSeedingError({ message: `Failed to write CLAUDE.md`, cause }),
    });

    return { path: path.join(workspaceRoot, "CLAUDE.md"), ticketKey };
  });
