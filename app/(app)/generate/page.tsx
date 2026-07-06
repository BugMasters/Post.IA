import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { MapPin } from "lucide-react";

import { requireUser } from "@/infra/auth/require-user";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { getQuotaStatus } from "@/features/usage/usage.repository";
import GenerateForm from "@/components/generate/generate-form";

export default async function GeneratePage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);
  const quota = profile ? await getQuotaStatus(user.id, "generate") : null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl italic font-medium tracking-tight">Gerar posts</h1>
        <p className="text-sm text-muted-foreground">
          Crie variações de post alinhadas ao seu posicionamento.
        </p>
        {quota ? (
          <p className="text-[11px] uppercase tracking-[0.12em] text-pen">
            {quota.used} de {quota.limit} gerações hoje
          </p>
        ) : null}
      </div>

      {profile ? (
        <GenerateForm />
      ) : (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader className="text-center">
            <CardTitle>Conclua seu onboarding primeiro</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <MapPin className="mx-auto h-12 w-12 text-primary" />
            <p className="text-sm text-muted-foreground">
              Faça o onboarding para que a IA entenda seu posicionamento e gere posts alinhados com sua marca.
            </p>
            <Button asChild className="w-full sm:w-auto">
              <Link href="/onboarding">Fazer onboarding</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
