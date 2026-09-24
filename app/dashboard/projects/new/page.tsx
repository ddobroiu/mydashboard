import { adminOrganizations, requireUser } from "@/lib/access";
import { NewProjectForm } from "./NewProjectForm";

export default async function NewProjectPage() {
  const userId = await requireUser();
  const orgs = await adminOrganizations(userId);

  return (
    <div className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Proiect nou</h1>
      {orgs.length === 0 ? (
        <p className="text-sm text-text-2">Nu ai drept de administrare în nicio organizație.</p>
      ) : (
        <NewProjectForm orgs={orgs.map((o) => ({ id: o.id, name: o.name }))} />
      )}
    </div>
  );
}
