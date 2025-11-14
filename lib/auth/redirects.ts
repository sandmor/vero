const SAFE_REDIRECT_FALLBACK = '/';
const RELATIVE_URL_BASE = 'http://localhost';
const ENV_DEFAULT_ORIGIN =
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.APP_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000');

export const LOGIN_REDIRECT_QUERY_KEY = 'redirectUrl';

function ensureLeadingSlash(value: string) {
  if (!value.startsWith('/')) {
    return `/${value}`;
  }
  return value;
}

export function sanitizeRedirectPath(candidate?: string | null): string {
  if (!candidate) {
    return SAFE_REDIRECT_FALLBACK;
  }
  const trimmed = candidate.trim();
  if (!trimmed) {
    return SAFE_REDIRECT_FALLBACK;
  }
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return SAFE_REDIRECT_FALLBACK;
  }
  if (trimmed.startsWith('//')) {
    return SAFE_REDIRECT_FALLBACK;
  }

  const normalized = ensureLeadingSlash(trimmed);

  try {
    const url = new URL(normalized, RELATIVE_URL_BASE);
    return `${url.pathname}${url.search}` || SAFE_REDIRECT_FALLBACK;
  } catch {
    return SAFE_REDIRECT_FALLBACK;
  }
}

function resolveRuntimeOrigin(candidate?: string | null) {
  if (candidate && /^https?:\/\//i.test(candidate)) {
    return candidate;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return ENV_DEFAULT_ORIGIN;
}

export function buildLoginRedirectUrl(targetPath: string): string {
  const safeTarget = sanitizeRedirectPath(targetPath);
  const params = new URLSearchParams({
    [LOGIN_REDIRECT_QUERY_KEY]: safeTarget,
  });
  return `/login?${params.toString()}`;
}

export function buildAbsoluteRedirectUrl(
  targetPath: string,
  opts?: { origin?: string | null }
) {
  const safeTarget = sanitizeRedirectPath(targetPath);
  const base = resolveRuntimeOrigin(opts?.origin);
  try {
    return new URL(safeTarget, base).toString();
  } catch {
    return new URL(SAFE_REDIRECT_FALLBACK, base).toString();
  }
}
