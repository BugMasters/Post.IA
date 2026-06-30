// components/positioning/positioning-editor.tsx
"use client";

import { useState, useTransition } from "react";
import { updatePositioningProfileAction } from "@/features/positioning/positioning.actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type EditableProfile = {
  niche: string;
  audience: string;
  offer: string;
  differentiation: string;
  tonePreference: string;
  ctaPreference: string;
  positioningMemory: string;
};

const FIELD_LABELS: Record<keyof EditableProfile, string> = {
  niche: "Nicho",
  audience: "Público",
  offer: "Oferta",
  differentiation: "Diferenciação",
  tonePreference: "Tom preferido",
  ctaPreference: "CTA preferida",
  positioningMemory: "Memória viva",
};

export default function PositioningEditor({ profile }: { profile: EditableProfile }) {
  const [form, setForm] = useState<EditableProfile>(profile);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setField = (key: keyof EditableProfile, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () =>
    startTransition(async () => {
      setError(null);
      const result = await updatePositioningProfileAction(form);
      if (result.ok) {
        setSaved(true);
      } else {
        setError(result.error);
      }
    });

  const shortFields: (keyof EditableProfile)[] = [
    "niche",
    "audience",
    "offer",
    "differentiation",
    "tonePreference",
    "ctaPreference",
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Editar posicionamento</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {shortFields.map((key) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={key}>{FIELD_LABELS[key]}</Label>
            <Input
              id={key}
              value={form[key]}
              onChange={(event) => setField(key, event.target.value)}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label htmlFor="positioningMemory">{FIELD_LABELS.positioningMemory}</Label>
          <Textarea
            id="positioningMemory"
            rows={8}
            value={form.positioningMemory}
            onChange={(event) => setField("positioningMemory", event.target.value)}
          />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
        {saved && <p className="text-xs text-muted-foreground">Salvo.</p>}
        <Button disabled={pending} onClick={handleSave}>
          {pending ? "Salvando..." : "Salvar"}
        </Button>
      </CardContent>
    </Card>
  );
}
