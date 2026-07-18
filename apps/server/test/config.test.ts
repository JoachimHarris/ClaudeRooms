import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

// The hosted-deployment surface (Milestone 6, ADR-0010). The security-relevant
// default is that the engine binds loopback unless a deployment explicitly
// opts into a public bind.

describe("loadConfig — hosted deployment", () => {
  it("defaults to a loopback bind (never public by accident)", () => {
    expect(loadConfig({}).host).toBe("127.0.0.1");
  });

  it("binds where a deployment asks, and carries a static dir", () => {
    const config = loadConfig({
      CLAUDEROOMS_HOST: "0.0.0.0",
      CLAUDEROOMS_STATIC_DIR: "/app/web",
      CLAUDEROOMS_ALLOWED_ORIGINS: "https://rooms.example.com",
    });
    expect(config.host).toBe("0.0.0.0");
    expect(config.staticDir).toBe("/app/web");
    expect(config.allowedOrigins).toEqual(["https://rooms.example.com"]);
  });

  it("leaves staticDir unset when not configured (embedded/dev)", () => {
    expect(loadConfig({}).staticDir).toBeUndefined();
  });

  it("still rejects an invalid port", () => {
    expect(() => loadConfig({ CLAUDEROOMS_PORT: "70000" })).toThrow();
  });
});
