import { addDays } from "@/lib/dates";

// Costul real al API-urilor AI, din conturile de organizatie (cheie Admin, doar citire):
// Anthropic (Usage & Cost Admin API) si OpenAI (Costs + Usage API). O cheie pe cont, nu pe proiect;
// proiectele se leaga de workspace-uri (Anthropic, wrkspc_...) sau proiecte (OpenAI, proj_...).
// Zilele sunt zile UTC, ca in rapoartele lor. Cheile nu se scriu niciodata in loguri sau in erori.

export type AiAdminCredentials = { adminKey: string };

export type ApiCostRow = {
  date: string;
  // wrkspc_... / proj_... sau "default" (workspace-ul / proiectul implicit)
  externalId: string;
  // modelul, sau descrierea costului cand nu tine de un model
  model: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  requests: number;
};

export const DEFAULT_ID = "default";

// Fereastra [since, until] ca intervale UTC; ziua de azi nu e inca incheiata, o lasam pe maine.
export function utcWindow(since: string, until: string, now = new Date()) {
  const yesterday = addDays(now.toISOString().slice(0, 10), -1);
  const last = until < yesterday ? until : yesterday;
  return { since, until: last, empty: since > last };
}

const sumRows = (rows: Map<string, ApiCostRow>, r: Omit<ApiCostRow, "costUsd" | "inputTokens" | "outputTokens" | "cachedTokens" | "requests"> & Partial<ApiCostRow>) => {
  const key = `${r.date}|${r.externalId}|${r.model}`;
  const g = rows.get(key) ?? { date: r.date, externalId: r.externalId, model: r.model, costUsd: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, requests: 0 };
  g.costUsd += r.costUsd ?? 0;
  g.inputTokens += r.inputTokens ?? 0;
  g.outputTokens += r.outputTokens ?? 0;
  g.cachedTokens += r.cachedTokens ?? 0;
  g.requests += r.requests ?? 0;
  rows.set(key, g);
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// Mesajul de eroare al API-ului, fara nimic din cerere (cheia sta in antete, nu apare aici)
async function readJson(res: Response, who: string) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message ?? body?.error?.type ?? res.statusText;
    throw new Error(`${who}: ${res.status} ${String(msg).slice(0, 200)}`);
  }
  return body;
}

// ─── Anthropic ─────────────────────────────────────────────────────────────

type AnthropicPage<T> = { data: { starting_at: string; ending_at: string; results: T[] }[]; has_more: boolean; next_page: string | null };

export type AnthropicCostResult = {
  // in centi de dolar, ca text zecimal: "123.45" = 1,2345 USD
  amount: string;
  currency?: string;
  workspace_id: string | null;
  description: string | null;
  model: string | null;
  cost_type?: string | null;
  token_type?: string | null;
};

export type AnthropicUsageResult = {
  workspace_id: string | null;
  model: string | null;
  uncached_input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation?: { ephemeral_1h_input_tokens?: number; ephemeral_5m_input_tokens?: number };
  output_tokens?: number;
};

