export function OAuthCallbackPage() {
  return (
    <div className="flex h-dvh items-center justify-center bg-background text-foreground">
      <div className="text-center">
        <h1 className="text-lg font-semibold">Signing you in...</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          You can close this window if it does not close automatically.
        </p>
      </div>
    </div>
  );
}
