/**
 * Per-call context from LiveKit room metadata.
 *
 * The manager (e.g. a Lighthouse `/start` endpoint) pre-creates the room with
 * `base64(JSON({ authToken, mcpContext }))` metadata, built from the caller's
 * session. The worker reads it on join — nothing per-call comes from worker env.
 * Returns the MCP `x-auth-token` and the base64(JSON) `x-context` the server
 * expects.
 *
 * The metadata is untrusted input, so it is decoded with a zod schema rather
 * than a trusted `JSON.parse` cast.
 *
 * See docs/features/livekit-voice-agent.md.
 */

import { Buffer } from "node:buffer";
import { z } from "zod";
import { logger } from "../../utils/logger.js";
import type { LiveKitRoomCallContext } from "../../types/index.js";

/** Shape the manager writes into room metadata. `mcpContext` is opaque here. */
const roomMetadataSchema = z.object({
  authToken: z.string().optional(),
  mcpContext: z.unknown().optional(),
});

/** Decode the base64(JSON) metadata string into an `unknown`, or `undefined`. */
function decodeBase64Json(encoded: string): unknown {
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf-8"));
  } catch (error) {
    logger.error(
      `[RealtimeVoiceAgent] room metadata is not valid base64 JSON: ${String(error)}`,
    );
    return undefined;
  }
}

/**
 * Decode `{ authToken, mcpContext }` from a room's base64(JSON) metadata.
 *
 * `authToken` may be empty (demo/guest, where the MCP server gates on the
 * context's `demoMode`); `xContext` is the re-encoded base64(JSON) of
 * `mcpContext`, or `""` when no context was supplied or the metadata is invalid.
 */
export function readCallContextFromRoom(
  roomMetadata: string | undefined,
): LiveKitRoomCallContext {
  const empty: LiveKitRoomCallContext = { authToken: "", xContext: "" };
  if (!roomMetadata) {
    logger.warn(
      "[RealtimeVoiceAgent] room has no metadata — MCP auth/context unavailable.",
    );
    return empty;
  }
  const decoded = roomMetadataSchema.safeParse(decodeBase64Json(roomMetadata));
  if (!decoded.success) {
    logger.error(
      `[RealtimeVoiceAgent] room metadata has unexpected shape: ${decoded.error.message}`,
    );
    return empty;
  }
  const { authToken, mcpContext } = decoded.data;
  const xContext =
    mcpContext === undefined || mcpContext === null
      ? ""
      : Buffer.from(JSON.stringify(mcpContext), "utf-8").toString("base64");
  return { authToken: authToken ?? "", xContext };
}
