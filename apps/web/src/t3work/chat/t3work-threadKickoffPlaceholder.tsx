type ThreadKickoffPlaceholderProps = {
  message: string;
};

export function shouldShowThreadKickoffPlaceholder(input: {
  kickoffMessage: string | undefined;
  serverMessageCount: number | null;
}): boolean {
  if (!input.kickoffMessage?.trim()) {
    return false;
  }

  return (input.serverMessageCount ?? 0) === 0;
}

export function ThreadKickoffPlaceholder({ message }: ThreadKickoffPlaceholderProps) {
  return (
    <div className="border-b border-border/60 bg-muted/20 px-4 py-3 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          Kickoff queued locally
        </p>
        <div className="mt-2 rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-sm">
          <p className="whitespace-pre-wrap text-sm leading-6 text-foreground">{message}</p>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          Showing the local kickoff prompt until the live thread receives its first message.
        </p>
      </div>
    </div>
  );
}
