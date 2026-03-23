import { Effect } from "effect";
import { JiraService } from "../jira/Services/JiraService.ts";
import { GmailService } from "../gmail/Services/GmailService.ts";
import { CalendarService } from "../calendar/Services/CalendarService.ts";

export interface TriageItem {
  priority: "urgent" | "respond" | "prepare" | "progress" | "housekeeping";
  source: "jira" | "email" | "calendar" | "github";
  summary: string;
  action?: string;
  link?: string;
}

export interface TriageReport {
  timestamp: string;
  items: TriageItem[];
  stats: {
    unreadEmails: number;
    actionEmails: number;
    noiseEmails: number;
    jiraTickets: number;
    jiraChanged: number;
    meetingsToday: number;
    meetingsTomorrow: number;
  };
  markdown: string;
}

/**
 * Scan all communication channels and generate a prioritized action list.
 */
export const generateTriageReport = Effect.gen(function* () {
  const jiraService = yield* JiraService;
  const gmailService = yield* GmailService;
  const calendarService = yield* CalendarService;

  const now = new Date();
  const timestamp = now.toISOString();
  const items: TriageItem[] = [];

  // Fetch all data in parallel
  const [tickets, unreadEmails, todayMeetings, tomorrowMeetings] = yield* Effect.all(
    [
      jiraService.listTickets({}).pipe(Effect.catch(() => Effect.succeed([] as const))),
      gmailService.search({ query: "is:unread", maxResults: 50 }).pipe(Effect.catch(() => Effect.succeed([] as const))),
      calendarService.agenda({}).pipe(Effect.catch(() => Effect.succeed([] as const))),
      calendarService.agenda({ date: "tomorrow" }).pipe(Effect.catch(() => Effect.succeed([] as const))),
    ] as const,
    { concurrency: 4 },
  );

  // --- Email Triage ---
  let actionEmails = 0;
  let noiseEmails = 0;

  for (const email of unreadEmails) {
    const category = email.category ?? "FYI";

    if (category === "NOISE") {
      noiseEmails++;
      continue;
    }

    if (category === "ACTION") {
      actionEmails++;
      items.push({
        priority: "respond",
        source: "email",
        summary: `[EMAIL] From: ${email.from} — ${email.subject}`,
        action: "Reply needed",
      });
    } else if (category === "REVIEW") {
      items.push({
        priority: "respond",
        source: "email",
        summary: `[REVIEW] ${email.subject}`,
        action: "Review requested",
      });
    }
  }

  // --- Meeting Prep ---
  const realMeetings = todayMeetings.filter((m) => !m.isAllDay);
  const upcomingMeetings = realMeetings.filter((m) => {
    try {
      return new Date(m.start) > now;
    } catch {
      return false;
    }
  });

  for (const meeting of upcomingMeetings.slice(0, 3)) {
    const startTime = new Date(meeting.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    items.push({
      priority: "prepare",
      source: "calendar",
      summary: `[${startTime}] ${meeting.title}`,
      action: "Prepare talking points",
    });
  }

  // --- Jira Activity ---
  const inProgress = tickets.filter((t) => t.status === "In Progress");
  const staleTickets = tickets.filter((t) => {
    try {
      const updated = new Date(t.updated);
      const daysSinceUpdate = (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceUpdate > 14;
    } catch {
      return false;
    }
  });
  const agingReview = tickets.filter((t) => {
    try {
      if (t.status !== "In Review") return false;
      const updated = new Date(t.updated);
      const daysSinceUpdate = (now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24);
      return daysSinceUpdate > 5;
    } catch {
      return false;
    }
  });

  for (const ticket of inProgress.slice(0, 5)) {
    items.push({
      priority: "progress",
      source: "jira",
      summary: `${ticket.key}: ${ticket.summary}`,
      action: `Status: ${ticket.status} | Priority: ${ticket.priority}`,
      link: ticket.url,
    });
  }

  for (const ticket of agingReview) {
    items.push({
      priority: "urgent",
      source: "jira",
      summary: `${ticket.key} has been In Review for too long`,
      action: "Follow up on review",
      link: ticket.url,
    });
  }

  for (const ticket of staleTickets.slice(0, 3)) {
    items.push({
      priority: "housekeeping",
      source: "jira",
      summary: `${ticket.key}: No update in 14+ days — close or update?`,
      link: ticket.url,
    });
  }

  // Housekeeping: noise emails
  if (noiseEmails > 0) {
    items.push({
      priority: "housekeeping",
      source: "email",
      summary: `Archive ${noiseEmails} noise email(s)`,
      action: "Auto-mark as read",
    });
  }

  // Sort by priority
  const priorityOrder = { urgent: 0, respond: 1, prepare: 2, progress: 3, housekeeping: 4 };
  items.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  // Generate markdown
  const sections: string[] = [
    `# Triage Report — ${now.toISOString().split("T")[0]} ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
    "",
  ];

  const urgent = items.filter((i) => i.priority === "urgent");
  const respond = items.filter((i) => i.priority === "respond");
  const prepare = items.filter((i) => i.priority === "prepare");
  const progress = items.filter((i) => i.priority === "progress");
  const housekeeping = items.filter((i) => i.priority === "housekeeping");

  if (urgent.length > 0) {
    sections.push("## Do Right Now");
    for (const item of urgent) {
      sections.push(`- ${item.summary}${item.action ? ` — ${item.action}` : ""}`);
    }
    sections.push("");
  }

  if (respond.length > 0) {
    sections.push("## Respond To");
    for (const item of respond) {
      sections.push(`- ${item.summary}${item.action ? ` — ${item.action}` : ""}`);
    }
    sections.push("");
  }

  if (prepare.length > 0) {
    sections.push("## Meeting Prep");
    for (const item of prepare) {
      sections.push(`- ${item.summary}${item.action ? ` — ${item.action}` : ""}`);
    }
    sections.push("");
  }

  if (progress.length > 0) {
    sections.push("## Keep Working On");
    for (const item of progress) {
      sections.push(`- ${item.summary}${item.action ? ` — ${item.action}` : ""}`);
    }
    sections.push("");
  }

  if (housekeeping.length > 0) {
    sections.push("## Housekeeping");
    for (const item of housekeeping) {
      sections.push(`- ${item.summary}${item.action ? ` — ${item.action}` : ""}`);
    }
    sections.push("");
  }

  sections.push("## Inbox Summary");
  sections.push(`- ${unreadEmails.length} unread emails (${actionEmails} action, ${noiseEmails} noise)`);
  sections.push(`- ${tickets.length} Jira tickets`);
  sections.push(`- ${realMeetings.length} meetings today, ${tomorrowMeetings.length} tomorrow`);

  const markdown = sections.join("\n");

  const report: TriageReport = {
    timestamp,
    items,
    stats: {
      unreadEmails: unreadEmails.length,
      actionEmails,
      noiseEmails,
      jiraTickets: tickets.length,
      jiraChanged: 0,
      meetingsToday: realMeetings.length,
      meetingsTomorrow: tomorrowMeetings.length,
    },
    markdown,
  };

  return report;
});
