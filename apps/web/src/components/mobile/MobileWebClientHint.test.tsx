import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MobileWebClientHint } from "./MobileWebClientHint";

describe("MobileWebClientHint", () => {
  it("renders live dev guidance when proxied to Vite", () => {
    const markup = renderToStaticMarkup(<MobileWebClientHint webClient="vite-dev-proxy" />);
    expect(markup).toContain("mobile-access-live-dev-hint");
    expect(markup).toContain("refresh on your phone");
  });

  it("renders production build guidance for static bundles", () => {
    const markup = renderToStaticMarkup(<MobileWebClientHint webClient="static-bundle" />);
    expect(markup).toContain("mobile-access-static-bundle-hint");
    expect(markup).toContain("bun run build");
  });

  it("renders nothing when webClient is unknown", () => {
    const markup = renderToStaticMarkup(<MobileWebClientHint webClient={undefined} />);
    expect(markup).toBe("");
  });
});
