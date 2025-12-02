import { generateUUID } from '../utils';

// Basic slugify: lowercase, trim, replace spaces/underscores with hyphen, remove invalid chars, collapse dashes.
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120); // keep headroom below 128
}

export function normalizeTags(tags: string[] | undefined): string[] {
  if (!tags) return [];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const raw of tags) {
    const t = slugify(raw);
    if (!t) continue;
    if (!seen.has(t)) {
      seen.add(t);
      normalized.push(t);
    }
  }
  return normalized.slice(0, 64); // safety cap
}

export function appendSuffix(base: string, index: number): string {
  return `${base}-${index}`;
}

export function generateArchiveId(): string {
  return generateUUID();
}
