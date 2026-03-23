import { Data } from "effect";

export class GmailError extends Data.TaggedError("GmailError")<{
  readonly message: string;
}> {}
