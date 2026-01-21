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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { profileFormSchema, type ProfileFormValues } from "@/domain/profile";
import { upsertUserProfile } from "@/features/profile/profile.actions";

interface ProfileFormProps {
  defaultValues: ProfileFormValues;
}

export default function ProfileForm({ defaultValues }: ProfileFormProps) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof upsertUserProfile>> | null>(
    null
  );
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset,
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileFormSchema),
    defaultValues,
  });

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const statusMessage = () => {
    if (!result || result.ok) return null;
    return <p className="text-sm text-destructive-500">{result.error}</p>;
  };

  const onSubmit = (values: ProfileFormValues) => {
    setResult(null);

    startTransition(() => {
      void upsertUserProfile(values).then(async (response) => {
        if (response.ok) {
          await router.push("/dashboard");
          router.refresh();
          return;
        }

        setResult(response);
      });
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
              Defina o tom e o contexto que a IA deve usar ao escrever em seu nome.
            </CardDescription>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 px-6 pb-2">
          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor="displayName">Nome publico</Label>
                <Input
                  id="displayName"
                  placeholder="Ex: Ana Souza"
                  {...register("displayName")}
                />
                {errors.displayName && (
                  <p className="text-sm text-destructive-500">
                    {errors.displayName.message}
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="headline">Headline</Label>
                <Input
                  id="headline"
                  placeholder="Ex: Especialista em growth para SaaS"
                  {...register("headline")}
                />
                {errors.headline && (
                  <p className="text-sm text-destructive-500">
                    {errors.headline.message}
                  </p>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="role">Cargo ou identidade</Label>
              <Input
                id="role"
                placeholder="Ex: Founder, Dev Flutter, Consultor"
                {...register("role")}
              />
              {errors.role && (
                <p className="text-sm text-destructive-500">
                  {errors.role.message}
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bio">Bio resumida</Label>
              <Textarea
                id="bio"
                rows={4}
                placeholder="Ex: Ajudo startups B2B a ganhar tracao com conteudo claro."
                {...register("bio")}
              />
              {errors.bio && (
                <p className="text-sm text-destructive-500">
                  {errors.bio.message}
                </p>
              )}
            </div>
          </section>

          <section className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="website">Site</Label>
                <Input
                  id="website"
                  placeholder="https://seusite.com"
                  {...register("website")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="linkedin">LinkedIn</Label>
                <Input
                  id="linkedin"
                  placeholder="https://linkedin.com/in/usuario"
                  {...register("linkedin")}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="github">GitHub</Label>
                <Input
                  id="github"
                  placeholder="https://github.com/usuario"
                  {...register("github")}
                />
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="writingStyleNotes">Notas de estilo</Label>
              <Textarea
                id="writingStyleNotes"
                rows={3}
                placeholder="Ex: curto, direto, sem jargao."
                {...register("writingStyleNotes")}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="bannedClaims">Restricoes</Label>
              <Textarea
                id="bannedClaims"
                rows={3}
                placeholder="Ex: nao dizer que sou senior, nao prometer resultados."
                {...register("bannedClaims")}
              />
            </div>
          </section>
        </CardContent>

        <CardFooter className="flex flex-col items-start gap-3 px-6 pb-6">
          {statusMessage()}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar perfil"}
          </Button>
        </CardFooter>
      </Card>
    </form>
  );
}
