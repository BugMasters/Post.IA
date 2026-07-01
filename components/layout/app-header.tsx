import Link from "next/link";
import { signOut } from "@/infra/auth";
import { Button } from "@/components/ui/button";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/generate", label: "Gerar" },
  { href: "/posts", label: "Histórico" },
  { href: "/rascunhos", label: "Rascunhos" },
  { href: "/posicionamento", label: "Posicionamento" },
];

export default function AppHeader() {
  return (
    <header className="border-b">
      <nav className="mx-auto flex max-w-4xl items-center justify-between p-4">
        <Link href="/dashboard" className="font-semibold">Post.IA</Link>
        <div className="flex items-center gap-4 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-muted-foreground hover:text-foreground">
              {l.label}
            </Link>
          ))}
          <form action={async () => { "use server"; await signOut({ redirectTo: "/" }); }}>
            <Button variant="outline" size="sm" type="submit">Sair</Button>
          </form>
        </div>
      </nav>
    </header>
  );
}
