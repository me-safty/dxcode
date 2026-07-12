import { fromMarkdown } from "mdast-util-from-markdown";

interface MarkdownNode {
  readonly type: string;
  readonly url?: string;
  readonly children?: ReadonlyArray<MarkdownNode>;
}

export function markdownLinkDestinations(markdown: string): ReadonlyArray<string> {
  const destinations: Array<string> = [];
  const visit = (node: MarkdownNode): void => {
    if (node.type === "link" && typeof node.url === "string") {
      destinations.push(node.url);
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(fromMarkdown(markdown));
  return destinations;
}
