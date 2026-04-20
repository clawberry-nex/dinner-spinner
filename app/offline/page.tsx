import Link from "next/link";

export const dynamic = "force-static";

export const metadata = {
  title: "Offline — Dinner Spinner",
};

export default function OfflinePage() {
  return (
    <main className="mx-auto max-w-md px-4 py-12 text-center">
      <h1 className="font-serif text-3xl">You&rsquo;re offline</h1>
      <p className="mt-3 text-ink-2">
        Dinner Spinner needs a connection to fetch new dishes, but any dish you
        opened recently should still be readable.
      </p>
      <p className="mt-6 text-[13px]">
        <Link href="/" className="underline underline-offset-4">Back to the spinner</Link>
        <span className="mx-2 text-ink-3">·</span>
        <Link href="/dishes" className="underline underline-offset-4">Browse dishes</Link>
      </p>
    </main>
  );
}
