"use client";

import type { CodexAccountConfig, CodexUsageSnapshot } from "@t3tools/contracts";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FolderSearchIcon,
  Loader2Icon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";

import {
  loginCodexAccount,
  probeCodexAccountUsage,
  scanCodexProfiles,
} from "../../../lib/codexUsageProbe";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { importedCodexAccounts, managedCodexAccountHomePath } from "./codexAccounts";

interface BulkAddAccountsDialogProps {
  binaryPath: string;
  onAddAccounts: (accounts: ReadonlyArray<CodexAccountConfig>) => void;
  onClose: () => void;
}

interface EnrollmentDraft {
  readonly id: string;
  readonly label: string;
  readonly shadowHomePath: string;
  readonly index: number;
}

interface VerifiedEnrollment {
  readonly account: CodexAccountConfig;
  readonly usage: CodexUsageSnapshot;
}

function clampAccountCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(50, Math.trunc(value)));
}

function planLabel(usage: CodexUsageSnapshot): string | undefined {
  return usage.planType?.trim() || undefined;
}

export function BulkAddAccountsDialog({
  binaryPath,
  onAddAccounts,
  onClose,
}: BulkAddAccountsDialogProps) {
  const [mode, setMode] = useState<"enroll" | "scan">("enroll");
  const [count, setCount] = useState(1);
  const [basePath, setBasePath] = useState("~/Library/Application Support/Codex Accounts");
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState({
    current: 0,
    total: 0,
    stage: "idle" as "idle" | "login" | "verify",
  });
  const [error, setError] = useState<string | null>(null);
  const [scannedProfiles, setScannedProfiles] = useState<string[]>([]);
  const [pendingVerification, setPendingVerification] = useState<EnrollmentDraft | null>(null);
  const [verifiedEnrollments, setVerifiedEnrollments] = useState<VerifiedEnrollment[]>([]);

  const effectiveBinaryPath = binaryPath || "codex";

  const verifyEnrollment = async (draft: EnrollmentDraft): Promise<CodexAccountConfig | null> => {
    const result = await probeCodexAccountUsage({
      shadowHomePath: draft.shadowHomePath,
      binaryPath: effectiveBinaryPath,
    });

    if (result.status !== "success" || !result.usage) {
      setPendingVerification(draft);
      setError(
        result.error ??
          "Login finished, but the account quota could not be verified. Complete activation in the browser, then retry verification.",
      );
      return null;
    }

    const usage = result.usage;
    const account: CodexAccountConfig = {
      id: draft.id,
      label: usage.email ?? draft.label,
      shadowHomePath: draft.shadowHomePath,
      enabled: true,
    };
    setVerifiedEnrollments((previous) => [...previous, { account, usage }]);
    onAddAccounts([account]);
    setPendingVerification(null);
    setError(null);
    return account;
  };

  const handleScan = async () => {
    setIsProcessing(true);
    setError(null);
    setScannedProfiles([]);
    try {
      const result = await scanCodexProfiles({ basePath });
      if (result.status === "success" && result.profiles) {
        setScannedProfiles([...result.profiles]);
      } else {
        setError(result.error || "Failed to scan directory");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImportScanned = () => {
    const newAccounts = importedCodexAccounts(scannedProfiles);
    if (newAccounts.length > 0) {
      onAddAccounts(newAccounts);
    }
    onClose();
  };

  const handleStart = async () => {
    const total = clampAccountCount(count);
    setCount(total);
    setIsProcessing(true);
    setProgress({ current: 0, total, stage: "login" });
    setError(null);
    setPendingVerification(null);
    setVerifiedEnrollments([]);

    let failed = false;
    const timestamp = Date.now();

    for (let i = 0; i < total; i++) {
      const id = `acct_${timestamp}_${i}`;
      const draft: EnrollmentDraft = {
        id,
        label: `Enrolled account ${i + 1}`,
        shadowHomePath: managedCodexAccountHomePath(id),
        index: i,
      };

      setProgress({ current: i + 1, total, stage: "login" });
      try {
        const loginResult = await loginCodexAccount({
          shadowHomePath: draft.shadowHomePath,
          binaryPath: effectiveBinaryPath,
        });

        if (loginResult.status !== "success") {
          setError(`Login failed for account ${i + 1}: ${loginResult.error}`);
          failed = true;
          break;
        }

        setProgress({ current: i + 1, total, stage: "verify" });
        const account = await verifyEnrollment(draft);
        if (!account) {
          failed = true;
          break;
        }
      } catch (cause) {
        setError(
          `Error enrolling account ${i + 1}: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
        failed = true;
        break;
      }
    }

    setIsProcessing(false);
    if (!failed) {
      onClose();
    }
  };

  const handleRetryVerification = async () => {
    if (!pendingVerification || isProcessing) return;
    setIsProcessing(true);
    setProgress({
      current: pendingVerification.index + 1,
      total: count,
      stage: "verify",
    });
    try {
      await verifyEnrollment(pendingVerification);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsProcessing(false);
    }
  };

  const progressLabel =
    progress.stage === "verify" ? "Verifying Codex quota" : "Waiting for browser login";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-[30rem] rounded-lg border bg-card p-5 shadow-lg">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">Codex account enrollment</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add managed Codex accounts after completing the normal browser login and activation
            flow.
          </p>
        </div>

        <div className="mb-4 flex gap-4 border-b">
          <button
            className={`pb-2 text-sm font-medium ${
              mode === "enroll" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
            }`}
            disabled={isProcessing}
            onClick={() => setMode("enroll")}
            type="button"
          >
            Enroll accounts
          </button>
          <button
            className={`pb-2 text-sm font-medium ${
              mode === "scan" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"
            }`}
            disabled={isProcessing}
            onClick={() => setMode("scan")}
            type="button"
          >
            Import existing
          </button>
        </div>

        {mode === "enroll" ? (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Complete any Plus or phone activation prompts in the browser. The account is added
              only after quota verification succeeds.
            </p>

            {!isProcessing ? (
              <>
                <div className="mb-5 flex items-center gap-3">
                  <span className="text-sm">Accounts</span>
                  <Input
                    className="h-8 w-20"
                    max={50}
                    min={1}
                    onChange={(event) => setCount(clampAccountCount(Number(event.target.value)))}
                    type="number"
                    value={count}
                  />
                </div>

                {verifiedEnrollments.length > 0 ? (
                  <div className="mb-4 rounded-md border bg-muted/30 p-2">
                    {verifiedEnrollments.map(({ account, usage }) => (
                      <div
                        className="flex min-w-0 items-center justify-between gap-3 py-1 text-xs"
                        key={account.id}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <CheckCircle2Icon className="size-3.5 shrink-0 text-primary" />
                          <span className="truncate">{account.label}</span>
                        </div>
                        {planLabel(usage) ? (
                          <span className="shrink-0 uppercase text-muted-foreground">
                            {planLabel(usage)}
                          </span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}

                {error ? (
                  <div className="mb-4 flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                    <div className="min-w-0 flex-1">{error}</div>
                  </div>
                ) : null}

                <div className="flex justify-end gap-2">
                  <Button disabled={isProcessing} onClick={onClose} variant="outline">
                    Close
                  </Button>
                  {pendingVerification ? (
                    <Button onClick={() => void handleRetryVerification()} variant="secondary">
                      <RefreshCwIcon className="mr-2 h-4 w-4" />
                      Retry verification
                    </Button>
                  ) : null}
                  <Button onClick={() => void handleStart()}>
                    <PlayIcon className="mr-2 h-4 w-4" />
                    Start
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <Loader2Icon className="mb-4 h-8 w-8 animate-spin text-primary" />
                <h3 className="font-medium">{progressLabel}</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Account {progress.current} of {progress.total}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Import existing Codex profiles from a local directory.
            </p>

            <div className="mb-5 flex flex-col gap-2">
              <span className="text-sm">Base directory</span>
              <div className="flex gap-2">
                <Input
                  className="flex-1"
                  disabled={isProcessing}
                  onChange={(event) => setBasePath(event.target.value)}
                  value={basePath}
                />
                <Button disabled={isProcessing || !basePath} onClick={() => void handleScan()}>
                  {isProcessing ? (
                    <Loader2Icon className="h-4 w-4 animate-spin" />
                  ) : (
                    <FolderSearchIcon className="mr-2 h-4 w-4" />
                  )}
                  Scan
                </Button>
              </div>
            </div>

            {error ? (
              <div className="mb-4 flex gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <div className="min-w-0 flex-1">{error}</div>
              </div>
            ) : null}

            {scannedProfiles.length > 0 ? (
              <div className="mb-4">
                <span className="text-sm font-medium">Found {scannedProfiles.length} profiles</span>
                <div className="mt-2 max-h-32 overflow-y-auto rounded-md border bg-muted/40 p-2 text-xs">
                  {scannedProfiles.map((profile) => (
                    <div className="truncate py-1 text-muted-foreground" key={profile}>
                      {profile}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <Button disabled={isProcessing} onClick={onClose} variant="outline">
                Cancel
              </Button>
              <Button
                disabled={scannedProfiles.length === 0 || isProcessing}
                onClick={handleImportScanned}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                Import {scannedProfiles.length}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
