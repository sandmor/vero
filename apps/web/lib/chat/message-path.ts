export const PATH_SEGMENT_PATTERN = /^_[0-9a-z]{2}$/;
export const PATH_PATTERN = /^(_[0-9a-z]{2})(\._[0-9a-z]{2})*$/;
export const ROOT_KEY = '__root__';

export class InvalidMessagePathError extends Error {
  constructor(message = 'Message path missing or invalid') {
    super(message);
    this.name = 'InvalidMessagePathError';
  }
}

export function parsePathSegments(path: string): string[] {
  return path.split('.').filter(Boolean);
}

export function getParentPath(path: string): string | null {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? null : path.slice(0, lastDot);
}

export function getLastSegment(path: string): string {
  const lastDot = path.lastIndexOf('.');
  return lastDot === -1 ? path : path.slice(lastDot + 1);
}

export function toBase36Label(index: number): string {
  const normalized = index < 0 ? 0 : index;
  return `_${normalized.toString(36).padStart(2, '0')}`;
}

export function parseLabelIndex(label: string): number {
  const normalized = label.startsWith('_') ? label.slice(1) : label;
  const parsed = parseInt(normalized, 36);
  return Number.isNaN(parsed) ? -1 : parsed;
}
