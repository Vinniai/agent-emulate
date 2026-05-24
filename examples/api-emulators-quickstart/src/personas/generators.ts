// Persona generators — the *activity* half of a persona run.
//
// Each function emits a `kind: "native"` tick: a direct REST write to a
// provider emulator's real API (paths verified against the live server). The
// stream's `pathPrefix` (e.g. `/google`) is prepended by the simulator engine,
// so a POST lands on `apps/server`'s `/:service/*` mount, gets dispatched to
// the provider emulator, and shows up on the aggregate `/_activity` stream —
// which is what the inspector renders live.
//
// Two flavours:
//   • one-shot   — gmail-send, slack-post, hubspot-contact, …: independent
//                  messages/records, good for raw volume.
//   • threaded   — gmail-thread, outlook-thread, slack-thread, discord-thread:
//                  driven by a shared `Conversations` model so each stream is a
//                  coherent set of inbound/outbound exchanges (Gmail send vs
//                  import, Slack thread_ts, alternating authors).
//
// Both stamp the timestamp they're handed (`now`) into the request body
// wherever the provider has a date field, so a time-compressed run (see
// timeline.ts) spreads the data across the simulated window. Everything is
// registered via `@emulators/simulator`'s public `registerGenerator()` — no
// fork of the package.

import { registerGenerator, type GeneratedTick, type GeneratorFn } from "@emulators/simulator";
import type { PersonaData } from "./profiles.js";
import { Conversations, type ConvMessage } from "./conversation.js";

const pick = <T>(arr: readonly T[], seq: number): T => arr[seq % arr.length];

