import { describe, expect, it } from "vite-plus/test";

import {
  AdvertisedEndpointProtocolError,
  AdvertisedEndpointUrlParseError,
  normalizeHttpBaseUrl,
} from "./advertisedEndpoint.ts";

const captureError = (run: () => unknown): unknown => {
  try {
    run();
  } catch (cause) {
    return cause;
  }
  throw new Error("Expected operation to throw");
};

describe("advertised endpoints", () => {
  it("normalizes websocket endpoints to an HTTP base URL", () => {
    expect(normalizeHttpBaseUrl("wss://relay.example.com/path?query=value#fragment")).toBe(
      "https://relay.example.com/",
    );
  });

  it("preserves URL parser failures with their input", () => {
    const input = "not a URL";
    const error = captureError(() => normalizeHttpBaseUrl(input));

    expect(error).toBeInstanceOf(AdvertisedEndpointUrlParseError);
    expect(error).toMatchObject({ input });
    expect((error as AdvertisedEndpointUrlParseError).cause).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(`Invalid advertised endpoint URL: ${input}`);
  });

  it("reports unsupported protocols without inventing a cause", () => {
    const input = "ftp://relay.example.com/path";
    const error = captureError(() => normalizeHttpBaseUrl(input));

    expect(error).toBeInstanceOf(AdvertisedEndpointProtocolError);
    expect(error).toMatchObject({ input, protocol: "ftp:" });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect((error as Error).message).toBe("Endpoint must use HTTP or HTTPS. Received ftp:");
  });
});