async function anthropicGet(c: AiAdminCredentials, path: string, params: [string, string][]) {
  const url = `https://api.anthropic.com${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { "x-api-key": c.adminKey, "anthropic-version": "2023-06-01", "user-agent": "mydashboard.ro/1.0" },
    cache: "no-store",
  });
  return readJson(res, "Anthropic");
}

// Toate paginile unui raport (has_more / next_page)
async function anthropicReport<T>(c: AiAdminCredentials, path: string, params: [string, string][]) {
  const pages: AnthropicPage<T>[] = [];
  let page: string | null = null;
  for (let i = 0; i < 100; i++) {
    const body: AnthropicPage<T> = await anthropicGet(c, path, page ? [...params, ["page", page]] : params);
    pages.push(body);
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return pages;
}

// Parsarea, separat de cereri, ca sa poata fi verificata pe exemplele din documentatie
export function parseAnthropic(costPages: AnthropicPage<AnthropicCostResult>[], usagePages: AnthropicPage<AnthropicUsageResult>[]): ApiCostRow[] {
  const rows = new Map<string, ApiCostRow>();
  for (const p of costPages)
    for (const b of p.data ?? [])
      for (const r of b.results ?? []) {
        if (r.currency && r.currency.toUpperCase() !== "USD") continue;
        sumRows(rows, {
          date: b.starting_at.slice(0, 10),
          externalId: r.workspace_id ?? DEFAULT_ID,
          model: r.model ?? r.description ?? "altele",
          costUsd: num(r.amount) / 100,
        });
      }
  for (const p of usagePages)
    for (const b of p.data ?? [])
      for (const r of b.results ?? []) {
        const cached = num(r.cache_read_input_tokens);
        const written = num(r.cache_creation?.ephemeral_1h_input_tokens) + num(r.cache_creation?.ephemeral_5m_input_tokens);
        sumRows(rows, {
          date: b.starting_at.slice(0, 10),
          externalId: r.workspace_id ?? DEFAULT_ID,
          model: r.model ?? "altele",
          inputTokens: num(r.uncached_input_tokens) + cached + written,
          cachedTokens: cached,
          outputTokens: num(r.output_tokens),
        });
      }
  return [...rows.values()];
}

export async function fetchAnthropicCosts(c: AiAdminCredentials, since: string, until: string): Promise<ApiCostRow[]> {
  const w = utcWindow(since, until);
  if (w.empty) return [];
  const range: [string, string][] = [
    ["starting_at", `${w.since}T00:00:00Z`],
    ["ending_at", `${addDays(w.until, 1)}T00:00:00Z`],
    ["bucket_width", "1d"],
    ["limit", "31"],
  ];
  const cost = await anthropicReport<AnthropicCostResult>(c, "/v1/organizations/cost_report", [
    ...range,
    ["group_by[]", "workspace_id"],
    ["group_by[]", "description"],
  ]);
  const usage = await anthropicReport<AnthropicUsageResult>(c, "/v1/organizations/usage_report/messages", [
    ...range,
    ["group_by[]", "workspace_id"],
    ["group_by[]", "model"],
  ]);
  return parseAnthropic(cost, usage);
}

// Verifica cheia (doar o cheie Admin poate lista workspace-urile) si aduce numele lor
export async function anthropicWorkspaces(c: AiAdminCredentials): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  let after: string | null = null;
  for (let i = 0; i < 20; i++) {
    const params: [string, string][] = [["limit", "1000"], ["include_archived", "true"]];
    if (after) params.push(["after_id", after]);
    const body: { data: { id: string; name: string }[]; has_more: boolean; last_id: string | null } = await anthropicGet(
      c,
      "/v1/organizations/workspaces",
      params,
    );
    for (const w of body.data ?? []) names[w.id] = w.name;
    if (!body.has_more || !body.last_id) break;
    after = body.last_id;
  }
  return names;
}

// ─── OpenAI ────────────────────────────────────────────────────────────────

type OpenAIPage<T> = { data: { start_time: number; end_time: number; results: T[] }[]; has_more: boolean; next_page: string | null };

export type OpenAICostResult = {
  // in dolari
  amount?: { value: number | string; currency?: string };
  line_item: string | null;
  project_id: string | null;
};

export type OpenAIUsageResult = {
  project_id: string | null;
  model: string | null;
  input_tokens?: number;
  output_tokens?: number;
  input_cached_tokens?: number;
  num_model_requests?: number;
};

async function openaiGet(c: AiAdminCredentials, path: string, params: [string, string][]) {
  const url = `https://api.openai.com${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${c.adminKey}`, "content-type": "application/json", "user-agent": "mydashboard.ro/1.0" },
    cache: "no-store",
  });
  return readJson(res, "OpenAI");
}

async function openaiReport<T>(c: AiAdminCredentials, path: string, params: [string, string][]) {
  const pages: OpenAIPage<T>[] = [];
  let page: string | null = null;
  for (let i = 0; i < 100; i++) {
    const body: OpenAIPage<T> = await openaiGet(c, path, page ? [...params, ["page", page]] : params);
    pages.push(body);
    if (!body.has_more || !body.next_page) break;
    page = body.next_page;
  }
  return pages;
}

