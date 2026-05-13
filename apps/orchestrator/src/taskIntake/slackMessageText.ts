const CHATGPT_ATTRIBUTION_PATTERN = /^\s*(?:(?:[*_])?Sent using(?:[*_])?\s+)?ChatGPT\s*$/i;
const CHATGPT_ATTRIBUTION_SUFFIX_PATTERN = /\s+(?:[*_])?Sent using(?:[*_])?\s+ChatGPT\s*$/i;

export function stripSlackClientAttribution(text: string) {
  return text
    .split(/\r?\n/)
    .filter((line) => !CHATGPT_ATTRIBUTION_PATTERN.test(line))
    .join("\n")
    .replace(CHATGPT_ATTRIBUTION_SUFFIX_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
