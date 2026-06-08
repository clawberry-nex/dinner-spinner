"use client";

import { signIn } from "next-auth/react";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AuthShell, GoogleButton, authInputCls, AuthError } from "../auth-shell";

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
    <AuthShell heading="Welcome back" copy="Sign in to your kitchen.">
      <GoogleButton onClick={() => signIn("google", { callbackUrl })} />

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[12px] text-text-faint">or</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={onCredentials} className="flex flex-col gap-[11px]">
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
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className={authInputCls}
        />
        {(msg || error) && (
          <AuthError>{msg ?? `Sign-in failed (${error}).`}</AuthError>
        )}
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
            "Sign in"
          )}
        </button>
      </form>

      <p className="mt-[18px] text-center text-[13.5px] text-text-dim">
        New here?{" "}
        <Link
          href="/auth/signup"
          className="font-semibold text-accent-2 hover:underline"
        >
          Request access
        </Link>
      </p>
    </AuthShell>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInForm />
    </Suspense>
  );
}
