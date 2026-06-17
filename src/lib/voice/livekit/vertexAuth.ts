/**
 * Vertex authentication helpers for the realtime voice agent.
 *
 * The Gemini Live WebSocket authenticates to Vertex via Application Default
 * Credentials (ADC). These helpers materialise ADC from the split
 * `GOOGLE_AUTH_*` env fields when no credentials file is configured, and remove
 * any Gemini Developer API key from the environment so `@google/genai` uses
 * Vertex/ADC auth (not an API key) for the realtime WebSocket.
 *
 * See docs/features/livekit-voice-agent.md.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { logger } from "../../utils/logger.js";

/**
 * Materialise Vertex ADC from the split `GOOGLE_AUTH_*` env fields.
 *
 * The google realtime plugin authenticates Vertex via ADC (it does not accept
 * inline credentials), so this writes a temp service-account JSON and points
 * `GOOGLE_APPLICATION_CREDENTIALS` at it — unless ADC is already configured.
 * No-op when `GOOGLE_APPLICATION_CREDENTIALS` is set or the `GOOGLE_AUTH_*`
 * fields are absent (auth then relies on ambient ADC).
 */
export function ensureVertexAdc(): void {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return;
  }
  const clientEmail = process.env.GOOGLE_AUTH_CLIENT_EMAIL;
  const rawPrivateKey = process.env.GOOGLE_AUTH_PRIVATE_KEY;
  if (!clientEmail || !rawPrivateKey) {
    logger.warn(
      "[RealtimeVoiceAgent] No GOOGLE_APPLICATION_CREDENTIALS and no GOOGLE_AUTH_* fields — Vertex auth will rely on ambient ADC.",
    );
    return;
  }
  const credentials = {
    type: process.env.GOOGLE_AUTH_TYPE ?? "service_account",
    project_id:
      process.env.GOOGLE_AUTH_BREEZE_PROJECT_ID ??
      process.env.GOOGLE_CLOUD_PROJECT_ID,
    private_key_id: process.env.GOOGLE_AUTH_PRIVATE_KEY_ID,
    private_key: rawPrivateKey.replace(/\\n/g, "\n"),
    client_email: clientEmail,
    token_uri:
      process.env.GOOGLE_AUTH_TOKEN_URI ??
      "https://oauth2.googleapis.com/token",
  };
  const credentialsDir = mkdtempSync(path.join(os.tmpdir(), "vertex-adc-"));
  const credentialsPath = path.join(credentialsDir, "adc.json");
  writeFileSync(credentialsPath, JSON.stringify(credentials), {
    mode: 0o600,
    flag: "wx",
  });
  process.on("exit", () => {
    rmSync(credentialsDir, { recursive: true, force: true });
  });
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
  logger.info(
    `[RealtimeVoiceAgent] Vertex ADC written to ${credentialsPath} (project ${credentials.project_id}).`,
  );
}

/**
 * Force pure Vertex/ADC auth for the Gemini Live WebSocket.
 *
 * `@google/genai` 1.52+ uses a Gemini Developer API key for the realtime
 * WebSocket auth even when `vertexai: true` and project/location are set, which
 * Vertex rejects at the handshake (WS close 1006). The realtime worker only
 * ever talks to Vertex, so remove these keys (only affects this process).
 */
export function clearGeminiApiKeyEnv(): void {
  for (const key of ["GOOGLE_API_KEY", "GOOGLE_AI_API_KEY", "GEMINI_API_KEY"]) {
    if (process.env[key]) {
      delete process.env[key];
      logger.info(
        `[RealtimeVoiceAgent] cleared ${key} so genai uses Vertex/ADC auth (not API key) for the Live WS.`,
      );
    }
  }
}
