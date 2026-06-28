import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";

/**
 * Bootstrap Atlas skills directories and seed shipped app skills.
 *
 * Creates:
 * - <workspaceRoot>/.atlas/skills/app/
 * - <workspaceRoot>/.atlas/skills/personal/
 *
 * For shipped app skills, checks file existence before writing to avoid
 * clobbering user edits. Version-stamps app skills for future migration support.
 */
export const bootstrapAtlasSkills = Effect.fnUntraced(function* (input: {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly workspaceRoot: string;
}): Effect.fn.Return<void, PlatformError.PlatformError> {
  const atlasDir = input.path.join(input.workspaceRoot, ".atlas");
  const skillsDir = input.path.join(atlasDir, "skills");
  const appSkillsDir = input.path.join(skillsDir, "app");
  const personalSkillsDir = input.path.join(skillsDir, "personal");

  // Create directory structure (idempotent)
  yield* input.fileSystem.makeDirectory(appSkillsDir, { recursive: true });
  yield* input.fileSystem.makeDirectory(personalSkillsDir, { recursive: true });

  // Version file for shipped app skills
  const versionFilePath = input.path.join(appSkillsDir, ".version");
  const currentVersion = "1.0.0";

  // Check if version file exists
  const versionFileExists = yield* input.fileSystem
    .exists(versionFilePath)
    .pipe(Effect.orElseSucceed(() => false));

  // Write version file only if it doesn't exist (don't overwrite user modifications)
  if (!versionFileExists) {
    yield* input.fileSystem.writeFileString(versionFilePath, currentVersion);
  }

  // Future: Add shipped app skills here
  // For now, we just ensure the directory structure exists
  // Example pattern for shipped skills:
  //
  // const exampleSkillPath = input.path.join(appSkillsDir, "example-skill.md");
  // const exampleSkillExists = yield* input.fileSystem
  //   .exists(exampleSkillPath)
  //   .pipe(Effect.orElseSucceed(() => false));
  //
  // if (!exampleSkillExists) {
  //   const exampleSkillContent = `<!-- version: ${currentVersion} -->
  //   # Example Skill
  //   ...
  //   `;
  //   yield* input.fileSystem.writeFileString(exampleSkillPath, exampleSkillContent);
  // }
});
