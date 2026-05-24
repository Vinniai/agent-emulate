import type { EmulateConfig, UnifiedUser } from "../config.js";

export interface MintedToken {
  token: string;
  login: string;
  scopes: string[];
}

const ROLE_SCOPES: Record<string, string[]> = {
  admin: ["repo", "user", "admin:org", "admin:repo_hook", "openid", "email", "profile"],
  technician: ["openid", "email", "profile", "User.Read"],
  user: ["openid", "email", "profile"],
};

function splitName(full?: string): { first: string; last: string } {
  if (!full) return { first: "Test", last: "User" };
  const parts = full.trim().split(/\s+/);
  return { first: parts[0] ?? "Test", last: parts.slice(1).join(" ") || "User" };
}

function isProviderEnabled(value: Record<string, unknown> | boolean | undefined): boolean {
  if (value === undefined) return false;
  if (typeof value === "boolean") return value;
  return true;
}

function asObject(value: Record<string, unknown> | boolean | undefined): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value : {};
}

function ensureArray(target: Record<string, unknown>, key: string): unknown[] {
  if (!Array.isArray(target[key])) target[key] = [];
  return target[key] as unknown[];
}

function ensureSection(config: EmulateConfig, service: string): Record<string, unknown> {
  if (!config[service] || typeof config[service] !== "object") {
    config[service] = {};
  }
  return config[service] as Record<string, unknown>;
}

function hasByKey(arr: unknown[], key: string, value: string): boolean {
  return arr.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const v = (entry as Record<string, unknown>)[key];
    return typeof v === "string" && v.toLowerCase() === value.toLowerCase();
  });
}

function hasByEmailList(arr: unknown[], email: string): boolean {
  return arr.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const list = (entry as Record<string, unknown>).email_addresses;
    return Array.isArray(list) && list.some((e) => typeof e === "string" && e.toLowerCase() === email.toLowerCase());
  });
}

/**
 * Fans out a unified `users[]` block into each emulator's expected seed shape.
 * Mutates `config` in place and returns the list of minted tokens.
 *
 * Precedence: existing per-service entries (e.g. `google.users`) are kept; users
 * from the unified block are appended only if not already present (matched by email/login).
 */
