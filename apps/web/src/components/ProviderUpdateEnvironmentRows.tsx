import { CheckIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "~/lib/utils";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { useLocalEnvironmentUpdateGroups } from "./ProviderUpdateLaunchNotification.environments";
import {
  collectProviderUpdateOutcomeSnapshots,
  firstRejectedProviderUpdateMessage,
  getProviderUpdateProgressToastView,
  getProviderUpdateSidebarPillView,
  isProviderUpdateActive,
  isTerminalProviderUpdatePhase,
  resolveEnvironmentUpdateRowStatus,
  type LocalEnvironmentUpdateGroup,
  type LocalProviderUpdateOutcome,
  type ProviderUpdateCandidate,
  type ProviderUpdateRowStatus,
  type ProviderUpdateRowStatusKind,
  type ProviderUpdateToastView,
} from "./ProviderUpdateLaunchNotification.logic";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

type ProviderUpdateCommandResult = AtomCommandResult<
  { readonly providers: ReadonlyArray<ServerProvider> },
  unknown
>;

interface EnvironmentUpdateResult {
  readonly view: ProviderUpdateToastView;
  readonly attemptedCandidateKeys: ReadonlySet<string>;
}

interface EnvironmentUpdateError {
  readonly message: string;
  readonly attemptedCandidateKeys: ReadonlySet<string>;
}

function providerUpdateResultKey(candidate: ProviderUpdateCandidate): string {
  const advisory = candidate.versionAdvisory;
  return JSON.stringify([
    candidate.driver,
    advisory.latestVersion,
    advisory.updateActionKey ?? advisory.updateCommand,
  ]);
}

/**
 * Map one targeted instance's update command result into the settled-outcome
 * shape the multi-backend reducers consume: a non-interrupted failure becomes a
 * rejection carrying its message; a success carries the post-update snapshot of
 * the targeted instance (null when the backend did not report it).
 */
function toProviderUpdateOutcome(input: {
  readonly environmentId: EnvironmentId;
  readonly isPrimary: boolean;
  readonly target: {
    readonly driver: ServerProvider["driver"];
    readonly instanceId: ServerProvider["instanceId"];
  };
  readonly result: ProviderUpdateCommandResult;
}): PromiseSettledResult<LocalProviderUpdateOutcome> {
  if (input.result._tag === "Failure") {
    if (isAtomCommandInterrupted(input.result)) {
      // An interrupted dispatch (e.g. superseded) is neither a success nor a
      // hard failure — surface it as a non-contributing, non-rejecting outcome.
      return {
        status: "fulfilled",
        value: {
          environmentId: input.environmentId,
          isPrimary: input.isPrimary,
          driver: input.target.driver,
          instanceId: input.target.instanceId,
          provider: null,
        },
      };
    }
    const error = squashAtomCommandFailure(input.result);
    return {
      status: "rejected",
      reason: error instanceof Error ? error : new Error("Provider update failed."),
    };
  }

  const provider =
    input.result.value.providers.find(
      (candidate) => candidate.instanceId === input.target.instanceId,
    ) ?? null;
  return {
    status: "fulfilled",
    value: {
      environmentId: input.environmentId,
      isPrimary: input.isPrimary,
      driver: input.target.driver,
      instanceId: input.target.instanceId,
      provider,
    },
  };
}

// Transport-hang safety net. The dispatch's `finally` clears the spinner and the
// in-flight guard on completion, so this only matters if a request never resolves
// at all (e.g. the socket drops mid-flight without surfacing an error). Keep it
// well beyond the server's own update timeout (5 min) so a legitimately slow
// update (npm installs routinely run tens of seconds) is never cut off and left
// showing a dead, unresponsive Update button.
const PENDING_EXPIRY_MS = 6 * 60_000;

function rowToneClass(kind: ProviderUpdateRowStatusKind): string {
  switch (kind) {
    case "failed":
      return "text-destructive";
    case "unchanged":
      return "text-warning";
    case "success":
      return "text-success";
    default:
      return "text-muted-foreground";
  }
}

function EnvironmentUpdateRow({
  group,
  status,
  canUpdate,
  onUpdate,
}: {
  readonly group: LocalEnvironmentUpdateGroup;
  readonly status: ProviderUpdateRowStatus;
  readonly canUpdate: boolean;
  readonly onUpdate: () => void;
}) {
  let trailing: ReactNode;
  switch (status.kind) {
    case "loading":
      trailing = <Spinner className="size-4 text-muted-foreground" />;
      break;
    case "success":
      trailing = <CheckIcon aria-hidden="true" className="size-4 text-success" />;
      break;
    case "failed":
    case "unchanged":
      trailing = canUpdate ? (
        <Button size="xs" variant="outline" onClick={onUpdate}>
          Retry
        </Button>
      ) : null;
      break;
    default:
      trailing = canUpdate ? (
        <Button size="xs" onClick={onUpdate}>
          Update
        </Button>
      ) : null;
      break;
  }

  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium text-foreground">{group.label}</span>
        <span className={cn("truncate text-xs", rowToneClass(status.kind))}>{status.text}</span>
      </div>
      <div className="shrink-0">{trailing}</div>
    </div>
  );
}

