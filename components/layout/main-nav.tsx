"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/generate", label: "Gerar" },
  { href: "/posts", label: "Histórico" },
  { href: "/rascunhos", label: "Rascunhos" },
  { href: "/posicionamento", label: "Posicionamento" },
];

export default function MainNav() {
  const pathname = usePathname();

  return (
    <>
      {links.map((link) => {
        const active =
          pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "border-b-2 pb-0.5 transition-colors",
              active
                ? "border-pen text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </>
  );
}
