"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "~/components/ui/dialog";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { ensureNativeApi } from "~/nativeApi";
import type { GitStatusResult, ProjectId, ThreadId } from "@t3tools/contracts";

interface PRCreationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: ProjectId;
  threadId: ThreadId;
  ticketKey?: string;
  workspaceRoot: string;
}

type Step = "review" | "create" | "jira";

export function PRCreationModal({
  open,
  onOpenChange,
  projectId,
  threadId,
  ticketKey,
  workspaceRoot,
}: PRCreationModalProps) {
  const [step, setStep] = useState<Step>("review");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [baseBranch, setBaseBranch] = useState("main");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [jiraComment, setJiraComment] = useState("");
  const [jiraPosted, setJiraPosted] = useState(false);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStep("review");
      setTitle(ticketKey ? `${ticketKey}: ` : "");
      setBody("");
      setBaseBranch("main");
      setLoading(false);
      setError(null);
      setGitStatus(null);
      setJiraComment("");
      setJiraPosted(false);
    }
  }, [open, ticketKey]);

  // Fetch git status when review step is active
  useEffect(() => {
    if (!open || step !== "review") return;
    let cancelled = false;

    async function fetchStatus() {
      try {
        setLoading(true);
        setError(null);
        const api = ensureNativeApi();
        const status = await api.git.status({ cwd: workspaceRoot });
        if (!cancelled) {
          setGitStatus(status);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to fetch git status");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchStatus();
    return () => {
      cancelled = true;
    };
  }, [open, step, workspaceRoot]);

  const handleCreatePR = useCallback(async () => {
    if (!title.trim()) {
      setError("PR title is required");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const api = ensureNativeApi();
      // Escape double quotes in title and body for the shell command
      const escapedTitle = title.replace(/"/g, '\\"');
      const escapedBody = body.replace(/"/g, '\\"');
      const command = `gh pr create --title "${escapedTitle}" --body "${escapedBody}" --base ${baseBranch}\n`;

      await api.terminal.write({
        threadId,
        data: command,
      });

      // Pre-fill Jira comment if ticket key is available
      if (ticketKey) {
        setJiraComment(
          `Pull request created for branch ${gitStatus?.branch ?? "unknown"}:\n\nTitle: ${title}\nBase: ${baseBranch}`,
        );
        setStep("jira");
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create pull request");
    } finally {
      setLoading(false);
    }
  }, [title, body, baseBranch, threadId, ticketKey, gitStatus?.branch, onOpenChange]);

  const handlePostJiraComment = useCallback(async () => {
    if (!ticketKey || !jiraComment.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const api = ensureNativeApi();
      await api.jira.postComment({
        ticketKey,
        body: jiraComment,
      });
      setJiraPosted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post Jira comment");
    } finally {
      setLoading(false);
    }
  }, [ticketKey, jiraComment]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {step === "review" && "Review Changes"}
            {step === "create" && "Create Pull Request"}
            {step === "jira" && "Post to Jira"}
          </DialogTitle>
          <DialogDescription>
            {step === "review" && "Review your current branch and changes before creating a PR."}
            {step === "create" && "Fill in the pull request details."}
            {step === "jira" && `Post a comment to ${ticketKey} about this PR.`}
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          {/* Step 1: Review */}
          {step === "review" && (
            <div className="flex flex-col gap-4">
              {loading && !gitStatus && (
                <p className="text-sm text-muted-foreground">Loading git status...</p>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}

              {gitStatus && (
                <>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Branch
                    </span>
                    <span className="font-mono text-sm">{gitStatus.branch ?? "detached HEAD"}</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Upstream
                    </span>
                    <span className="text-sm">
                      {gitStatus.hasUpstream
                        ? `${gitStatus.aheadCount} ahead, ${gitStatus.behindCount} behind`
                        : "No upstream branch"}
                    </span>
                  </div>

                  {gitStatus.pr && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Existing PR
                      </span>
                      <span className="text-sm">
                        #{gitStatus.pr.number} {gitStatus.pr.title} ({gitStatus.pr.state})
                      </span>
                    </div>
                  )}

                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      Diff Summary
                    </span>
                    <span className="text-sm">
                      {gitStatus.workingTree.files.length} file
                      {gitStatus.workingTree.files.length !== 1 ? "s" : ""} changed
                      {gitStatus.workingTree.insertions > 0 &&
                        `, +${gitStatus.workingTree.insertions}`}
                      {gitStatus.workingTree.deletions > 0 &&
                        `, -${gitStatus.workingTree.deletions}`}
                    </span>
                  </div>

                  {gitStatus.workingTree.files.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                        Changed Files
                      </span>
                      <ul className="max-h-48 overflow-y-auto rounded-md border bg-muted/50 p-2 text-xs font-mono">
                        {gitStatus.workingTree.files.map((file) => (
                          <li
                            key={file.path}
                            className="flex items-center justify-between py-0.5"
                          >
                            <span className="truncate">{file.path}</span>
                            <span className="ml-2 shrink-0 text-muted-foreground">
                              {file.insertions > 0 && (
                                <span className="text-green-600">+{file.insertions}</span>
                              )}
                              {file.deletions > 0 && (
                                <span className="ml-1 text-red-600">-{file.deletions}</span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 2: Create PR */}
          {step === "create" && (
            <div className="flex flex-col gap-4">
              {error && <p className="text-sm text-destructive">{error}</p>}

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pr-title" className="text-sm font-medium">
                  Title
                </label>
                <Input
                  id="pr-title"
                  value={title}
                  onChange={(e) => setTitle((e.target as HTMLInputElement).value)}
                  placeholder="PR title"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pr-body" className="text-sm font-medium">
                  Description
                </label>
                <Textarea
                  id="pr-body"
                  value={body}
                  onChange={(e) => setBody((e.target as HTMLTextAreaElement).value)}
                  placeholder="Describe your changes..."
                  rows={5}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="pr-base" className="text-sm font-medium">
                  Base Branch
                </label>
                <Input
                  id="pr-base"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch((e.target as HTMLInputElement).value)}
                  placeholder="main"
                />
              </div>
            </div>
          )}

          {/* Step 3: Jira */}
          {step === "jira" && ticketKey && (
            <div className="flex flex-col gap-4">
              {error && <p className="text-sm text-destructive">{error}</p>}

              {jiraPosted ? (
                <p className="text-sm text-green-600">
                  Comment posted to {ticketKey} successfully.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="jira-comment" className="text-sm font-medium">
                    Comment for {ticketKey}
                  </label>
                  <Textarea
                    id="jira-comment"
                    value={jiraComment}
                    onChange={(e) => setJiraComment((e.target as HTMLTextAreaElement).value)}
                    placeholder="Comment to post on the Jira ticket..."
                    rows={4}
                  />
                </div>
              )}
            </div>
          )}
        </DialogPanel>

        <DialogFooter>
          {step === "review" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={loading || !gitStatus}
                onClick={() => {
                  setError(null);
                  setStep("create");
                }}
              >
                Next
              </Button>
            </>
          )}

          {step === "create" && (
            <>
              <Button
                variant="outline"
                disabled={loading}
                onClick={() => {
                  setError(null);
                  setStep("review");
                }}
              >
                Back
              </Button>
              <Button disabled={loading || !title.trim()} onClick={() => void handleCreatePR()}>
                {loading ? "Creating..." : "Create PR"}
              </Button>
            </>
          )}

          {step === "jira" && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {jiraPosted ? "Done" : "Skip"}
              </Button>
              {!jiraPosted && (
                <Button
                  disabled={loading || !jiraComment.trim()}
                  onClick={() => void handlePostJiraComment()}
                >
                  {loading ? "Posting..." : "Post Comment"}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
