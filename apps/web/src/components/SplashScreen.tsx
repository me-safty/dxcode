import { WorkbenchLogo } from "./Icons";

export function SplashScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex size-24 items-center justify-center" aria-label="Workbench splash screen">
        <WorkbenchLogo aria-label="Workbench" className="size-16 text-foreground" />
      </div>
    </div>
  );
}
