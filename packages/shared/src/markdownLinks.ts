export function markdownLinkDestinations(markdown: string): ReadonlyArray<string> {
  const destinations: Array<string> = [];
  let searchFrom = 0;
  while (searchFrom < markdown.length) {
    const destinationStart = markdown.indexOf("](", searchFrom);
    if (destinationStart < 0) break;
    let depth = 1;
    let escaped = false;
    let cursor = destinationStart + 2;
    const contentStart = cursor;
    for (; cursor < markdown.length; cursor += 1) {
      const character = markdown[cursor];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "(") {
        depth += 1;
        continue;
      }
      if (character !== ")") continue;
      depth -= 1;
      if (depth === 0) break;
    }
    if (depth === 0 && cursor > contentStart) {
      destinations.push(markdown.slice(contentStart, cursor));
      searchFrom = cursor + 1;
    } else {
      searchFrom = destinationStart + 2;
    }
  }
  return destinations;
}
