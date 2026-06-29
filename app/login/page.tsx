import Link from "next/link";
import LoginForm from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-6">
      <h1 className="text-2xl font-semibold">Entrar no Post.IA</h1>
      <LoginForm />
      <p className="text-sm text-muted-foreground">
        Não tem conta? <Link className="underline" href="/signup">Criar conta</Link>
      </p>
    </main>
  );
}
