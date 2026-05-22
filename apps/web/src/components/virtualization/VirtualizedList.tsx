import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  type CSSProperties,
  type ForwardedRef,
  type Key,
  type ReactElement,
  type ReactNode,
  type RefAttributes,
} from "react";
import {
  Virtuoso,
  type Components as VirtuosoComponents,
  type VirtuosoHandle,
} from "react-virtuoso";

type VirtualizedListFollowOutput = "auto" | "smooth" | false;
type VirtualizedListInitialIndex = { readonly index: "LAST"; readonly align: "end" };
type VirtualizedListScrollBehavior = "auto" | "smooth";
type RefBox<T> = { current: T };
type VirtualizedListImperativeTarget = Pick<
  VirtuosoHandle,
  "scrollIntoView" | "scrollTo" | "scrollToIndex"
>;

export interface VirtualizedListState {
  readonly isAtEnd: boolean;
}

export interface VirtualizedListHandle {
  getScrollableNode(): HTMLElement | null;
  getState(): VirtualizedListState;
  scrollToEnd(options?: { animated?: boolean }): void;
  scrollToOffset(options: { offset: number; animated?: boolean }): void;
  scrollIndexIntoView(options: { index: number; animated?: boolean }): void;
}

export interface VirtualizedListProps<T> {
  readonly data: readonly T[];
  readonly keyExtractor: (item: T, index: number) => Key;
  readonly renderItem: (args: { item: T; index: number }) => ReactNode;
  readonly estimatedItemSize?: number;
  readonly initialScrollAtEnd?: boolean;
  readonly maintainScrollAtEnd?: boolean | { animated?: boolean };
  readonly maintainScrollAtEndThreshold?: number;
  readonly onIsAtEndChange?: (isAtEnd: boolean) => void;
  readonly onEndReached?: () => void;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly ListHeaderComponent?: ReactNode;
  readonly ListFooterComponent?: ReactNode;
  readonly increaseViewportBy?: number | { top: number; bottom: number };
  readonly minOverscanItemCount?: number | { top: number; bottom: number };
  readonly "data-testid"?: string;
}

export function resolveVirtualizedListFollowOutput(
  maintainScrollAtEnd: boolean | { animated?: boolean },
  isAtBottom: boolean,
): VirtualizedListFollowOutput {
  if (!isAtBottom || !maintainScrollAtEnd) {
    return false;
  }
  if (typeof maintainScrollAtEnd === "object" && maintainScrollAtEnd.animated) {
    return "smooth";
  }
  return "auto";
}

export function getVirtualizedListInitialTopMostItemIndex(
  initialScrollAtEnd: boolean,
  itemCount: number,
): VirtualizedListInitialIndex | undefined {
  return initialScrollAtEnd && itemCount > 0 ? { index: "LAST", align: "end" } : undefined;
}

export function getVirtualizedListScrollBehavior(
  animated?: boolean,
): VirtualizedListScrollBehavior {
  return animated ? "smooth" : "auto";
}

export function createVirtualizedListHandle({
  virtuosoRef,
  scrollableNodeRef,
  isAtEndRef,
}: {
  readonly virtuosoRef: RefBox<VirtualizedListImperativeTarget | null>;
  readonly scrollableNodeRef: RefBox<HTMLElement | null>;
  readonly isAtEndRef: RefBox<boolean>;
}): VirtualizedListHandle {
  return {
    getScrollableNode: () => scrollableNodeRef.current,
    getState: () => ({ isAtEnd: isAtEndRef.current }),
    scrollToEnd: (options) => {
      virtuosoRef.current?.scrollToIndex({
        index: "LAST",
        align: "end",
        behavior: getVirtualizedListScrollBehavior(options?.animated),
      });
    },
    scrollToOffset: ({ offset, animated }) => {
      virtuosoRef.current?.scrollTo({
        top: offset,
        behavior: getVirtualizedListScrollBehavior(animated),
      });
    },
    scrollIndexIntoView: ({ index, animated }) => {
      virtuosoRef.current?.scrollIntoView({
        index,
        behavior: getVirtualizedListScrollBehavior(animated),
      });
    },
  };
}

function VirtualizedListInner<T>(
  {
    data,
    keyExtractor,
    renderItem,
    estimatedItemSize,
    initialScrollAtEnd = false,
    maintainScrollAtEnd = false,
    maintainScrollAtEndThreshold,
    onIsAtEndChange,
    onEndReached,
    className,
    style,
    ListHeaderComponent,
    ListFooterComponent,
    increaseViewportBy,
    minOverscanItemCount,
    "data-testid": dataTestId,
  }: VirtualizedListProps<T>,
  ref: ForwardedRef<VirtualizedListHandle>,
) {
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollableNodeRef = useRef<HTMLElement | null>(null);
  const isAtEndRef = useRef(initialScrollAtEnd || data.length === 0);

  const followOutput = useCallback(
    (isAtBottom: boolean) => {
      isAtEndRef.current = isAtBottom;
      return resolveVirtualizedListFollowOutput(maintainScrollAtEnd, isAtBottom);
    },
    [maintainScrollAtEnd],
  );

  const handleAtBottomStateChange = useCallback(
    (isAtEnd: boolean) => {
      isAtEndRef.current = isAtEnd;
      onIsAtEndChange?.(isAtEnd);
    },
    [onIsAtEndChange],
  );

  const setScrollerRef = useCallback((node: HTMLElement | Window | null) => {
    scrollableNodeRef.current = node instanceof HTMLElement ? node : null;
  }, []);

  useImperativeHandle(
    ref,
    () =>
      createVirtualizedListHandle({
        virtuosoRef,
        scrollableNodeRef,
        isAtEndRef,
      }),
    [],
  );

  const components = useMemo<VirtuosoComponents<T>>(() => {
    const nextComponents: VirtuosoComponents<T> = {};
    if (ListHeaderComponent) {
      nextComponents.Header = function Header() {
        return <>{ListHeaderComponent}</>;
      };
    }
    if (ListFooterComponent) {
      nextComponents.Footer = function Footer() {
        return <>{ListFooterComponent}</>;
      };
    }
    return nextComponents;
  }, [ListFooterComponent, ListHeaderComponent]);
  const initialTopMostItemIndex = getVirtualizedListInitialTopMostItemIndex(
    initialScrollAtEnd,
    data.length,
  );

  return (
    <Virtuoso<T>
      ref={virtuosoRef}
      data={data}
      computeItemKey={(index, item) => keyExtractor(item, index)}
      itemContent={(index, item) => renderItem({ item, index })}
      followOutput={followOutput}
      atBottomStateChange={handleAtBottomStateChange}
      className={className}
      style={style}
      components={components}
      scrollerRef={setScrollerRef}
      {...(initialTopMostItemIndex !== undefined ? { initialTopMostItemIndex } : {})}
      {...(onEndReached ? { endReached: () => onEndReached() } : {})}
      {...(dataTestId !== undefined ? { "data-testid": dataTestId } : {})}
      {...(estimatedItemSize !== undefined ? { defaultItemHeight: estimatedItemSize } : {})}
      {...(maintainScrollAtEndThreshold !== undefined
        ? { atBottomThreshold: maintainScrollAtEndThreshold }
        : {})}
      {...(increaseViewportBy !== undefined ? { increaseViewportBy } : {})}
      {...(minOverscanItemCount !== undefined ? { minOverscanItemCount } : {})}
    />
  );
}

export const VirtualizedList = forwardRef(VirtualizedListInner) as <T>(
  props: VirtualizedListProps<T> & RefAttributes<VirtualizedListHandle>,
) => ReactElement;
