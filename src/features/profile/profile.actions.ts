"use server";

import { ensureDevUser } from "@/infra/dev/devUser";
import { getLatestBriefingForUser } from "@/features/briefing/briefing.repository";
import { getProfileForUser, upsertProfileForUser } from "./profile.repository";
import { isMissingProfileTableError, MissingUserProfileTableError } from "./profile.errors";

const DEFAULT_CONSTRAINTS =
  "não usar clichês, não prometer resultados, não exagerar autoridade";

const mapAudienceLevel = (value?: string | null) => {
  if (!value) return undefined;
  if (value === "Leigo") return "Iniciante";
  if (value === "Técnico") return "Avançado";
  return "Intermediário";
};

export async function getMyProfile() {
  const user = await ensureDevUser();
  return getProfileForUser(user.id);
}

export async function ensureDefaultProfile(briefing?: Awaited<ReturnType<typeof getLatestBriefingForUser>> | null) {
  const user = await ensureDevUser();
  try {
    const existing = await getProfileForUser(user.id);

    if (existing) {
      return existing;
    }

    const latestBriefing = briefing ?? (await getLatestBriefingForUser(user.id));
    const avoidList =
      latestBriefing?.avoid?.length ? latestBriefing.avoid.join(", ") : "";

    const constraints = avoidList
      ? `${DEFAULT_CONSTRAINTS}; evitar ${avoidList}`
      : DEFAULT_CONSTRAINTS;

    return await upsertProfileForUser(user.id, {
      roleTitle: "Criador de conteúdo",
      audienceLevel: mapAudienceLevel(latestBriefing?.audienceLevel),
      languageStyle: "Didático",
      goals: latestBriefing?.goal,
      audience: latestBriefing?.audience,
      whatIDo: latestBriefing?.offer,
      howIWork: latestBriefing?.differentiation,
      constraints,
    });
  } catch (error) {
    if (isMissingProfileTableError(error)) {
      throw new MissingUserProfileTableError();
    }
    throw error;
  }
}
