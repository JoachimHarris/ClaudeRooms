import { describe, expect, it } from "vitest";
import { clientFrameSchema, protocolEnvelopeSchema, LIMITS } from "../src/index.js";

describe("clientFrameSchema", () => {
  it("accepts a valid chat.send frame", () => {
    const parsed = clientFrameSchema.safeParse({
      type: "chat.send",
      content: "hello",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects unknown frame types", () => {
    expect(clientFrameSchema.safeParse({ type: "shell.exec" }).success).toBe(false);
  });

  it("rejects empty and oversized message content", () => {
    expect(clientFrameSchema.safeParse({ type: "chat.send", content: "" }).success).toBe(
      false,
    );
    expect(
      clientFrameSchema.safeParse({
        type: "chat.send",
        content: "x".repeat(LIMITS.maxMessageLength + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects claude.request with an unknown mode", () => {
    expect(
      clientFrameSchema.safeParse({
        type: "claude.request",
        content: "hi",
        mode: "repository_write",
      }).success,
    ).toBe(false);
  });

  it("rejects extra dangerous fields on decision.resolve status", () => {
    expect(
      clientFrameSchema.safeParse({
        type: "decision.resolve",
        decisionId: "not-a-uuid",
        status: "accepted",
      }).success,
    ).toBe(false);
  });
});

describe("protocolEnvelopeSchema", () => {
  const base = {
    protocolVersion: 1,
    eventId: "7d4d5c1e-9f7a-4a7e-8a8e-2f6f0c1b2a3d",
    roomId: "1b671a64-40d5-491e-99b0-da01ff1f3341",
    sequence: 1,
    actor: { type: "system" as const },
    occurredAt: new Date().toISOString(),
  };

  it("validates payload against the event type", () => {
    const good = protocolEnvelopeSchema.safeParse({
      ...base,
      type: "participant.left",
      payload: { participantId: "1b671a64-40d5-491e-99b0-da01ff1f3341" },
    });
    expect(good.success).toBe(true);

    const bad = protocolEnvelopeSchema.safeParse({
      ...base,
      type: "participant.left",
      payload: { wrong: true },
    });
    expect(bad.success).toBe(false);
  });

  it("rejects unsupported protocol versions", () => {
    const parsed = protocolEnvelopeSchema.safeParse({
      ...base,
      protocolVersion: 2,
      type: "participant.left",
      payload: { participantId: base.roomId },
    });
    expect(parsed.success).toBe(false);
  });
});
