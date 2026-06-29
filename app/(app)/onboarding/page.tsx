import { redirect } from "next/navigation";
import { requireUser } from "@/infra/auth/require-user";
import { getOnboarding } from "@/features/onboarding/onboarding.repository";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import OnboardingChat from "@/components/onboarding/onboarding-chat";
import type { ChatMessage } from "@/domain/onboarding";

export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);
  if (profile) redirect("/dashboard");

  const existing = await getOnboarding(user.id);
  const messages = (existing?.messages as ChatMessage[] | undefined) ?? [];

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Vamos te conhecer</h1>
        <p className="text-sm text-muted-foreground">
          Responda em conversa. No fim, monto seu posicionamento.
        </p>
      </div>
      <OnboardingChat initialMessages={messages} />
    </main>
  );
}
