// components/generate/variant-card.tsx
"use client";

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/features/feedback/feedback.actions";
import { relearnPositioningAction } from "@/features/positioning/relearn.actions";
import type { FeedbackSignal } from "@/domain/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function VariantCard({
  postId,
  label,
  content,
}: {
  postId: string;
  label: string;
  content: string;
}) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState<FeedbackSignal | null>(null);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);

  const react = (signal: FeedbackSignal) =>
    startTransition(async () => {
      const result = await submitFeedbackAction({ postId, variantLabel: label, signal });
      if (result.ok) {
        setSent(signal);
        if (result.shouldRelearn) await relearnPositioningAction();
      }
    });

  const saveEdit = () =>
    startTransition(async () => {
      const result = await submitFeedbackAction({
        postId,
        variantLabel: label,
        signal: "edited",
        editedContent: draft,
      });
      if (result.ok) {
        setSent("edited");
        setEditing(false);
        if (result.shouldRelearn) await relearnPositioningAction();
      }
    });

  const handleCopyClick = async () => {
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {editing ? (
          <Textarea
            rows={8}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        ) : (
          <p className="whitespace-pre-wrap text-sm">{draft}</p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={handleCopyClick}>{copied ? "Copiado" : "Copiar"}</Button>
          {editing ? (
            <>
              <Button size="sm" disabled={pending} onClick={saveEdit}>Salvar edição</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { setDraft(content); setEditing(false); }}>Cancelar</Button>
            </>
          ) : (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setEditing(true)}>Editar</Button>
          )}
          <Button size="sm" variant={sent === "liked" ? "default" : "outline"} disabled={pending} onClick={() => react("liked")}>👍</Button>
          <Button size="sm" variant={sent === "disliked" ? "default" : "outline"} disabled={pending} onClick={() => react("disliked")}>👎</Button>
          <Button size="sm" variant={sent === "more_like_this" ? "default" : "outline"} disabled={pending} onClick={() => react("more_like_this")}>Mais assim</Button>
        </div>
      </CardContent>
    </Card>
  );
}
