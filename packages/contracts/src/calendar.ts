import { Schema } from "effect";
import { TrimmedNonEmptyString } from "./baseSchemas";

export const CalendarEvent = Schema.Struct({
  title: TrimmedNonEmptyString,
  start: Schema.String,
  end: Schema.String,
  location: Schema.optional(Schema.String),
  organizer: Schema.optional(TrimmedNonEmptyString),
  attendees: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  description: Schema.optional(Schema.String),
  isAllDay: Schema.Boolean,
});
export type CalendarEvent = typeof CalendarEvent.Type;

export const CalendarAgendaInput = Schema.Struct({
  date: Schema.optional(TrimmedNonEmptyString),
});
export type CalendarAgendaInput = typeof CalendarAgendaInput.Type;

export const CalendarMeetingPrepInput = Schema.Struct({
  title: TrimmedNonEmptyString,
  start: Schema.String,
});
export type CalendarMeetingPrepInput = typeof CalendarMeetingPrepInput.Type;

export const CALENDAR_WS_METHODS = {
  calendarAgenda: "calendar.agenda",
  calendarMeetingPrep: "calendar.meetingPrep",
} as const;
