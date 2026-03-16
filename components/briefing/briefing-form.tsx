"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  BriefingFormValues,
  audienceLevelOptions,
  audienceOptions,
  ctaOptions,
  goalOptions,
  avoidOptions,
  briefingSchema,
  toneOptions,
} from "@/domain/briefing";
import {
  SaveBriefingResult,
  saveBriefingAction,
} from "@/features/briefing/briefing.actions";

interface BriefingFormProps {
  defaultValues: BriefingFormValues;
}

export default function BriefingForm({ defaultValues }: BriefingFormProps) {
  const [result, setResult] = useState<SaveBriefingResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<BriefingFormValues>({
    resolver: zodResolver(briefingSchema),
    defaultValues,
  });

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const selectedTones = watch("tone") ?? [];
  const selectedAvoid = watch("avoid") ?? [];
  const toneLimitReached = selectedTones.length >= 2;
  const toneCountText = `${selectedTones.length}/2 selecionados`;
  const isBusy = isSubmitting || isPending;

  const toggleTone = (tone: string) => {
    const currentTones = selectedTones ?? [];

    if (currentTones.includes(tone)) {
      setValue("tone", currentTones.filter((item) => item !== tone), {
        shouldValidate: true,
      });
      return;
    }

    if (toneLimitReached) return;

    setValue("tone", [...currentTones, tone], {
      shouldValidate: true,
    });
  };

  const toggleAvoid = (value: string) => {
    const currentAvoid = selectedAvoid ?? [];

    if (currentAvoid.includes(value)) {
      setValue("avoid", currentAvoid.filter((item) => item !== value), {
        shouldValidate: true,
      });
      return;
    }

    setValue("avoid", [...currentAvoid, value], {
      shouldValidate: true,
    });
  };

  const statusMessage = () => {
    if (!result) {
      return null;
    }

    if (result.ok) {
      return (
        <p className="text-sm text-green-500">
          Briefing salvo! Acesse o dashboard para revisar o resumo.
        </p>
      );
    }

    return (
      <p className="text-sm text-destructive-500">{result.error}</p>
    );
  };

  const onSubmit = async (values: BriefingFormValues) => {
    if (isBusy) {
      return;
    }

    setResult(null);

    const response = await saveBriefingAction(values);

    if (!response.ok) {
      setResult(response);
      return;
    }

    startTransition(() => {
      router.push(response.redirectTo);
    });
  };

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="mx-auto w-full max-w-2xl md:max-w-3xl"
    >
      <Card className="rounded-3xl border bg-card/80 shadow-sm">
        <CardHeader className="space-y-1 px-6 pb-2 pt-6">
          <div>
            <CardTitle>Briefing guiado</CardTitle>
            <CardDescription>
              Estruture o contexto e receba uma orientação clara para seus posts.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 px-6 pb-2">
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2 min-w-0">
                <Label htmlFor="goal" className="min-h-[40px] leading-snug">
                  Qual é o objetivo do post?
                </Label>
                <select
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
                  id="goal"
                  {...register("goal")}
                >
                  {goalOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="min-h-[16px] text-xs text-muted-foreground mt-2">
                  Defina a intenção principal do post.
                </p>
                {errors.goal && (
                  <p className="text-sm text-destructive-500">
                    {errors.goal.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 min-w-0">
                <Label htmlFor="audience" className="min-h-[40px] leading-snug">
                  Para quem é?
                </Label>
                <select
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
                  id="audience"
                  {...register("audience")}
                >
                  {audienceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="min-h-[16px] text-xs text-muted-foreground mt-2">
                  Escolha o público que você quer atingir.
                </p>
                {errors.audience && (
                  <p className="text-sm text-destructive-500">
                    {errors.audience.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2 min-w-0">
                <Label
                  htmlFor="audienceLevel"
                  className="min-h-[40px] leading-snug"
                >
                  Nível do público
                </Label>
                <select
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
                  id="audienceLevel"
                  {...register("audienceLevel")}
                >
                  {audienceLevelOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
                <p className="min-h-[16px] text-xs text-muted-foreground mt-2">
                  Quanto o público já conhece sobre o assunto.
                </p>
                {errors.audienceLevel && (
                  <p className="text-sm text-destructive-500">
                    {errors.audienceLevel.message}
                  </p>
                )}
              </div>
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="offer">O que você oferece?</Label>
              <Textarea
                id="offer"
                rows={3}
                placeholder="Ex: Mentoria 1:1 para iniciantes..."
                {...register("offer")}
              />
              <p className="text-xs text-muted-foreground">
                Foque no benefício principal e no problema que resolve.
              </p>
              {errors.offer && (
                <p className="text-sm text-destructive-500">
                  {errors.offer.message}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="differentiation">
                Por que você é diferente?
              </Label>
              <Textarea
                id="differentiation"
                rows={3}
                placeholder="Ex: Método prático + templates..."
                {...register("differentiation")}
              />
              <p className="text-xs text-muted-foreground">
                Destaque processos, formatos ou entregáveis exclusivos.
              </p>
              {errors.differentiation && (
                <p className="text-sm text-destructive-500">
                  {errors.differentiation.message}
                </p>
              )}
            </div>
          </section>

          <Separator />

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold">
                Tom de voz (escolha até 2)
              </p>
              <p
                className={
                  toneLimitReached
                    ? "text-xs text-destructive-500"
                    : "text-xs text-muted-foreground"
                }
              >
                {toneCountText}
              </p>
            </div>
            <ToggleGroup className="flex flex-wrap gap-2">
              {toneOptions.map((tone) => {
                const selected = selectedTones.includes(tone);
                const disabled = toneLimitReached && !selected;
                return (
                  <ToggleGroupItem
                    key={tone}
                    pressed={selected}
                    disabled={disabled}
                    onClick={() => toggleTone(tone)}
                  >
                    {tone}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            {errors.tone && (
              <p className="text-sm text-destructive-500">{errors.tone.message}</p>
            )}
          </section>

          <Separator />

          <section className="space-y-3">
            <p className="text-base font-semibold">Evitar no texto</p>
            <p className="text-xs text-muted-foreground">
              Marque o que não deve aparecer.
            </p>
            <ToggleGroup className="flex flex-wrap gap-2">
              {avoidOptions.map((avoid) => {
                return (
                  <ToggleGroupItem
                    key={avoid}
                    pressed={selectedAvoid.includes(avoid)}
                    onClick={() => toggleAvoid(avoid)}
                  >
                    {avoid}
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
          </section>

          <Separator />

          <section className="space-y-2">
            <Label htmlFor="cta">O que você quer que a pessoa faça?</Label>
            <select
              className="rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
              id="cta"
              {...register("cta")}
            >
              {ctaOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </section>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 border-t pt-4 px-6">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={isBusy}>
              {isBusy ? "Salvando..." : "Salvar e ver resumo"}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => void router.push("/dashboard")}
            >
              Cancelar
            </Button>
            {isBusy && (
              <span className="text-xs text-muted-foreground">Salvando…</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Após salvar, seu resumo aparecerá no dashboard.
          </p>
          {statusMessage()}
        </CardFooter>
      </Card>
    </form>
  );
}
