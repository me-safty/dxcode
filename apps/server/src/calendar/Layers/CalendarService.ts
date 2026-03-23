import { Effect, Layer } from "effect";
import { execSync } from "node:child_process";
import { CalendarService } from "../Services/CalendarService.ts";
import { CalendarError } from "../Errors.ts";
import type { CalendarEvent } from "@t3tools/contracts";

function runGcalcli(args: string): Effect.Effect<string, CalendarError> {
  return Effect.try({
    try: () => execSync(`gcalcli ${args}`, { encoding: "utf-8", timeout: 30000 }),
    catch: (e) => new CalendarError({ message: `gcalcli failed: ${e}` }),
  });
}

function parseTsvAgenda(tsv: string): CalendarEvent[] {
  const lines = tsv.trim().split("\n").filter(Boolean);
  const events: CalendarEvent[] = [];

  for (const line of lines) {
    const parts = line.split("\t");
    if (parts.length < 4) continue;

    const [startDate, startTime, endDate, endTime, ...titleParts] = parts;
    const title = titleParts.join("\t").trim();
    if (!title) continue;

    const isAllDay = !startTime || startTime.trim() === "";
    const start = isAllDay ? (startDate ?? "").trim() : `${(startDate ?? "").trim()}T${(startTime ?? "").trim()}`;
    const end = isAllDay ? (endDate ?? "").trim() : `${(endDate ?? "").trim()}T${(endTime ?? "").trim()}`;

    events.push({
      title: title as CalendarEvent["title"],
      start,
      end,
      isAllDay,
    } as CalendarEvent);
  }

  return events;
}

export const CalendarServiceLive = Layer.succeed(
  CalendarService,
  CalendarService.of({
    agenda: ({ date }) =>
      Effect.gen(function* () {
        const dateArg = date ?? "today";
        const output = yield* runGcalcli(`agenda ${dateArg} --tsv`);
        return parseTsvAgenda(output);
      }),

    meetingPrep: ({ title, start }) =>
      Effect.gen(function* () {
        // Generate meeting prep notes based on title and time
        const notes = `## Meeting Prep: ${title}\n**Time:** ${start}\n\n### Talking Points\n- \n\n### Questions\n- \n\n### Action Items\n- `;
        return { notes };
      }),
  }),
);
