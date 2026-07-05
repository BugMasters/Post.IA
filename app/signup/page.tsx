import Link from "next/link";
import SignupForm from "@/components/auth/signup-form";

export default function SignupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="font-display text-2xl italic font-medium tracking-tight">Criar conta no Post.IA</h1>
      <SignupForm />
      <p className="text-sm text-muted-foreground">
        Já tem conta? <Link className="underline" href="/login">Entrar</Link>
      </p>
    </main>
  );
}
