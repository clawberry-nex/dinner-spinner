"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, BrandMark } from "../../_components/ui";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.status === 401) { setError("Wrong password"); return; }
      if (!res.ok) { setError("Error"); return; }
      router.push("/admin");
    } catch { setError("Error"); }
    finally { setLoading(false); }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-bg px-6">
      <form onSubmit={submit} className="flex w-full max-w-xs flex-col items-center gap-6 rounded-lg border border-rule bg-paper p-8">
        <BrandMark size={44} />
        <h1 className="m-0 text-[26px] italic font-medium text-ink" style={{ fontFamily: "var(--font-disp)" }}>Admin</h1>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded-pill border border-rule bg-bg px-4 py-3 text-center text-[15px] text-ink placeholder:text-ink-3 focus:border-ink-3 focus:outline-none"
        />
        <Button variant="primary" size="md" type="submit" disabled={!password || loading}>
          {loading ? "…" : "Log in"}
        </Button>
        {error && <div className="text-center text-[12px] text-warn">{error}</div>}
      </form>
    </div>
  );
}
