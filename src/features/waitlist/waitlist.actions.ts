"use server";

import { ZodError } from "zod";
import { waitlistSchema } from "@/domain/waitlist";
import { addToWaitlist } from "./waitlist.repository";

export type JoinWaitlistResult = { ok: true } | { ok: false; error: string };

export async function joinWaitlistAction(email: string): Promise<JoinWaitlistResult> {
  try {
    const input = waitlistSchema.parse({ email });
    await addToWaitlist(input.email);
    return { ok: true };
  } catch (error) {
    if (error instanceof ZodError) {
      return { ok: false, error: error.issues.map((i) => i.message).join(", ") };
    }
    return { ok: false, error: "Erro ao entrar na lista." };
  }
}
