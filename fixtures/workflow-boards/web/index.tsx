import {
  defineWebPlugin,
  type PluginSidebarSectionRenderProps,
  useEnvironmentProjectRefs,
} from "@t3tools/plugin-sdk-web";
import { EnvironmentId } from "@t3tools/contracts";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

import type { BoardListEntry } from "../contracts/workflow.ts";
import { BoardRoute } from "./boardRoute";
import { createWorkflowApi, type WorkflowApi } from "./workflowApi";

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "Unable to load boards.";
}

function sidebarLinkStyle(active = false): CSSProperties {
  return {
    borderRadius: "6px",
    color: "var(--foreground)",
    display: "block",
    fontSize: "13px",
    fontWeight: active ? 600 : 400,
    overflow: "hidden",
    padding: "6px 8px",
    textDecoration: "none",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

function BoardSidebar(props: PluginSidebarSectionRenderProps & { readonly api: WorkflowApi }) {
  // The board list is per-project — an environment id is NOT a project id. Resolve
  // the environment's real project(s) and aggregate their boards (the common local
  // case is a single project; multi-project environments list all boards flat).
  const environmentId = props.environmentId ? EnvironmentId.make(props.environmentId) : null;
  const projectRefs = useEnvironmentProjectRefs(environmentId);
  // Depend on a stable key (not the array identity) so the fetch effect doesn't
  // re-run every render when the atom returns an equal-but-new array.
  const projectIdsKey = useMemo(
    () => projectRefs.map((ref) => ref.projectId).join(","),
    [projectRefs],
  );
  const [boards, setBoards] = useState<ReadonlyArray<BoardListEntry>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectRefs.length === 0) {
      setBoards([]);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void Promise.all(
      projectRefs.map((ref) => props.api.listBoards({ projectId: ref.projectId })),
    ).then(
      (lists) => {
        if (!cancelled) {
          setBoards(lists.flat());
          setLoading(false);
        }
      },
      (cause: unknown) => {
        if (!cancelled) {
          setBoards([]);
          setError(errorMessage(cause));
          setLoading(false);
        }
      },
    );

    return () => {
      cancelled = true;
    };
    // projectRefs is read inside; projectIdsKey is the stable re-run trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIdsKey, props.api]);

  const basePath = props.routeBasePath ? `${props.routeBasePath}/boards` : null;

  if (!basePath) {
    return <span style={sidebarLinkStyle()}>Select a board</span>;
  }

  if (projectRefs.length === 0) {
    return (
      <a href={basePath} style={sidebarLinkStyle()}>
        Select a board
      </a>
    );
  }

  if (loading && boards.length === 0) {
    return (
      <a href={basePath} style={sidebarLinkStyle()}>
        Loading boards...
      </a>
    );
  }

  if (error !== null && boards.length === 0) {
    return (
      <a href={basePath} style={sidebarLinkStyle()}>
        Boards unavailable
      </a>
    );
  }

  if (boards.length === 0) {
    return (
      <a href={basePath} style={sidebarLinkStyle()}>
        Select a board
      </a>
    );
  }

  return (
    <div style={{ display: "grid", gap: "2px" }}>
      {boards.map((board) => (
        <a
          key={board.boardId}
          href={`${basePath}?boardId=${encodeURIComponent(board.boardId)}`}
          style={sidebarLinkStyle()}
          title={board.name}
        >
          {board.name}
        </a>
      ))}
    </div>
  );
}

export default defineWebPlugin({
  register: (ctx) => {
    const api = createWorkflowApi(ctx.rpc);

    ctx.registerRoute({
      path: "boards",
      component: (props) => <BoardRoute {...props} rpc={ctx.rpc} api={api} />,
    });

    ctx.registerSidebarSection({
      id: "boards",
      title: "Workflow Boards",
      render: (props) => <BoardSidebar {...props} api={api} />,
    });
  },
});
