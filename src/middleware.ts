import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const ref = request.nextUrl.searchParams.get("ref");
  const response = NextResponse.next();

  if (ref) {
    response.cookies.set("referral_code", ref, {
      httpOnly: true,
      maxAge: 60 * 60 * 24, // 24 hours
      path: "/",
      sameSite: "lax",
    });
  }

  return response;
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
