import Conf from "conf";
import * as nodePath from "node:path";
import type { CodeSession } from "../types.ts";

export class SessionManager {
  private conf: Conf<{ session: CodeSession }>;

  constructor(workingDir: string) {
    // Store the session file alongside the project, not in a global config dir.
    this.conf = new Conf<{ session: CodeSession }>({
      projectName: "t3code-cli",
      cwd: nodePath.join(workingDir, ".t3code"),
      configName: "session",
    });
  }

  save(session: CodeSession): void {
    this.conf.set("session", { ...session, savedAt: Date.now() });
  }

  load(): CodeSession | null {
    return (this.conf.get("session") as CodeSession | undefined) ?? null;
  }

  clear(): void {
    this.conf.delete("session");
  }

  hasSession(): boolean {
    return this.conf.has("session");
  }
}
