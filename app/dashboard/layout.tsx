import Link from "next/link";
import { BellRing, Clapperboard, Home, Inbox, ListTodo, LogOut, Settings, Wallet } from "lucide-react";

const item = "flex items-center gap-2 rounded-lg px-2.5 py-2 text-text-2 hover:bg-bg hover:text-text shrink-0";
import { projectsForUser, requireUser } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { NOT_LOCAL_ALERT } from "@/lib/alert-explain";
import { logout } from "./actions";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const userId = await requireUser();
  const projects = await projectsForUser(userId);
  // problemele active din toate site-urile (erori, credite, site picat), in meniu
  const activeAlerts = await prisma.alertState.count({ where: { active: true, ...NOT_LOCAL_ALERT } });
  // e-mailurile necitite de la oameni (0 daca migrarea inboxului nu e aplicata inca)
  const unreadEmails = await prisma.emailThread
    .aggregate({ _sum: { unreadCount: true }, where: { category: "inbox", unreadCount: { gt: 0 } } })
    .then((r) => r._sum.unreadCount || 0)
    .catch(() => 0);

  return (
    <div className="min-h-screen md:flex">
      <aside className="md:w-60 md:min-h-screen border-b md:border-b-0 md:border-r border-border bg-surface px-4 py-4 md:py-6 flex md:flex-col gap-4">
        <Link href="/dashboard" className="font-semibold text-lg shrink-0">
          MyDashboard
        </Link>
        <nav className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible flex-1 text-sm">
          <Link href="/dashboard" className={item}>
            <Home size={16} /> Acasă
          </Link>
          <Link href="/dashboard/email" className={item}>
            <Inbox size={16} /> Emailuri
            {unreadEmails > 0 && (
              <span className="ml-auto rounded-full bg-accent px-2 py-0.5 text-xs font-semibold text-white">{unreadEmails}</span>
            )}
          </Link>
          <Link href="/dashboard/de-facut" className={item}>
            <ListTodo size={16} /> De făcut
          </Link>
          <Link href="/dashboard/bani" className={item}>
            <Wallet size={16} /> Bani
          </Link>
          <Link href="/dashboard/postari" className={item}>
            <Clapperboard size={16} /> Postări
          </Link>
          <Link href="/dashboard/alerte" className={item}>
            <BellRing size={16} /> Alerte
            {activeAlerts > 0 && (
              <span className="ml-auto rounded-full bg-red-600 px-2 py-0.5 text-xs font-semibold text-white">{activeAlerts}</span>
            )}
          </Link>
          <Link href="/dashboard/setari" className={item}>
            <Settings size={16} /> Setări
          </Link>
          <div className="hidden md:block text-xs uppercase tracking-wide text-text-3 mt-5 mb-1 px-2">Afaceri</div>
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/dashboard/projects/${p.id}`}
              className="hidden md:block rounded-md px-2 py-1.5 text-text-2 hover:bg-bg truncate"
            >
              {p.name}
            </Link>
          ))}
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
