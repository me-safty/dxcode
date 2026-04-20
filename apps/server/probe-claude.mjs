import { query } from "@anthropic-ai/claude-agent-sdk";

function waitForAbortSignal(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

const abort = new AbortController();

const q = query({
  prompt: (async function* () {
    await waitForAbortSignal(abort.signal);
  })(),
  options: {
    persistSession: false,
    pathToClaudeCodeExecutable: "/Users/tyulyukov/.local/bin/claude",
    abortController: abort,
    settingSources: ["user", "project", "local"],
    allowedTools: [],
    stderr: (line) => {
      console.error("[claude stderr]", line);
    },
  },
});

const timeoutId = setTimeout(() => {
  console.error("TIMEOUT after 10s");
  abort.abort();
}, 10000);

try {
  const init = await q.initializationResult();
  console.log("subscriptionType:", init.account?.subscriptionType);
  console.log("commands count:", init.commands?.length);
  console.log("commands:", JSON.stringify(init.commands?.slice(0, 20), null, 2));
} catch (err) {
  console.error("ERROR:", err);
} finally {
  clearTimeout(timeoutId);
  if (!abort.signal.aborted) abort.abort();
}
