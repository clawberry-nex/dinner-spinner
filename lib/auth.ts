import "server-only";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { sql } from "@/lib/db";
import {
  parseAllowlist,
  isEmailAllowed,
  verifyPassword,
  slugFromEmail,
  assignAvailableHandle,
} from "@/lib/auth-helpers";

const allowlist = () => parseAllowlist(process.env.ALLOWED_EMAILS);

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/auth/signin" },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID ?? "",
      clientSecret: process.env.AUTH_GOOGLE_SECRET ?? "",
    }),
    Credentials({
      name: "Email + password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(creds) {
        const email = String(creds?.email ?? "").trim().toLowerCase();
        const password = String(creds?.password ?? "");
        if (!email || !password) return null;
        const rows = await sql`
          SELECT id, email, name, password_hash
          FROM users
          WHERE email = ${email}
          LIMIT 1
        `;
        const row = rows[0];
        if (!row || !row.password_hash) return null;
        if (!(await verifyPassword(password, row.password_hash as string))) return null;
        return {
          id: row.id as string,
          email: row.email as string,
          name: (row.name as string | null) ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      const email = (user?.email ?? "").trim().toLowerCase();
      if (!email) return false;
      if (!isEmailAllowed(email, allowlist())) return false;

      // Google: upsert the user row and stamp our DB uuid back onto the
      // user object so jwt() picks up the right id. Credentials provider
      // already produced our user_id in authorize() above.
      if (account?.provider === "google") {
        const handle = await assignAvailableHandle(
          slugFromEmail(email),
          async (h) => {
            const r = await sql`SELECT 1 FROM users WHERE handle = ${h} LIMIT 1`;
            return r.length > 0;
          },
        );
        const rows = await sql`
          INSERT INTO users (email, name, image, handle)
          VALUES (${email}, ${user.name ?? null}, ${user.image ?? null}, ${handle})
          ON CONFLICT (email) DO UPDATE
            SET name  = COALESCE(EXCLUDED.name,  users.name),
                image = COALESCE(EXCLUDED.image, users.image)
          RETURNING id
        `;
        user.id = rows[0].id as string;
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.sub) {
        // NextAuth's default User type already has id?: string thanks to
        // the next-auth.d.ts shipped by the package.
        (session.user as { id: string }).id = token.sub;
      }
      return session;
    },
  },
});
