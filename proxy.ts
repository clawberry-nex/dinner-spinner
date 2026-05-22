import { auth } from "@/lib/auth";

export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Public paths. NOT `/` — the spinner fetches /api/dishes which is
  // user-scoped now, and an anonymous visit would crash with "p.slice is
  // not a function" when the 401 body lands where an array was expected.
  // The page also has nothing useful to show without a session, so redirect.
  if (
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/auth/") ||
    pathname === "/manifest.webmanifest" ||
    pathname.startsWith("/icons/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/offline")
  ) {
    return;
  }

  if (req.auth) return;

  const isApi = pathname.startsWith("/api/");

  // Bearer-token bypass for API routes. The route handler does the actual
  // constant-time validation via resolveUserId (lib/auth-helpers.ts);
  // the proxy just needs to let the request through.
  if (isApi && req.headers.get("authorization")?.startsWith("Bearer ")) {
    return;
  }

  if (isApi) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const signInUrl = new URL("/auth/signin", req.url);
  signInUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
  return Response.redirect(signInUrl);
});

export const config = {
  // Skip Next internals & static assets so the JWT cookie doesn't have
  // to be parsed for every chunk request.
  matcher: ["/((?!_next/|api/auth/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|webmanifest)$).*)"],
};
