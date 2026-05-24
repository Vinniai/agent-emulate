// Time compression — pace a run by wall-clock, but stamp data with a virtual
// clock that fast-forwards over a much longer simulated span.
//
// Run 10 wall-minutes to simulate 10 days; 90 wall-minutes to simulate 9
// months. The simulator engine takes an injectable `now()`, so we hand it a
// scaled clock: every record/message a generator stamps lands somewhere in the
// simulated window, spread proportionally across it. Threads opened early sit
// near the window's start; later ticks land later — so a compressed run still
// produces a chronologically coherent history.

const UNITS: Record<string, number> = {
  s: 1,
  m: 60, // minutes
  h: 3600,
  d: 86_400,
  w: 604_800,
  mo: 2_592_000, // 30-day month
  y: 31_536_000, // 365-day year
};

/**
 * Parse a duration string into seconds. Supports `s m h d w mo y`, decimals,
 * and compounds: `90m`, `10d`, `9mo`, `1.5d`, `1y6mo`, `36h`. Note `m` is
 * minutes and `mo` is months.
 */
export function parseDuration(input: string): number {
  const re = /(\d+(?:\.\d+)?)(mo|[smhdwy])/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    matched = true;
    total += parseFloat(m[1]) * UNITS[m[2]];
  }
  if (!matched) throw new Error(`[persona] bad duration "${input}" (try 90m, 10d, 9mo, 1y6mo)`);
  return total;
}

/** Compact human form of a second count: 864000 → "10d", 23328000 → "9mo". */
export function humanizeDuration(sec: number): string {
  const order: Array<[string, number]> = [
    ["y", UNITS.y],
    ["mo", UNITS.mo],
    ["d", UNITS.d],
    ["h", UNITS.h],
    ["m", UNITS.m],
    ["s", UNITS.s],
  ];
  for (const [label, size] of order) {
    if (sec >= size) {
      const v = sec / size;
      return `${Number.isInteger(v) ? v : v.toFixed(1)}${label}`;
    }
  }
  return `${sec}s`;
}

export interface Timeline {
  /** The virtual clock — advances `scale`× faster than wall time. */
  now(): Date;
  /** Simulated seconds per wall-clock second. 1 = real time. */
  scale: number;
  simStart: Date;
  simEnd: Date;
  /** One-line description for the run banner. */
  describe(): string;
}

export interface TimelineOptions {
  /** Wall-clock length of the run, in seconds. */
  wallSeconds: number;
  /** Simulated span in seconds. Omit for real time (scale 1). */
  simSpanSec?: number;
  /** Injectable real clock (testing). Defaults to `Date.now`. */
  realNow?: () => number;
}

/**
 * Build a fast-forward clock. The simulated window *ends* at the run's start
 * instant and stretches `simSpanSec` into the past, so generated timestamps
 * read as "the last <span> of history", compressed into the wall-clock run.
 */
export function makeTimeline(opts: TimelineOptions): Timeline {
  const realClock = opts.realNow ?? Date.now;
  const realStart = realClock();
  const span = opts.simSpanSec ?? opts.wallSeconds;
  const scale = span / opts.wallSeconds;
  const simEnd = new Date(realStart);
  const simStart = new Date(realStart - span * 1000);

  return {
    scale,
    simStart,
    simEnd,
    now(): Date {
      return new Date(simStart.getTime() + (realClock() - realStart) * scale);
    },
    describe(): string {
      if (scale === 1) return `real time · ${humanizeDuration(opts.wallSeconds)} run`;
      const day = (d: Date): string => d.toISOString().slice(0, 10);
      return (
        `compressing ${humanizeDuration(span)} of activity into ${humanizeDuration(opts.wallSeconds)} ` +
        `(${scale >= 100 ? Math.round(scale) : scale.toFixed(1)}× speed) · ` +
        `sim window ${day(simStart)} → ${day(simEnd)}`
      );
    },
  };
}
