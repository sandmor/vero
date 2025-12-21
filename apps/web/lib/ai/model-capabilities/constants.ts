/**
 * Model Capabilities Constants and Defaults
 */

import type { ModelFormat } from './types';
import type { SupportedProvider } from '../registry';

export const DEFAULT_TIER_IDS = ['guest', 'regular'];

export const FORMAT_PRIORITY: ModelFormat[] = ['text', 'image', 'file', 'audio', 'video'];

export const PROVIDER_DEFAULTS: Record<
    SupportedProvider,
    { supportsTools: boolean; supportedFormats: ModelFormat[] }
> = {
    openai: {
        supportsTools: true,
        supportedFormats: ['text', 'image', 'file', 'audio'],
    },
    google: {
        supportsTools: true,
        supportedFormats: ['text', 'image', 'file', 'audio', 'video'],
    },
    openrouter: {
        supportsTools: false,
        supportedFormats: ['text'],
    },
};
