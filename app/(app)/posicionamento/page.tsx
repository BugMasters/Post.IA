import Link from "next/link";
import { requireUser } from "@/infra/auth/require-user";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { listMemoryVersions } from "@/features/positioning/memory-version.repository";
import { Button } from "@/components/ui/button";
import PositioningEditor from "@/components/positioning/positioning-editor";
import MemoryHistory from "@/components/positioning/memory-history";

export default async function PosicionamentoPage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);

  if (!profile) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="font-display text-3xl italic font-medium tracking-tight">Posicionamento</h1>
        <p className="text-sm text-muted-foreground">Conclua seu onboarding primeiro.</p>
        <Button asChild><Link href="/onboarding">Começar</Link></Button>
      </main>
    );
  }

  const versions = await listMemoryVersions(user.id);

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="font-display text-3xl italic font-medium tracking-tight">Seu posicionamento</h1>
      <PositioningEditor
        profile={{
          niche: profile.niche,
          audience: profile.audience,
          offer: profile.offer,
          differentiation: profile.differentiation,
          tonePreference: profile.tonePreference,
          ctaPreference: profile.ctaPreference,
          positioningMemory: profile.positioningMemory,
        }}
      />
      <MemoryHistory
        versions={versions.map((version) => ({
          id: version.id,
          memory: version.memory,
          source: version.source,
          createdAt: version.createdAt.toLocaleDateString("pt-BR"),
        }))}
      />
      <p className="text-xs text-muted-foreground">
        A memória também atualiza sozinha conforme você dá feedback nos posts.
      </p>
    </main>
  );
}
