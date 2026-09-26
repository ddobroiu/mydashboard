import type { Metadata } from "next";
import Link from "next/link";
import { LegalFooter } from "@/components/LegalFooter";
import { LEGAL, LEGAL_VERSION_LABEL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Confidențialitate · MyDashboard",
  description: "Cum prelucrează MyDashboard datele administratorilor și ale vizitatorilor site-urilor măsurate.",
};

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-text pt-4">{children}</h2>;
}

export default function PrivacyPage() {
  return (
    <main className="min-h-screen px-4">
      <article className="max-w-2xl mx-auto py-10 space-y-3 text-sm text-text-2 leading-relaxed">
        <Link href="/login" className="text-text-3 hover:text-text">
          ← MyDashboard
        </Link>
        <h1 className="text-xl font-semibold text-text">Notă de confidențialitate – MyDashboard</h1>
        <p className="text-text-3">{LEGAL_VERSION_LABEL}</p>

        <H>1. Cine suntem</H>
        <p>
          Operatorul datelor este {LEGAL.company}, CUI {LEGAL.cui}, Reg. Com. {LEGAL.regCom} (EUID {LEGAL.euid}), cu sediul în{" "}
          {LEGAL.address}. Contact:{" "}
          <a href={`mailto:${LEGAL.email}`} className="text-accent">
            {LEGAL.email}
          </a>
          . Nu am desemnat un responsabil cu protecția datelor (DPO); pentru orice solicitare scrieți-ne la adresa de email de mai
          sus.
        </p>
        <p>
          MyDashboard (mydashboard.ro) este instrumentul intern al societății, folosit doar de administratorii săi, pentru a vedea
          într-un singur loc statisticile, încasările, facturile și costurile site-urilor și aplicațiilor proprii. Nu este un
          serviciu oferit publicului.
        </p>

        <H>2. Datele administratorilor (autentificare)</H>
        <p>
          Pentru conturile de administrator prelucrăm: adresa de email, numele, parola (stocată doar sub formă de hash bcrypt) și
          cookie-urile de sesiune strict necesare autentificării (<code>authjs.session-token</code>, <code>authjs.csrf-token</code>,{" "}
          <code>authjs.callback-url</code>, cu prefix <code>__Secure-</code>/<code>__Host-</code> pe HTTPS). Temei: art. 6 alin. (1)
          lit. (b) și (f) GDPR – accesul securizat la instrument. Datele se păstrează cât timp contul există. MyDashboard nu
          folosește cookie-uri de analiză sau de marketing pe propriile pagini.
        </p>

        <H>3. Serviciul de măsurare a traficului (t.js)</H>
        <p>
          Site-urile societății pot include scriptul <code>https://mydashboard.ro/t.js</code>, un instrument propriu de statistici
          (fără terți), care ne arată câte vizite are fiecare site, de unde vin vizitatorii (căutare, rețele sociale, reclame) și
          ce vizite au dus la o comandă. Pentru vizitatorii acestor site-uri:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Identificatori salvați în browser</strong> (pe domeniul site-ului vizitat, first-party): cookie-ul{" "}
            <code>_md_vid</code> (identificator aleator al vizitatorului, 12 luni) și, în localStorage, <code>_md_vid</code>,{" "}
            <code>_md_sid</code> (identificator aleator al vizitei) și <code>_md_last</code> (momentul ultimei activități; o vizită
            nouă începe după 30 de minute de pauză).
          </li>
          <li>
            <strong>Date trimise la fiecare pagină</strong>: adresa paginii (inclusiv parametrii de campanie precum utm_*, gclid,
            fbclid, ttclid), site-ul de proveniență (referrer), lățimea ecranului și tipul de dispozitiv dedus din browser (desktop /
            mobil / tabletă). Pentru comenzi: valoarea, moneda și numărul comenzii, atunci când site-ul le transmite. Din adresa
            paginii salvăm doar calea și parametrii de campanie (utm_*, gclid, fbclid, ttclid, gbraid, wbraid, msclkid, ref);
            ceilalți parametri (care ar putea conține, de exemplu, o adresă de email sau un cod) sunt eliminați înainte de
            salvare. Din site-ul de proveniență păstrăm doar numele domeniului.
          </li>
          <li>
            <strong>Plăți</strong>: identificatorul vizitatorului este atașat plăților Stripe (câmpul{" "}
            <code>client_reference_id</code> sau metadata <code>md_vid</code>), pentru a ști din ce campanie a venit o vânzare.
          </li>
          <li>
            <strong>Adresa IP</strong> este primită tehnic de server odată cu cererea, dar nu este salvată în baza de date a
            statisticilor. Nu salvăm nici textul complet de identificare a browserului (user-agent), ci doar categoria de
            dispozitiv. Traficul automat (roboți) este ignorat.
          </li>
          <li>
            Nu folosim datele pentru profilare publicitară, nu le vindem și nu le transmitem terților.
          </li>
          <li>
            <strong>Consimțământ</strong>: site-urile care cer acordul pentru cookie-urile de analiză încarcă scriptul numai după
            acord sau îl folosesc în modul „cu consimțământ”, în care nu salvează și nu trimite nimic până la acceptare; la
            retragerea acordului, identificatorii de mai sus sunt șterși din browser. Temei: art. 6 alin. (1) lit. (a) GDPR și art.
            4 alin. (5) din Legea nr. 506/2004.
          </li>
          <li>
            <strong>Păstrare</strong>: datele statistice (vizite și evenimente, legate de identificatorii aleatori) se păstrează cel
            mult 26 de luni, după care sunt șterse sau agregate.
          </li>
        </ul>

        <H>4. Date despre plăți și facturi</H>
        <p>
          Pentru rapoartele interne, MyDashboard preia din conturile societății de la Stripe și Oblio sumele încasate, adresa de
          email a plătitorului și datele de facturare (nume, CIF, email) de pe facturile emise. Temei: art. 6 alin. (1) lit. (f)
          GDPR – evidența și analiza internă a activității. Documentele contabile originale rămân la Stripe și Oblio și sunt
          păstrate conform Legii contabilității nr. 82/1991.
        </p>

        <H>5. Unde sunt datele</H>
        <p>
          Aplicația și baza de date rulează pe servere Hetzner Online GmbH din Uniunea Europeană. Emailurile interne de alertă
          sunt trimise prin Resend (SUA; transfer pe baza Cadrului UE-SUA privind protecția datelor și/sau a clauzelor
          contractuale standard) și nu conțin date ale vizitatorilor.
        </p>

        <H>6. Drepturile dumneavoastră</H>
        <p>
          Aveți dreptul de acces, rectificare, ștergere, restricționare, portabilitate, opoziție și de retragere a
          consimțământului în orice moment, fără a afecta legalitatea prelucrării anterioare. Nu luăm decizii bazate exclusiv pe
          prelucrare automată. Deoarece statisticile folosesc identificatori aleatori, pentru o cerere privind datele de trafic vă
          rugăm să ne indicați valoarea cookie-ului <code>_md_vid</code> din browser; ștergerea cookie-urilor și a datelor site-ului
          oprește legarea vizitelor viitoare de cele trecute. Aveți dreptul să depuneți plângere la Autoritatea Națională de
          Supraveghere a Prelucrării Datelor cu Caracter Personal (ANSPDCP), B-dul G-ral. Gheorghe Magheru 28-30, București,{" "}
          <a href="https://www.dataprotection.ro" className="text-accent" rel="noopener noreferrer" target="_blank">
            www.dataprotection.ro
          </a>
          .
        </p>
      </article>
      <LegalFooter />
    </main>
  );
}