function localPart(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

function emailFor(data: PersonaData, seq: number): string {
  const person = pick(data.people, seq);
  const domain = pick(data.emailDomains, seq);
  return `${localPart(person)}@${domain}`;
}

const ME = "team@agent-emulate.dev";

/** Pipedrive's `add_time` wants "YYYY-MM-DD HH:MM:SS". */
const pdTime = (now: Date): string => now.toISOString().slice(0, 19).replace("T", " ");
/** Slack ts is "<epoch>.<6 digits>". */
const slackTs = (now: Date): string => (now.getTime() / 1000).toFixed(6);

/** Build a base64url RFC822 message with threading headers when it's a reply. */
function rawMessage(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  now: Date;
  messageId?: string;
  inReplyTo?: string;
}): string {
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${opts.subject}`,
    `Date: ${opts.now.toUTCString()}`,
  ];
  if (opts.messageId) headers.push(`Message-ID: ${opts.messageId}`);
  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    headers.push(`References: ${opts.inReplyTo}`);
  }
  return Buffer.from([...headers, "", opts.body].join("\r\n"), "utf8").toString("base64url");
}

// --- One-shot email --------------------------------------------------------

function gmailSend(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/gmail/v1/users/me/messages/send",
    body: {
      raw: rawMessage({
        from: emailFor(data, seq),
        to: ME,
        subject: pick(data.emailSubjects, seq),
        body: pick(data.bodies, seq),
        now,
      }),
    },
  });
}

function outlookSend(data: PersonaData): GeneratorFn {
  return (seq) => ({
    kind: "native",
    method: "POST",
    path: "/v1.0/me/sendMail",
    body: {
      message: {
        subject: pick(data.emailSubjects, seq),
        body: { contentType: "HTML", content: `<p>${pick(data.bodies, seq)}</p>` },
        toRecipients: [{ emailAddress: { address: emailFor(data, seq) } }],
      },
      saveToSentItems: true,
    },
  });
}

function resendSend(data: PersonaData): GeneratorFn {
  return (seq) => ({
    kind: "native",
    method: "POST",
    path: "/emails",
    body: {
      from: "hello@agent-emulate.dev",
      to: emailFor(data, seq),
      subject: pick(data.emailSubjects, seq),
      html: `<p>${pick(data.bodies, seq)}</p>`,
    },
  });
}

// --- One-shot chat ----------------------------------------------------------

function slackPost(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/api/chat.postMessage",
    // "general" is a seeded channel resolvable by name on the slack emulator.
    body: { channel: "general", text: pick(data.chatMessages, seq), ts: slackTs(now) },
  });
}

function intercomConversation(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/conversations",
    body: {
      from: { type: "user", id: `visitor-${seq}` },
      body: pick(data.enquiries, seq),
      created_at: Math.floor(now.getTime() / 1000),
    },
  });
}

function discordPost(data: PersonaData): GeneratorFn {
  return (seq) => ({
    kind: "native",
    method: "POST",
    // The native-kit mounts the message collection under the literal `CHANNEL`.
    path: "/api/v10/channels/CHANNEL/messages",
    body: { content: pick(data.chatMessages, seq) },
  });
}

// --- One-shot CRM -----------------------------------------------------------

function hubspotContact(data: PersonaData): GeneratorFn {
  return (seq, now) => {
    const person = pick(data.people, seq);
    const [first, ...rest] = person.split(" ");
    return {
      kind: "native",
      method: "POST",
      path: "/crm/v3/objects/contacts",
      body: {
        properties: {
          email: emailFor(data, seq),
          firstname: first,
          lastname: rest.join(" ") || "—",
          company: pick(data.companies, seq),
          createdate: now.toISOString(),
        },
      },
    };
  };
}

function hubspotDeal(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/crm/v3/objects/deals",
    body: {
      properties: {
        dealname: pick(data.dealTitles, seq),
        amount: String(pick(data.amounts, seq)),
        dealstage: pick(["appointmentscheduled", "qualifiedtobuy", "presentationscheduled", "closedwon"], seq),
        createdate: now.toISOString(),
      },
    },
  });
}

function salesforceLead(data: PersonaData): GeneratorFn {
  return (seq) => {
    const person = pick(data.people, seq);
    const [first, ...rest] = person.split(" ");
    return {
      kind: "native",
      method: "POST",
      path: "/services/data/v60.0/sobjects/Lead",
      body: {
        FirstName: first,
        LastName: rest.join(" ") || "Lead",
        Company: pick(data.companies, seq),
        Email: emailFor(data, seq),
        Status: pick(["Open - Not Contacted", "Working - Contacted", "Qualified"], seq),
      },
    };
  };
}

function pipedrivePerson(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/v1/persons",
    body: { name: pick(data.people, seq), email: [emailFor(data, seq)], add_time: pdTime(now) },
  });
}

function pipedriveDeal(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/v1/deals",
    body: { title: pick(data.dealTitles, seq), value: pick(data.amounts, seq), currency: "AUD", add_time: pdTime(now) },
  });
}

function zohoLead(data: PersonaData): GeneratorFn {
  return (seq) => {
    const person = pick(data.people, seq);
    const [first, ...rest] = person.split(" ");
    return {
      kind: "native",
      method: "POST",
      path: "/crm/v3/Leads",
      body: {
        data: [
          {
            First_Name: first,
            Last_Name: rest.join(" ") || "Lead",
            Company: pick(data.companies, seq),
            Email: emailFor(data, seq),
          },
        ],
      },
    };
  };
}

function zendeskTicket(data: PersonaData): GeneratorFn {
  return (seq, now) => ({
    kind: "native",
    method: "POST",
    path: "/api/v2/tickets",
    body: {
      ticket: {
        subject: pick(data.enquiries, seq).slice(0, 60),
        comment: { body: pick(data.enquiries, seq) },
        priority: pick(["low", "normal", "high", "urgent"], seq),
        created_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
    },
  });
}

// --- Threaded (conversational) ---------------------------------------------
//
// Each pulls the next message in some live thread from a shared `Conversations`
// model and renders it per provider, mapping inbound/outbound to genuinely
// different endpoints or authors.

const subjectOf = (m: ConvMessage): string => (m.isReply ? `Re: ${m.subject}` : m.subject);

function gmailThread(conv: Conversations): GeneratorFn {
  return (_seq, now) => {
    const m = conv.next(now);
    const rootId = `<${m.threadId}.1@agent-emulate.dev>`;
    const raw = rawMessage({
      from: m.direction === "inbound" ? m.customerEmail : ME,
      to: m.direction === "inbound" ? ME : m.customerEmail,
      subject: subjectOf(m),
      body: m.body,
      now,
      messageId: `<${m.threadId}.${m.seqInThread}@agent-emulate.dev>`,
      inReplyTo: m.isReply ? rootId : undefined,
    });
    // Outbound = we send it; inbound = it arrives in the mailbox (import).
    const path = m.direction === "outbound" ? "/gmail/v1/users/me/messages/send" : "/gmail/v1/users/me/messages/import";
    return { kind: "native", method: "POST", path, body: { raw } };
  };
}

function outlookThread(conv: Conversations): GeneratorFn {
  return (_seq, now) => {
    const m = conv.next(now);
    if (m.direction === "outbound") {
      return {
        kind: "native",
        method: "POST",
        path: "/v1.0/me/sendMail",
        body: {
          message: {
            subject: subjectOf(m),
            body: { contentType: "HTML", content: `<p>${m.body}</p>` },
            toRecipients: [{ emailAddress: { address: m.customerEmail } }],
          },
          saveToSentItems: true,
        },
      };
    }
    // inbound — lands in the mailbox as a received message.
    return {
      kind: "native",
      method: "POST",
      path: "/v1.0/me/messages",
      body: {
        subject: subjectOf(m),
        body: { contentType: "HTML", content: `<p>${m.body}</p>` },
        from: { emailAddress: { address: m.customerEmail, name: m.customer } },
        conversationId: m.threadId,
        receivedDateTime: now.toISOString(),
        isRead: false,
      },
    };
  };
}

function slackThread(conv: Conversations): GeneratorFn {
  return (_seq, now) => {
    const m = conv.next(now);
    const marker = m.direction === "inbound" ? "📥" : "📤";
    const body: Record<string, unknown> = {
      channel: "general",
      text: `${marker} ${m.body}`,
      ts: slackTs(now),
      username: m.direction === "inbound" ? m.customer : "Support",
    };
    // Replies hang off the thread root via thread_ts (we own the timeline).
    if (m.isReply) body.thread_ts = `${m.rootTsSec}.000001`;
    return { kind: "native", method: "POST", path: "/api/chat.postMessage", body };
  };
}

function discordThread(conv: Conversations): GeneratorFn {
  return (_seq, now) => {
    const m = conv.next(now);
    const marker = m.direction === "inbound" ? "📥" : "📤";
    return {
      kind: "native",
      method: "POST",
      path: "/api/v10/channels/CHANNEL/messages",
      body: {
        content: `[${m.threadId} #${m.seqInThread}] ${marker} ${m.body}`,
        timestamp: now.toISOString(),
      },
    };
  };
}

