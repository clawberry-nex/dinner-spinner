"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function SignInForm() {
  const params = useSearchParams();
  const callbackUrl = params.get("callbackUrl") ?? "/";
  const error = params.get("error");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function onCredentials(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    const res = await signIn("credentials", {
      email,
      password,
      callbackUrl,
      redirect: false,
    });
    setSubmitting(false);
    if (!res || res.error) {
      setMsg("Email or password is wrong, or that email isn't on the allowlist.");
    } else if (res.url) {
      window.location.href = res.url;
    }
  }

  return (
    <div className="mx-auto mt-16 flex w-full max-w-sm flex-col gap-6 rounded-lg border border-zinc-200 bg-paper p-6 shadow-sm dark:border-zinc-800">
      <h1 className="text-center text-xl font-semibold">Sign in to Dinner Spinner</h1>

      <button
        type="button"
        onClick={() => signIn("google", { callbackUrl })}
        className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-500"
      >
        Continue with Google
      </button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-zinc-400">
        <hr className="flex-1 border-zinc-300 dark:border-zinc-700" />
        or
        <hr className="flex-1 border-zinc-300 dark:border-zinc-700" />
      </div>

      <form onSubmit={onCredentials} className="flex flex-col gap-3">
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
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={submitting}
          className="rounded-md border border-zinc-300 px-4 py-2 font-medium hover:bg-zinc-100 disabled:opacity-70 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          {submitting ? "Signing in…" : "Sign in with email"}
        </button>
        {(msg || error) && (
          <p className="text-sm text-red-600">{msg ?? `Sign-in failed (${error}).`}</p>
        )}
      </form>

      <p className="text-center text-sm">
        No account yet?{" "}
        <Link href="/auth/signup" className="text-emerald-600 hover:underline">
          Create one
        </Link>
      </p>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
