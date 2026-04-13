import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dinner Spinner",
  description: "Pick a dinner, scale the recipe, build a shopping list.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <header className="border-b border-zinc-200 dark:border-zinc-800">
          <nav className="mx-auto max-w-4xl px-4 py-3 flex gap-6 text-sm font-medium">
            <Link href="/" className="hover:underline">
              Spinner
            </Link>
            <Link href="/dishes" className="hover:underline">
              Dishes
            </Link>
            <Link href="/plan" className="hover:underline">
              Meal plan
            </Link>
            <Link href="/admin" className="ml-auto text-zinc-500 hover:underline">
              Admin
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8">
          {children}
        </main>
      </body>
    </html>
  );
}
