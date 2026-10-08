import { requireUser } from "@/lib/access";
import InboxTodo from "@/components/InboxTodo";

export const dynamic = "force-dynamic";

// „De facut”: mesajele importante din inbox si lista de lucruri de rezolvat (mutate de pe prima pagina)
export default async function DeFacut() {
  await requireUser();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">De făcut</h1>
        <p className="text-sm text-text-2">Mesajele care așteaptă răspuns și lucrurile de rezolvat, pe toate site-urile.</p>
      </div>
      <InboxTodo />
    </div>
  );
}
