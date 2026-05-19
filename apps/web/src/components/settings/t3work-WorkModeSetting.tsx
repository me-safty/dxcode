import {
  useT3workWorkMode,
  writeT3workWorkMode,
  type T3workWorkMode,
} from "../../t3work/t3work-workMode";

export function T3workWorkModeSetting() {
  const workMode = useT3workWorkMode();

  const setMode = (mode: T3workWorkMode) => {
    writeT3workWorkMode(mode);
  };

  return (
    <div className="mb-8 space-y-4 rounded-xl border bg-card/50 p-4">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">Work mode</h3>
        <p className="text-sm text-muted-foreground">
          Choose your default experience. For Teams focuses on project and issue tracking.
        </p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label
          className={`relative flex cursor-pointer gap-3 rounded-lg border-2 p-5 transition-all ${
            workMode === "classic"
              ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
              : "border-border bg-card hover:border-blue-300 dark:hover:border-blue-600"
          }`}
        >
          <input
            type="radio"
            name="work-mode"
            value="classic"
            checked={workMode === "classic"}
            onChange={() => setMode("classic")}
            className="mt-1"
            aria-label="For Code"
          />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium">For Code</div>
            <div className="text-xs text-muted-foreground">
              Agent-first interface for coding and technical workflows.
            </div>
          </div>
        </label>

        <label
          className={`relative flex cursor-pointer gap-3 rounded-lg border-2 p-5 transition-all ${
            workMode === "t3work"
              ? "border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
              : "border-border bg-card hover:border-blue-300 dark:hover:border-blue-600"
          }`}
        >
          <input
            type="radio"
            name="work-mode"
            value="t3work"
            checked={workMode === "t3work"}
            onChange={() => setMode("t3work")}
            className="mt-1"
            aria-label="For Teams"
          />
          <div className="flex-1 space-y-1">
            <div className="text-sm font-medium">For Teams</div>
            <div className="text-xs text-muted-foreground">
              Project planning, issue tracking, and Jira-driven collaboration.
            </div>
          </div>
        </label>
      </div>
    </div>
  );
}
