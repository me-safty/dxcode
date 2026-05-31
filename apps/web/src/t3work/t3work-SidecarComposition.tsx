import { useMemo, type ReactNode } from "react";
import {
  resolveSidecarComposition,
  type RecipeSurface,
  type SidecarComposition,
} from "@t3tools/project-recipes";
import {
  DEFAULT_SIDECAR_COMPOSITION,
  getT3WorkProfile,
  listBundledSidecarSections,
} from "@t3tools/t3work-skill-packs";

import { useT3workSidecarComposition } from "~/t3work/hooks/t3work-useSidecarComposition";
import type { SidecarSectionHost } from "~/t3work/t3work-sidecarSectionHost";
import { useRunT3workDeterministicWorkflowLaunch } from "~/t3work/t3work-inlineRecipeLaunch";
import { T3workSidecarSectionInstance } from "~/t3work/t3work-sidecarSectionInstance";

type T3workSidecarCompositionProps = {
  readonly surface: RecipeSurface;
  readonly profileId?: string | undefined;
  readonly projectDefault?: SidecarComposition | undefined;
  readonly host: SidecarSectionHost;
  readonly resolveSectionProps?: ((sectionId: string) => unknown) | undefined;
  readonly emptyState?: ReactNode;
};

export function T3workSidecarComposition({
  surface,
  profileId,
  projectDefault,
  host,
  resolveSectionProps,
  emptyState,
}: T3workSidecarCompositionProps) {
  const profileDefault = getT3WorkProfile(profileId).sidecarSections;
  const bundledSectionsById = useMemo(
    () => new Map(listBundledSidecarSections().map((section) => [section.id, section])),
    [],
  );
  const defaultComposition = useMemo(
    () =>
      resolveSidecarComposition({
        bundledDefault: DEFAULT_SIDECAR_COMPOSITION,
        profileDefault,
        projectDefault,
      }),
    [profileDefault, projectDefault],
  );
  const runWorkflowLaunch = useRunT3workDeterministicWorkflowLaunch();
  const {
    composition,
    setCollapsed,
    personalization,
    hideSection,
    moveSection,
    hideItem,
    pinItem,
    unpinItem,
  } = useT3workSidecarComposition({
    bundledDefault: DEFAULT_SIDECAR_COMPOSITION,
    profileDefault,
    projectDefault,
  });

  const visibleSections = composition.sections.flatMap((sectionState) => {
    const definition = bundledSectionsById.get(sectionState.sectionId);
    if (!definition || !definition.surfaces.includes(surface)) {
      return [];
    }

    return [{ definition, sectionState }];
  });

  return (
    <div className="space-y-5 p-4 sm:p-5">
      {visibleSections.length === 0
        ? (emptyState ?? (
            <p className="rounded-md border border-dashed border-border/60 bg-background/40 px-3 py-2 text-xs text-muted-foreground/70">
              No sidecar sections are available for this view.
            </p>
          ))
        : visibleSections.map(({ definition, sectionState }, index) => {
            return (
              <T3workSidecarSectionInstance
                key={definition.id}
                definition={definition}
                sectionState={sectionState}
                sectionIndex={index}
                totalVisibleSections={visibleSections.length}
                surface={surface}
                host={host}
                defaultComposition={defaultComposition}
                personalization={personalization}
                resolveSectionProps={resolveSectionProps}
                runWorkflowLaunch={runWorkflowLaunch}
                setCollapsed={setCollapsed}
                hideSection={hideSection}
                moveSection={moveSection}
                hideItem={hideItem}
                pinItem={pinItem}
                unpinItem={unpinItem}
              />
            );
          })}
    </div>
  );
}
