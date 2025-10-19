import type { Geo } from '@vercel/functions';
import type { ArtifactKind } from '@/components/artifact';
import {
  PromptTemplateEngine,
  type PromptPart,
  type PromptCompositionResult,
  type RenderedPromptSegment,
  type PromptRole,
  joinSegments,
} from './prompt-engine';
import { RUN_CODE_TOOL_PROMPT } from './tool-prompts/run-code';
import type { ChatToolId } from './tool-ids';

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

export type SystemPromptContext = {
  requestHints: RequestHints;
  allowedTools?: ChatToolId[];
  pinnedEntries?: PinnedEntry[];
  variables?: Record<string, string>;
};

export type SystemPromptOptions = SystemPromptContext & {
  parts?: PromptPart<SystemPromptContext>[];
  joiner?: string;
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

const ARTIFACT_TOOL_IDS = ['createDocument', 'updateDocument'] as const;
const ARCHIVE_TOOL_IDS = [
  'readArchive',
  'writeArchive',
  'manageChatPins',
] as const;

export const regularPrompt =
  'You are a friendly, high-signal assistant. Keep replies focused, verify instructions, ask when context is missing, and overall follow user instructions over all else. The user may ask to override these guidelines at any time.';

const formattingPrompt = `
Formatting expectations
- Render math with KaTeX syntax: inline $...$, block $$...$$
- If using diagrams, use Markdown code fences labelled \`\`\`mermaid
- Prefer clear headings, tight prose, and cite tools or artifacts when you use them
- Use markdown lists to present items.
- Always wrap code in markdown's code blocks.
`;

const runCodePrompt = RUN_CODE_TOOL_PROMPT;

const requestOriginTemplate = `About the origin of user's request:
- lat: {{latitude}}
- lon: {{longitude}}
- city: {{city}}
- country: {{country}}
`;

const artifactsPrompt = `
Artifacts workspace (side-by-side document view)
- Use \`createDocument\` for code or substantial output (~10+ lines) the user may reuse
- Label code fences with their language (default \`python\`); explain limits if another language is requested
- Keep chat replies in conversation unless the user asks for an artifact
- After creating a document, wait for user direction before calling \`updateDocument\`
- For major revisions prefer full rewrites; use targeted updates only when the user scopes the change
`;

const archivePrompt = `
Archive tools (long-form knowledge base)
- Search/read before creating; one entry per entity with a stable lowercase-hyphen slug
- Keep each body as a cohesive essay: weave new facts into place and revise outdated text
- Surface contradictions to the user before overwriting; never store secrets or volatile tokens
- Use links only for relationships between distinct entries; keep subtopics inside the main file
- Pin only high-signal dossiers needed every chat, and unpin when relevance fades
`;

const pinnedMemoryTemplate = `Pinned Memory Files (Authoritative context – treat as already read; update only via tools when user indicates changes)
{{pinnedEntriesBlock}}
`;

const baseBehaviorPart: PromptPart<SystemPromptContext> = {
  id: 'base-behavior',
  template: regularPrompt,
  priority: 10,
};

const formattingPart: PromptPart<SystemPromptContext> = {
  id: 'formatting',
  template: formattingPrompt,
  priority: 15,
};

const runCodePart: PromptPart<SystemPromptContext> = {
  id: 'run-code',
  template: runCodePrompt,
  priority: 18,
  isEnabled: ({ allowedTools }) =>
    isToolGroupEnabled(allowedTools, ['runCode']),
};

const requestOriginPart: PromptPart<SystemPromptContext> = {
  id: 'request-origin',
  template: requestOriginTemplate,
  priority: 20,
  prepare: ({ requestHints }) => ({
    latitude: formatGeoValue(requestHints.latitude),
    longitude: formatGeoValue(requestHints.longitude),
    city: formatGeoValue(requestHints.city),
    country: formatGeoValue(requestHints.country),
  }),
};

const artifactsPart: PromptPart<SystemPromptContext> = {
  id: 'artifacts',
  template: artifactsPrompt,
  priority: 30,
  isEnabled: ({ allowedTools }) =>
    isToolGroupEnabled(allowedTools, ARTIFACT_TOOL_IDS),
};

const archivePart: PromptPart<SystemPromptContext> = {
  id: 'archive',
  template: archivePrompt,
  priority: 40,
  isEnabled: ({ allowedTools }) =>
    isToolGroupEnabled(allowedTools, ARCHIVE_TOOL_IDS),
};

const pinnedMemoryPart: PromptPart<SystemPromptContext> = {
  id: 'pinned-memory',
  template: pinnedMemoryTemplate,
  priority: 50,
  isEnabled: ({ pinnedEntries }) => Boolean(pinnedEntries?.length),
  prepare: ({ pinnedEntries }) => ({
    pinnedEntriesBlock: buildPinnedEntriesBlock(pinnedEntries),
  }),
};

const defaultSystemPromptParts: PromptPart<SystemPromptContext>[] = [
  baseBehaviorPart,
  formattingPart,
  runCodePart,
  requestOriginPart,
  artifactsPart,
  archivePart,
  pinnedMemoryPart,
];

const defaultSystemPromptEngine = new PromptTemplateEngine<SystemPromptContext>(
  defaultSystemPromptParts
);

const requestPromptEngine = new PromptTemplateEngine<SystemPromptContext>([
  requestOriginPart,
]);

export function getDefaultSystemPromptParts() {
  return defaultSystemPromptParts.map((part) => ({ ...part }));
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

export const systemPrompt = ({
  requestHints,
  pinnedEntries,
  allowedTools,
  variables,
  parts,
  joiner,
}: SystemPromptOptions): SystemPromptComposition => {
  const context: SystemPromptContext = {
    requestHints,
    pinnedEntries,
    allowedTools,
    variables,
  };

  let composition: PromptCompositionResult;

  if (parts) {
    const customEngine = new PromptTemplateEngine<SystemPromptContext>(parts, {
      joiner,
    });
    composition = customEngine.compose(context);
  } else if (joiner) {
    const customEngine = new PromptTemplateEngine<SystemPromptContext>(
      defaultSystemPromptParts,
      { joiner }
    );
    composition = customEngine.compose(context);
  } else {
    composition = defaultSystemPromptEngine.compose(context);
  }

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
};

export const getRequestPromptFromHints = (requestHints: RequestHints) => {
  const composition = requestPromptEngine.compose({
    requestHints,
    allowedTools: undefined,
    pinnedEntries: undefined,
  });

  return joinSegments(composition.segments, composition.joiner);
};

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

export const sheetPrompt = `
You are a spreadsheet creation assistant. Create a spreadsheet in csv format based on the given prompt. The spreadsheet should contain meaningful column headers and data.
`;

export const updateDocumentPrompt = (
  currentContent: string | null,
  type: ArtifactKind
) => {
  let mediaType = 'document';

  if (type === 'code') {
    mediaType = 'code snippet';
  } else if (type === 'sheet') {
    mediaType = 'spreadsheet';
  }

  return `Improve the following contents of the ${mediaType} based on the given prompt.

${currentContent ?? ''}`;
};

function formatGeoValue(value: unknown): string {
  return value === undefined || value === null ? 'undefined' : String(value);
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
