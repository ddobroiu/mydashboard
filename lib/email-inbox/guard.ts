// Rutele /api/email/* sunt pentru proprietar: utilizator logat cu rol OWNER sau ADMIN intr-o organizatie
// (proxy.ts nu acopera /api, deci verificam aici).
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function emailApiDenied(): Promise<NextResponse | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Neautentificat" }, { status: 401 });
  const ok = await prisma.membership.count({ where: { userId, role: { in: ["OWNER", "ADMIN"] } } });
  return ok ? null : NextResponse.json({ error: "Fără drept de acces" }, { status: 403 });
}
