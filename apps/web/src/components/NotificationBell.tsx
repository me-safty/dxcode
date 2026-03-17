import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { ReviewRequest } from "@t3tools/contracts";
import { BellIcon, BotIcon, GitPullRequestIcon, XIcon } from "lucide-react";

import { Popover, PopoverTrigger, PopoverPopup } from "./ui/popover";
import { Tooltip, TooltipTrigger, TooltipPopup } from "./ui/tooltip";
import { reviewRequestListQueryOptions } from "../lib/gitReactQuery";
import { readNativeApi } from "../nativeApi";

type Filter = "reviews" | "bot" | "all";

interface NotificationBellProps {
  onStartReview: (prUrl: string, requestId: string) => void;
}

export default function NotificationBell({ onStartReview }: NotificationBellProps) {
  const [filter, setFilter] = useState<Filter>("reviews");
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const reviewRequestsQuery = useQuery(reviewRequestListQueryOptions());

  const requests = reviewRequestsQuery.data?.reviewRequests ?? [];

  // Badge only counts pending non-bot requests — bots don't trigger notifications
  const pendingCount = requests.filter((r) => r.status === "pending" && !r.isBot).length;

  const filteredRequests =
    filter === "all"
      ? requests
      : filter === "bot"
        ? requests.filter((r) => r.isBot)
        : requests.filter((r) => !r.isBot);

  const handleDismiss = async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    const api = readNativeApi();
    if (!api) return;
    await api.reviewRequest.dismiss({ id });
    await queryClient.invalidateQueries({ queryKey: ["reviewRequest"] });
  };

  const handleClick = (request: ReviewRequest) => {
    if (request.status === "in_review" && request.threadId) {
      void navigate({ to: "/$threadId", params: { threadId: request.threadId } });
    } else {
      onStartReview(request.prUrl, request.id);
    }
  };

  const botCount = requests.filter((r) => r.isBot).length;
  const reviewCount = requests.filter((r) => !r.isBot).length;

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              className="relative inline-flex size-7 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent hover:text-foreground"
              aria-label="Review requests"
            >
              <BellIcon className="size-3.5" />
              {pendingCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
                  {pendingCount > 9 ? "9+" : pendingCount}
                </span>
              )}
            </PopoverTrigger>
          }
        />
        <TooltipPopup side="bottom">Review requests</TooltipPopup>
      </Tooltip>

      <PopoverPopup side="bottom" align="end" sideOffset={8} className="w-80">
        <div className="-my-4 -mx-4">
          <div className="border-b border-border/50 px-3 py-2">
            <div className="flex items-center gap-1">
              <FilterTab
                active={filter === "reviews"}
                onClick={() => setFilter("reviews")}
                count={reviewCount}
              >
                Reviews
              </FilterTab>
              <FilterTab
                active={filter === "bot"}
                onClick={() => setFilter("bot")}
                count={botCount}
              >
                <BotIcon className="size-3" />
                Bot
              </FilterTab>
              <FilterTab
                active={filter === "all"}
                onClick={() => setFilter("all")}
                count={requests.length}
              >
                All
              </FilterTab>
            </div>
          </div>

          {filteredRequests.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground/60">
              {filter === "bot"
                ? "No bot PRs"
                : filter === "reviews"
                  ? "No review requests"
                  : "No review requests"}
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {filteredRequests.map((request) => (
                <button
                  key={request.id}
                  type="button"
                  className="group/item flex w-full items-start gap-2 border-b border-border/30 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent/50"
                  onClick={() => handleClick(request)}
                >
                  <GitPullRequestIcon
                    className={`mt-0.5 size-3.5 shrink-0 ${
                      request.status === "in_review" ? "text-violet-500" : "text-emerald-500"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-xs font-medium">
                        {request.repoNameWithOwner}#{request.prNumber}
                      </span>
                      {request.isBot && (
                        <BotIcon className="size-3 shrink-0 text-muted-foreground/50" />
                      )}
                      {request.status === "in_review" && (
                        <span className="shrink-0 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[9px] font-medium text-violet-500">
                          In Review
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                      {request.prTitle}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground/50">
                        by {request.authorLogin}
                      </span>
                      {request.status === "in_review" && (
                        <button
                          type="button"
                          className="rounded-md border border-border/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground/70 transition-colors hover:bg-secondary hover:text-foreground"
                          aria-label="Mark as done"
                          onClick={(event) => void handleDismiss(event, request.id)}
                        >
                          Done
                        </button>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground/40 opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover/item:opacity-100"
                    aria-label="Dismiss"
                    onClick={(event) => void handleDismiss(event, request.id)}
                  >
                    <XIcon className="size-3" />
                  </button>
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function FilterTab({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground/60 hover:text-muted-foreground"
      }`}
      onClick={onClick}
    >
      {children}
      {count > 0 && (
        <span
          className={`ml-0.5 text-[9px] ${active ? "text-foreground/70" : "text-muted-foreground/40"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
