import * as Schema from "effect/Schema";

export const SidecarCompositionSection = Schema.Struct({
  sectionId: Schema.String,
  visible: Schema.optional(Schema.Boolean),
  collapsed: Schema.optional(Schema.Boolean),
});
export type SidecarCompositionSection = typeof SidecarCompositionSection.Type;

export const SidecarComposition = Schema.Struct({
  sections: Schema.Array(SidecarCompositionSection),
});
export type SidecarComposition = typeof SidecarComposition.Type;

const SidecarItemIdsBySection = Schema.Record(Schema.String, Schema.Array(Schema.String));

export const SidecarPersonalization = Schema.Struct({
  composition: Schema.optional(SidecarComposition),
  itemHides: Schema.optional(SidecarItemIdsBySection),
  itemPins: Schema.optional(SidecarItemIdsBySection),
  itemOrderOverrides: Schema.optional(SidecarItemIdsBySection),
});
export type SidecarPersonalization = typeof SidecarPersonalization.Type;

export type SidecarSectionItemPersonalization = {
  readonly hiddenItemIds: ReadonlyArray<string>;
  readonly pinnedItemIds: ReadonlyArray<string>;
  readonly orderOverrideItemIds: ReadonlyArray<string>;
};

const EMPTY_ITEM_IDS: ReadonlyArray<string> = [];

function normalizeSections(
  sections: ReadonlyArray<SidecarCompositionSection>,
): SidecarComposition["sections"] {
  const normalized = new Map<string, SidecarCompositionSection>();

  for (const section of sections) {
    if (normalized.has(section.sectionId)) {
      normalized.delete(section.sectionId);
    }
    normalized.set(section.sectionId, section);
  }

  return [...normalized.values()];
}

function normalizeItemIds(itemIds: ReadonlyArray<string>): ReadonlyArray<string> {
  const normalized = new Map<string, string>();

  for (const itemId of itemIds) {
    if (normalized.has(itemId)) {
      normalized.delete(itemId);
    }
    normalized.set(itemId, itemId);
  }

  return [...normalized.keys()];
}

function readSectionItemIds(
  idsBySection: Readonly<Record<string, ReadonlyArray<string>>> | undefined,
  sectionId: string,
): ReadonlyArray<string> {
  return normalizeItemIds(idsBySection?.[sectionId] ?? EMPTY_ITEM_IDS);
}

function applyCompositionLayer(
  base: SidecarComposition,
  override: SidecarComposition,
): SidecarComposition {
  const normalizedBase = normalizeSections(base.sections);
  const normalizedOverride = normalizeSections(override.sections);
  const baseMap = new Map(normalizedBase.map((section) => [section.sectionId, section]));
  const overrideMap = new Map(normalizedOverride.map((section) => [section.sectionId, section]));
  const orderedSectionIds = [
    ...normalizedOverride.map((section) => section.sectionId),
    ...normalizedBase
      .map((section) => section.sectionId)
      .filter((sectionId) => !overrideMap.has(sectionId)),
  ];

  return {
    sections: orderedSectionIds.map((sectionId) => {
      const baseSection = baseMap.get(sectionId);
      const overrideSection = overrideMap.get(sectionId);

      return {
        sectionId,
        ...(baseSection?.visible !== undefined ? { visible: baseSection.visible } : {}),
        ...(baseSection?.collapsed !== undefined ? { collapsed: baseSection.collapsed } : {}),
        ...(overrideSection?.visible !== undefined ? { visible: overrideSection.visible } : {}),
        ...(overrideSection?.collapsed !== undefined
          ? { collapsed: overrideSection.collapsed }
          : {}),
      };
    }),
  };
}

export function resolveSidecarComposition(input: {
  bundledDefault: SidecarComposition;
  profileDefault?: SidecarComposition | undefined;
  projectDefault?: SidecarComposition | undefined;
  userOverrides?: SidecarComposition | undefined;
}): SidecarComposition {
  const layeredComposition = [
    input.bundledDefault,
    input.profileDefault,
    input.projectDefault,
    input.userOverrides,
  ].reduce<SidecarComposition>(
    (current, nextLayer) => {
      if (!nextLayer) {
        return current;
      }

      return applyCompositionLayer(current, nextLayer);
    },
    { sections: [] },
  );

  return {
    sections: layeredComposition.sections.filter((section) => section.visible !== false),
  };
}

export function resolveSidecarSectionItemPersonalization(input: {
  readonly sectionId: string;
  readonly personalization?: SidecarPersonalization | undefined;
}): SidecarSectionItemPersonalization {
  return {
    hiddenItemIds: readSectionItemIds(input.personalization?.itemHides, input.sectionId),
    pinnedItemIds: readSectionItemIds(input.personalization?.itemPins, input.sectionId),
    orderOverrideItemIds: readSectionItemIds(
      input.personalization?.itemOrderOverrides,
      input.sectionId,
    ),
  };
}

export function isSidecarItemHidden(input: {
  readonly itemId: string;
  readonly personalization?: SidecarSectionItemPersonalization | undefined;
}): boolean {
  return (input.personalization?.hiddenItemIds ?? EMPTY_ITEM_IDS).includes(input.itemId);
}

export function isSidecarItemPinned(input: {
  readonly itemId: string;
  readonly personalization?: SidecarSectionItemPersonalization | undefined;
}): boolean {
  return (input.personalization?.pinnedItemIds ?? EMPTY_ITEM_IDS).includes(input.itemId);
}

export function resolveSidecarSectionItemOrder(input: {
  readonly itemIds: ReadonlyArray<string>;
  readonly personalization?: SidecarSectionItemPersonalization | undefined;
}): ReadonlyArray<string> {
  const naturalOrder = normalizeItemIds(input.itemIds);
  const visibleItemIds = new Set(naturalOrder);
  const orderOverrideItemIds = (
    input.personalization?.orderOverrideItemIds ?? EMPTY_ITEM_IDS
  ).filter((itemId) => visibleItemIds.has(itemId));
  const orderedItemIds = [
    ...orderOverrideItemIds,
    ...naturalOrder.filter((itemId) => !orderOverrideItemIds.includes(itemId)),
  ].filter((itemId) => !isSidecarItemHidden({ itemId, personalization: input.personalization }));

  const pinnedItemIds = orderedItemIds.filter((itemId) =>
    isSidecarItemPinned({ itemId, personalization: input.personalization }),
  );

  return [...pinnedItemIds, ...orderedItemIds.filter((itemId) => !pinnedItemIds.includes(itemId))];
}
