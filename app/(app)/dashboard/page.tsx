import Link from "next/link";
import { MapPin } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import { requireUser } from "@/infra/auth/require-user";

export default async function DashboardPage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-display text-3xl italic font-medium tracking-tight text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Veja seu posicionamento e comece a gerar posts.
        </p>
      </div>

      {profile ? (
        <Card className="mx-auto w-full max-w-2xl">
          <CardHeader>
            <CardTitle>Seu posicionamento</CardTitle>
            <CardDescription>
              {[profile.niche, profile.audience, profile.offer]
                .filter(Boolean)
                .join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p className="line-clamp-4 whitespace-pre-wrap">
              {profile.positioningMemory}
            </p>
          </CardContent>
          <CardFooter className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button asChild className="w-full sm:w-auto">
              <Link href="/generate">Gerar posts</Link>
            </Button>
            <Button variant="outline" asChild className="w-full sm:w-auto">
              <Link href="/posicionamento">Ver posicionamento</Link>
            </Button>
            <Button variant="ghost" asChild className="w-full sm:w-auto">
              <Link href="/posts">Histórico</Link>
            </Button>
          </CardFooter>
        </Card>
      ) : (
        <Card className="mx-auto w-full max-w-2xl">
          <CardContent className="space-y-6 text-center">
            <div className="flex flex-col items-center gap-3 pt-6">
              <MapPin className="h-12 w-12 text-primary" />
              <h2 className="text-xl font-semibold">Defina seu posicionamento</h2>
              <p className="text-sm text-muted-foreground">
                Faça o onboarding para que a IA entenda sua marca e gere posts alinhados ao seu estilo.
              </p>
            </div>
            <div className="space-y-1 pb-4">
              <Button asChild className="w-full">
                <Link href="/onboarding">Começar onboarding</Link>
              </Button>
              <p className="text-xs text-muted-foreground">Leva menos de 2 minutos.</p>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