// --- Registration -----------------------------------------------------------

const THREADED = ["gmail-thread", "outlook-thread", "slack-thread", "discord-thread"] as const;
type ThreadedKey = (typeof THREADED)[number];

export interface PersonaGenerators {
  /** One `Conversations` per threaded provider, for printing a sample transcript. */
  conversations: Record<ThreadedKey, Conversations>;
}

/**
 * Register every persona generator, closed over `data`. Scenario YAMLs
 * reference these provider keys. Returns the conversation models so the driver
 * can show a sample inbound/outbound thread after a run. `random` is forwarded
 * to the conversation models for reproducible runs.
 */
export function registerPersonaGenerators(data: PersonaData, opts: { random?: () => number } = {}): PersonaGenerators {
  // one-shot
  registerGenerator("gmail-send", gmailSend(data));
  registerGenerator("outlook-send", outlookSend(data));
  registerGenerator("resend-send", resendSend(data));
  registerGenerator("slack-post", slackPost(data));
  registerGenerator("intercom-convo", intercomConversation(data));
  registerGenerator("discord-post", discordPost(data));
  registerGenerator("hubspot-contact", hubspotContact(data));
  registerGenerator("hubspot-deal", hubspotDeal(data));
  registerGenerator("salesforce-lead", salesforceLead(data));
  registerGenerator("pipedrive-person", pipedrivePerson(data));
  registerGenerator("pipedrive-deal", pipedriveDeal(data));
  registerGenerator("zoho-lead", zohoLead(data));
  registerGenerator("zendesk-ticket", zendeskTicket(data));

  // threaded — one Conversations instance per provider
  const conversations = {
    "gmail-thread": new Conversations(data, opts),
    "outlook-thread": new Conversations(data, opts),
    "slack-thread": new Conversations(data, opts),
    "discord-thread": new Conversations(data, opts),
  } satisfies Record<ThreadedKey, Conversations>;
  registerGenerator("gmail-thread", gmailThread(conversations["gmail-thread"]));
  registerGenerator("outlook-thread", outlookThread(conversations["outlook-thread"]));
  registerGenerator("slack-thread", slackThread(conversations["slack-thread"]));
  registerGenerator("discord-thread", discordThread(conversations["discord-thread"]));

  return { conversations };
}

/** Channel grouping — used by the driver to label tick output. */
export const CHANNEL_OF: Record<string, "email" | "chat" | "crm"> = {
  "gmail-send": "email",
  "outlook-send": "email",
  "resend-send": "email",
  "gmail-thread": "email",
  "outlook-thread": "email",
  "slack-post": "chat",
  "intercom-convo": "chat",
  "discord-post": "chat",
  "slack-thread": "chat",
  "discord-thread": "chat",
  "hubspot-contact": "crm",
  "hubspot-deal": "crm",
  "salesforce-lead": "crm",
  "pipedrive-person": "crm",
  "pipedrive-deal": "crm",
  "zoho-lead": "crm",
  "zendesk-ticket": "crm",
};
