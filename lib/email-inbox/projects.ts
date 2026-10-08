// Aplicatiile ale caror e-mailuri intra in inboxul mydashboard (DOAR aplicatiile; print are inboxul lui in
// adminul ShopPrint, platformele 3D vor avea panoul lor). Cheia = numele proiectului din mydashboard cu litere mici
// (ca la /api/mydashboard/stats). Fisier fara Prisma, folosit si in componentele client.

export const MAIL_PROJECTS = {
  ai365: { name: "ai365", domain: "ai365.ro" },
  anexa1: { name: "anexa1", domain: "anexa1.ro" },
  bazadate: { name: "bazadate", domain: "bazadate.ro" },
  beneficiari: { name: "beneficiari", domain: "beneficiari.ro" },
  constelatii: { name: "constelatii", domain: "constelatii.com" },
  invitonline: { name: "invitonline", domain: "invitonline.ro" },
  oferte: { name: "oferte", domain: "oferte.net" },
  postingclips: { name: "PostingClips", domain: "postingclips.com" },
  tiparementale: { name: "tiparementale", domain: "tiparementale.ro" },
  mydashboard: { name: "mydashboard", domain: "mydashboard.ro" },
} as const;

export type MailProjectKey = keyof typeof MAIL_PROJECTS;
export const PROJECT_KEYS = Object.keys(MAIL_PROJECTS) as MailProjectKey[];
export const isProjectKey = (k: unknown): k is MailProjectKey => typeof k === "string" && k in MAIL_PROJECTS;
export const projectLabel = (k: string | null | undefined) => (isProjectKey(k) ? MAIL_PROJECTS[k].name : k || "");

const domainOf = (addr: string | null | undefined) => String(addr || "").toLowerCase().trim().split("@").pop() || "";

/** Aplicatia careia ii apartine o adresa (contact@bazadate.ro → bazadate; si subdomeniile). */
export function projectOfAddress(addr: string | null | undefined): MailProjectKey | undefined {
  const dom = domainOf(addr);
  if (!dom || !String(addr).includes("@")) return undefined;
  return PROJECT_KEYS.find((k) => dom === MAIL_PROJECTS[k].domain || dom.endsWith(`.${MAIL_PROJECTS[k].domain}`));
}

export const isOwnAddress = (addr: string | null | undefined) => Boolean(projectOfAddress(addr));

/** Proiectul din mydashboard (Project) pentru o cheie: dupa domeniu sau dupa nume. */
export function matchProject<T extends { name: string; domain: string | null }>(key: string | null | undefined, projects: T[]): T | undefined {
  if (!isProjectKey(key)) return undefined;
  const p = MAIL_PROJECTS[key];
  const clean = (d: string | null) => String(d || "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return projects.find((x) => clean(x.domain) === p.domain) || projects.find((x) => x.name.trim().toLowerCase() === key);
}

/** Cheia aplicatiei pentru un proiect din mydashboard (invers fata de matchProject). */
export function keyOfProject(p: { name: string; domain: string | null }): MailProjectKey | undefined {
  return PROJECT_KEYS.find((k) => matchProject(k, [p]));
}

/** Cheia aplicatiei dintr-un nume sau domeniu oarecare („PostingClips”, „www.bazadate.ro”, „bazadate”); altfel undefined. */
export function projectKeyOf(s: string | null | undefined): MailProjectKey | undefined {
  const v = String(s || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!v) return undefined;
  return PROJECT_KEYS.find((k) => k === v || MAIL_PROJECTS[k].name.toLowerCase() === v || MAIL_PROJECTS[k].domain === v || v.endsWith(`.${MAIL_PROJECTS[k].domain}`));
}
