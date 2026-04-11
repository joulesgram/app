import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { decode } from "next-auth/jwt";

// Auth.js v5 session cookie names. Production uses the __Secure- prefix over
// HTTPS; dev uses the plain name. We check both so a machine that has a cookie
// left over from the other mode (e.g. a tunneled preview) is still cleaned up.
const SESSION_COOKIE_NAMES = [
  "__Secure-authjs.session-token",
  "authjs.session-token",
];

const MAX_COOKIE_CHUNKS = 16;

function readSessionToken(
  cookies: NextRequest["cookies"],
  baseName: string,
): string | null {
  const base = cookies.get(baseName)?.value;
  if (base) return base;

  const chunks: string[] = [];
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) {
    const chunk = cookies.get(`${baseName}.${i}`)?.value;
    if (!chunk) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? chunks.join("") : null;
}

function clearSessionCookies(response: NextResponse, baseName: string) {
  const clearOptions = { path: "/", maxAge: 0 };
  response.cookies.set(baseName, "", clearOptions);
  for (let i = 0; i < MAX_COOKIE_CHUNKS; i++) {
    response.cookies.set(`${baseName}.${i}`, "", clearOptions);
  }
}

export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Referral tracking: capture ?ref= into a cookie the signIn callback reads.
  const ref = request.nextUrl.searchParams.get("ref");
  if (ref) {
    response.cookies.set("referral_code", ref, {
      httpOnly: true,
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
      sameSite: "lax",
    });
  }

  // Stale session cookie sweep. If AUTH_SECRET is rotated (or was missing
  // when old cookies were issued), `auth()` called from an RSC logs
  // JWTSessionError forever because the RSC path in next-auth/lib/index.js
  // drops the Set-Cookie cleanup that @auth/core emits. Do the cleanup here,
  // where Set-Cookie headers actually reach the browser.
  const secret = process.env.AUTH_SECRET;
  if (secret) {
    for (const baseName of SESSION_COOKIE_NAMES) {
      const token = readSessionToken(request.cookies, baseName);
      if (!token) continue;
      try {
        const payload = await decode({ token, secret, salt: baseName });
        if (!payload) clearSessionCookies(response, baseName);
      } catch {
        clearSessionCookies(response, baseName);
      }
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
