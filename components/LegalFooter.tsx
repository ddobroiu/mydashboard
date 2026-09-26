import Link from "next/link";
import { LEGAL } from "@/lib/legal";

export function LegalFooter() {
  return (
    <footer className="text-xs text-text-3 text-center space-y-1 px-4 py-6">
      <p>
        {LEGAL.company} · CUI {LEGAL.cui} ({LEGAL.vatStatus}) · Reg. Com. {LEGAL.regCom}
      </p>
      <p>{LEGAL.address}</p>
      <p>
        <a href={`mailto:${LEGAL.email}`} className="hover:text-text">
          {LEGAL.email}
        </a>
        {" · "}
        <Link href="/confidentialitate" className="hover:text-text">
          Confidențialitate
        </Link>
      </p>
    </footer>
  );
}
