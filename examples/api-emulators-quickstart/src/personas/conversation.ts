// Conversation threads — coherent inbound/outbound message exchanges.
//
// A one-shot generator emits independent messages; that's fine for volume but
// it isn't a *conversation*. This models real threads: a customer opens a
// thread (inbound), we reply (outbound), they follow up (inbound) — alternating
// direction, sharing a thread id + subject, with timestamps that march forward
// across the (compressed) timeline.
//
// `next(now)` either opens a new thread or advances an existing open one, so a
// single stream interleaves several live threads at once — the shape of a real
// inbox or support channel. Each conversational provider generator renders a
// `ConvMessage` into its API's native request (Gmail send vs import, Slack
// thread_ts, …), so direction maps to genuinely different endpoints/authors.

import type { PersonaData } from "./profiles.js";

export type Direction = "inbound" | "outbound";

export interface ConvMessage {
  threadId: string;
  /** Epoch seconds of the thread's first message — Slack `thread_ts`, mail References. */
  rootTsSec: number;
  /** 1-based position within the thread. */
  seqInThread: number;
  /** Root subject; replies render as "Re: <subject>". */
  subject: string;
  isReply: boolean;
  /** inbound = customer → us; outbound = us → customer. */
  direction: Direction;
  /** The customer/counterparty on the other side of the thread. */
  customer: string;
  customerEmail: string;
  body: string;
  /** When this message occurred (virtual clock). */
  now: Date;
}

interface Thread {
  id: string;
  subject: string;
  customer: string;
  customerEmail: string;
  rootTsSec: number;
  count: number;
  lastDirection: Direction;
}

const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length];

function localPart(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

export interface ConversationOptions {
  /** Max threads alive at once. */
  maxOpen?: number;
  /** A thread closes after this many messages. */
  maxLength?: number;
  /** [0,1) RNG — injectable for reproducible runs/tests. */
  random?: () => number;
}

export class Conversations {
  private readonly maxOpen: number;
  private readonly maxLength: number;
  private readonly random: () => number;
  private readonly open: Thread[] = [];
  private counter = 0;
  /** Every message emitted, capped — lets the driver print a sample transcript. */
  readonly log: ConvMessage[] = [];

  constructor(
    private readonly data: PersonaData,
    opts: ConversationOptions = {},
  ) {
    this.maxOpen = opts.maxOpen ?? 6;
    this.maxLength = opts.maxLength ?? 4;
    this.random = opts.random ?? Math.random;
  }

  /** Open a new thread or advance an open one; returns the next message. */
  next(now: Date): ConvMessage {
    const shouldOpen = this.open.length === 0 || (this.open.length < this.maxOpen && this.random() < 0.45);
    const msg = shouldOpen ? this.openThread(now) : this.advanceThread(now);
    if (this.log.length < 500) this.log.push(msg);
    return msg;
  }

  /** Threads grouped by id (insertion order preserved). */
  threads(): ConvMessage[][] {
    const byId = new Map<string, ConvMessage[]>();
    for (const m of this.log) {
      const arr = byId.get(m.threadId) ?? [];
      arr.push(m);
      byId.set(m.threadId, arr);
    }
    return [...byId.values()];
  }

  /** A thread with at least `minLen` messages, for a demo transcript. */
  sampleThread(minLen = 2): ConvMessage[] | undefined {
    return this.threads().find((t) => t.length >= minLen);
  }

  private openThread(now: Date): ConvMessage {
    const n = this.counter++;
    const customer = pick(this.data.people, n);
    const t: Thread = {
      id: `thr-${String(n).padStart(4, "0")}`,
      subject: pick(this.data.emailSubjects, n),
      customer,
      customerEmail: `${localPart(customer)}@${pick(this.data.emailDomains, n)}`,
      rootTsSec: Math.floor(now.getTime() / 1000),
      count: 1,
      lastDirection: "inbound",
    };
    this.open.push(t);
    return {
      threadId: t.id,
      rootTsSec: t.rootTsSec,
      seqInThread: 1,
      subject: t.subject,
      isReply: false,
      direction: "inbound",
      customer: t.customer,
      customerEmail: t.customerEmail,
      body: pick(this.data.enquiries, n),
      now,
    };
  }

  private advanceThread(now: Date): ConvMessage {
    const idx = Math.floor(this.random() * this.open.length);
    const t = this.open[idx];
    const direction: Direction = t.lastDirection === "inbound" ? "outbound" : "inbound";
    t.lastDirection = direction;
    t.count += 1;
    const seqInThread = t.count;

    // inbound follow-ups read like the customer; outbound like our reply copy.
    const body = direction === "outbound" ? pick(this.data.bodies, t.count) : pick(this.data.enquiries, t.count + 1);

    if (t.count >= this.maxLength) this.open.splice(idx, 1); // thread complete

    return {
      threadId: t.id,
      rootTsSec: t.rootTsSec,
      seqInThread,
      subject: t.subject,
      isReply: true,
      direction,
      customer: t.customer,
      customerEmail: t.customerEmail,
      body,
      now,
    };
  }
}
