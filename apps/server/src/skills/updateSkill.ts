import { Effect } from "effect";
import { JiraService } from "../jira/Services/JiraService.ts";
import { GmailService } from "../gmail/Services/GmailService.ts";
import { CalendarService } from "../calendar/Services/CalendarService.ts";

export interface UpdateReport {
  date: string;
  yesterday: string[];
  today: string[];
  blockers: string[];
  stats: {
    jiraTickets: number;
    inProgress: number;
    waiting: number;
    unreadEmails: number;
    meetingsToday: number;
  };
  markdown: string;
}

/**
 * Generate a daily status update by aggregating data from all services.
 */
export const generateDailyUpdate = Effect.gen(function* () {
  const jiraService = yield* JiraService;
  const gmailService = yield* GmailService;
  const calendarService = yield* CalendarService;

  const today = new Date().toISOString().split("T")[0]!;

  // Fetch data from all services in parallel
  const [tickets, emails, meetings] = yield* Effect.all(
    [
      jiraService.listTickets({}).pipe(Effect.catch(() => Effect.succeed([] as const))),
      gmailService.search({ query: "is:unread newer_than:1d" }).pipe(Effect.catch(() => Effect.succeed([] as const))),
      calendarService.agenda({}).pipe(Effect.catch(() => Effect.succeed([] as const))),
    ] as const,
    { concurrency: 3 },
  );

  // Categorize tickets
  const inProgress = tickets.filter((t) => t.status === "In Progress");
  const waiting = tickets.filter(
    (t) => t.status === "Waiting" || t.status === "In Review" || t.status === "Blocked",
  );
  const done = tickets.filter((t) => t.status === "Done" || t.status === "Closed");

  // Build yesterday section (from recently updated tickets)
  const yesterday: string[] = [];
  for (const ticket of inProgress.slice(0, 3)) {
    yesterday.push(`Worked on ${ticket.key}: ${ticket.summary}`);
  }
  if (done.length > 0) {
    for (const ticket of done.slice(0, 2)) {
      yesterday.push(`Completed ${ticket.key}: ${ticket.summary}`);
    }
  }
  if (yesterday.length === 0) {
    yesterday.push("Continued work on active tickets");
  }

  // Build today section
  const todayItems: string[] = [];
  for (const ticket of inProgress.slice(0, 3)) {
    todayItems.push(`Continue ${ticket.key}: ${ticket.summary} (${ticket.priority})`);
  }
  if (meetings.length > 0) {
    const realMeetings = meetings.filter((m) => !m.isAllDay);
    if (realMeetings.length > 0) {
      todayItems.push(`${realMeetings.length} meeting(s) scheduled`);
    }
  }
  if (todayItems.length === 0) {
    todayItems.push("Review and prioritize backlog");
  }

  // Build blockers section
  const blockers: string[] = [];
  for (const ticket of waiting) {
    blockers.push(`${ticket.key}: ${ticket.summary} — ${ticket.status}`);
  }
  if (blockers.length === 0) {
    blockers.push("None");
  }

  // Generate markdown
  const markdown = [
    `# Daily Status Update — ${today}`,
    "",
    "## Yesterday",
    ...yesterday.map((item) => `- ${item}`),
    "",
    "## Today",
    ...todayItems.map((item) => `- ${item}`),
    "",
    "## Blockers",
    ...blockers.map((item) => `- ${item}`),
    "",
    "---",
    `📋 ${tickets.length} Jira tickets (${inProgress.length} in progress, ${waiting.length} waiting)`,
    `📧 ${emails.length} unread emails`,
    `📅 ${meetings.length} events today`,
  ].join("\n");

  const report: UpdateReport = {
    date: today,
    yesterday,
    today: todayItems,
    blockers,
    stats: {
      jiraTickets: tickets.length,
      inProgress: inProgress.length,
      waiting: waiting.length,
      unreadEmails: emails.length,
      meetingsToday: meetings.length,
    },
    markdown,
  };

  return report;
});
