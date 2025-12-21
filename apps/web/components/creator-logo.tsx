'use client';

import { Bot } from 'lucide-react';
import {
    LogoOpenAI,
    LogoGoogle,
    LogoOpenRouter,
    LogoClaude,
    LogoKimi,
    LogoMeta,
    LogoMistral,
    LogoDeepSeek,
    LogoCohere,
    LogoNVIDIA,
    LogoXAI,
    LogoQwen,
    LogoZai,
} from '@/components/icons';
import { normalizeCreatorSlug, hasCreatorLogo } from '@/lib/ai/creators';

type CreatorLogoProps = {
    creatorSlug: string;
    size?: number;
    className?: string;
};

/**
 * Renders a logo for a model creator.
 *
 * For known creators with custom logos, displays the logo.
 * For unknown creators, displays a generic Bot icon.
 */
export function CreatorLogo({
    creatorSlug,
    size = 16,
    className,
}: CreatorLogoProps) {
    const normalized = normalizeCreatorSlug(creatorSlug);

    switch (normalized) {
        case 'openai':
            return <LogoOpenAI size={size} />;
        case 'google':
            return <LogoGoogle size={size} />;
        case 'openrouter':
            return <LogoOpenRouter size={size} />;
        case 'anthropic':
            return <LogoClaude size={size} />;
        case 'meta':
            return <LogoMeta size={size} />;
        case 'mistral':
            return <LogoMistral size={size} />;
        case 'deepseek':
            return <LogoDeepSeek size={size} />;
        case 'cohere':
            return <LogoCohere size={size} />;
        case 'alibaba':
            return <LogoQwen size={size} />;
        case 'moonshotai':
            return <LogoKimi size={size} />;
        case 'nvidia':
            return <LogoNVIDIA size={size} />;
        case 'xai':
            return <LogoXAI size={size} />;
        case 'zai':
            return <LogoZai size={size} />;
        default:
            // Unknown creator - show generic icon
            return <Bot size={size} className={className} />;
    }
}

/**
 * Check if a creator has a custom logo component
 */
export function creatorHasLogo(creatorSlug: string): boolean {
    return hasCreatorLogo(creatorSlug);
}
