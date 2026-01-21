import ProfileForm from "@/features/profile/components/profile-form";
import { getUserProfile } from "@/features/profile/profile.actions";
import { type ProfileFormValues } from "@/domain/profile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatDbUserMessage, toDbUserMessage } from "@/lib/db/dbError";

type ProfileRecord = Awaited<ReturnType<typeof getUserProfile>>;

const normalizeField = (value: string | null | undefined) =>
  typeof value === "string" ? value : "";

function buildInitialValues(profile: ProfileRecord | null): ProfileFormValues {
  return {
    displayName: normalizeField(profile?.displayName),
    headline: normalizeField(profile?.headline),
    bio: normalizeField(profile?.bio),
    role: normalizeField(profile?.role),
    website: normalizeField(profile?.website),
    linkedin: normalizeField(profile?.linkedin),
    github: normalizeField(profile?.github),
    writingStyleNotes: normalizeField(profile?.writingStyleNotes),
    bannedClaims: normalizeField(profile?.bannedClaims),
  };
}

export default async function ProfilePage() {
  let profile: ProfileRecord | null = null;
  let errorMessage: string | null = null;

  try {
    profile = await getUserProfile();
  } catch (error) {
    const dbMessage = toDbUserMessage(error);
    errorMessage = formatDbUserMessage(
      dbMessage ?? { message: "Nao foi possivel carregar o perfil." }
    );
  }

  const initialValues = buildInitialValues(profile);
  const isEditing = Boolean(profile);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-semibold">
          {isEditing ? "Editar perfil" : "Perfil"}
        </h1>
        <p className="text-sm text-muted-foreground">
          Ajuste o contexto do autor para deixar os posts mais fieis ao seu tom.
        </p>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTitle>Erro ao carregar perfil</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      <ProfileForm defaultValues={initialValues} />
    </main>
  );
}
