import { requireUser } from "@/infra/auth/require-user";
import { listDrafts } from "@/features/drafts/draft.repository";
import DraftList from "@/components/drafts/draft-list";

export default async function RascunhosPage() {
  const user = await requireUser();
  const drafts = await listDrafts(user.id);

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Rascunhos</h1>
      <DraftList
        drafts={drafts.map((draft) => ({
          id: draft.id,
          label: draft.label,
          content: draft.content,
          theme: draft.theme,
          createdAt: draft.createdAt.toLocaleDateString("pt-BR"),
        }))}
      />
    </main>
  );
}
