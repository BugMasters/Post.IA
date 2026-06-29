"use client";

import { useState, useTransition } from "react";
import { submitFeedbackAction } from "@/features/feedback/feedback.actions";
import { relearnPositioningAction } from "@/features/positioning/relearn.actions";
import type { FeedbackSignal } from "@/domain/feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

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

  const react = (signal: FeedbackSignal) =>
    startTransition(async () => {
      const result = await submitFeedbackAction({ postId, variantLabel: label, signal });
      if (result.ok) {
        setSent(signal);
        if (result.shouldRelearn) await relearnPositioningAction();
      }
    });

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{label}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap text-sm">{content}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={pending} onClick={() => navigator.clipboard.writeText(content)}>Copiar</Button>
          <Button size="sm" variant={sent === "liked" ? "default" : "outline"} disabled={pending} onClick={() => react("liked")}>👍</Button>
          <Button size="sm" variant={sent === "disliked" ? "default" : "outline"} disabled={pending} onClick={() => react("disliked")}>👎</Button>
          <Button size="sm" variant={sent === "more_like_this" ? "default" : "outline"} disabled={pending} onClick={() => react("more_like_this")}>Mais assim</Button>
        </div>
      </CardContent>
    </Card>
  );
}
