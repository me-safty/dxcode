import { describe, expect, it } from "vitest";

import {
  buildDefaultWsUrl,
  resolveHttpOriginFromWsUrl,
  resolveWsUrlFromSources,
} from "./connection";

describe("buildDefaultWsUrl", () => {
  it("uses wss for https pages and preserves host", () => {
    expect(
      buildDefaultWsUrl({
        pageProtocol: "https:",
        pageHost: "chat.example.com:443",
        pageHostname: "chat.example.com",
      }),
    ).toBe("wss://chat.example.com:443");
  });

  it("falls back to hostname when host is empty", () => {
    expect(
      buildDefaultWsUrl({
        pageProtocol: "http:",
        pageHost: "",
        pageHostname: "chat.example.com",
      }),
    ).toBe("ws://chat.example.com");
  });
});

describe("resolveWsUrlFromSources", () => {
  const defaultInput = {
    pageProtocol: "http:",
    pageHost: "localhost:3773",
    pageHostname: "localhost",
  };

  it("prefers explicit URL over desktop bridge and env values", () => {
    expect(
      resolveWsUrlFromSources({
        ...defaultInput,
        explicitUrl: "wss://explicit.example.com/socket",
        bridgeWsUrl: "wss://bridge.example.com/socket",
        envWsUrl: "wss://env.example.com/socket",
      }),
    ).toBe("wss://explicit.example.com/socket");
  });

  it("uses desktop bridge URL before env URL", () => {
    expect(
      resolveWsUrlFromSources({
        ...defaultInput,
        bridgeWsUrl: "wss://bridge.example.com/socket",
        envWsUrl: "wss://env.example.com/socket",
      }),
    ).toBe("wss://bridge.example.com/socket");
  });

  it("falls back to env URL when desktop bridge is unavailable", () => {
    expect(
      resolveWsUrlFromSources({
        ...defaultInput,
        envWsUrl: "wss://env.example.com/socket",
      }),
    ).toBe("wss://env.example.com/socket");
  });
});

describe("resolveHttpOriginFromWsUrl", () => {
  it("maps ws and wss URLs to http(s) origins", () => {
    expect(
      resolveHttpOriginFromWsUrl({
        wsUrl: "wss://chat.example.com/socket?token=abc",
        fallbackOrigin: "https://fallback.example.com",
      }),
    ).toBe("https://chat.example.com");
    expect(
      resolveHttpOriginFromWsUrl({
        wsUrl: "ws://chat.example.com:3773/socket?token=abc",
        fallbackOrigin: "https://fallback.example.com",
      }),
    ).toBe("http://chat.example.com:3773");
  });

  it("uses fallback origin when the URL is invalid", () => {
    expect(
      resolveHttpOriginFromWsUrl({
        wsUrl: "not-a-url",
        fallbackOrigin: "https://fallback.example.com",
      }),
    ).toBe("https://fallback.example.com");
  });
});
