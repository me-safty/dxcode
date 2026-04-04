import { SessionManager } from "../session/SessionManager.ts";
import { startWithSession } from "./start.ts";

export async function continueSession(options: {
  model?: string;
} = {}): Promise<void> {
  const sessionManager = new SessionManager(process.cwd());

  if (!sessionManager.hasSession()) {
    console.error(
      "No session found in this directory.\nStart a new one: t3code start",
    );
    process.exit(1);
  }

  const session = sessionManager.load()!;
  const ago = formatAgo(session.savedAt);
  console.log(`Resuming session from ${ago}...`);
  if (session.currentTask) {
    console.log(`Last task: ${session.currentTask}`);
  }

  await startWithSession(session, options.model);
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
