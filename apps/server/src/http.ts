import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createRoomBodySchema, joinRoomBodySchema } from "@clauderooms/shared";
import { DomainError, httpStatusFor } from "./errors.js";
import { KeyedRateLimiter } from "./ratelimit.js";
import type { RoomService } from "./rooms.js";
import type { RoomHub } from "./hub.js";

const paramsSchema = z.object({ roomId: z.string().uuid() });

export function registerHttpRoutes(
  app: FastifyInstance,
  deps: { rooms: RoomService; hub: RoomHub },
): void {
  // Room creation/joining mint credentials — keep them hard to hammer.
  const limiter = new KeyedRateLimiter(30, 0.5);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      return reply
        .status(httpStatusFor(error.code))
        .send({ error: { code: error.code, message: error.message } });
    }
    app.log.error({ err: error }, "unhandled http error");
    return reply
      .status(500)
      .send({ error: { code: "INTERNAL", message: "Internal error" } });
  });

  app.get("/api/health", async () => ({ ok: true }));

  app.post("/api/rooms", async (request, reply) => {
    if (!limiter.tryTake(request.ip)) {
      throw new DomainError("RATE_LIMITED", "Too many requests");
    }
    const body = createRoomBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new DomainError("INVALID_PAYLOAD", "Invalid room creation payload");
    }
    const result = deps.rooms.createRoom(body.data);
    return reply.status(201).send({
      room: result.room,
      participant: { ...result.participant, connected: false },
      sessionToken: result.sessionToken,
      inviteToken: result.inviteToken,
      inviteExpiresAt: result.inviteExpiresAt,
    });
  });

  app.post("/api/rooms/:roomId/join", async (request, reply) => {
    if (!limiter.tryTake(request.ip)) {
      throw new DomainError("RATE_LIMITED", "Too many requests");
    }
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      throw new DomainError("ROOM_NOT_FOUND", "No such room");
    }
    const body = joinRoomBodySchema.safeParse(request.body);
    if (!body.success) {
      throw new DomainError("INVALID_PAYLOAD", "Invalid join payload");
    }
    const result = deps.rooms.joinRoom({
      roomId: params.data.roomId,
      inviteToken: body.data.inviteToken,
      displayName: body.data.displayName,
    });
    for (const envelope of result.envelopes) {
      deps.hub.broadcast(result.room.id, envelope);
    }
    return reply.status(200).send({
      room: result.room,
      participant: { ...result.participant, connected: false },
      sessionToken: result.sessionToken,
    });
  });
}
