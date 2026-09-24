import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { dayDate, dayKey } from "@/lib/dates";
import { isBot } from "@/lib/tracking/sources";

export const dynamic = "force-dynamic";

// Link scurt urmarit: numara click-ul si trimite mai departe, cu UTM-urile puse.
export async function GET(req: NextRequest, ctx: RouteContext<"/l/[code]">) {
  const { code } = await ctx.params;
  const link = await prisma.trackedLink.findUnique({ where: { code } });
  if (!link) return NextResponse.redirect(new URL("/", req.url));

  if (!isBot(req.headers.get("user-agent") ?? "")) {
    const now = new Date();
    await prisma.$transaction([
      prisma.trackedLink.update({ where: { id: link.id }, data: { clicks: { increment: 1 }, lastClickAt: now } }),
      prisma.trackEvent.create({
        data: { projectId: link.projectId, type: "link_click", name: link.name, linkId: link.id, at: now, date: dayDate(dayKey(now)) },
      }),
    ]);
  }
  return NextResponse.redirect(link.destination, 302);
}
