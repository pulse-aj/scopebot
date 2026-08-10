import { runPrioritization } from "./prioritizer";
import { logger } from "./logger";

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const STARTUP_DELAY_MS = 30_000;

// Single-flight state for the prioritization job. The flag is shared by the
// timer-driven tick and admin-triggered refreshes so we never run two
// Anthropic calls in parallel.
let running = false;
let nextRunAt: Date | null = null;
let timer: NodeJS.Timeout | null = null;

export function getNextScheduledRun(): Date | null {
  return nextRunAt;
}

export function isPrioritizationRunning(): boolean {
  return running;
}

/**
 * Schedule the next run. We use a self-rescheduling chained setTimeout
 * (instead of setInterval) so that:
 *   - manual refreshes correctly push the next auto-run out by 2h
 *   - the reported `nextRunAt` always matches what the timer will actually do
 *   - a long-running model call can't cause overlapping fires
 */
function scheduleNext(delayMs: number) {
  if (timer) clearTimeout(timer);
  nextRunAt = new Date(Date.now() + delayMs);
  timer = setTimeout(() => {
    void runOnce("scheduler-tick");
  }, delayMs);
}

async function runOnce(source: string): Promise<"ran" | "busy" | "failed"> {
  if (running) {
    logger.info({ source }, "AI prioritization skipped — already running");
    return "busy";
  }
  running = true;
  try {
    await runPrioritization();
    logger.info({ source }, "AI prioritization run finished");
    return "ran";
  } catch (err) {
    logger.error({ err, source }, "AI prioritization run failed");
    return "failed";
  } finally {
    running = false;
    // Always re-arm: a 2h cadence from the moment we finished (manual or
    // auto). This keeps the timer in sync with the user-visible `nextRunAt`.
    scheduleNext(TWO_HOURS_MS);
  }
}

/**
 * Trigger a prioritization run in the background and return immediately.
 * The HTTP caller does not block on the Anthropic call — the UI is expected
 * to poll the GET endpoint to see when `isRunning` flips back to false and
 * `generatedAt` advances.
 *
 * Returns "busy" if a run was already in flight; "started" otherwise.
 */
export function triggerPrioritizationInBackground(): "started" | "busy" {
  if (running) return "busy";
  // Mark running synchronously so a concurrent caller in the same tick can't
  // also kick off a run before our setImmediate fires.
  running = true;
  setImmediate(async () => {
    try {
      await runPrioritization();
      logger.info(
        { source: "admin-refresh" },
        "AI prioritization run finished",
      );
    } catch (err) {
      logger.error(
        { err, source: "admin-refresh" },
        "AI prioritization run failed",
      );
    } finally {
      running = false;
      scheduleNext(TWO_HOURS_MS);
    }
  });
  return "started";
}

/**
 * Start the periodic AI prioritization job. Runs once shortly after startup
 * (so a deploy doesn't stampede the API at boot) then every 2 hours via a
 * chained timeout. Safe to call multiple times — only arms once.
 *
 * Note: this relies on a single long-lived process, which is fine on
 * Reserved VM deployments. On Autoscale-style deployments the timer is
 * unreliable (scale-to-zero kills it, multiple instances each run their
 * own copy) — switch to an external scheduler before moving deployment
 * types.
 */
export function startPrioritizationScheduler(): void {
  if (timer) return;
  scheduleNext(STARTUP_DELAY_MS);
  logger.info(
    { intervalMs: TWO_HOURS_MS, startupDelayMs: STARTUP_DELAY_MS },
    "AI prioritization scheduler started",
  );
}
