/**
 * Utility functions for model capabilities
 */

import type { ModelFormat } from './types';
import { FORMAT_PRIORITY } from './constants';

/**
 * Generate a friendly model name from the raw model slug
 */
export function generateFriendlyModelName(modelSlug: string): string {
    // Remove date suffixes like "-20241022" or "-2024-08-06"
    let name = modelSlug.replace(/-\d{4,}(-\d{2}(-\d{2})?)?$/, '');
    // Remove version suffixes like ":latest" or ":free"
    name = name.replace(/:(latest|free|beta|preview|experimental)$/i, '');
    return name;
}

/**
 * Map modalities to our format types
 */
export function mapModalityToFormat(modality: string): ModelFormat | null {
    const normalized = modality.toLowerCase();

    if (
        normalized.includes('text') ||
        normalized.includes('chat') ||
        normalized.includes('language') ||
        normalized.includes('code') ||
        normalized.includes('json')
    ) {
        return 'text';
    }
    if (
        normalized.includes('image') ||
        normalized.includes('vision') ||
        normalized.includes('visual')
    ) {
        return 'image';
    }
    if (
        normalized.includes('file') ||
        normalized.includes('document') ||
        normalized.includes('pdf')
    ) {
        return 'file';
    }
    if (
        normalized.includes('audio') ||
        normalized.includes('speech') ||
        normalized.includes('voice')
    ) {
        return 'audio';
    }
    if (normalized.includes('video') || normalized.includes('animation')) {
        return 'video';
    }
    return null;
}

/**
 * Sort formats by priority order
 */
export function sortFormats(formats: Set<ModelFormat>): ModelFormat[] {
    return Array.from(formats).sort(
        (a, b) => FORMAT_PRIORITY.indexOf(a) - FORMAT_PRIORITY.indexOf(b)
    );
}
