import { redirect } from "next/navigation";
import { requireUser } from "@/infra/auth/require-user";
import { getOnboarding } from "@/features/onboarding/onboarding.repository";
import { getPositioningProfile } from "@/features/positioning/positioning.repository";
import OnboardingChat from "@/components/onboarding/onboarding-chat";
import type { ChatMessage } from "@/domain/onboarding";

// Server Actions herdam este teto da página. 60s é o máximo do Vercel Hobby;
// combinar com LLM_MAX_TIMEOUT_MS (< 60s) para a síntese não ser morta no meio.
export const maxDuration = 60;

export default async function OnboardingPage() {
  const user = await requireUser();
  const profile = await getPositioningProfile(user.id);
  if (profile) redirect("/dashboard");

  const existing = await getOnboarding(user.id);
  const messages = (existing?.messages as ChatMessage[] | undefined) ?? [];

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl italic font-medium tracking-tight">Vamos te conhecer</h1>
        <p className="text-sm text-muted-foreground">
          Responda em conversa. No fim, monto seu posicionamento.
        </p>
      </div>
      <OnboardingChat initialMessages={messages} />
    </main>
  );
}
