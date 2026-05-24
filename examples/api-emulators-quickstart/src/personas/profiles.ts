// Persona profiles — the *content* half of a persona run.
//
// A persona pairs a content dataset (who's emailing, what they're chatting
// about, which deals/leads/tickets flow through the CRM) with a scenario YAML
// (how fast, how many streams, how bursty). The driver (`run.ts`) registers
// native generators that close over this data, then streams the matching
// scenario into the live `apps/server` on :4000.
//
// Three personas, deliberately different in shape:
//   • large-org           — enterprise, high volume, every channel at once
//   • small-business      — a local trades shop, modest steady trickle
//   • inbound-enquiries   — support/sales intake: bursty chats, tickets, leads

export interface PersonaData {
  /** Customer / counterparty org names. */
  companies: string[];
  /** Human contacts (sender names, lead names, deal owners). */
  people: string[];
  /** Email domain(s) used to synthesise addresses. */
  emailDomains: string[];
  /** Email subject lines. */
  emailSubjects: string[];
  /** Short email / chat body lines. */
  bodies: string[];
  /** Free-form chat messages (Slack / Discord / Teams). */
  chatMessages: string[];
  /** Inbound enquiry text (Intercom conversations, Zendesk tickets). */
  enquiries: string[];
  /** Deal / opportunity titles. */
  dealTitles: string[];
  /** Deal values in whole dollars. */
  amounts: number[];
}

export interface PersonaProfile {
  label: string;
  /** Scenario file under `scenarios/personas/`. */
  scenario: string;
  /** One-line description of the simulated activity shape. */
  blurb: string;
  data: PersonaData;
}

const LARGE_ORG: PersonaProfile = {
  label: "Large organisation",
  scenario: "large-org.yaml",
  blurb: "Enterprise traffic — high-volume email, chat and CRM across every channel at once.",
  data: {
    companies: [
      "Northwind Logistics",
      "Contoso Manufacturing",
      "Fabrikam Energy",
      "Tailspin Aerospace",
      "Adventure Works Global",
      "Wingtip Financial",
    ],
    people: ["Dana Whitfield", "Marcus Lindgren", "Priya Raghunathan", "Sofia Almeida", "Tom Okafor", "Helen Zhao"],
    emailDomains: ["northwind.example", "contoso.example", "fabrikam.example"],
    emailSubjects: [
      "Q3 procurement framework — sign-off needed",
      "RE: Master services agreement renewal",
      "Vendor onboarding: security questionnaire",
      "Regional rollout plan v4 attached",
      "Escalation: SLA breach on tenant EU-2",
      "Board pack — please review by Friday",
    ],
    bodies: [
      "Looping in legal — see redlines in the attached.",
      "Approved on our side. Routing to procurement for PO.",
      "Can we move the steering call to Thursday 3pm?",
      "Numbers look right. One flag on the FX assumption.",
      "Confirming the migration window for the weekend.",
    ],
    chatMessages: [
      "Deploy to prod-eu finished ✅ — monitoring dashboards green",
      "Heads up: vendor demo pushed to 2pm, room 4.2",
      "Who owns the SOC2 evidence request? due EOD",
      "Incident #4471 resolved — RCA in the channel thread",
      "Reminder: change freeze starts Friday 18:00 UTC",
    ],
    enquiries: [
      "Our SSO login is rejecting SAML assertions since this morning.",
      "Requesting a quote for 500 additional enterprise seats.",
      "Can you confirm data residency options for the AU region?",
      "API rate limits seem lower than the contracted tier.",
      "Need an invoice reissued with our updated billing entity.",
    ],
    dealTitles: [
      "Enterprise platform expansion",
      "Multi-region rollout — phase 2",
      "Premium support uplift",
      "Data warehouse add-on",
      "3-year renewal + uplift",
    ],
    amounts: [180000, 92500, 410000, 56000, 1250000, 74800],
  },
};

const SMALL_BUSINESS: PersonaProfile = {
  label: "Small business",
  scenario: "small-business.yaml",
  blurb: "A local trades shop — a modest, steady trickle of email, team chat and CRM updates.",
  data: {
    companies: ["Bayside Cafe", "Hartman Plumbing", "Green Leaf Landscaping", "Corner St Dental", "Riverview Motors"],
    people: ["Jo Hartman", "Sam Reilly", "Mia Tran", "Dave Costa", "Ella Brooks"],
    emailDomains: ["hartmanplumbing.example", "greenleaf.example"],
    emailSubjects: [
      "Quote for hot water system replacement",
      "Booking confirmation — Tue 9am",
      "Invoice #1042 — payment received, thanks!",
      "Re: blocked drain at 14 Maple St",
      "Reminder: annual service due next week",
    ],
    bodies: [
      "Thanks for the quick callout yesterday — all sorted.",
      "Can you fit us in before the weekend?",
      "Payment's gone through, receipt attached.",
      "We'll send a tech out first thing Tuesday.",
      "Parts are in — booking you for Thursday morning.",
    ],
    chatMessages: [
      "Job at 14 Maple St done, invoice raised",
      "Van 2 needs a service, booking it Friday",
      "New 5-star review came in 🎉",
      "Low on copper fittings — reorder?",
      "Tomorrow: 3 jobs, all morning slots",
    ],
    enquiries: [
      "Hi, do you do emergency callouts on weekends?",
      "How much for a standard gas heater service?",
      "My kitchen tap is dripping — can someone come this week?",
      "Do you offer payment plans for bigger jobs?",
      "Can I get a copy of last year's invoice for warranty?",
    ],
    dealTitles: [
      "Hot water system install",
      "Bathroom reno — plumbing",
      "Annual maintenance plan",
      "Drain inspection + clear",
      "Gas fit-off — new kitchen",
    ],
    amounts: [1850, 320, 4200, 690, 2750],
  },
};

