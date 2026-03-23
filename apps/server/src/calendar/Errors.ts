import { Data } from "effect";

export class CalendarError extends Data.TaggedError("CalendarError")<{
  readonly message: string;
}> {}
