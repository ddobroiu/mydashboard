import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Role } from "@prisma/client";

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  return session.user.id;
}

// Proiectele vizibile pentru utilizator: cele din organizatiile in care e membru.
export async function projectsForUser(userId: string) {
  return prisma.project.findMany({
    where: { organization: { memberships: { some: { userId } } } },
    include: { connections: { select: { id: true, provider: true, status: true, lastSyncAt: true, lastError: true } } },
    orderBy: { name: "asc" },
  });
}

const RANK: Record<Role, number> = { VIEWER: 0, ADMIN: 1, OWNER: 2 };

// Verifica accesul la un proiect; minRole = ADMIN pentru modificari.
export async function requireProject(projectId: string, minRole: Role = "VIEWER") {
  const userId = await requireUser();
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { organization: { include: { memberships: { where: { userId } } } } },
  });
  const membership = project?.organization.memberships[0];
  if (!project || !membership || RANK[membership.role] < RANK[minRole]) notFound();
  return { userId, project, role: membership.role };
}

export async function adminOrganizations(userId: string) {
  return prisma.organization.findMany({
    where: { memberships: { some: { userId, role: { in: ["OWNER", "ADMIN"] } } } },
    orderBy: { name: "asc" },
  });
}
