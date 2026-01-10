import type { Geo } from '@vercel/functions';

import type { UserPreferences } from '@/lib/db/schema';
import {
  joinSegments,
  PromptTemplateEngine,
  renderTemplate,
  type PromptCompositionResult,
  type PromptPart,
  type PromptRole,
  type RenderedPromptSegment,
} from './prompt-engine';
import type { ChatToolId } from './tool-ids';
import { RUN_CODE_TOOL_PROMPT } from './tool-prompts/run-code';

export type RequestHints = {
  latitude: Geo['latitude'];
  longitude: Geo['longitude'];
  city: Geo['city'];
  country: Geo['country'];
};

export type PinnedEntry = {
  slug: string;
  entity: string;
  body: string;
};

export type PromptRuntimeContext = {
  requestHints: RequestHints;
  allowedTools?: ChatToolId[];
  pinnedEntries?: PinnedEntry[];
  variables?: Record<string, string>;
  user?: UserPreferences | null;
};

export type PromptEngineContext = PromptRuntimeContext & {
  tools: {
    runCode: boolean;
    archive: boolean;
  };
  requestOrigin: {
    latitude: string;
    longitude: string;
    city: string;
    country: string;
  };
  pinnedEntriesBlock: string;
};

export interface PromptMessage {
  id: string;
  role: PromptRole;
  content: string;
  depth?: number;
  order: number;
}

export interface SystemPromptComposition {
  system: string;
  messages: PromptMessage[];
  segments: RenderedPromptSegment[];
  joiner: string;
}

const PINNED_MEMORY_CHAR_LIMIT = 20_000;

const ARCHIVE_TOOL_IDS = [
  'readArchive',
  'writeArchive',
  'manageChatPins',
] as const;

export const BASE_BEHAVIOR_PROMPT =
  'You are a friendly, high-signal assistant. Keep replies focused, verify instructions, ask when context is missing, and overall follow user instructions over all else. The user may ask to override these guidelines at any time.';

export const FORMATTING_PROMPT = `
Formatting expectations
- Render math with KaTeX syntax: inline $...$, block $$...$$
- Never write formulas or math outside the appropriate KaTeX delimiters; every mathematical expression must be wrapped in inline $...$ or block $$...$$
- If using tables, use Markdown syntax or CSV format wrapped in \`\`\`csv code fences
- If using diagrams, use Markdown code fences labelled \`\`\`mermaid
- Prefer clear headings, tight prose, and cite tools when you use them
- Use markdown lists to present items.
- Always wrap code in markdown's fenced code blocks with a language label (even short snippets or shell commands); never place code inline in prose.
`;

export const RUN_CODE_PROMPT = RUN_CODE_TOOL_PROMPT;

export const REQUEST_ORIGIN_TEMPLATE = `About the origin of user's request:
- lat: {{requestOrigin.latitude}}
- lon: {{requestOrigin.longitude}}
- city: {{requestOrigin.city}}
- country: {{requestOrigin.country}}
`;

export const ARCHIVE_PROMPT = `
Archive tools (long-form knowledge base)
- Search/read before creating; one entry per entity with a stable lowercase-hyphen slug
- Keep each body as a cohesive essay: weave new facts into place and revise outdated text
- Surface contradictions to the user before overwriting; never store secrets or volatile tokens
- Use links only for relationships between distinct entries; keep subtopics inside the main file
- Pin only high-signal dossiers needed every chat, and unpin when relevance fades
`;

export const PINNED_MEMORY_TEMPLATE = `Pinned Memory Files (Authoritative context – treat as already read; update only via tools when user indicates changes)
{{pinnedEntriesBlock}}
`;

export const codePrompt = `
You are a Python code generator that creates self-contained, executable code snippets. When writing code:

1. Each snippet should be complete and runnable on its own
2. Prefer using print() statements to display outputs
3. Include helpful comments explaining the code
4. Keep snippets concise (generally under 15 lines)
5. Avoid external dependencies - use Python standard library
6. Handle potential errors gracefully
7. Return meaningful output that demonstrates the code's functionality
8. Don't use input() or other interactive functions
9. Don't access files or network resources
10. Don't use infinite loops

Examples of good snippets:

# Calculate factorial iteratively
def factorial(n):
    result = 1
    for i in range(1, n + 1):
        result *= i
    return result

print(f"Factorial of 5 is: {factorial(5)}")
`;

function formatGeoValue(value: unknown): string {
  return value === undefined || value === null ? 'undefined' : String(value);
}

function formatRequestHints(requestHints: RequestHints): {
  latitude: string;
  longitude: string;
  city: string;
  country: string;
} {
  return {
    latitude: formatGeoValue(requestHints.latitude),
    longitude: formatGeoValue(requestHints.longitude),
    city: formatGeoValue(requestHints.city),
    country: formatGeoValue(requestHints.country),
  };
}

