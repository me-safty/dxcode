import { APP_DISPLAY_NAME } from "../branding";

export function StartupPendingSurface(props?: {
  readonly title?: string;
  readonly detail?: string;
}) {
  const title = props?.title ?? "Starting T3 Code";
  const detail =
    props?.detail ?? "Preparing the local workspace and connecting to the desktop runtime.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-8 py-10 text-foreground">
      <section className="w-full max-w-[30rem] rounded-lg border border-border/80 bg-card/95 p-7 shadow-2xl shadow-black/10 backdrop-blur-md sm:p-8">
        <p className="mb-2.5 text-[11px] font-semibold tracking-[0.16em] text-muted-foreground uppercase">
          {APP_DISPLAY_NAME}
        </p>
        <h1 className="text-[2.75rem] leading-none font-semibold tracking-tight text-foreground sm:text-[3.25rem]">
          {title}
        </h1>
        <p className="mt-[1.125rem] max-w-xl text-base leading-[1.55] text-muted-foreground">
          {detail}
        </p>
        <div className="mt-[1.375rem] inline-flex items-center gap-2.5 text-sm font-semibold text-foreground/90">
          <span className="size-2.5 rounded-full bg-[linear-gradient(135deg,#2563eb,#10b981)]" />
          <span>Launching local environment</span>
        </div>
      </section>
    </div>
  );
}