/**
 * The launch popover's body when WSL is present: one row per local environment
 * (Windows + WSL). Each row targets only its own backend and exposes an update
 * trigger only for candidates whose actions can be safely dispatched.
 */
export function ProviderUpdateEnvironmentRows({
  onInteract,
  onEmpty,
}: {
  /** Called the first time the user triggers an update, so the host can stop refreshing the prompt. */
  readonly onInteract?: () => void;
  /** Called once no update, progress, or result row remains for the host toast to display. */
  readonly onEmpty?: () => void;
}) {
  const { groups } = useLocalEnvironmentUpdateGroups();
  const updateProvider = useAtomCommand(serverEnvironment.updateProvider, {
    reportFailure: false,
  });
  const groupByEnvironment = useMemo(
    () => new Map(groups.map((group) => [group.environmentId, group] as const)),
    [groups],
  );

  // Only surface results that land after this popover opened.
  const visibleAfterIsoRef = useRef<string>(new Date().toISOString());

  // Synchronous re-entry guard. setPendingEnvironments is an async state update,
  // and PENDING_EXPIRY_MS can clear the spinner while a request is still in
  // flight, so a rapid double-click (or a click after the expiry fires mid-
  // request) would otherwise dispatch a second full round of updates. A ref
  // updates synchronously, so we can bail before doing any work.
  const inFlightEnvironmentsRef = useRef<Set<EnvironmentId>>(new Set());

  // Monotonic per-environment request version. Bumped on each dispatch and
  // captured locally, so an attempt that was superseded -- e.g. one that already
  // tripped the expiry safety net and was retried -- detects it is no longer
  // current and skips every state write when it finally resolves, instead of
  // clobbering the newer attempt's spinner/result/error or its in-flight guard.
  const requestVersionRef = useRef<Map<EnvironmentId, number>>(new Map());

  const [pendingEnvironments, setPendingEnvironments] = useState<ReadonlySet<EnvironmentId>>(
    () => new Set(),
  );
  const [errorByEnvironment, setErrorByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, EnvironmentUpdateError>
  >(() => new Map());
  const [resultByEnvironment, setResultByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, EnvironmentUpdateResult>
  >(() => new Map());
  // Remember only environments where this mounted prompt actually accepted an
  // update attempt. If an interrupted request loses its row while that backend
  // reconnects, this keeps the prompt alive until its snapshot is authoritative
  // again without letting an unrelated offline candidate strand the prompt.
  const attemptedEnvironmentIdsRef = useRef<Set<EnvironmentId>>(new Set());

  const clearPending = useCallback((environmentId: EnvironmentId) => {
    setPendingEnvironments((previous) => {
      if (!previous.has(environmentId)) {
        return previous;
      }
      const next = new Set(previous);
      next.delete(environmentId);
      return next;
    });
  }, []);

  const handleUpdate = useCallback(
    async (environmentId: EnvironmentId) => {
      const group = groupByEnvironment.get(environmentId);
      if (!group || group.runnableCandidates.length === 0) {
        return;
      }
      if (inFlightEnvironmentsRef.current.has(environmentId)) {
        return;
      }
      inFlightEnvironmentsRef.current.add(environmentId);
      attemptedEnvironmentIdsRef.current.add(environmentId);
      const requestVersion = (requestVersionRef.current.get(environmentId) ?? 0) + 1;
      requestVersionRef.current.set(environmentId, requestVersion);
      const isCurrentRequest = () =>
        requestVersionRef.current.get(environmentId) === requestVersion;
      onInteract?.();
      const providerCount = group.runnableCandidates.length;
      const attemptedCandidateKeys = new Set(group.runnableCandidates.map(providerUpdateResultKey));
      const targets = group.runnableCandidates.map((candidate) => ({
        driver: candidate.driver,
        instanceId: candidate.instanceId,
      }));

      setPendingEnvironments((previous) => new Set(previous).add(environmentId));
      setErrorByEnvironment((previous) => {
        if (!previous.has(environmentId)) {
          return previous;
        }
        const next = new Map(previous);
        next.delete(environmentId);
        return next;
      });
      setResultByEnvironment((previous) => {
        if (!previous.has(environmentId)) {
          return previous;
        }
        const next = new Map(previous);
        next.delete(environmentId);
        return next;
      });

      const expiry = setTimeout(() => {
        // A newer attempt may have superseded this one; if so, leave its state
        // untouched.
        if (!isCurrentRequest()) {
          return;
        }
        // The request is presumed dead (see PENDING_EXPIRY_MS). Clear the
        // spinner AND the in-flight guard together so the row never strands on a
        // dead Update button, and surface feedback so the timeout is visible
        // rather than silently reverting to idle.
        inFlightEnvironmentsRef.current.delete(environmentId);
        clearPending(environmentId);
        setErrorByEnvironment((previous) =>
          new Map(previous).set(environmentId, {
            message: "Update timed out — try again.",
            attemptedCandidateKeys,
          }),
        );
      }, PENDING_EXPIRY_MS);
      try {
        // Dispatch each candidate's update to this environment's own backend and
        // normalize every settled outcome into the multi-backend reducer shape.
        const results = await Promise.all(
          targets.map(async (target): Promise<PromiseSettledResult<LocalProviderUpdateOutcome>> => {
            try {
              const result = await updateProvider({
                environmentId,
                input: { provider: target.driver, instanceId: target.instanceId },
              });
              return toProviderUpdateOutcome({
                environmentId,
                isPrimary: group.isPrimary,
                target,
                result,
              });
            } catch (error) {
              return {
                status: "rejected",
                reason: error instanceof Error ? error : new Error("Provider update failed."),
              };
            }
          }),
        );
        if (!isCurrentRequest()) {
          // A newer attempt superseded this one while it was in flight; leave
          // the newer attempt's state intact.
          return;
        }
        // The request resolved (not a transport hang), so clear any stale
        // timeout error the expiry may have set -- otherwise a late success
        // would be masked, since an error takes priority in the row status.
        setErrorByEnvironment((previous) => {
          if (!previous.has(environmentId)) {
            return previous;
          }
          const next = new Map(previous);
          next.delete(environmentId);
          return next;
        });
        if (results.length === 0) {
          setErrorByEnvironment((previous) =>
            new Map(previous).set(environmentId, {
              message: "This environment isn’t connected — try again once it reconnects.",
              attemptedCandidateKeys,
            }),
          );
          return;
        }
        const rejectedMessage = firstRejectedProviderUpdateMessage(results);
        if (rejectedMessage) {
          setErrorByEnvironment((previous) =>
            new Map(previous).set(environmentId, {
              message: rejectedMessage,
              attemptedCandidateKeys,
            }),
          );
          return;
        }
        const view = getProviderUpdateProgressToastView({
          providers: collectProviderUpdateOutcomeSnapshots(results),
          providerCount,
        });
        // Only persist a terminal outcome. A non-terminal ("running"/"initial")
        // view means this dispatch could not confirm completion — e.g. a snapshot
        // came back without its targeted instance (collectProviderUpdateOutcome-
        // Snapshots drops null providers), which happens when the command is
        // interrupted as a second backend connects and supersedes the in-flight
        // update. A stored view never re-polls, so persisting it would pin the
        // row's spinner forever once the pending flag expires. Drop it and let
        // the live per-environment provider state (pill) plus the pending expiry
        // drive the row, so it self-heals to whatever the backend actually did.
        if (isTerminalProviderUpdatePhase(view.phase)) {
          setResultByEnvironment((previous) =>
            new Map(previous).set(environmentId, { view, attemptedCandidateKeys }),
          );
        }
      } catch (error) {
        if (isCurrentRequest()) {
          setErrorByEnvironment((previous) =>
            new Map(previous).set(environmentId, {
              message: error instanceof Error ? error.message : "Provider update failed.",
              attemptedCandidateKeys,
            }),
          );
        }
      } finally {
        clearTimeout(expiry);
        // Only the current attempt owns the shared spinner and in-flight guard;
        // a superseded attempt resolving late must not clear a newer one's.
        if (isCurrentRequest()) {
          clearPending(environmentId);
          inFlightEnvironmentsRef.current.delete(environmentId);
        }
      }
    },
    [clearPending, groupByEnvironment, onInteract, updateProvider],
  );

  const rows = groups
    .map((group) => {
      const storedResult = resultByEnvironment.get(group.environmentId);
      const storedError = errorByEnvironment.get(group.environmentId);
      const hasAttemptedCandidate =
        storedResult !== undefined &&
        group.candidates.some((candidate) =>
          storedResult.attemptedCandidateKeys.has(providerUpdateResultKey(candidate)),
        );
      const hasUnattemptedCandidate =
        storedResult !== undefined &&
        group.candidates.some(
          (candidate) =>
            !storedResult.attemptedCandidateKeys.has(providerUpdateResultKey(candidate)),
        );
      const oneClickCandidateKeys = new Set(group.oneClickCandidates.map(providerUpdateResultKey));
      const hasSettingsOnlyCandidate = group.candidates.some(
        (candidate) => !oneClickCandidateKeys.has(providerUpdateResultKey(candidate)),
      );
      const pillProviders = group.oneClickCandidates.map(
        (candidate) =>
          group.providers.find(
            (provider) => provider.driver === candidate.driver && isProviderUpdateActive(provider),
          ) ?? candidate,
      );
      const pill = getProviderUpdateSidebarPillView(pillProviders, {
        visibleAfterIso: visibleAfterIsoRef.current,
      });
      const hasErrorTarget =
        storedError !== undefined &&
        group.candidates.some((candidate) =>
          storedError.attemptedCandidateKeys.has(providerUpdateResultKey(candidate)),
        );
      const visibleError =
        storedError !== undefined && group.connectionState === "ready" && !hasErrorTarget
          ? undefined
          : storedError?.message;
      const visibleResult =
        (group.candidates.length > 0 && storedResult !== undefined && !hasAttemptedCandidate) ||
        (storedResult?.view.phase === "succeeded" && hasUnattemptedCandidate)
          ? undefined
          : storedResult?.view;
      const visiblePill = pill?.tone === "success" && hasSettingsOnlyCandidate ? null : pill;

      return {
        group,
        status: resolveEnvironmentUpdateRowStatus({
          group,
          error: visibleError,
          result: visibleResult,
          // Derive the live pill from the candidates this row is actually
          // tracking, not every provider in the environment. Otherwise an
          // unrelated provider's recent success (or one candidate succeeding while
          // another was interrupted) makes the pill report success and hides the
          // Update action for candidates that are still outdated.
          pill: visiblePill,
          isPending: pendingEnvironments.has(group.environmentId),
        }),
      };
    })
    .filter(({ group, status }) => group.candidates.length > 0 || status.kind !== "idle");

  useEffect(() => {
    // Empty provider snapshots from connecting, disconnected, or failed
    // backends are not authoritative. Keep an interacted toast mounted until
    // every backend that contributed an update or attempt is ready; unrelated
    // offline environments must not strand an otherwise-empty toast.
    const attemptedGroups = groups.filter((group) =>
      attemptedEnvironmentIdsRef.current.has(group.environmentId),
    );
    if (rows.length === 0 && attemptedGroups.every((group) => group.connectionState === "ready")) {
      onEmpty?.();
    }
  }, [groups, onEmpty, rows.length]);

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="mt-0.5 flex flex-col gap-1">
      {rows.map(({ group, status }) => (
        <EnvironmentUpdateRow
          key={group.environmentId}
          group={group}
          status={status}
          canUpdate={group.runnableCandidates.length > 0}
          onUpdate={() => handleUpdate(group.environmentId)}
        />
      ))}
    </div>
  );
}