const INBOUND_ENQUIRIES: PersonaProfile = {
  label: "Inbound enquiries",
  scenario: "inbound-enquiries.yaml",
  blurb: "Sales + support intake — bursty live chats and tickets, leads landing in the CRM, auto-reply emails.",
  data: {
    companies: ["(prospect)", "(website visitor)", "(trial user)", "(existing customer)", "(partner referral)"],
    people: ["Alex Morgan", "Jordan Lee", "Casey Nguyen", "Riley Patel", "Quinn Foster", "Avery Sokolov"],
    emailDomains: ["gmail.example", "outlook.example", "fastmail.example"],
    emailSubjects: [
      "Thanks for reaching out — here's what's next",
      "Your demo is confirmed for tomorrow",
      "Re: pricing for the team plan",
      "We received your support request (#auto)",
      "Following up on your enquiry",
    ],
    bodies: [
      "Thanks for getting in touch! A specialist will follow up shortly.",
      "Here's the pricing breakdown you asked about.",
      "Booked you in for a demo — calendar invite attached.",
      "We've logged your request and are looking into it now.",
      "Appreciate your patience — update coming today.",
    ],
    chatMessages: [
      "🔔 New lead from pricing page — routing to sales",
      "Support queue at 6 — anyone free to grab one?",
      "Hot lead: asked for enterprise demo, tagged @sales",
      "Ticket SLA at risk on #2287, 12 min left",
      "Trial converted 🎉 — moving to onboarding",
    ],
    enquiries: [
      "Is there a free trial, and what are the limits?",
      "Can your product integrate with our existing CRM?",
      "I'm getting an error on checkout — card keeps declining.",
      "Do you have a plan for non-profits?",
      "How quickly can we get onboarded if we sign this week?",
      "Need help — can't reset my password, link expired.",
    ],
    dealTitles: [
      "Inbound — team plan",
      "Inbound — enterprise demo",
      "Website lead — starter",
      "Referral — annual",
      "Trial conversion",
    ],
    amounts: [4900, 24000, 1200, 8800, 3600],
  },
};

const NANGO_UNIFIED: PersonaProfile = {
  label: "Nango unified",
  scenario: "nango-unified.yaml",
  blurb:
    "CRM + accounting routed through the Nango emulator — Salesforce, HubSpot, Xero, QuickBooks under one service.",
  data: {
    companies: [
      "Helios Robotics",
      "Meridian Health Group",
      "Lumen Retail Co",
      "Atlas Freight",
      "Vertex Analytics",
      "Cobalt Studios",
    ],
    people: ["Rosa Delgado", "Ibrahim Khan", "Nina Petrova", "Wesley Cole", "Mei Lin", "Andre Dubois"],
    emailDomains: ["helios.example", "meridian.example", "lumen.example"],
    emailSubjects: [
      "Renewal paperwork attached",
      "Updated order for Q4",
      "Statement of work — countersigned",
      "Invoice query — line 3",
      "New PO raised, ref 88421",
    ],
    bodies: [
      "Sending the signed agreement now.",
      "Can you re-issue with our new billing address?",
      "All approved — go ahead and invoice.",
      "Order quantities confirmed for the quarter.",
      "Thanks, payment scheduled for the 30th.",
    ],
    chatMessages: [
      "New opp synced from Salesforce → Nango",
      "Xero invoice posted for Atlas Freight",
      "HubSpot deal moved to closed-won 🎉",
      "QuickBooks payment reconciled",
      "Nango sync run completed, 0 errors",
    ],
    enquiries: [
      "Can we consolidate billing across both entities?",
      "Requesting a revised quote with the partner discount.",
      "When does our current term renew?",
      "Please add two more seats to the existing order.",
      "Could you send the latest statement?",
    ],
    dealTitles: [
      "Platform licence — annual",
      "Implementation services",
      "Add-on module — analytics",
      "Support tier upgrade",
      "Multi-entity rollout",
    ],
    amounts: [48000, 132000, 21500, 9600, 275000, 64000],
  },
};

export const PERSONAS: Record<string, PersonaProfile> = {
  "large-org": LARGE_ORG,
  "small-business": SMALL_BUSINESS,
  "inbound-enquiries": INBOUND_ENQUIRIES,
  "nango-unified": NANGO_UNIFIED,
};

export const PERSONA_NAMES = Object.keys(PERSONAS);
