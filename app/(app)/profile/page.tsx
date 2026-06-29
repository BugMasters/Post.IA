import {
  audienceLevelOptions,
  emptyAuthorProfileValues,
  type AuthorProfileValues,
} from "@/domain/authorProfile";
import ProfileForm from "@/features/profile/components/profile-form";
import { getAuthorProfileForUser } from "@/features/profile/profile.actions";
import { requireUser } from "@/infra/auth/require-user";

const isAudienceLevel = (
  value: string
): value is (typeof audienceLevelOptions)[number] =>
  audienceLevelOptions.includes(value as (typeof audienceLevelOptions)[number]);

const toDefaultValues = (
  profile: Awaited<ReturnType<typeof getAuthorProfileForUser>>
): AuthorProfileValues => ({
  ...emptyAuthorProfileValues,
  role: profile?.role ?? "",
  niche: profile?.niche ?? "",
  audience: profile?.audience ?? "",
  audienceLevel:
    profile?.audienceLevel && isAudienceLevel(profile.audienceLevel)
      ? profile.audienceLevel
      : emptyAuthorProfileValues.audienceLevel,
  writingStyle: profile?.writingStyle ?? "",
  tonePreference: profile?.tonePreference ?? "",
  ctaPreference: profile?.ctaPreference ?? "",
});

export default async function ProfilePage() {
  const user = await requireUser();
  const profile = await getAuthorProfileForUser(user.id);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold text-foreground">Perfil do autor</h1>
        <p className="text-sm text-muted-foreground">
          Ajuste seu posicionamento para dar mais contexto ao gerador antes do briefing.
        </p>
      </div>

      <ProfileForm defaultValues={toDefaultValues(profile)} />
    </main>
  );
}
