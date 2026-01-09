import Link from "next/link";
import { ClipboardList } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { toDbUserMessage } from "@/lib/db/dbError";

export default async function DashboardPage() {
  let briefing: Awaited<ReturnType<typeof getLatestBriefingForUser>> | null = null;
  let dbError: ReturnType<typeof toDbUserMessage> = null;

  try {
    const user = await ensureDevUser();
    briefing = await getLatestBriefingForUser(user.id);
  } catch (error) {
    dbError = toDbUserMessage(error);
  }

  const bullets = [
    "Público e nível de linguagem",
    "Tom de voz e o que evitar",
    "CTA e foco do conteúdo",
  ];

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Veja o briefing atual e o resumo estratégico que vai guiar seus posts.
        </p>
      </div>

      {dbError ? (
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Não foi possível acessar o banco</CardTitle>
            <CardDescription>Verifique a configuração local do Postgres.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>{dbError.message}</p>
            {dbError.devDetails ? (
              <p className="text-xs">Dev: {dbError.devDetails}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : briefing ? (
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader>
            <div>
              <CardTitle>Seu briefing atual</CardTitle>
              <CardDescription>
                Atualizado em {briefing.createdAt.toLocaleDateString("pt-BR")}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div className="space-y-2 rounded-lg border border-dashed border-border/60 p-4">
              <p>
                <span className="font-semibold">Objetivo:</span> {briefing.goal}
              </p>
              <p>
                <span className="font-semibold">Audiência:</span> {briefing.audience}
              </p>
              <p>
                <span className="font-semibold">Nível:</span> {briefing.audienceLevel}
              </p>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Tons
              </p>
              <div className="flex flex-wrap gap-2">
                {briefing.tone.length ? (
                  briefing.tone.map((tone) => (
                    <Badge key={tone} variant="primary">
                      {tone}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">Não definido</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <p className="font-semibold text-xs uppercase tracking-wide text-muted-foreground">
                Evitar
              </p>
              <div className="flex flex-wrap gap-2">
                {briefing.avoid.length ? (
                  briefing.avoid.map((item) => (
                    <Badge key={item} variant="subtle">
                      {item}
                    </Badge>
                  ))
                ) : (
                  <span className="text-muted-foreground">Nada pendente</span>
                )}
              </div>
            </div>

            <div>
              <p className="font-semibold">CTA:</p>
              <p className="text-muted-foreground">{briefing.cta}</p>
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/generate">Gerar posts</Link>
            </Button>
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <Link href="/briefing">Editar briefing</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card className="mx-auto w-full max-w-2xl">
          <CardContent className="space-y-6 text-center">
            <div className="flex flex-col items-center gap-3">
              <ClipboardList className="h-12 w-12 text-primary" />
              <h2 className="text-xl font-semibold">Você ainda não tem um briefing</h2>
              <p className="text-sm text-muted-foreground">
                Responda em 2 minutos e nós montamos um direcionamento para gerar 6
                variações de post.
              </p>
            </div>

            <ul className="space-y-2 text-left text-sm text-muted-foreground">
              {bullets.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-1 h-2 w-2 rounded-full bg-muted-foreground" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>

            <div className="space-y-1">
              <Button asChild className="w-full">
                <Link href="/briefing">Criar meu briefing</Link>
              </Button>
              <p className="text-xs text-muted-foreground">Você pode editar quando quiser.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
