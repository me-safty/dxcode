import { describe, expect, it } from "vitest";
import { parseHostnameFromRemoteUrl, providerFromHostname } from "./RoutingGitHostCli.ts";

describe("parseHostnameFromRemoteUrl", () => {
  it("extracts hostname from SSH URL", () => {
    expect(parseHostnameFromRemoteUrl("git@github.com:user/repo.git")).toBe("github.com");
  });

  it("extracts hostname from HTTPS URL", () => {
    expect(parseHostnameFromRemoteUrl("https://gitlab.com/user/repo.git")).toBe("gitlab.com");
  });

  it("returns null for empty string", () => {
    expect(parseHostnameFromRemoteUrl("")).toBeNull();
  });

  it("extracts hostname from git:// URL", () => {
    expect(parseHostnameFromRemoteUrl("git://github.com/user/repo.git")).toBe("github.com");
  });

  it("extracts hostname from SSH URL with ssh:// prefix", () => {
    expect(parseHostnameFromRemoteUrl("ssh://git@gitlab.example.com:22/repo.git")).toBe(
      "gitlab.example.com",
    );
  });
});

describe("providerFromHostname", () => {
  it("maps github.com to github", () => {
    expect(providerFromHostname("github.com")).toBe("github");
  });

  it("maps gitlab.com to gitlab", () => {
    expect(providerFromHostname("gitlab.com")).toBe("gitlab");
  });

  it("maps self-hosted gitlab to gitlab", () => {
    expect(providerFromHostname("gitlab.example.com")).toBe("gitlab");
  });

  it("returns null for unknown provider", () => {
    expect(providerFromHostname("bitbucket.org")).toBeNull();
  });
});
