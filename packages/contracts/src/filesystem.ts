import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "./baseSchemas.ts";

const FILESYSTEM_PATH_MAX_LENGTH = 512;

export const FilesystemBrowseInput = Schema.Struct({
  partialPath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  cwd: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH))),
});
export type FilesystemBrowseInput = typeof FilesystemBrowseInput.Type;

export const FilesystemBrowseEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  fullPath: TrimmedNonEmptyString,
});
export type FilesystemBrowseEntry = typeof FilesystemBrowseEntry.Type;

export const FilesystemBrowseResult = Schema.Struct({
  parentPath: TrimmedNonEmptyString,
  entries: Schema.Array(FilesystemBrowseEntry),
});
export type FilesystemBrowseResult = typeof FilesystemBrowseResult.Type;

export class FilesystemBrowseError extends Schema.TaggedErrorClass<FilesystemBrowseError>()(
  "FilesystemBrowseError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// --- listDir ---
export const FilesystemListDirInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  // relativePath is "" for the workspace root, hence Schema.String (not TrimmedNonEmptyString)
  relativePath: Schema.String.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
});
export type FilesystemListDirInput = typeof FilesystemListDirInput.Type;

export const FilesystemListDirEntry = Schema.Struct({
  name: TrimmedNonEmptyString,
  relativePath: TrimmedNonEmptyString,
  kind: Schema.Literals(["file", "directory"]),
});
export type FilesystemListDirEntry = typeof FilesystemListDirEntry.Type;

export const FilesystemListDirResult = Schema.Struct({
  entries: Schema.Array(FilesystemListDirEntry),
});
export type FilesystemListDirResult = typeof FilesystemListDirResult.Type;

export class FilesystemListDirError extends Schema.TaggedErrorClass<FilesystemListDirError>()(
  "FilesystemListDirError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

// --- readFile ---
export const FilesystemReadFileInput = Schema.Struct({
  cwd: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
  relativePath: TrimmedNonEmptyString.check(Schema.isMaxLength(FILESYSTEM_PATH_MAX_LENGTH)),
});
export type FilesystemReadFileInput = typeof FilesystemReadFileInput.Type;

export const FilesystemReadFileResult = Schema.Struct({
  content: Schema.String,
  truncated: Schema.Boolean,
  tooLarge: Schema.Boolean,
  binary: Schema.Boolean,
});
export type FilesystemReadFileResult = typeof FilesystemReadFileResult.Type;

export class FilesystemReadFileError extends Schema.TaggedErrorClass<FilesystemReadFileError>()(
  "FilesystemReadFileError",
  {
    message: TrimmedNonEmptyString,
    cause: Schema.optional(Schema.Defect()),
  },
) {}
