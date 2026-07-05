"use client";

import { useState, useTransition } from "react";
import { deleteDraftAction } from "@/features/drafts/draft.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type DraftView = {
  id: string;
  label: string;
  content: string;
  theme: string | null;
  createdAt: string;
};

export default function DraftList({ drafts }: { drafts: DraftView[] }) {
  const [pending, startTransition] = useTransition();
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = async (draft: DraftView) => {
    try {
      await navigator.clipboard.writeText(draft.content);
      setCopiedId(draft.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  const remove = (id: string) =>
    startTransition(async () => {
      await deleteDraftAction(id);
    });

  if (drafts.length === 0) {
    return <p className="text-sm text-muted-foreground">Você ainda não salvou rascunhos.</p>;
  }

  return (
    <div className="space-y-4">
      {drafts.map((draft) => (
        <Card key={draft.id}>
          <CardHeader>
            <CardTitle className="text-base">
              {draft.label}
              {draft.theme ? ` · ${draft.theme}` : ""} · {draft.createdAt}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="whitespace-pre-wrap text-sm">{draft.content}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => copy(draft)}>
                {copiedId === draft.id ? "Copiado" : "Copiar"}
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => remove(draft.id)}>
                Excluir
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
