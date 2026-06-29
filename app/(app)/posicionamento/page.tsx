import Link from "next/link";
import { requireUser } from "@/infra/auth/require-user";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PosicionamentoPage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);

  if (!profile) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-3xl font-semibold">Posicionamento</h1>
        <p className="text-sm text-muted-foreground">Conclua seu onboarding primeiro.</p>
        <Button asChild><Link href="/onboarding">Começar</Link></Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-3xl font-semibold">Seu posicionamento</h1>
      <Card>
        <CardHeader><CardTitle>Memória viva</CardTitle></CardHeader>
        <CardContent>
          <p className="whitespace-pre-wrap text-sm">{profile.positioningMemory}</p>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">
        Atualiza sozinho conforme você dá feedback nos posts.
      </p>
    </main>
  );
}
