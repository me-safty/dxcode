import { useCallback, useMemo } from "react";

import { resolveSidecarComposition, type SidecarComposition } from "@t3tools/project-recipes";

import { useServerConfig } from "~/rpc/serverState";
import {
  persistStoredSidecarComposition,
  readStoredSidecarCompositionFromServerSettings,
} from "~/t3work/hooks/t3work-sidecarCompositionPersistence";

const EMPTY_SIDECAR_COMPOSITION: SidecarComposition = { sections: [] };

export function useT3workSidecarComposition(input: {
  bundledDefault: SidecarComposition;
  profileDefault?: SidecarComposition | undefined;
  projectDefault?: SidecarComposition | undefined;
}) {
  const serverConfig = useServerConfig();
  const userOverrides = useMemo(
    () => readStoredSidecarCompositionFromServerSettings(serverConfig?.settings),
    [serverConfig?.settings.t3workStoredSidecarCompositionJson],
  );
  const composition = useMemo(
    () =>
      resolveSidecarComposition({
        bundledDefault: input.bundledDefault,
        profileDefault: input.profileDefault,
        projectDefault: input.projectDefault,
        userOverrides,
      }),
    [input.bundledDefault, input.profileDefault, input.projectDefault, userOverrides],
  );

  const setCollapsed = useCallback(
    (sectionId: string, collapsed: boolean) => {
      const baseComposition =
        userOverrides.sections.length > 0
          ? userOverrides
          : composition.sections.length > 0
            ? composition
            : EMPTY_SIDECAR_COMPOSITION;
      const nextSections = baseComposition.sections.some(
        (section) => section.sectionId === sectionId,
      )
        ? baseComposition.sections.map((section) =>
            section.sectionId === sectionId ? { ...section, collapsed } : section,
          )
        : [...baseComposition.sections, { sectionId, collapsed }];

      persistStoredSidecarComposition({ sections: nextSections });
    },
    [composition, userOverrides],
  );

  return { composition, setCollapsed, userOverrides };
}
