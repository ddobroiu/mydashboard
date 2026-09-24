import Link from "next/link";
import { LayoutGrid, LogOut, Plus } from "lucide-react";
import { projectsForUser, requireUser } from "@/lib/access";
import { logout } from "./actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUser();
  const projects = await projectsForUser(userId);

  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-60 md:min-h-screen border-b md:border-b-0 md:border-r border-border bg-surface px-4 py-4 md:py-6 flex md:flex-col gap-4">
        <Link href="/dashboard" className="font-semibold text-lg shrink-0">
          MyDashboard
        </Link>
        <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible flex-1 text-sm">
          <Link href="/dashboard" className="flex items-center gap-2 rounded-md px-2 py-1.5 text-text-2 hover:bg-bg shrink-0">
            <LayoutGrid size={16} /> Toate proiectele
          </Link>
          <div className="hidden md:block text-xs uppercase tracking-wide text-text-3 mt-4 mb-1 px-2">Proiecte</div>
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/projects/${p.id}`}
              className="rounded-md px-2 py-1.5 text-text-2 hover:bg-bg truncate shrink-0"
            >
              {p.name}
            </Link>
          ))}
          <Link
            href="/dashboard/projects/new"
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-accent hover:bg-bg shrink-0"
          >
            <Plus size={16} /> Proiect nou
          </Link>
        </nav>
        <form action={logout}>
          <button className="flex items-center gap-2 text-sm text-text-3 hover:text-text px-2">
            <LogOut size={16} /> <span className="hidden md:inline">Ieșire</span>
          </button>
        </form>
      </aside>
      <main className="flex-1 px-4 md:px-8 py-6 max-w-7xl">{children}</main>
    </div>
  );
}
