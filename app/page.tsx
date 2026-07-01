import Link from "next/link";
import { redirect } from "next/navigation";

import { auth } from "@/infra/auth";
import { Button } from "@/components/ui/button";
import WaitlistForm from "@/components/marketing/waitlist-form";

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 p-6">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">
          Posts que soam como você — e vendem você.
        </h1>
        <p className="text-lg text-muted-foreground">
          O Post.IA aprende seu posicionamento e melhora a cada uso. Sem texto
          genérico de IA.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        <WaitlistForm />
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/signup">Criar conta grátis</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/login">Entrar</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
