export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-2 font-mono" aria-label="Mognet splash screen">
        <span className="text-2xl font-medium leading-none text-primary">~ $</span>
        <span className="text-[11px] font-medium tracking-[0.08em] text-muted-foreground">
          mognet
        </span>
      </div>
    </div>
  );
}
