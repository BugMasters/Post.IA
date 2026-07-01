"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  advanceOnboardingAction,
  finishOnboardingAction,
} from "@/features/onboarding/onboarding.actions";
import type { ChatMessage } from "@/domain/onboarding";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export default function OnboardingChat({ initialMessages }: { initialMessages: ChatMessage[] }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);

  const advance = (userMessage: string) =>
    startTransition(async () => {
      setError(null);
      const result = await advanceOnboardingAction(userMessage);
      if (!result.ok) return setError(result.error);
      if (result.question) {
        setMessages((m) => [
          ...m,
          ...(userMessage ? [{ role: "user" as const, content: userMessage }] : []),
          { role: "assistant" as const, content: result.question! },
        ]);
      } else if (userMessage) {
        setMessages((m) => [...m, { role: "user", content: userMessage }]);
      }
      if (result.done) setDone(true);
    });

  // dispara a 1ª pergunta se a conversa está vazia
  useEffect(() => {
    if (!started.current && messages.length === 0) {
      started.current = true;
      advance("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    if (!input.trim()) return;
    const value = input.trim();
    setInput("");
    advance(value);
  };

  const finish = () =>
    startTransition(async () => {
      setError(null);
      const result = await finishOnboardingAction();
      if (!result.ok) return setError(result.error);
      router.push("/dashboard");
    });

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border p-4">
        {messages.map((m, i) => (
          <p key={i} className={m.role === "assistant" ? "text-foreground" : "text-muted-foreground"}>
            <strong>{m.role === "assistant" ? "Post.IA: " : "Você: "}</strong>
            {m.content}
          </p>
        ))}
        {pending ? <p className="text-sm text-muted-foreground">Pensando...</p> : null}
      </div>

      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {done ? (
        <Button onClick={finish} disabled={pending} className="w-full">
          {pending ? "Montando seu perfil..." : "Concluir e montar meu posicionamento"}
        </Button>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Sua resposta..."
            disabled={pending}
          />
          <Button onClick={send} disabled={pending || !input.trim()} className="w-full">
            Enviar
          </Button>
        </div>
      )}
    </div>
  );
}
