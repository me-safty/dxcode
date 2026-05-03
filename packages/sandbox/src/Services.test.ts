import type { SandboxServiceDescriptor } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  areRequiredSandboxServicesReady,
  getSandboxServiceReadiness,
  normalizeSandboxServiceRequests,
} from "./Services.ts";

describe("Sandbox service helpers", () => {
  it("normalizes service requests with stable service ids", () => {
    const requests = normalizeSandboxServiceRequests([
      {
        kind: "t3-runtime",
        required: true,
      },
      {
        kind: "browser",
        required: false,
      },
    ]);

    expect(requests.map((request) => request.serviceId)).toEqual(["t3-runtime", "browser"]);
  });

  it("keeps generated service ids stable when other kinds are reordered", () => {
    const original = normalizeSandboxServiceRequests([
      {
        kind: "t3-runtime",
        required: true,
      },
      {
        kind: "browser",
        required: false,
      },
    ]);
    const reordered = normalizeSandboxServiceRequests([
      {
        kind: "browser",
        required: false,
      },
      {
        kind: "t3-runtime",
        required: true,
      },
    ]);

    expect(original.find((request) => request.kind === "t3-runtime")?.serviceId).toBe(
      reordered.find((request) => request.kind === "t3-runtime")?.serviceId,
    );
    expect(original.find((request) => request.kind === "browser")?.serviceId).toBe(
      reordered.find((request) => request.kind === "browser")?.serviceId,
    );
  });

  it("uses per-kind occurrence indexes for duplicate generated service ids", () => {
    const requests = normalizeSandboxServiceRequests([
      {
        kind: "dev-server",
        required: true,
      },
      {
        kind: "dev-server",
        required: false,
      },
    ]);

    expect(requests.map((request) => request.serviceId)).toEqual(["dev-server", "dev-server-2"]);
  });

  it("aggregates readiness for required and optional services", () => {
    const requested = normalizeSandboxServiceRequests([
      {
        serviceId: "runtime" as SandboxServiceDescriptor["serviceId"],
        kind: "t3-runtime",
        required: true,
      },
      {
        serviceId: "browser" as SandboxServiceDescriptor["serviceId"],
        kind: "browser",
        required: false,
      },
    ]);
    const descriptors: ReadonlyArray<SandboxServiceDescriptor> = [
      {
        serviceId: "runtime" as SandboxServiceDescriptor["serviceId"],
        kind: "t3-runtime",
        status: "ready",
      },
      {
        serviceId: "browser" as SandboxServiceDescriptor["serviceId"],
        kind: "browser",
        status: "provisioning",
      },
    ];

    expect(areRequiredSandboxServicesReady({ requested, descriptors })).toBe(true);
    expect(getSandboxServiceReadiness({ requested, descriptors })).toMatchObject({
      ready: true,
      requiredReady: true,
      requiredTotal: 1,
      optionalReadyCount: 0,
    });
  });

  it("marks failed required services as not ready", () => {
    const requested = normalizeSandboxServiceRequests([
      {
        serviceId: "runtime" as SandboxServiceDescriptor["serviceId"],
        kind: "t3-runtime",
        required: true,
      },
    ]);
    const descriptors: ReadonlyArray<SandboxServiceDescriptor> = [
      {
        serviceId: "runtime" as SandboxServiceDescriptor["serviceId"],
        kind: "t3-runtime",
        status: "failed",
      },
    ];

    expect(areRequiredSandboxServicesReady({ requested, descriptors })).toBe(false);
    expect(getSandboxServiceReadiness({ requested, descriptors }).failed).toHaveLength(1);
  });
});
