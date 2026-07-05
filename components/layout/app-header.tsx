import Link from "next/link";
import { signOut } from "@/infra/auth";
import { Button } from "@/components/ui/button";
import MainNav from "@/components/layout/main-nav";

export default function AppHeader() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-4xl items-center justify-between p-4">
        <Link
          href="/dashboard"
          className="font-display text-lg italic font-semibold underline decoration-pen decoration-2 underline-offset-4"
        >
          Post.IA
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <MainNav />
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <Button variant="outline" size="sm" type="submit">Sair</Button>
          </form>
        </div>
      </nav>
    </header>
  );
}
