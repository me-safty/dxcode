import { lstat, mkdir, readFile, readdir, readlink, rm, symlink } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");
const rootPackageJsonPath = join(repoRoot, "package.json");
const rootNodeModulesDir = join(repoRoot, "node_modules");

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function workspaceDirectoriesForPattern(pattern) {
  if (pattern === "scripts") {
    return [join(repoRoot, "scripts")];
  }

  const prefix = pattern.endsWith("/*") ? pattern.slice(0, -2) : pattern;
  return readdir(join(repoRoot, prefix), { withFileTypes: true }).then((entries) =>
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(repoRoot, prefix, entry.name)),
  );
}

async function collectWorkspacePackages() {
  const rootPackageJson = await readJson(rootPackageJsonPath);
  const packagePatterns = rootPackageJson.workspaces?.packages ?? [];
  const directories = [];

  for (const pattern of packagePatterns) {
    directories.push(...(await workspaceDirectoriesForPattern(pattern)));
  }

  const packages = [];
  for (const directory of directories) {
    const packageJsonPath = join(directory, "package.json");
    try {
      const manifest = await readJson(packageJsonPath);
      if (typeof manifest.name === "string" && manifest.name.length > 0) {
        packages.push({
          name: manifest.name,
          directory,
        });
      }
    } catch {
      // Ignore directories that are not packages.
    }
  }

  return packages;
}

async function ensureWorkspaceLink(name, directory) {
  const destination = join(rootNodeModulesDir, name);
  const target = relative(dirname(destination), directory);

  await mkdir(dirname(destination), { recursive: true });

  try {
    const stat = await lstat(destination);
    if (stat.isSymbolicLink()) {
      const existingTarget = await readlink(destination);
      if (existingTarget === target) {
        return;
      }
    }
    await rm(destination, { recursive: true, force: true });
  } catch {
    // Missing destination is fine.
  }

  await symlink(target, destination, process.platform === "win32" ? "junction" : "dir");
}

const workspacePackages = await collectWorkspacePackages();
await mkdir(rootNodeModulesDir, { recursive: true });
await Promise.all(
  workspacePackages.map(({ name, directory }) => ensureWorkspaceLink(name, directory)),
);
