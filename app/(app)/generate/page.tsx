import Link from "next/link";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

import { requireUser } from "@/infra/auth/require-user";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import GenerateForm from "@/components/generate/generate-form";

const safeArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

export default async function GeneratePage() {
  const user = await requireUser();
  const briefing = await getLatestBriefingForUser(user.id);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">Gerar posts</h1>
        <p className="text-sm text-muted-foreground">
          Use seu briefing salvo para criar variações de post focadas em cada estilo.
        </p>
      </div>

      {briefing ? (
        <GenerateForm
          briefing={{
            goal: briefing.goal,
            audience: briefing.audience,
            audienceLevel: briefing.audienceLevel,
            offer: briefing.offer,
            differentiation: briefing.differentiation,
            tone: safeArray(briefing.tone),
            avoid: safeArray(briefing.avoid),
            cta: briefing.cta,
          }}
        />
      ) : (
        <Card className="mx-auto w-full max-w-3xl">
          <CardHeader className="text-center">
            <CardTitle>Precisamos de um briefing salvo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-center">
            <ClipboardList className="mx-auto h-12 w-12 text-primary" />
            <p className="text-sm text-muted-foreground">
              Crie e salve um briefing guiado para gerar ideias alinhadas ao seu objetivo, público e tom.
            </p>
            <Button asChild className="w-full sm:w-auto">
              <Link href="/briefing">Criar meu briefing</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
