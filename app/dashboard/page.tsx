import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ensureDevUser } from "@/infra/dev/devUser";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";

export default async function DashboardPage() {
  const user = await ensureDevUser();
  const briefing = await getLatestBriefingForUser(user.id);

  const offerSummary = briefing?.offer.length
    ? briefing.offer.length > 200
      ? `${briefing.offer.slice(0, 200)}…`
      : briefing.offer
    : "";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Visão rápida do seu briefing guiado.
        </p>
      </div>
      {briefing ? (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Último briefing</CardTitle>
              <CardDescription>
                Criado em {briefing.createdAt.toLocaleDateString("pt-BR")}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <p>
                <span className="font-semibold">Objetivo:</span> {briefing.goal}
              </p>
              <p>
                <span className="font-semibold">Audiência:</span> {briefing.audience} •{" "}
                {briefing.audienceLevel}
              </p>
              <p>
                <span className="font-semibold">CTA:</span> {briefing.cta}
              </p>
              <p>
                <span className="font-semibold">Tom:</span>{" "}
                {briefing.tone.length ? briefing.tone.join(", ") : "Não definido"}
              </p>
            </div>
            <div className="space-y-1">
              <p className="font-semibold">Oferta</p>
              <p className="text-sm text-muted-foreground">{offerSummary}</p>
            </div>
          </CardContent>
          <CardFooter className="gap-4">
            <Button asChild>
              <Link href="/briefing">Atualizar briefing</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-lg font-semibold">Nenhum briefing disponível</p>
            <p className="text-sm text-muted-foreground">
              Crie um briefing guiado para inspirar as próximas interações da IA.
            </p>
            <Button asChild>
              <Link href="/briefing">Criar briefing guiado</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
