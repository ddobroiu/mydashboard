import { dayKey } from "@/lib/dates";

// Replicate: tokenul API + (optional) modelele proiectului. Acelasi cont
// Replicate poate fi folosit de mai multe proiecte; fiecare isi alege modelele.
export type ReplicateCredentials = {
  apiToken: string;
  // "firtoz/trellis, black-forest-labs/flux-1.1-pro" — gol = toate
  models?: string;
};

export type AiUsageRow = {
  date: string;
  model: string;
  isGeneration: boolean;
  runs: number;
  failed: number;
  seconds: number;
  costUsd: number;
};

// Tarife Replicate (replicate.com/pricing, septembrie 2026). Modelele platite
// pe secunda: durata x pretul GPU-ului; modelele oficiale: pret fix pe rulare.
const GPU = { cpu: 0.0001, t4: 0.000225, l40s: 0.000975, a100: 0.0014, h100: 0.001525 };

type Rate = { perSecond?: number; perRun?: number; generation?: boolean };

export const MODEL_RATES: Record<string, Rate> = {
  "firtoz/trellis": { perSecond: GPU.a100, generation: true },
  "tencent/hunyuan3d-2mv": { perSecond: GPU.l40s, generation: true },
  "tencent/hunyuan3d-2": { perSecond: GPU.l40s, generation: true },
  "black-forest-labs/flux-1.1-pro": { perRun: 0.04 },
  "black-forest-labs/flux-schnell": { perRun: 0.003 },
  "black-forest-labs/flux-dev": { perRun: 0.025 },
  "nightmareai/real-esrgan": { perSecond: GPU.t4 },
  // Modelele de text (Llama) se platesc pe token; costul e neglijabil, il estimam pe CPU
  "meta/meta-llama-3-8b-instruct": { perRun: 0.0005 },
  "meta/meta-llama-3-70b-instruct": { perRun: 0.003 },
};

// Model necunoscut: presupunem GPU L40S (cel mai des folosit) si il marcam ca 3D daca numele o spune
function rateFor(model: string): Rate {
  return MODEL_RATES[model] ?? { perSecond: GPU.l40s, generation: /3d|trellis|mesh|hunyuan/i.test(model) };
}

type Prediction = {
  id: string;
  model?: string;
  version?: string;
  status: string;
  created_at: string;
  metrics?: { predict_time?: number };
};

async function api<T>(c: ReplicateCredentials, url: string): Promise<T> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${c.apiToken}` }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Replicate: ${body.detail ?? body.title ?? res.statusText}`);
  return body as T;
}

export async function testReplicate(c: ReplicateCredentials) {
  return api<{ username: string; type: string }>(c, "https://api.replicate.com/v1/account");
}

const modelFilter = (c: ReplicateCredentials) =>
  new Set(
    (c.models ?? "")
      .split(/[\s,]+/)
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean),
  );

// Rularile din [since, until], adunate pe zi si model. Replicate le da de la
// cea mai noua la cea mai veche, deci ne oprim cand trecem de `since`.
export async function fetchReplicateUsage(c: ReplicateCredentials, since: string, until: string): Promise<AiUsageRow[]> {
  const only = modelFilter(c);
  const groups = new Map<string, AiUsageRow>();
  let url: string | null = "https://api.replicate.com/v1/predictions";

  for (let page = 0; url && page < 500; page++) {
    const body: { results: Prediction[]; next: string | null } = await api(c, url);
    let older = false;
    for (const p of body.results) {
      const date = dayKey(new Date(p.created_at));
      if (date < since) {
        older = true;
        continue;
      }
      if (date > until) continue;
      if (p.status === "starting" || p.status === "processing") continue;
      const model = (p.model ?? p.version ?? "necunoscut").toLowerCase();
      if (only.size && !only.has(model)) continue;

      const rate = rateFor(model);
      const seconds = p.metrics?.predict_time ?? 0;
      // Modelele oficiale taxeaza doar rularile reusite; cele pe secunda taxeaza timpul folosit
      const cost = rate.perRun !== undefined ? (p.status === "succeeded" ? rate.perRun : 0) : seconds * (rate.perSecond ?? 0);

      const key = `${date}|${model}`;
      const g = groups.get(key) ?? { date, model, isGeneration: !!rate.generation, runs: 0, failed: 0, seconds: 0, costUsd: 0 };
      if (p.status === "succeeded") g.runs += 1;
      else g.failed += 1;
      g.seconds += seconds;
      g.costUsd += cost;
      groups.set(key, g);
    }
    url = older ? null : body.next;
  }
  return [...groups.values()];
}
