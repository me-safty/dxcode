export type JoinPath = (first: string, ...segments: string[]) => string;

export function resolveDesktopBaseDir(input: {
  readonly homeDirectory: string;
  readonly joinPath: JoinPath;
  readonly t3Home: string | null | undefined;
}): string {
  if (typeof input.t3Home === "string") {
    const trimmed = input.t3Home.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return input.joinPath(input.homeDirectory, ".t3");
}

export function resolveDesktopStateDir(input: {
  readonly baseDir: string;
  readonly isDevelopment: boolean;
  readonly joinPath: JoinPath;
}): string {
  return input.joinPath(input.baseDir, input.isDevelopment ? "dev" : "userdata");
}
