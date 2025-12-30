"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  audienceLevelOptions,
  audienceOptions,
  briefingSchema,
  ctaOptions,
  goalOptions,
  BriefingFormValues,
  toneOptions,
  avoidOptions,
} from "@/domain/briefing";
import {
  SaveBriefingResult,
  saveBriefingAction,
} from "@/features/briefing/briefing.actions";

const defaultBriefingValues: BriefingFormValues = {
  goal: goalOptions[0],
  audience: audienceOptions[0],
  audienceLevel: audienceLevelOptions[0],
  tone: [],
  avoid: [],
  cta: ctaOptions[0],
  offer: "",
  differentiation: ""
};

export default function BriefingPage() {
  const [result, setResult] = useState<SaveBriefingResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<BriefingFormValues>({
    resolver: zodResolver(briefingSchema),
    defaultValues: defaultBriefingValues,
  });

  const onSubmit = (data: BriefingFormValues) => {
    const formData = new FormData();
    Object.entries(data).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => formData.append(key, item));
      } else {
        formData.append(key, value ?? "");
      }
    });

    startTransition(() => {
      void saveBriefingAction(formData).then((response) => {
        return setResult(response);
      });
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
      <p className="text-sm text-destructive-500">
        {result.error || "Não foi possível salvar o briefing."}
      </p>
    );
  };

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold">Briefing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conte para a IA o que você precisa e receba um resumo estratégico.
        </p>
      </div>
      <form
        className="space-y-6 rounded-2xl border bg-card/80 p-6 shadow-sm"
        onSubmit={handleSubmit(onSubmit)}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="goal">Objetivo principal</Label>
            <select
              className="rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
              id="goal"
              {...register("goal")}
            >
              {goalOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {errors.goal && (
              <p className="text-sm text-destructive-500">{errors.goal.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="audience">Audiência</Label>
            <select
              className="rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
              id="audience"
              {...register("audience")}
            >
              {audienceOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {errors.audience && (
              <p className="text-sm text-destructive-500">{errors.audience.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="audienceLevel">Nível da audiência</Label>
            <select
              className="rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
              id="audienceLevel"
              {...register("audienceLevel")}
            >
              {audienceLevelOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {errors.audienceLevel && (
              <p className="text-sm text-destructive-500">{errors.audienceLevel.message}</p>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="offer">Oferta</Label>
            <Textarea id="offer" rows={3} {...register("offer")} />
            {errors.offer && (
              <p className="text-sm text-destructive-500">{errors.offer.message}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="differentiation">Diferenciação</Label>
            <Textarea id="differentiation" rows={3} {...register("differentiation")} />
            {errors.differentiation && (
              <p className="text-sm text-destructive-500">
                {errors.differentiation.message}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <Label className="text-base font-semibold" htmlFor="tone">
                Tom de voz (até 2)
              </Label>
              <p className="text-xs text-muted-foreground">max 2</p>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
              {toneOptions.map((tone) => (
                <label
                  key={tone}
                  className="cursor-pointer rounded-md border border-input/70 px-3 py-2 text-sm shadow-sm transition hover:border-ring/80"
                >
                  <input
                    type="checkbox"
                    value={tone}
                    className="mr-2 accent-primary"
                    {...register("tone")}
                  />
                  {tone}
                </label>
              ))}
            </div>
            {errors.tone && (
              <p className="text-sm text-destructive-500">{errors.tone.message}</p>
            )}
          </div>

          <div>
            <Label className="text-base font-semibold" htmlFor="avoid">
              O que evitar
            </Label>
            <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
              {avoidOptions.map((avoid) => (
                <label
                  key={avoid}
                  className="cursor-pointer rounded-md border border-input/70 px-3 py-2 text-sm shadow-sm transition hover:border-ring/80"
                >
                  <input
                    type="checkbox"
                    value={avoid}
                    className="mr-2 accent-primary"
                    {...register("avoid")}
                  />
                  {avoid}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="cta">Call to action</Label>
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
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Após salvar, o resumo estará disponível no dashboard.
            </p>
            <div className="text-xs text-muted-foreground">{isPending ? "Salvando…" : ""}</div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar briefing"}
            </Button>
            <Link href="/dashboard" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
              Voltar ao dashboard
            </Link>
          </div>
          {statusMessage()}
        </div>
      </form>
    </main>
  );
}
