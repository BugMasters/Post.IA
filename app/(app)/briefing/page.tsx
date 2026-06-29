import BriefingForm from "@/components/briefing/briefing-form";
import { requireUser } from "@/infra/auth/require-user";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import {
  BriefingFormValues,
  audienceLevelOptions,
  audienceOptions,
  ctaOptions,
  goalOptions,
} from "@/domain/briefing";

const fallbackGoal = goalOptions[0];
const fallbackAudience = audienceOptions[0];
const fallbackAudienceLevel = audienceLevelOptions[0];
const fallbackCta = ctaOptions[0];

type BriefingRecord = Awaited<ReturnType<typeof getLatestBriefingForUser>>;

function ensureOption<T extends readonly string[]>(
  value: unknown,
  options: T,
  fallback: T[number]
): T[number] {
  if (typeof value === "string" && options.includes(value as T[number])) {
    return value as T[number];
  }
  return fallback;
}

function normalizeStringArray(value: string[] | null | undefined) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function buildInitialValues(briefing: BriefingRecord | null): BriefingFormValues {
  return {
    goal: ensureOption(briefing?.goal, goalOptions, fallbackGoal),
    audience: ensureOption(briefing?.audience, audienceOptions, fallbackAudience),
    audienceLevel: ensureOption(
      briefing?.audienceLevel,
      audienceLevelOptions,
      fallbackAudienceLevel
    ),
    offer: typeof briefing?.offer === "string" ? briefing.offer : "",
    differentiation:
      typeof briefing?.differentiation === "string" ? briefing.differentiation : "",
    tone: normalizeStringArray(briefing?.tone),
    avoid: normalizeStringArray(briefing?.avoid),
    cta: ensureOption(briefing?.cta, ctaOptions, fallbackCta),
  };
}

export default async function BriefingPage() {
  const user = await requireUser();
  const briefing = await getLatestBriefingForUser(user.id);
  const initialValues = buildInitialValues(briefing);
  const isEditing = Boolean(briefing);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">
          {isEditing ? "Editar briefing" : "Briefing"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isEditing
            ? "Ajuste seu direcionamento. Você pode salvar novamente quando quiser."
            : "Conte para a IA o que você precisa e receba um resumo estratégico."}
        </p>
      </div>

      <BriefingForm defaultValues={initialValues} />
    </main>
  );
}
