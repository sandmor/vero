import { NextResponse } from 'next/server';
import { createGuestSession } from '@/lib/auth/guest';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const redirectUrl = searchParams.get('redirectUrl') || '/';
  await createGuestSession();
  return NextResponse.redirect(new URL(redirectUrl, request.url));
}
