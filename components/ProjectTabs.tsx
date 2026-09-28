import Link from "next/link";

export const PROJECT_TABS = [
  { key: "prezentare", label: "Prezentare" },
  { key: "trafic", label: "Trafic" },
  { key: "google", label: "Google" },
  { key: "bani", label: "Bani" },
  { key: "reclame", label: "Reclame" },
  { key: "social", label: "Social" },
  { key: "facturi", label: "Facturi" },
  { key: "conexiuni", label: "Conexiuni" },
] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number]["key"];

export function parseTab(v: string | string[] | undefined): ProjectTab {
  // tabul vechi „Costuri” e acum in „Bani”
  if (v === "costuri") return "bani";
  return PROJECT_TABS.find((t) => t.key === v)?.key ?? "prezentare";
}

// Taburile paginii de proiect; pastreaza perioada aleasa (days) cand schimbi tabul
export function ProjectTabs({ basePath, tab, days }: { basePath: string; tab: ProjectTab; days: number }) {
  return (
    <nav className="-mx-1 overflow-x-auto border-b border-border" aria-label="Secțiunile proiectului">
      <div className="flex min-w-max gap-1 px-1">
        {PROJECT_TABS.map((t) => (
          <Link
            key={t.key}
            href={`${basePath}?tab=${t.key}&days=${days}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm whitespace-nowrap ${
              t.key === tab ? "border-accent text-text font-medium" : "border-transparent text-text-2 hover:text-text"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
}

// Tab fara conexiune: spune ce trebuie legat, in loc sa ascunda sectiunea
export function NotConnected({ title, text, basePath, days }: { title: string; text: string; basePath: string; days: number }) {
  return (
    <div className="card p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-text-2">{text}</p>
      <Link href={`${basePath}?tab=conexiuni&days=${days}`} className="mt-5 inline-block rounded-md bg-accent px-4 py-2 text-sm text-white">
        Mergi la Conexiuni
      </Link>
    </div>
  );
}
