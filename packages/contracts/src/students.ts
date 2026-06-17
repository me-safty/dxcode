import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString, TrimmedString } from "./baseSchemas.ts";

/**
 * Branded identifier for Student entities
 */
const makeEntityId = <Brand extends string>(brand: Brand) => {
  return TrimmedNonEmptyString.pipe(Schema.brand(brand));
};

export const StudentId = makeEntityId("StudentId");
export type StudentId = typeof StudentId.Type;

/**
 * Student schema representing a student with their subjects and school
 */
export const StudentSchema = Schema.Struct({
  id: StudentId,
  name: TrimmedNonEmptyString.pipe(
    Schema.annotateKey({
      title: "Student Name",
      description: "Full name of the student",
    }),
  ),
  subjects: Schema.Array(TrimmedNonEmptyString).pipe(
    Schema.withDecodingDefault(Effect.succeed([])),
    Schema.annotateKey({
      title: "Subjects",
      description: "List of subjects the student is enrolled in",
    }),
  ),
  school: TrimmedNonEmptyString.pipe(
    Schema.annotateKey({
      title: "School",
      description: "Name of the school the student attends",
    }),
  ),
  workspaceFolder: Schema.optional(TrimmedString).pipe(
    Schema.annotateKey({
      title: "Workspace Folder",
      description: "Optional workspace folder path for student materials",
    }),
  ),
});

export type Student = typeof StudentSchema.Type;

/**
 * Derives a URL-safe slug from a student name
 * @param name - The student's name
 * @returns A slugified version of the name (lowercase, hyphenated)
 */
export function deriveStudentSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
