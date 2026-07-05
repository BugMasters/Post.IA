"use client";

import { useState, useTransition } from "react";

import { joinWaitlistAction } from "@/features/waitlist/waitlist.actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function WaitlistForm() {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function onSubmit(formData: FormData) {
    const email = String(formData.get("email") ?? "");
    startTransition(async () => {
      setError(null);
      const result = await joinWaitlistAction(email);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  if (done) {
    return (
      <p className="text-sm text-pen">
        Pronto! Te aviso quando abrir.
      </p>
    );
  }

  return (
    <form action={onSubmit} className="w-full max-w-md space-y-2">
      <div className="flex gap-2">
        <Input
          name="email"
          type="email"
          placeholder="seu@email.com"
          required
          aria-label="E-mail"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "..." : "Entrar na lista"}
        </Button>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </form>
  );
}
