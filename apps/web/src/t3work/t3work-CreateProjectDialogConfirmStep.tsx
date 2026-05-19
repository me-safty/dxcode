import { Loader2 } from "lucide-react";
import type { ExternalProject } from "@t3tools/integrations-core";
import { GitHubRepositoryDiscoverySection } from "~/t3work/components/t3work-GitHubRepositoryDiscoverySection";
import { LinkedRepositoryListEditor } from "~/t3work/components/t3work-LinkedRepositoryListEditor";

export function ConfirmStep({
  selectedProject,
  linkedRepositoryUrls,
  discoveredRepositoryUrls,
  newRepositoryUrl,
  setNewRepositoryUrl,
  onAddRepository,
  onRemoveRepository,
  onAddRepositories,
  onDiscoveredRepositoryUrlsChange,
}: {
  selectedProject: ExternalProject | null;
  linkedRepositoryUrls: ReadonlyArray<string>;
  discoveredRepositoryUrls: ReadonlyArray<string>;
  newRepositoryUrl: string;
  setNewRepositoryUrl: (value: string) => void;
  onAddRepository: () => void;
  onRemoveRepository: (url: string) => void;
  onAddRepositories: (urls: ReadonlyArray<string>) => void;
  onDiscoveredRepositoryUrlsChange: (urls: ReadonlyArray<string>) => void;
}) {
  return (
    <section className="space-y-3">
      <GitHubRepositoryDiscoverySection
        enabled={Boolean(selectedProject)}
        projectKey={selectedProject?.key ?? undefined}
        projectTitle={selectedProject?.title ?? undefined}
        linkedRepositoryUrls={linkedRepositoryUrls}
        onAddSuggestedUrls={onAddRepositories}
        onVisibleSuggestionsChange={onDiscoveredRepositoryUrlsChange}
      />
      <LinkedRepositoryListEditor
        repositoryUrls={linkedRepositoryUrls}
        newRepositoryUrl={newRepositoryUrl}
        setNewRepositoryUrl={setNewRepositoryUrl}
        onAddRepository={onAddRepository}
        onRemoveRepository={onRemoveRepository}
        onAddSearchableOption={(url) => onAddRepositories([url])}
        searchableRepositoryOptions={discoveredRepositoryUrls}
        emptyMessage="No linked repositories yet. Add GitHub or GHE repositories if you want agent context from code."
      />
    </section>
  );
}

export function CreatingStep({
  projectTitle,
  repositoryCount,
}: {
  projectTitle: string | undefined;
  repositoryCount: number;
}) {
  const title = projectTitle ?? "project";
  return (
    <section className="flex min-h-[18rem] items-center justify-center px-2 py-6 sm:min-h-[22rem]">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-border bg-card px-6 py-7 shadow-sm">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/20 via-primary to-primary/20" />
        <div className="flex flex-col items-center text-center">
          <div className="mb-5 flex size-14 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
            <Loader2 className="size-6 animate-spin" />
          </div>
          <h3 className="text-base font-semibold">Creating {title}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            We&apos;re provisioning the workspace, wiring up project metadata, and bootstrapping the
            selected repositories.
          </p>
        </div>

        <div className="mt-6 space-y-3 text-left">
          {[
            "Preparing the managed workspace",
            repositoryCount > 0
              ? `Linking ${repositoryCount} repository${repositoryCount === 1 ? "" : "ies"}`
              : "No repositories selected yet",
            "Finalizing the project shell",
          ].map((label) => (
            <div
              key={label}
              className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2"
            >
              <span className="flex size-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <span className="size-2.5 rounded-full bg-current" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium">{label}</div>
                <div className="text-xs text-muted-foreground">In progress</div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 rounded-lg border border-dashed border-border/80 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          This usually takes a few seconds. Keep this window open while the project is created.
        </div>
      </div>
    </section>
  );
}
