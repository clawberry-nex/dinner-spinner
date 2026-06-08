"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { AuthShell, GoogleButton, authInputCls, AuthError } from "../auth-shell";

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
    <AuthShell
      heading="Request access"
      copy="Dinner Spinner is invite-only while it's small. If your email's on the list, you'll be dropped straight in."
    >
      <GoogleButton onClick={() => signIn("google", { callbackUrl: "/" })} />

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[12px] text-text-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-[11px]">
        <input
          type="text"
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          className={authInputCls}
        />
        <input
          type="email"
          required
          placeholder="you@email.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className={authInputCls}
        />
        <input
          type="password"
          required
          minLength={8}
          placeholder="Password (min 8 chars)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          className={authInputCls}
        />
        {msg && <AuthError>{msg}</AuthError>}
        <button
          type="submit"
          disabled={submitting}
          className="mt-[5px] inline-flex h-[52px] items-center justify-center gap-[10px] rounded-[var(--radius-md)] border border-accent bg-accent text-[15.5px] font-semibold text-accent-ink transition-opacity hover:opacity-90 disabled:opacity-60"
          style={{ letterSpacing: 0.2 }}
        >
          {submitting ? (
            <>
              <span className="spin inline-block h-[16px] w-[16px] rounded-full border-2 border-accent-ink/30 border-t-accent-ink" />
              One moment…
            </>
          ) : (
            "Create account"
          )}
        </button>
      </form>

      <p className="mt-[18px] text-center text-[13.5px] text-text-dim">
        Already have an account?{" "}
        <Link
          href="/auth/signin"
          className="font-semibold text-accent-2 hover:underline"
        >
          Sign in
        </Link>
      </p>
      <p className="mx-auto mt-[10px] max-w-[280px] text-center text-[12px] leading-[1.5] text-text-faint">
        Dinner Spinner is invite-only while it&rsquo;s small. If your email&rsquo;s
        on the list, you&rsquo;ll be dropped straight in.
      </p>
    </AuthShell>
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
