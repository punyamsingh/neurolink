/**
 * LiveKit Agents worker launcher.
 *
 * Registers a worker with the LiveKit server (Cloud or self-hosted) for the
 * given agent entry file. LiveKit dispatches one Job per room, each running in
 * its own process, which provides worker-per-call isolation and horizontal
 * scaling. Connection settings are resolved from the environment.
 *
 * `@livekit/agents` is an optional dependency, imported dynamically.
 *
 * See docs/features/livekit-voice-agent.md.
 */

import {
  resolveEouTurnDetection,
  resolveLiveKitServerConfig,
} from "./config.js";
import { logger } from "../../utils/logger.js";
import type { LiveKitWorkerLaunchOptions } from "../../types/index.js";

const DEFAULT_AGENT_NAME = "neurolink-voice";
const EOU_METHOD_MULTILINGUAL = "lk_end_of_utterance_multilingual";

const IS_JOB_CHILD = process.argv.some((arg) => arg.includes("job_proc"));
const PROC_ROLE = IS_JOB_CHILD ? "job(child)" : "worker(parent)";

let processGuardsInstalled = false;

export function installVoiceWorkerProcessGuards(
  metricsIntervalMs = Number(process.env.VOICE_METRICS_INTERVAL_MS ?? 10000),
): void {
  if (processGuardsInstalled) {
    return;
  }
  processGuardsInstalled = true;
  const procInfo = {
    role: PROC_ROLE,
    pid: process.pid,
    ppid: process.ppid,
  };

  process.on("uncaughtException", (error) => {
    logger.error("voiceWorker.uncaughtException", {
      ...procInfo,
      error: error?.stack ?? String(error),
    });
    if (IS_JOB_CHILD) {
      setTimeout(() => process.exit(1), 1000).unref?.();
    }
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("voiceWorker.unhandledRejection", {
      ...procInfo,
      error: reason instanceof Error ? reason.stack : String(reason),
    });
  });
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => {
      logger.warn("voiceWorker.signal", { ...procInfo, signal });
      setTimeout(() => process.exit(0), 1500);
    });
  }

  if (Number.isFinite(metricsIntervalMs) && metricsIntervalMs > 0) {
    const mb = (bytes: number): number =>
      Math.round((bytes / 1024 / 1024) * 10) / 10;
    const timer = setInterval(() => {
      const usage = process.memoryUsage();
      logger.debug("voiceWorker.mem", {
        ...procInfo,
        rssMb: mb(usage.rss),
        heapUsedMb: mb(usage.heapUsed),
        heapTotalMb: mb(usage.heapTotal),
        externalMb: mb(usage.external),
      });
    }, metricsIntervalMs);
    timer.unref?.();
  }
}

/**
 * Register the English EOU inference runner in the worker process.
 *
 * Must run before `cli.runApp`: the worker only spawns the shared inference
 * executor when `InferenceRunner.registeredRunners` is non-empty at startup,
 * and passes that registry to the executor process. Importing the plugin
 * registers both English and multilingual runners, so we delete multilingual to
 * keep only the English model loaded.
 */
async function registerEouTurnDetectorRunner(): Promise<void> {
  const { InferenceRunner } = await import("@livekit/agents");
  // Importing the plugin's turn-detector module triggers registerRunner().
  await import("@livekit/agents-plugin-livekit");
  delete InferenceRunner.registeredRunners[EOU_METHOD_MULTILINGUAL];
}

/**
 * Launch the LiveKit voice agent worker.
 *
 * Call from a small runner script; `agentFile` must point to the file whose
 * default export is the result of `defineVoiceAgent`.
 *
 * ```ts
 * await startVoiceAgentWorker({
 *   agentFile: new URL("./voice-agent-entry.js", import.meta.url).pathname,
 *   agentName: "neurolink-voice",
 * });
 * ```
 */
export async function startVoiceAgentWorker(
  options: LiveKitWorkerLaunchOptions,
): Promise<void> {
  const server = resolveLiveKitServerConfig();
  const { cli, WorkerOptions } = await import("@livekit/agents");

  if (resolveEouTurnDetection().enabled) {
    await registerEouTurnDetectorRunner();
  }

  cli.runApp(
    new WorkerOptions({
      agent: options.agentFile,
      agentName: options.agentName ?? DEFAULT_AGENT_NAME,
      wsURL: server.url,
      apiKey: server.apiKey,
      apiSecret: server.apiSecret,
    }),
  );
}

export async function startRealtimeVoiceAgentWorker(
  options: LiveKitWorkerLaunchOptions,
): Promise<void> {
  installVoiceWorkerProcessGuards();
  if (process.env.LIVEKIT_EOU_TURN_DETECTION) {
    delete process.env.LIVEKIT_EOU_TURN_DETECTION;
    logger.info("realtime.worker.eouDisabled", {
      reason: "s2s-in-model-turn-detection",
    });
  }
  if (process.argv.includes("connect")) {
    process.env.LK_REALTIME_CONNECT_MODE = "true";
    logger.info("realtime.worker.connectMode", { enabled: true });
  }
  await startVoiceAgentWorker(options);
}
