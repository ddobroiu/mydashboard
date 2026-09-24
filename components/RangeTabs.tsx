import Link from "next/link";

export const RANGES = [7, 30, 90] as const;

export function parseRange(v: string | string[] | undefined): number {
  const n = Number(v);
  return (RANGES as readonly number[]).includes(n) ? n : 30;
}

export function RangeTabs({ basePath, days }: { basePath: string; days: number }) {
  return (
    <div className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
      {RANGES.map((r) => (
        <Link
          key={r}
          href={`${basePath}?days=${r}`}
          className={`px-3 py-1 rounded-md ${r === days ? "bg-accent text-white" : "text-text-2 hover:text-text"}`}
        >
          {r} zile
        </Link>
      ))}
    </div>
  );
}
