"use client";

import * as React from "react";
import { Copy, Loader2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { BriefingSnapshot, FormatOption } from "@/features/generate/mockGenerator";
import { GeneratePostFormat, generatePostsAction } from "@/features/generate/generate.actions";
import type { GenerateVariant } from "@/infra/llm/types";

const formatOptions: FormatOption[] = ["Apenas texto", "Foto + texto", "Apenas foto"];

const formatTranslator: Record<FormatOption, GeneratePostFormat> = {
  "Apenas texto": "TEXT",
  "Foto + texto": "PHOTO_TEXT",
  "Apenas foto": "PHOTO",
};

interface GenerateFormProps {
  briefing: BriefingSnapshot;
}

export default function GenerateForm({ briefing }: GenerateFormProps) {
  const [theme, setTheme] = React.useState("");
  const [format, setFormat] = React.useState<FormatOption>("Apenas texto");
  const [variants, setVariants] = React.useState<GenerateVariant[]>([]);
  const [fieldError, setFieldError] = React.useState<string | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);
  const [isGenerating, setIsGenerating] = React.useState(false);

  const toneLabels = briefing.tone.length ? briefing.tone : ["Tom neutro"];

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedTheme = theme.trim();

    if (!trimmedTheme) {
      setFieldError("Informe o tema do post.");
      return;
    }

    if (trimmedTheme.length < 3) {
      setFieldError("Informe um tema com pelo menos 3 caracteres.");
      return;
    }

    setFieldError(null);
    setServerError(null);
    setIsGenerating(true);

    try {
      const result = await generatePostsAction({
        theme: trimmedTheme,
        format: formatTranslator[format],
      });

      if (!result.ok) {
        setServerError(result.error);
        return;
      }

      setVariants(result.variants);
      setCopiedId(null);
    } catch (caughtError) {
      console.error("[GenerateForm] geração falhou:", caughtError);
      setServerError("Erro inesperado ao gerar as variações.");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async (variant: GenerateVariant) => {
    try {
      await navigator.clipboard.writeText(variant.content);
      setCopiedId(variant.label);
    } catch {
      setCopiedId(null);
    }
  };

  return (
    <section className="space-y-6">
      <Card className="border-dashed">
        <CardContent className="space-y-3">
          <p className="text-sm font-semibold text-foreground">Resumo do briefing atual</p>
          <div className="flex flex-wrap gap-2">
            <Badge variant="primary">{briefing.goal}</Badge>
            <Badge variant="subtle">
              {briefing.audience} • {briefing.audienceLevel}
            </Badge>
            {toneLabels.map((tone) => (
              <Badge key={tone}>{tone}</Badge>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertTitle>Erro ao gerar variações</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Tema do post</label>
              <Input
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
                placeholder="Ex: Como posicionar minha marca pessoal"
                required
              />
              {fieldError && (
                <p className="text-xs text-destructive">{fieldError}</p>
              )}
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-foreground">Formato</label>
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as FormatOption)}
                className={cn(
                  "w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                  "disabled:cursor-not-allowed disabled:opacity-50"
                )}
              >
                {formatOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <Button type="submit" className="w-full" disabled={isGenerating}>
                {isGenerating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Gerando variações...
                  </>
                ) : (
                  "Gerar 6 variações"
                )}
              </Button>
              <p className="text-xs text-muted-foreground">Geração pode levar alguns segundos.</p>
            </div>
          </form>
        </CardContent>
      </Card>

      {variants.length > 0 ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {variants.map((variant) => (
              <Card key={variant.label} className="space-y-3">
                <CardHeader>
                  <CardTitle className="text-lg">{variant.label}</CardTitle>
                </CardHeader>
                <CardContent className="!pt-0">
                  <p className="text-sm leading-relaxed text-muted-foreground whitespace-pre-line">
                    {variant.content}
                  </p>
                </CardContent>
                <CardFooter className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopy(variant)}
                    type="button"
                  >
                    <Copy className="h-4 w-4" />
                    {copiedId === variant.label ? "Copiado" : "Copiar"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled title="Em breve" type="button">
                    Salvar no planner
                  </Button>
                  {copiedId === variant.label && (
                    <span className="text-xs text-muted-foreground">Conteúdo copiado</span>
                  )}
                </CardFooter>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/60 p-5 text-sm text-muted-foreground">
          Preencha o tema e clique em gerar para abrir 6 variações baseadas no briefing.
        </div>
      )}
    </section>
  );
}
