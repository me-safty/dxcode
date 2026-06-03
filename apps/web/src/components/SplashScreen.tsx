export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-3">
        <div
          className="flex size-24 items-center justify-center"
          aria-label="Neuropharm Research splash screen"
        >
          <img
            alt="Neuropharm Research"
            className="size-16 object-contain"
            src="/apple-touch-icon.png"
          />
        </div>
        <div className="text-sm text-muted-foreground">Neuropharm Research</div>
      </div>
    </div>
  );
}
