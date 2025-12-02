/**
 * Type utilities and validators for the sandbox environment.
 * Provides type-safe validation and coercion functions.
 */

/**
 * Coerces a value to a finite number or returns null
 */
export function coerceFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

/**
 * Normalizes text using Unicode NFC normalization
 */
export function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  if (value.length === 0) {
    return null;
  }

  try {
    return value.normalize('NFC');
  } catch {
    return value;
  }
}

/**
 * Type guard to check if a value is a valid JSON-serializable object
 */
export function isJsonSerializable(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === 'undefined') return false;
  if (typeof value === 'function') return false;
  if (typeof value === 'symbol') return false;

  const primitiveTypes = ['string', 'number', 'boolean'];
  if (primitiveTypes.includes(typeof value)) return true;

  if (typeof value === 'object') {
    try {
      JSON.stringify(value);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

/**
 * Validates that a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Validates coordinates object
 */
export interface ValidatedCoordinates {
  latitude: number;
  longitude: number;
}

export function validateCoordinates(
  value: unknown
): ValidatedCoordinates | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const obj = value as Record<string, unknown>;
  const latitude = coerceFiniteNumber(obj.latitude);
  const longitude = coerceFiniteNumber(obj.longitude);

  if (latitude === null || longitude === null) {
    return null;
  }

  // Validate coordinate ranges
  if (latitude < -90 || latitude > 90) {
    return null;
  }

  if (longitude < -180 || longitude > 180) {
    return null;
  }

  return { latitude, longitude };
}
