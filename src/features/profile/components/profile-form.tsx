"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  authorProfileSchema,
  audienceLevelOptions,
  type AuthorProfileValues,
} from "@/domain/authorProfile";
import {
  saveAuthorProfileAction,
  type SaveAuthorProfileResult,
} from "@/features/profile/profile.actions.server";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

interface ProfileFormProps {
  defaultValues: AuthorProfileValues;
}

export default function ProfileForm({ defaultValues }: ProfileFormProps) {
  const [result, setResult] = useState<SaveAuthorProfileResult | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<AuthorProfileValues>({
    resolver: zodResolver(authorProfileSchema),
    defaultValues,
  });

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const isBusy = isSubmitting || isPending;

  const statusMessage = () => {
    if (!result) {
      return null;
    }

    if (result.ok) {
      return (
        <p className="text-sm text-green-500">
          Perfil salvo. Redirecionando para o dashboard...
        </p>
      );
    }

    return <p className="text-sm text-destructive-500">{result.error}</p>;
  };

  const onSubmit = async (values: AuthorProfileValues) => {
    if (isBusy) {
      return;
    }

    setResult(null);

    const response = await saveAuthorProfileAction(values);
    setResult(response);

    if (!response.ok) {
      return;
    }

    startTransition(() => {
      router.push("/dashboard");
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
            <CardTitle>Perfil do autor</CardTitle>
            <CardDescription>
              Defina o contexto base que o gerador deve considerar antes do briefing.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 px-6 pb-2">
          <section className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="role">Cargo/atuação</Label>
              <Input
                id="role"
                placeholder="Ex: Dev Flutter"
                {...register("role")}
              />
              {errors.role && (
                <p className="text-sm text-destructive-500">{errors.role.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="niche">Nicho</Label>
              <Input
                id="niche"
                placeholder="Ex: Mobile / SaaS"
                {...register("niche")}
              />
              {errors.niche && (
                <p className="text-sm text-destructive-500">{errors.niche.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="audience">Público</Label>
              <Input
                id="audience"
                placeholder="Ex: Devs / Founders"
                {...register("audience")}
              />
              {errors.audience && (
                <p className="text-sm text-destructive-500">{errors.audience.message}</p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="audienceLevel">Nível do público</Label>
              <select
                id="audienceLevel"
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs focus-visible:border-ring focus-visible:ring-ring/50"
                {...register("audienceLevel")}
              >
                {audienceLevelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {errors.audienceLevel && (
                <p className="text-sm text-destructive-500">
                  {errors.audienceLevel.message}
                </p>
              )}
            </div>
          </section>

          <Separator />

          <section className="space-y-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="writingStyle">Estilo de escrita</Label>
              <Textarea
                id="writingStyle"
                rows={3}
                placeholder="Ex: Didático, direto"
                {...register("writingStyle")}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="tonePreference">Preferência de tom</Label>
              <Textarea
                id="tonePreference"
                rows={3}
                placeholder="Ex: Profissional, leve"
                {...register("tonePreference")}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ctaPreference">CTA preferido</Label>
              <Textarea
                id="ctaPreference"
                rows={3}
                placeholder="Ex: Comentar, salvar"
                {...register("ctaPreference")}
              />
            </div>
          </section>
        </CardContent>

        <CardFooter className="flex flex-col gap-3 border-t px-6 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={isBusy}>
              {isBusy ? "Salvando..." : "Salvar perfil"}
            </Button>
            <Button
              variant="ghost"
              type="button"
              onClick={() => void router.push("/dashboard")}
            >
              Cancelar
            </Button>
          </div>
          {statusMessage()}
        </CardFooter>
      </Card>
    </form>
  );
}
