// Bounded webhook delivery retry with exponential backoff.
//
// A real provider does not give up after one POST: a transient blip on the
// consumer's endpoint is retried. Emulators that drive integrations must do
// the same or a briefly-unavailable consumer silently loses events. This is
// the single seam both the GitHub-style dispatcher (`@emulators/core`) and the
// Nango dispatcher (`@emulators/nango`) deliver through.
//
// A delivery is "successful" only on a 2xx. Any thrown error (network failure,
// timeout) OR a non-2xx response triggers a retry until the attempt budget is
// spent. `fetch`/`sleep` are injectable so tests are fast and deterministic.

export interface DeliverDeps {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  sleep?: (ms: number) => Promise<void>;
}

export interface RetryResult {
  status_code: number | null;
  success: boolean;
  /** How many attempts were actually made (1 = delivered first try). */
  attempts: number;
}

/**
 * Read the retry policy from the environment, per-call so tests can toggle it:
 *   EMULATE_WEBHOOK_RETRIES            total attempts (default 3, min 1)
 *   EMULATE_WEBHOOK_RETRY_BACKOFF_MS   base backoff ms (default 100, min 0;
 *                                      delay before retry i is base * 2**i)
 */
export function webhookRetryConfig(): { attempts: number; backoffMs: number } {
  const attempts = Math.max(1, Math.floor(Number(process.env.EMULATE_WEBHOOK_RETRIES) || 3));
  const raw = process.env.EMULATE_WEBHOOK_RETRY_BACKOFF_MS;
  const backoffMs = Math.max(0, Number(raw === undefined || raw === "" ? 100 : raw) || 0);
  return { attempts, backoffMs };
}

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * POST with bounded retry. Returns the outcome of the last attempt plus the
 * attempt count; never throws. Each attempt gets a fresh 10s timeout.
 */
export async function deliverWithRetry(url: string, init: RequestInit, deps?: DeliverDeps): Promise<RetryResult> {
  const { attempts, backoffMs } = webhookRetryConfig();
  const doFetch = deps?.fetch ?? (globalThis.fetch as (u: string, i?: RequestInit) => Promise<Response>);
  const sleep = deps?.sleep ?? defaultSleep;

  const result: RetryResult = { status_code: null, success: false, attempts: 0 };

  for (let i = 0; i < attempts; i++) {
    result.attempts = i + 1;
    try {
      const res = await doFetch(url, { ...init, signal: AbortSignal.timeout(10000) });
      result.status_code = res.status;
      result.success = res.ok;
      if (res.ok) return result;
    } catch {
      result.status_code = null;
      result.success = false;
    }
    if (i < attempts - 1 && backoffMs > 0) await sleep(backoffMs * 2 ** i);
  }
  return result;
}
