/**
 * Opt-in render timing, for finding out which pipeline stage is slow on a real device.
 *
 * Off by default and effectively free when off. Turn it on by opening the app with `?profile`
 * in the URL, or in the console: `localStorage.pictoeProfile = "1"` then reload (or call
 * `__pictoeProfile.enable()`). After dragging some sliders, run `__pictoeProfile.summary()`
 * for a median / 95th-percentile / sample-count table per stage, and `__pictoeProfile.reset()`
 * to start over.
 *
 * Caveat: on a GPU-backed canvas, drawing calls return before the GPU has finished, so that
 * cost tends to show up in whichever later stage first reads pixels back (colour stage,
 * sharpen) rather than in the draw stage itself. Read the stages together with "total".
 */

const MAX_SAMPLES = 300;

type StageStats = { stage: string; median: number; p95: number; samples: number };

const samples = new Map<string, number[]>();
let enabled: boolean | undefined;

function detect(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).has("profile")) return true;
    return window.localStorage?.getItem("pictoeProfile") === "1";
  } catch {
    // Storage can throw (Safari private mode, blocked cookies); profiling just stays off.
    return false;
  }
}

export function profilingEnabled(): boolean {
  if (enabled === undefined) {
    enabled = detect();
    installConsoleHook(); // always available, so `__pictoeProfile.enable()` works from the console
  }
  return enabled;
}

export function setProfiling(on: boolean): void {
  enabled = on;
}

function record(stage: string, ms: number): void {
  let list = samples.get(stage);
  if (!list) {
    list = [];
    samples.set(stage, list);
  }
  list.push(ms);
  if (list.length > MAX_SAMPLES) list.shift();
}

/** Records a duration measured elsewhere (for example a Worker round trip) while profiling is on. */
export function recordTime(stage: string, ms: number): void {
  if (profilingEnabled()) record(stage, ms);
}

/** Runs `fn`, recording how long it took under `stage` when profiling is on. */
export function timed<T>(stage: string, fn: () => T): T {
  if (!profilingEnabled()) return fn();
  const start = performance.now();
  try {
    return fn();
  } finally {
    record(stage, performance.now() - start);
  }
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
}

export function profileSummary(): StageStats[] {
  const rows: StageStats[] = [];
  for (const [stage, list] of samples) {
    const sorted = [...list].sort((a, b) => a - b);
    rows.push({
      stage,
      median: Math.round(percentile(sorted, 0.5) * 10) / 10,
      p95: Math.round(percentile(sorted, 0.95) * 10) / 10,
      samples: sorted.length,
    });
  }
  return rows;
}

export function resetProfile(): void {
  samples.clear();
}

function installConsoleHook(): void {
  if (typeof window === "undefined") return;
  (window as unknown as Record<string, unknown>)["__pictoeProfile"] = {
    enable: () => setProfiling(true),
    summary: () => {
      const rows = profileSummary();
      console.table(rows.map((r) => ({ ...r, "median ms": r.median, "p95 ms": r.p95 })));
      return rows;
    },
    reset: resetProfile,
  };
}
