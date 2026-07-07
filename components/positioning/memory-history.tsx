"use client";

import { useState, useTransition } from "react";
import { revertMemoryVersionAction } from "@/features/positioning/memory-version.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type MemoryVersionView = {
  id: string;
  memory: string;
  source: string;
  createdAt: string;
};

const SOURCE_LABELS: Record<string, string> = {
  manual: "Edição manual",
  relearn: "Reaprendizado",
  onboarding: "Onboarding",
};

export default function MemoryHistory({ versions }: { versions: MemoryVersionView[] }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const revert = (id: string) =>
    startTransition(async () => {
      setError(null);
      const result = await revertMemoryVersionAction(id);
      if (!result.ok) setError(result.error);
    });

  if (versions.length === 0) {
    return <p className="text-xs text-muted-foreground">Ainda não há histórico de versões.</p>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display italic font-medium">Histórico da memória</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-xs text-destructive">{error}</p>}
        {/* Cada versão como anotação de margem: filete à caneta na esquerda. */}
        {versions.map((version) => (
          <div key={version.id} className="space-y-2 border-l-2 border-pen pl-3 pb-3">
            <p className="text-xs text-muted-foreground">
              <span className="font-display italic text-pen">
                {SOURCE_LABELS[version.source] ?? version.source}
              </span>{" "}
              · {version.createdAt}
            </p>
            <p className="whitespace-pre-wrap text-sm line-clamp-4">{version.memory}</p>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => revert(version.id)}>
              Reverter para esta
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
