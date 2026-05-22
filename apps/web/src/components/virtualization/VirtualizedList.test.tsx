import { createRef, type Key, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
  latestProps: null as MockVirtuosoProps | null,
}));

interface MockVirtuosoProps {
  readonly data?: readonly string[];
  readonly computeItemKey?: (index: number, item: string) => Key;
  readonly itemContent?: (index: number, item: string) => ReactNode;
  readonly components?: {
    readonly Header?: () => ReactNode;
    readonly Footer?: () => ReactNode;
  };
  readonly followOutput?: (isAtBottom: boolean) => "auto" | "smooth" | false;
  readonly atBottomStateChange?: (isAtEnd: boolean) => void;
  readonly endReached?: (index: number) => void;
  readonly initialTopMostItemIndex?: unknown;
  readonly defaultItemHeight?: number;
  readonly increaseViewportBy?: unknown;
  readonly minOverscanItemCount?: unknown;
  readonly "data-testid"?: string;
}

vi.mock("react-virtuoso", () => ({
  Virtuoso: (props: MockVirtuosoProps) => {
    mockState.latestProps = props;
    const Header = props.components?.Header;
    const Footer = props.components?.Footer;
    return (
      <div data-testid={props["data-testid"]}>
        {Header ? <Header /> : null}
        {props.data?.map((item, index) => {
          const key = props.computeItemKey?.(index, item) ?? index;
          return (
            <div data-key={String(key)} key={String(key)}>
              {props.itemContent?.(index, item)}
            </div>
          );
        })}
        {Footer ? <Footer /> : null}
      </div>
    );
  },
}));

import {
  VirtualizedList,
  type VirtualizedListHandle,
  createVirtualizedListHandle,
  getVirtualizedListInitialTopMostItemIndex,
  resolveVirtualizedListFollowOutput,
} from "./VirtualizedList";

function getLatestVirtuosoProps(): MockVirtuosoProps {
  if (!mockState.latestProps) {
    throw new Error("Virtuoso was not rendered.");
  }
  return mockState.latestProps;
}

describe("VirtualizedList", () => {
  it("renders header, footer, and item content with stable keys", () => {
    const markup = renderToStaticMarkup(
      <VirtualizedList
        data={["alpha", "beta"]}
        keyExtractor={(item) => `item-${item}`}
        renderItem={({ item, index }) => `${index}:${item}`}
        ListHeaderComponent={<div>Header</div>}
        ListFooterComponent={<div>Footer</div>}
        data-testid="list"
      />,
    );

    expect(markup).toContain("Header");
    expect(markup).toContain("0:alpha");
    expect(markup).toContain("1:beta");
    expect(markup).toContain("Footer");
    expect(markup).toContain('data-key="item-alpha"');
    expect(markup).toContain('data-key="item-beta"');
  });

  it("maps initialScrollAtEnd to the last item index when data is present", () => {
    renderToStaticMarkup(
      <VirtualizedList
        data={["alpha"]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => item}
        initialScrollAtEnd
      />,
    );

    expect(getLatestVirtuosoProps().initialTopMostItemIndex).toEqual({
      index: "LAST",
      align: "end",
    });
    expect(getVirtualizedListInitialTopMostItemIndex(true, 0)).toBeUndefined();
  });

  it("maps animated maintainScrollAtEnd to smooth followOutput only at bottom", () => {
    renderToStaticMarkup(
      <VirtualizedList
        data={["alpha"]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => item}
        maintainScrollAtEnd={{ animated: true }}
      />,
    );

    const followOutput = getLatestVirtuosoProps().followOutput;
    expect(followOutput?.(true)).toBe("smooth");
    expect(followOutput?.(false)).toBe(false);
    expect(resolveVirtualizedListFollowOutput(true, true)).toBe("auto");
  });

  it("updates at-end state through the imperative handle state source", () => {
    const onIsAtEndChange = vi.fn();
    renderToStaticMarkup(
      <VirtualizedList
        data={["alpha"]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => item}
        onIsAtEndChange={onIsAtEndChange}
      />,
    );

    getLatestVirtuosoProps().atBottomStateChange?.(true);
    expect(onIsAtEndChange).toHaveBeenCalledWith(true);

    const isAtEndRef = { current: false };
    const handle = createVirtualizedListHandle({
      virtuosoRef: { current: null },
      scrollableNodeRef: { current: null },
      isAtEndRef,
    });
    expect(handle.getState()).toEqual({ isAtEnd: false });
    isAtEndRef.current = true;
    expect(handle.getState()).toEqual({ isAtEnd: true });
  });

  it("maps imperative methods to Virtuoso scroll methods", () => {
    const scrollToIndex = vi.fn();
    const scrollTo = vi.fn();
    const scrollIntoView = vi.fn();
    const scrollableNode = {} as HTMLElement;
    const handle = createVirtualizedListHandle({
      virtuosoRef: {
        current: {
          scrollToIndex,
          scrollTo,
          scrollIntoView,
        },
      },
      scrollableNodeRef: { current: scrollableNode },
      isAtEndRef: { current: true },
    });

    expect(handle.getScrollableNode()).toBe(scrollableNode);

    handle.scrollToEnd({ animated: false });
    handle.scrollToEnd({ animated: true });
    handle.scrollToOffset({ offset: 0, animated: false });
    handle.scrollIndexIntoView({ index: 10, animated: false });

    expect(scrollToIndex).toHaveBeenNthCalledWith(1, {
      index: "LAST",
      align: "end",
      behavior: "auto",
    });
    expect(scrollToIndex).toHaveBeenNthCalledWith(2, {
      index: "LAST",
      align: "end",
      behavior: "smooth",
    });
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    expect(scrollIntoView).toHaveBeenCalledWith({ index: 10, behavior: "auto" });
  });

  it("calls onEndReached when Virtuoso reports the end", () => {
    const onEndReached = vi.fn();
    renderToStaticMarkup(
      <VirtualizedList
        data={["alpha"]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => item}
        onEndReached={onEndReached}
      />,
    );

    getLatestVirtuosoProps().endReached?.(0);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it("accepts refs with the public handle type", () => {
    const ref = createRef<VirtualizedListHandle | null>();

    renderToStaticMarkup(
      <VirtualizedList
        ref={ref}
        data={["alpha"]}
        keyExtractor={(item) => item}
        renderItem={({ item }) => item}
      />,
    );

    expect(ref.current).toBeNull();
  });
});
