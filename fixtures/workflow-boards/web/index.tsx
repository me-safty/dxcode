import { defineWebPlugin, type PluginWebRpc } from "@t3tools/plugin-sdk-web";
import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";

// Phase-0 plumbing spike for sub-project B: prove a workflow-boards WEB bundle
// builds, loads in the host, renders, and round-trips to the server plugin over
// `plugins.call`. Deliberately minimal to isolate the bundle mechanics:
//   - `rpc.call` returns a Promise (no effect Stream) -> no effect subpath imports
//   - inline styles + host CSS variables -> no Tailwind dependency
//   - no host atoms -> no single-instance atom-registry concerns
// The real board UI (useWorkflowApi adapter, host-atom deps, subscribeBoard fold)
// is Phases 1-3 of docs/superpowers/plans/2026-07-04-workflows-plugin-b-web-board-bundle.md.

const shell: CSSProperties = {
  minHeight: "100%",
  padding: "24px",
  color: "var(--foreground)",
  background: "var(--background)",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  overflow: "auto",
};

const card: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "8px",
  padding: "16px",
  background: "var(--card)",
  marginTop: "12px",
  maxWidth: "760px",
};

const mono: CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
  fontSize: "12px",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  margin: 0,
};

const button: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: "6px",
  padding: "6px 12px",
  background: "var(--secondary, transparent)",
  color: "var(--foreground)",
  cursor: "pointer",
  fontSize: "13px",
};

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Plugin RPC failed.";
}

function WorkflowBoardsSurface({
  rpc,
  pluginId,
  path,
}: {
  readonly rpc: PluginWebRpc;
  readonly pluginId: string;
  readonly path: string;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    setError(null);
    try {
      // A workflow RPC method with an empty-object input: proves the web bundle ->
      // server plugin round-trip without needing a projectId (plugin routes don't
      // yet receive environment/project context — a Phase-1 item). The server
      // decodes the input against `Schema.Struct({})`, so `{}` is required — a
      // missing/`undefined` input fails decode ("input decode failed").
      const value = await rpc.call("workflow.listNeedsAttentionTickets", {});
      setResult(value);
      setStatus("ok");
    } catch (cause) {
      setError(errorMessage(cause));
      setStatus("error");
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  const count = Array.isArray(result) ? result.length : null;

  return (
    <div style={shell}>
      <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>Workflow Boards</h1>
      <p style={{ color: "var(--muted-foreground)", marginTop: "4px", maxWidth: "760px" }}>
        Plugin web bundle — rendered by the host and talking to the workflow-boards server plugin
        over <code>plugins.call</code>.
      </p>

      <div style={card}>
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button type="button" style={button} onClick={() => void load()}>
            Reload
          </button>
          <span style={{ color: "var(--muted-foreground)", fontSize: "13px" }}>
            {status === "loading"
              ? "Calling workflow.listNeedsAttentionTickets…"
              : status === "error"
                ? "RPC failed"
                : status === "ok"
                  ? count !== null
                    ? `RPC ok — ${count} ticket(s) need attention`
                    : "RPC ok"
                  : ""}
          </span>
        </div>
        {error !== null ? (
          <pre style={{ ...mono, color: "var(--destructive, #ef4444)", marginTop: "12px" }}>
            {error}
          </pre>
        ) : null}
        {status === "ok" ? (
          <pre style={{ ...mono, marginTop: "12px" }}>{JSON.stringify(result, null, 2)}</pre>
        ) : null}
      </div>

      <div style={card}>
        <div style={{ fontWeight: 600, marginBottom: "8px" }}>Plugin context</div>
        <pre style={mono}>
          {JSON.stringify(
            {
              pluginId,
              path,
              location: typeof window !== "undefined" ? window.location.pathname : null,
            },
            null,
            2,
          )}
        </pre>
      </div>
    </div>
  );
}

export default defineWebPlugin({
  register: (ctx) => {
    ctx.registerRoute({
      path: "boards",
      component: (props) => (
        <WorkflowBoardsSurface rpc={ctx.rpc} pluginId={String(ctx.pluginId)} path={props.path} />
      ),
    });
    ctx.registerSidebarSection({
      id: "workflow-boards",
      title: "Workflow Boards",
      render: ({ routeBasePath }) => (
        <a
          href={routeBasePath ? `${routeBasePath}/boards` : undefined}
          style={{
            color: "var(--foreground)",
            display: "block",
            fontSize: "13px",
            padding: "6px 8px",
            textDecoration: "none",
          }}
        >
          Boards
        </a>
      ),
    });
  },
});
