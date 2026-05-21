"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { compressImage, type CompressedImage } from "@/lib/image-compress";
import { AppHeader } from "../../_components/app-header";
import { Button } from "../../_components/ui";

const SESSION_KEY = "dinner-spinner:ingest-draft";

export default function IngestPage() {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [compressedPreviewUrl, setCompressedPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setCompressedPreviewUrl(f ? URL.createObjectURL(f) : null);
    setError(null);
  }

  function clearFile() {
    setFile(null);
    if (compressedPreviewUrl) URL.revokeObjectURL(compressedPreviewUrl);
    setCompressedPreviewUrl(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() && !file) return;
    setLoading(true);
    setError(null);
    setRawResponse(null);

    try {
      let image: CompressedImage | undefined;
      if (file) image = await compressImage(file);

      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: input.trim() || undefined,
          image,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        dish?: unknown;
        error?: { code?: string; message?: string; rawResponse?: string | null };
      };
      if (!res.ok || !body.dish) {
        setError(body.error?.message ?? `Ingest failed (${res.status})`);
        setRawResponse(body.error?.rawResponse ?? null);
        return;
      }
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(body.dish));
      router.push("/admin?fromIngest=1");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected failure");
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = (input.trim().length > 0 || file !== null) && !loading;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-4">
      <AppHeader />
      <h1 className="mb-4 text-2xl font-semibold">Ingest a recipe</h1>
      <p className="mb-6 text-sm text-zinc-500">
        Paste a recipe, a URL, or describe a dish in your own words. Optionally
        attach a photo (a cookbook page, a recipe screenshot, an ingredient
        list). Claude will parse it; you&apos;ll review the result in the
        normal dish form before saving.
      </p>

      <form onSubmit={submit} className="space-y-4">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={10}
          placeholder="Paste a recipe, URL, or describe a dish…"
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          disabled={loading}
        />

        <div className="space-y-2">
          <label className="block text-sm font-medium">Attach photo (optional)</label>
          <input
            type="file"
            accept="image/*"
            onChange={onFile}
            disabled={loading}
            className="block w-full text-sm"
          />
          {compressedPreviewUrl && (
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={compressedPreviewUrl}
                alt="attached"
                className="max-h-48 rounded-md border border-zinc-300 dark:border-zinc-700"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearFile}
                disabled={loading}
              >
                Remove
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="submit" disabled={!canSubmit}>
            {loading ? "Reading your recipe…" : "Ingest →"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.push("/admin")}
            disabled={loading}
          >
            Cancel
          </Button>
        </div>

        {error && (
          <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
            <p>{error}</p>
            {rawResponse && (
              <details>
                <summary className="cursor-pointer text-xs underline">
                  Show raw response
                </summary>
                <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-xs">
                  {rawResponse}
                </pre>
              </details>
            )}
            <p className="text-xs">
              <a href="/admin" className="underline">
                Back to manual entry
              </a>
            </p>
          </div>
        )}
      </form>
    </main>
  );
}
