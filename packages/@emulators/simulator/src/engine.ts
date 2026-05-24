import type { Scenario, Stream } from "./scenario.js";
import { generate } from "./generators.js";

// The engine streams a scenario's activity into a running emulator. Everything
// non-deterministic — the clock, the timer, the network, the RNG — is
// injectable so a run is fully reproducible under test.

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface TimerLike {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export interface SimulatorOptions {
  /** Emulator base URL (e.g. http://nango.localhost:1355). Overrides scenario.base. */
  base?: string;
  fetch?: FetchLike;
  now?: () => Date;
  timer?: TimerLike;
  /** [0,1) RNG for interval jitter. */
  random?: () => number;
  /** Generate + log but make no HTTP calls. */
  dryRun?: boolean;
  /** Observation hook — fired after each tick (also in dry-run). */
  onTick?: (info: { stream: string; provider: string; kind: "sync" | "forward" | "native"; seq: number }) => void;
  /** Bearer token sent on native writes (the emulator's fallback identity). */
  nativeToken?: string;
}

const defaultTimer: TimerLike = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface StreamState {
  spec: Stream;
  seq: number;
  handle: unknown;
}

export class Simulator {
  private readonly base: string;
  private readonly fetch: FetchLike;
  private readonly now: () => Date;
  private readonly timer: TimerLike;
  private readonly random: () => number;
  private readonly dryRun: boolean;
  private readonly onTick?: SimulatorOptions["onTick"];
  private readonly nativeToken: string;

  private readonly states: StreamState[];
  private durationHandle: unknown;
  private finished = false;
  private resolveDone?: () => void;

  constructor(
    private readonly scenario: Scenario,
    opts: SimulatorOptions = {},
  ) {
    const base = opts.base ?? scenario.base;
    if (!base) throw new Error("[emulate-sim] no base URL (pass --base or set `base:` in the scenario)");
    this.base = base.replace(/\/+$/, "");
    this.fetch = opts.fetch ?? (globalThis.fetch as FetchLike);
    this.now = opts.now ?? (() => new Date());
    this.timer = opts.timer ?? defaultTimer;
    this.random = opts.random ?? Math.random;
    this.dryRun = opts.dryRun ?? false;
    this.onTick = opts.onTick;
    this.nativeToken = opts.nativeToken ?? "emulate-sim";
    this.states = scenario.streams.map((spec) => ({ spec, seq: 0, handle: undefined }));
  }

  /** One tick per stream, sequentially. Ignores rate/maxCount — used by `--once`. */
  async runOnce(): Promise<void> {
    for (const st of this.states) await this.tick(st);
  }

  /** Run continuously; resolves when every stream hits maxCount, the duration
   *  elapses, or `stop()` is called. */
  start(): Promise<void> {
    const done = new Promise<void>((resolve) => (this.resolveDone = resolve));
    if (this.scenario.durationSec != null) {
      this.durationHandle = this.timer.set(() => this.finish(), this.scenario.durationSec * 1000);
    }
    for (const st of this.states) this.arm(st);
    return done;
  }

  /** Graceful stop: cancel everything and resolve `start()`. */
  stop(): void {
    this.finish();
  }

  // --- internals ----------------------------------------------------------

  private arm(st: StreamState): void {
    if (this.finished) return;
    const { intervalMs, jitter } = st.spec;
    const delay = intervalMs * (1 + (this.random() * 2 - 1) * jitter);
    st.handle = this.timer.set(
      () => {
        void this.onScheduled(st);
      },
      Math.max(0, delay),
    );
  }

  private async onScheduled(st: StreamState): Promise<void> {
    if (this.finished) return;
    await this.tick(st);
    if (this.finished) return;
    if (st.spec.maxCount != null && st.seq >= st.spec.maxCount) {
      if (this.states.every((s) => s.spec.maxCount != null && s.seq >= s.spec.maxCount)) this.finish();
      return; // this stream is done; do not re-arm
    }
    this.arm(st);
  }

  private async tick(st: StreamState): Promise<void> {
    const seq = st.seq++;
    const t = generate(st.spec.provider, seq, this.now());

    if (!this.dryRun) {
      if (t.kind === "sync") {
        const conn = encodeURIComponent(st.spec.connectionId);
        const model = encodeURIComponent(t.model);
        await this.post(`${this.base}/connections/${conn}/records/${model}`, { records: [t.record] });
        await this.post(`${this.base}/sync/trigger`, {
          connection_id: st.spec.connectionId,
          provider_config_key: st.spec.providerConfigKey,
          syncs: [`${st.spec.providerConfigKey}-sync`],
          model: t.model,
          added: 1,
        });
      } else if (t.kind === "forward") {
        const env = encodeURIComponent(st.spec.environmentUuid ?? "env");
        const pck = encodeURIComponent(st.spec.providerConfigKey);
        await this.post(`${this.base}/webhook/${env}/${pck}`, t.payload, {
          "Connection-Id": st.spec.connectionId,
        });
      } else {
        // Native write: the emulator's own webhook dispatch fires the event.
        await this.send(t.method, `${this.base}${st.spec.pathPrefix ?? ""}${t.path}`, t.body, {
          Authorization: `Bearer ${this.nativeToken}`,
        });
      }
    }

    this.onTick?.({ stream: st.spec.name, provider: st.spec.provider, kind: t.kind, seq });
  }

  private post(url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<void> {
    return this.send("POST", url, body, extraHeaders);
  }

  private async send(method: string, url: string, body: unknown, extraHeaders?: Record<string, string>): Promise<void> {
    try {
      await this.fetch(url, {
        method,
        headers: { "Content-Type": "application/json", ...extraHeaders },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // A streamed activity driver is best-effort: a transient emulator hiccup
      // must not abort the whole run.
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const st of this.states) if (st.handle != null) this.timer.clear(st.handle);
    if (this.durationHandle != null) this.timer.clear(this.durationHandle);
    this.resolveDone?.();
  }
}
