import { prisma } from "@/infra/db/prisma";
import type { GenerateVariant } from "@/infra/llm/types";

export type SavePostInput = {
  theme: string;
  platform: string;
  length: string;
  objective: string;
  variants: GenerateVariant[];
};

export async function savePost(userId: string, input: SavePostInput) {
  return prisma.post.create({
    data: { userId, ...input, variants: input.variants },
  });
}

export async function listPosts(userId: string) {
  return prisma.post.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function getPost(userId: string, postId: string) {
  return prisma.post.findFirst({ where: { id: postId, userId } });
}

export async function updatePostVariants(
  userId: string,
  postId: string,
  variants: GenerateVariant[]
) {
  return prisma.post.updateMany({
    where: { id: postId, userId },
    data: { variants },
  });
}
