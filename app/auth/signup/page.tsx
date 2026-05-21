"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";

export default function SignUpPage() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password, name }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setSubmitting(false);
      setMsg(messageFor(data.error));
      return;
    }
    // Auto-sign-in after successful sign-up.
    const signed = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl: "/",
    });
    setSubmitting(false);
    if (signed?.url) {
      window.location.href = signed.url;
    } else {
      setMsg("Account created — sign in.");
    }
  }

  return (
    <div className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-6 rounded-lg border border-zinc-200 bg-paper p-6 shadow-sm dark:border-zinc-800">
      <h1 className="text-center text-xl font-semibold">Create your account</h1>
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="email"
          required
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500 disabled:opacity-70"
        >
          {submitting ? "Creating…" : "Create account"}
        </button>
        {msg && <p className="text-sm text-red-600">{msg}</p>}
      </form>
      <p className="text-center text-sm">
        Already have an account?{" "}
        <Link href="/auth/signin" className="text-emerald-600 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function messageFor(code: string | undefined): string {
  switch (code) {
    case "email_not_allowed":
      return "That email isn't on the allowlist.";
    case "already_registered":
      return "That email is already registered. Try signing in.";
    case "password_too_short":
      return "Password must be at least 8 characters.";
    case "missing_fields":
      return "Email and password are required.";
    default:
      return "Sign-up failed.";
  }
}
