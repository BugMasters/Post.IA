import type { Metadata } from "next";
import { Geist_Mono, Newsreader, Public_Sans } from "next/font/google";
import "./globals.css";
import AuthSessionProvider from "@/components/auth/session-provider";

const publicSans = Public_Sans({
  variable: "--font-public-sans",
  subsets: ["latin"],
});

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Post.IA — seu co-piloto de conteúdo",
  description:
    "Posts que soam como você e vendem você. Quanto mais você usa, melhor fica.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body
        className={`${publicSans.variable} ${newsreader.variable} ${geistMono.variable} antialiased`}
      >
        <AuthSessionProvider>{children}</AuthSessionProvider>
      </body>
    </html>
  );
}