function isToolGroupEnabled(
  allowedTools: string[] | undefined,
  toolIds: readonly string[]
) {
  if (!toolIds.length) return true;
  if (allowedTools === undefined) return true;
  if (allowedTools.length === 0) return false;

  const allowedSet = new Set(allowedTools);
  return toolIds.some((tool) => allowedSet.has(tool));
}

function buildPinnedEntriesBlock(pinnedEntries?: PinnedEntry[]): string {
  if (!pinnedEntries || pinnedEntries.length === 0) {
    return '';
  }

  let remaining = PINNED_MEMORY_CHAR_LIMIT;
  const segments: string[] = [];

  for (const entry of pinnedEntries) {
    if (remaining <= 0) break;

    const slug = entry.slug || 'unknown';
    const entity = entry.entity || 'unknown';
    const body = entry.body ?? '';
    const textBody = body.length > remaining ? body.slice(0, remaining) : body;

    segments.push(`\n=== ${slug} — ${entity} ===\n${textBody}`);

    remaining -= textBody.length;
  }

  return segments.join('');
}

function segregateSegments(composition: PromptCompositionResult): {
  primarySystemSegments: RenderedPromptSegment[];
  auxiliarySegments: RenderedPromptSegment[];
} {
  const primarySystemSegments: RenderedPromptSegment[] = [];
  const auxiliarySegments: RenderedPromptSegment[] = [];

  for (const segment of composition.segments) {
    const depth = segment.depth;
    if (segment.role === 'system' && (depth === undefined || depth === null)) {
      primarySystemSegments.push(segment);
    } else {
      auxiliarySegments.push(segment);
    }
  }

  return { primarySystemSegments, auxiliarySegments };
}

function groupSegmentsIntoMessages(
  segments: RenderedPromptSegment[],
  joiner: string
): PromptMessage[] {
  if (!segments.length) return [];

  const grouped: PromptMessage[] = [];

  segments.forEach((segment, index) => {
    const depth = Number.isFinite(segment.depth)
      ? Math.max(0, Math.floor(segment.depth as number))
      : undefined;
    const suffix =
      segment.separator ?? (index === segments.length - 1 ? '' : joiner);
    const chunk = `${segment.content}${suffix}`;
    const previous = grouped.at(-1);

    if (
      previous &&
      previous.role === segment.role &&
      previous.depth === depth
    ) {
      previous.content = `${previous.content}${chunk}`;
    } else {
      grouped.push({
        id: segment.id,
        role: segment.role,
        content: chunk,
        depth,
        order: grouped.length,
      });
    }
  });

  return grouped
    .map((message) => ({
      ...message,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0);
}

function buildPromptContext(
  runtime: PromptRuntimeContext
): PromptEngineContext {
  const requestOrigin = formatRequestHints(runtime.requestHints);
  const pinnedEntriesBlock = buildPinnedEntriesBlock(runtime.pinnedEntries);

  return {
    ...runtime,
    variables: runtime.variables ?? {},
    user: runtime.user ?? undefined,
    requestOrigin,
    pinnedEntriesBlock,
    tools: {
      runCode: isToolGroupEnabled(runtime.allowedTools, ['runCode']),
      archive: isToolGroupEnabled(runtime.allowedTools, ARCHIVE_TOOL_IDS),
    },
  };
}

export function composePromptFromParts({
  requestHints,
  pinnedEntries,
  allowedTools,
  variables,
  user,
  parts,
  joiner,
}: {
  parts: PromptPart<PromptEngineContext>[];
  joiner: string;
} & PromptRuntimeContext): SystemPromptComposition {
  const resolvedJoiner = joiner || '\n\n';

  if (!parts.length) {
    return {
      system: '',
      messages: [],
      segments: [],
      joiner: resolvedJoiner,
    };
  }

  const context = buildPromptContext({
    requestHints,
    pinnedEntries,
    allowedTools,
    variables,
    user,
  });

  const engine = new PromptTemplateEngine<PromptEngineContext>(parts, {
    joiner: resolvedJoiner,
  });
  const composition = engine.compose(context);

  const { primarySystemSegments, auxiliarySegments } =
    segregateSegments(composition);

  const system = joinSegments(primarySystemSegments, composition.joiner);
  const messages = groupSegmentsIntoMessages(
    auxiliarySegments,
    composition.joiner
  );

  return {
    system,
    messages,
    segments: composition.segments,
    joiner: composition.joiner,
  };
}

export const getRequestPromptFromHints = (requestHints: RequestHints) => {
  const requestOrigin = formatRequestHints(requestHints);
  return renderTemplate(REQUEST_ORIGIN_TEMPLATE, { requestOrigin }).trim();
};

