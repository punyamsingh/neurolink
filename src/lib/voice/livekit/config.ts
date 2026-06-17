/**
 * Environment resolution for the LiveKit voice agent.
 *
 * Reads LiveKit connection settings and LLM defaults from `process.env` with
 * descriptive errors for missing required values. No type assertions: presence
 * is verified with explicit string checks.
 *
 * See docs/features/livekit-voice-agent.md.
 */

import type {
  LiveKitServerConfig,
  LiveKitBrainDefaults,
  RealtimeVoiceConfig,
} from "../../types/index.js";

const DEFAULT_LLM_PROVIDER = "bedrock";
const DEFAULT_LLM_MODEL = "claude-sonnet-4-6";

/** Read a required environment variable or throw a descriptive error. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `${name} is not set in environment (required for the LiveKit voice agent)`,
    );
  }
  return value.trim();
}

/** Read an optional environment variable, falling back to a default. */
function readEnv(name: string, fallback: string): string {
  const value = process.env[name];
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return fallback;
}

function readOptionalEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (typeof raw === "string" && raw.trim().length > 0) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return fallback;
}

/**
 * Resolve LiveKit server connection settings from the environment.
 *
 * Requires `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`. Works
 * identically for LiveKit Cloud, a self-hosted server, or `livekit-server --dev`
 * — only the values differ.
 */
export function resolveLiveKitServerConfig(): LiveKitServerConfig {
  return {
    url: requireEnv("LIVEKIT_URL"),
    apiKey: requireEnv("LIVEKIT_API_KEY"),
    apiSecret: requireEnv("LIVEKIT_API_SECRET"),
  };
}

/**
 * Resolve the LLM provider/model defaults for the brain.
 *
 * Defaults to Bedrock / Claude; overridable via `VOICE_LLM_PROVIDER` and
 * `VOICE_LLM_MODEL`.
 */
export function resolveBrainDefaults(): LiveKitBrainDefaults {
  return {
    provider: readEnv("VOICE_LLM_PROVIDER", DEFAULT_LLM_PROVIDER),
    model: readEnv("VOICE_LLM_MODEL", DEFAULT_LLM_MODEL),
  };
}

const DEFAULT_REALTIME_MODEL = "gemini-live-2.5-flash";
const DEFAULT_REALTIME_LOCATION = "global";
const DEFAULT_RESPONSE_MODALITY = "AUDIO";
const DEFAULT_SYSTEM_PROMPT =
  "You are a concise voice assistant for a merchant dashboard. Keep replies short and spoken.";
const DEFAULT_GREETING =
  "Briefly greet the merchant and ask how you can help with their store today.";
const DEFAULT_LIGHTHOUSE_URL = "http://localhost:5173";
const DEFAULT_MCP_PATH = "/ai/mcp/v2";

/**
 * Resolve the realtime (Gemini Live speech-to-speech) voice configuration from
 * the environment.
 *
 * Every value has a safe default so a worker can run with no realtime-specific
 * env at all. Vertex `project` is resolved from `VERTEX_PROJECT`, then the
 * service-account project (`GOOGLE_AUTH_BREEZE_PROJECT_ID`), then
 * `GOOGLE_CLOUD_PROJECT_ID`. The MCP URL is `VOICE_MCP_URL` if set, otherwise
 * `${LIGHTHOUSE_URL}/ai/mcp/v2`.
 */
export function resolveRealtimeVoiceConfig(): RealtimeVoiceConfig {
  const lighthouseUrl = readEnv("LIGHTHOUSE_URL", DEFAULT_LIGHTHOUSE_URL);
  const mcpUrl = readEnv(
    "VOICE_MCP_URL",
    `${lighthouseUrl}${DEFAULT_MCP_PATH}`,
  );
  return {
    project:
      readOptionalEnv("VERTEX_PROJECT") ??
      readOptionalEnv("GOOGLE_AUTH_BREEZE_PROJECT_ID") ??
      readOptionalEnv("GOOGLE_CLOUD_PROJECT_ID"),
    location: readEnv("VERTEX_LOCATION", DEFAULT_REALTIME_LOCATION),
    model: readEnv("VOICE_LIVE_MODEL", DEFAULT_REALTIME_MODEL),
    voice: readOptionalEnv("VOICE_S2S_VOICE"),
    responseModality: readEnv(
      "VOICE_RESPONSE_MODALITY",
      DEFAULT_RESPONSE_MODALITY,
    ).toUpperCase(),
    systemPrompt: readEnv("VOICE_SYSTEM_PROMPT", DEFAULT_SYSTEM_PROMPT),
    greeting: readEnv("VOICE_GREETING", DEFAULT_GREETING),
    toolsEnabled: readEnv("VOICE_S2S_TOOLS", "").toLowerCase() === "true",
    mcpUrl,
    emptyRoomGraceMs: readNumberEnv("VOICE_EMPTY_ROOM_GRACE_MS", 30_000),
    joinDeadlineMs: readNumberEnv("VOICE_JOIN_DEADLINE_MS", 60_000),
    hitlTimeoutMs: readNumberEnv("VOICE_HITL_TIMEOUT_MS", 45_000),
    metricsIntervalMs: readNumberEnv("VOICE_METRICS_INTERVAL_MS", 10_000),
  };
}

const EOU_TRUTHY = new Set(["1", "true", "english", "en", "on", "yes"]);

/**
 * Resolve the semantic end-of-utterance (EOU) turn-detection settings.
 *
 * Opt-in via `LIVEKIT_EOU_TURN_DETECTION` (`1`/`true`/`english`/`en`/`on`/`yes`).
 * When enabled, the English `@livekit/agents-plugin-livekit` EOU model decides
 * whether the user's turn is truly over, layered on top of VAD silence — so
 * natural mid-sentence pauses don't split one utterance. English-only; the
 * model adds ~200MB RAM per worker and ~10ms per turn-end.
 *
 * `LIVEKIT_EOU_UNLIKELY_THRESHOLD` optionally overrides the model's confidence
 * threshold (lower = end the turn more eagerly).
 */
export function resolveEouTurnDetection(): {
  enabled: boolean;
  unlikelyThreshold: number | undefined;
} {
  const raw = process.env.LIVEKIT_EOU_TURN_DETECTION;
  const enabled =
    typeof raw === "string" && EOU_TRUTHY.has(raw.trim().toLowerCase());
  const thresholdRaw = process.env.LIVEKIT_EOU_UNLIKELY_THRESHOLD;
  let unlikelyThreshold: number | undefined;
  if (typeof thresholdRaw === "string" && thresholdRaw.trim().length > 0) {
    const parsed = Number(thresholdRaw.trim());
    if (Number.isFinite(parsed)) {
      unlikelyThreshold = parsed;
    }
  }
  return { enabled, unlikelyThreshold };
}
