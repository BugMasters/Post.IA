import { prisma } from "@/infra/db/prisma";
import { chatMessagesSchema, type ChatMessage } from "@/domain/onboarding";

export async function getOnboarding(userId: string) {
  return prisma.onboardingConversation.findUnique({ where: { userId } });
}

export async function saveOnboarding(
  userId: string,
  messages: ChatMessage[],
  status: "in_progress" | "completed",
  turnCount: number
) {
  const data = { messages: chatMessagesSchema.parse(messages), status, turnCount };
  return prisma.onboardingConversation.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
}