// „gpt-4o-2024-08-06, input” -> „gpt-4o-2024-08-06”, ca sa se lipeasca de tokenii aceluiasi model
export const openaiItemModel = (lineItem: string | null) => (lineItem ? lineItem.split(",")[0].trim() || lineItem : "altele");

const utcDay = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10);

export function parseOpenAI(costPages: OpenAIPage<OpenAICostResult>[], usagePages: OpenAIPage<OpenAIUsageResult>[]): ApiCostRow[] {
  const rows = new Map<string, ApiCostRow>();
  for (const p of costPages)
    for (const b of p.data ?? [])
      for (const r of b.results ?? []) {
        if (r.amount?.currency && r.amount.currency.toLowerCase() !== "usd") continue;
        sumRows(rows, {
          date: utcDay(b.start_time),
          externalId: r.project_id ?? DEFAULT_ID,
          model: openaiItemModel(r.line_item),
          costUsd: num(r.amount?.value),
        });
      }
  for (const p of usagePages)
    for (const b of p.data ?? [])
      for (const r of b.results ?? [])
        sumRows(rows, {
          date: utcDay(b.start_time),
          externalId: r.project_id ?? DEFAULT_ID,
          model: r.model ?? "altele",
          inputTokens: num(r.input_tokens),
          cachedTokens: num(r.input_cached_tokens),
          outputTokens: num(r.output_tokens),
          requests: num(r.num_model_requests),
        });
  return [...rows.values()];
}

const unix = (day: string) => String(Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000));

export async function fetchOpenAICosts(c: AiAdminCredentials, since: string, until: string): Promise<ApiCostRow[]> {
  const w = utcWindow(since, until);
  if (w.empty) return [];
  const range: [string, string][] = [
    ["start_time", unix(w.since)],
    ["end_time", unix(addDays(w.until, 1))],
    ["bucket_width", "1d"],
  ];
  const cost = await openaiReport<OpenAICostResult>(c, "/v1/organization/costs", [
    ...range,
    ["limit", "180"],
    ["group_by", "project_id"],
    ["group_by", "line_item"],
  ]);
  const usage = await openaiReport<OpenAIUsageResult>(c, "/v1/organization/usage/completions", [
    ...range,
    ["limit", "31"],
    ["group_by", "project_id"],
    ["group_by", "model"],
  ]);
  return parseOpenAI(cost, usage);
}

// Verifica cheia (doar o cheie Admin poate lista proiectele) si aduce numele lor
export async function openaiProjects(c: AiAdminCredentials): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  let after: string | null = null;
  for (let i = 0; i < 50; i++) {
    const params: [string, string][] = [["limit", "100"], ["include_archived", "true"]];
    if (after) params.push(["after", after]);
    const body: { data: { id: string; name: string }[]; has_more: boolean; last_id: string | null } = await openaiGet(
      c,
      "/v1/organization/projects",
      params,
    );
    for (const p of body.data ?? []) names[p.id] = p.name;
    if (!body.has_more || !body.last_id) break;
    after = body.last_id;
  }
  return names;
}

export const AI_ADMIN = {
  ANTHROPIC_ADMIN: {
    name: "Anthropic",
    keyPrefix: "sk-ant-admin",
    idPrefix: "wrkspc_",
    idLabel: "workspace",
    fetch: fetchAnthropicCosts,
    names: anthropicWorkspaces,
    keyHint: "Console Anthropic → Settings → Admin keys → Create admin key (sk-ant-admin…). Contul trebuie să fie organizație.",
  },
  OPENAI_ADMIN: {
    name: "OpenAI",
    keyPrefix: "sk-admin-",
    idPrefix: "proj_",
    idLabel: "proiect",
    fetch: fetchOpenAICosts,
    names: openaiProjects,
    keyHint: "platform.openai.com → Settings → Organization → Admin keys → Create new admin key (sk-admin-…), cu drept doar de citire dacă ți se oferă.",
  },
} as const;

export type AiAdminProvider = keyof typeof AI_ADMIN;
export const AI_ADMIN_PROVIDERS = Object.keys(AI_ADMIN) as AiAdminProvider[];
export const isAiAdminProvider = (p: string): p is AiAdminProvider => p in AI_ADMIN;