export function expandUnifiedUsers(config: EmulateConfig): MintedToken[] {
  const users = config.users;
  if (!Array.isArray(users) || users.length === 0) return [];

  const tokens: MintedToken[] = [];

  for (const user of users) {
    if (!user || !user.email || !user.id) continue;
    const role = user.role ?? "user";
    const scopes = ROLE_SCOPES[role] ?? ROLE_SCOPES.user;
    const token = user.token ?? `tok_${user.id}`;
    tokens.push({ token, login: user.email, scopes });

    const providers = user.providers ?? {};
    const { first, last } = splitName(user.name);
    const fullName = user.name ?? `${first} ${last}`.trim();

    if (isProviderEnabled(providers.google)) {
      const section = ensureSection(config, "google");
      const list = ensureArray(section, "users");
      if (!hasByKey(list, "email", user.email)) {
        list.push({ email: user.email, name: fullName, email_verified: true });
      }
    }

    if (isProviderEnabled(providers.microsoft)) {
      const section = ensureSection(config, "microsoft");
      const list = ensureArray(section, "users");
      if (!hasByKey(list, "email", user.email)) {
        list.push({ email: user.email, name: fullName });
      }
      const teams = (asObject(providers.microsoft).teams as string[] | undefined) ?? [];
      if (teams.length > 0) {
        const teamList = ensureArray(section, "teams");
        for (const teamName of teams) {
          let team = teamList.find(
            (t) => t && typeof t === "object" && (t as Record<string, unknown>).name === teamName,
          ) as Record<string, unknown> | undefined;
          if (!team) {
            team = { name: teamName, members: [] };
            teamList.push(team);
          }
          const members = ensureArray(team, "members");
          if (!members.includes(user.email)) members.push(user.email);
        }
      }
    }

    if (isProviderEnabled(providers.apple)) {
      const section = ensureSection(config, "apple");
      const list = ensureArray(section, "users");
      if (!hasByKey(list, "email", user.email)) list.push({ email: user.email, name: fullName });
    }

    if (isProviderEnabled(providers.okta)) {
      const section = ensureSection(config, "okta");
      const list = ensureArray(section, "users");
      if (!hasByKey(list, "email", user.email)) {
        list.push({ login: user.email, email: user.email, first_name: first, last_name: last });
      }
    }

    if (isProviderEnabled(providers.workos)) {
      const section = ensureSection(config, "workos");
      const list = ensureArray(section, "users");
      const wopts = asObject(providers.workos);
      const password = (wopts.password as string | undefined) ?? "Password123!";
      if (!hasByKey(list, "email", user.email)) {
        list.push({
          id: `user_${user.id}`,
          email: user.email,
          first_name: first,
          last_name: last,
          password,
          email_verified: true,
        });
      }
      // Ensure a default org + membership so password login can resolve org_id.
      const orgs = ensureArray(section, "organizations");
      const defaultOrgSlug = (wopts.organization_slug as string | undefined) ?? "emulate-org";
      if (!hasByKey(orgs, "slug", defaultOrgSlug)) {
        orgs.push({ id: `org_${defaultOrgSlug}`, name: "Emulate Org", slug: defaultOrgSlug });
      }
      const memberships = ensureArray(section, "memberships");
      const memberRole = role === "admin" ? "admin" : "member";
      const exists = memberships.some((m) => {
        if (!m || typeof m !== "object") return false;
        const r = m as Record<string, unknown>;
        return r.user_email === user.email && r.organization_slug === defaultOrgSlug;
      });
      if (!exists) {
        memberships.push({ user_email: user.email, organization_slug: defaultOrgSlug, role: memberRole });
      }
    }

    if (isProviderEnabled(providers.clerk)) {
      const section = ensureSection(config, "clerk");
      const list = ensureArray(section, "users");
      if (!hasByEmailList(list, user.email)) {
        list.push({ first_name: first, last_name: last, email_addresses: [user.email] });
      }
    }

    if (isProviderEnabled(providers.github)) {
      const section = ensureSection(config, "github");
      const list = ensureArray(section, "users");
      const login = (asObject(providers.github).login as string | undefined) ?? user.id;
      if (!hasByKey(list, "login", login)) list.push({ login, name: fullName, email: user.email });
    }

    if (isProviderEnabled(providers.vercel)) {
      const section = ensureSection(config, "vercel");
      const list = ensureArray(section, "users");
      if (!hasByKey(list, "email", user.email)) {
        list.push({ username: user.id, name: fullName, email: user.email });
      }
    }

    if (isProviderEnabled(providers.simpro)) {
      const section = ensureSection(config, "simpro");
      const list = ensureArray(section, "staff");
      if (!hasByKey(list, "email", user.email)) {
        const isAdmin = Boolean(asObject(providers.simpro).admin);
        list.push({ email: user.email, name: fullName, admin: isAdmin });
      }
    }

    if (isProviderEnabled(providers.uptick)) {
      const section = ensureSection(config, "uptick");
      const list = ensureArray(section, "users");
      if (!hasByKey(list, "email", user.email)) {
        list.push({ username: user.id, email: user.email, first_name: first, last_name: last });
      }
    }

    if (isProviderEnabled(providers.slack)) {
      const section = ensureSection(config, "slack");
      const list = ensureArray(section, "users");
      if (!hasByKey(list, "email", user.email)) {
        list.push({ name: user.id, real_name: fullName, email: user.email });
      }
    }
  }

  // Merge minted tokens into the config token map so they propagate through createServer.
  config.tokens = config.tokens ?? {};
  for (const t of tokens) {
    if (!config.tokens[t.token]) {
      config.tokens[t.token] = { login: t.login, scopes: t.scopes };
    }
  }

  return tokens;
}

export function listUnifiedUsers(config: EmulateConfig, tokens: MintedToken[]): Array<UnifiedUser & { token: string }> {
  const users = config.users ?? [];
  return users.map((u) => {
    const minted = tokens.find((t) => t.login === u.email);
    return { ...u, token: minted?.token ?? u.token ?? `tok_${u.id}` };
  });
}
