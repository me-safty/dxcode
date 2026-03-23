import { ServiceMap, Effect } from "effect";
import type { CalendarEvent } from "@t3tools/contracts";
import type { CalendarError } from "../Errors.ts";

export interface CalendarServiceShape {
  readonly agenda: (input: { date?: string }) => Effect.Effect<ReadonlyArray<CalendarEvent>, CalendarError>;
  readonly meetingPrep: (input: { title: string; start: string }) => Effect.Effect<{ notes: string }, CalendarError>;
}

export class CalendarService extends ServiceMap.Service<CalendarService, CalendarServiceShape>()(
  "t3/calendar/Services/CalendarService",
) {}
