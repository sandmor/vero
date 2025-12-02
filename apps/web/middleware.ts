import { NextResponse } from 'next/server';
import { clerkMiddleware } from '@clerk/nextjs/server';

// Wrap our custom logic with Clerk's middleware so that calls to auth() work.
export default clerkMiddleware(async (auth, request) => {
  const { pathname } = request.nextUrl;

  // Health / test endpoint used by Playwright to know the dev server is ready.
  if (pathname.startsWith('/ping')) {
    return new Response('pong', { status: 200 });
  }

  // Skip any auth / guest session bootstrapping for Clerk's own auth routes.
  if (
    pathname.startsWith('/api/auth') ||
    pathname.startsWith('/sso-callback')
  ) {
    return NextResponse.next();
  }

  const { userId } = await auth();
  const guestCookie = request.cookies.get('guest_session');

  // If no Clerk user and no guest session, create a guest session first, then redirect back.
  if (!userId && !guestCookie && !['/login', '/register'].includes(pathname)) {
    const redirectUrl = encodeURIComponent(request.url);
    return NextResponse.redirect(
      new URL(`/api/auth/guest?redirectUrl=${redirectUrl}`, request.url)
    );
  }

  // If authenticated via Clerk, block access to login/register pages.
  if (userId && ['/login', '/register'].includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    '/',
    '/chat/:id',
    '/api/:path*',
    '/login',
    '/register',
    '/sso-callback',

    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
};
