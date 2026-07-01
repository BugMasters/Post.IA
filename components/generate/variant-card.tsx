// components/generate/variant-card.tsx
"use client";

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/features/feedback/feedback.actions";
import { relearnPositioningAction } from "@/features/positioning/relearn.actions";
import { regenerateVariantAction } from "@/features/generate/regenerate.actions";
import { createDraftAction } from "@/features/drafts/draft.actions";
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
  // Última versão "confirmada" (regenerada ou edição salva). Cancelar volta aqui,
  // não para o prop `content` congelado, evitando divergência UI/DB e drift de aprendizado.
  const [baseline, setBaseline] = useState(content);
  const [draft, setDraft] = useState(content);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [draftSaved, setDraftSaved] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);

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
        setBaseline(draft);
        setEditing(false);
        if (result.shouldRelearn) await relearnPositioningAction();
      }
    });

  const regenerate = () =>
    startTransition(async () => {
      setRegenError(null);
      const result = await regenerateVariantAction(postId, label);
      if (result.ok) {
        setBaseline(result.content);
        setDraft(result.content);
        setEditing(false);
      } else {
        setRegenError(result.error);
      }
    });

  const saveDraft = () =>
    startTransition(async () => {
      setDraftError(null);
      const result = await createDraftAction({ postId, label, content: draft });
      if (result.ok) {
        setDraftSaved(true);
        setTimeout(() => setDraftSaved(false), 1500);
      } else {
        setDraftError(result.error);
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
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { setDraft(baseline); setEditing(false); }}>Cancelar</Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => { setRegenError(null); setEditing(true); }}>Editar</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={regenerate}>Regenerar</Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={saveDraft}>{draftSaved ? "Salvo" : "Salvar rascunho"}</Button>
            </>
          )}
          <Button size="sm" variant={sent === "liked" ? "default" : "outline"} disabled={pending} onClick={() => react("liked")}>👍</Button>
          <Button size="sm" variant={sent === "disliked" ? "default" : "outline"} disabled={pending} onClick={() => react("disliked")}>👎</Button>
          <Button size="sm" variant={sent === "more_like_this" ? "default" : "outline"} disabled={pending} onClick={() => react("more_like_this")}>Mais assim</Button>
        </div>
        {regenError && <p className="text-xs text-destructive">{regenError}</p>}
        {draftError && <p className="text-xs text-destructive">{draftError}</p>}
      </CardContent>
    </Card>
  );
}
