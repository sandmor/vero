import { format as formatDate } from 'date-fns';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export type TemplateData = Record<string, unknown>;

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
const DATETIME_REGEX =
  /\{\{\s*datetime(?:\s+"([^"]*)"(?:\s+"([^"]*)")?)?\s*\}\}/gi;

const EACH_BLOCK_REGEX =
  /\{\{#each\s+([a-zA-Z0-9_.-]+)\s*\}\}([\s\S]*?)\{\{\/each\}\}/g;

const IF_BLOCK_REGEX =
  /\{\{#if\s+([a-zA-Z0-9_.-]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/g;

function resolvePath(source: TemplateData, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = source;

  for (const segment of segments) {
    if (current == null) {
      return undefined;
    }

    if (typeof current !== 'object') {
      return undefined;
    }

    if (!(segment in (current as Record<string, unknown>))) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function mergeData(
  target: TemplateData,
  additions: TemplateData
): TemplateData {
  return Object.assign({}, target, additions);
}

function normaliseValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function cloneContext<Context>(context: Context): TemplateData {
  if (context == null || typeof context !== 'object') {
    return {};
  }

  if (isPlainObject(context)) {
    return { ...(context as TemplateData) };
  }

  // Fall back to shallow copy if it's an instance of a class
  return Object.assign({}, context as TemplateData);
}

function renderEachBlocks(template: string, data: TemplateData): string {
  return template.replace(EACH_BLOCK_REGEX, (_, key: string, block: string) => {
    const value = resolvePath(data, key);

    if (!Array.isArray(value) || value.length === 0) {
      return '';
    }

    return value
      .map((item, index) => {
        const iterationData: TemplateData = {
          ...data,
          this: item,
          index,
        };
        return renderTemplate(block, iterationData);
      })
      .join('');
  });
}

function renderIfBlocks(template: string, data: TemplateData): string {
  return template.replace(IF_BLOCK_REGEX, (_, key: string, block: string) => {
    const value = resolvePath(data, key);

    // Consider the block as "enabled" if the value is truthy
    const isEnabled = Boolean(value);

    if (!isEnabled) {
      return '';
    }

    // Recursively render the block content
    return renderTemplate(block, data);
  });
}

function renderDatetimeBlocks(template: string, now = new Date()): string {
  return template.replace(
    DATETIME_REGEX,
    (_matched: string, maybeFormat?: string, maybeTimezone?: string) => {
      const formatString =
        maybeFormat && maybeFormat.trim().length
          ? maybeFormat.trim()
          : "yyyy-MM-dd'T'HH:mm:ssXXX";
      const timezone =
        maybeTimezone && maybeTimezone.trim().length
          ? maybeTimezone.trim()
          : undefined;

      try {
        if (!timezone) {
          return formatDate(now, formatString);
        }

        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
        const parts = formatter.formatToParts(now);
        const partMap = parts.reduce<Record<string, string>>((acc, part) => {
          if (part.type !== 'literal') {
            acc[part.type] = part.value;
          }
          return acc;
        }, {});

        const year = Number(partMap.year);
        const month = Number(partMap.month);
        const day = Number(partMap.day);
        const hour = Number(partMap.hour);
        const minute = Number(partMap.minute);
        const second = Number(partMap.second);

        if (
          Number.isFinite(year) &&
          Number.isFinite(month) &&
          Number.isFinite(day) &&
          Number.isFinite(hour) &&
          Number.isFinite(minute) &&
          Number.isFinite(second)
        ) {
          const zonedDate = new Date(
            Date.UTC(
              year,
              month - 1,
              day,
              hour,
              minute,
              second,
              now.getMilliseconds()
            )
          );
          return formatDate(zonedDate, formatString);
        }

        return formatDate(now, formatString);
      } catch (_error) {
        return formatDate(now, formatString);
      }
    }
  );
}

export function renderTemplate(template: string, data: TemplateData): string {
  const withEachBlocks = renderEachBlocks(template, data);
  const withIfBlocks = renderIfBlocks(withEachBlocks, data);
  const withDatetimeBlocks = renderDatetimeBlocks(withIfBlocks);

  return withDatetimeBlocks.replace(
    PLACEHOLDER_REGEX,
    (_match: string, rawKey: string) => {
      const value = resolvePath(data, rawKey);
      return normaliseValue(value);
    }
  );
}

export type PromptRole = 'system' | 'user' | 'assistant';

export interface PromptPart<Context> {
  id: string;
  template: string;
  priority?: number;
  isEnabled?: (context: Context) => boolean;
  prepare?: (context: Context) => TemplateData;
  separator?: string;
  role?: PromptRole;
  depth?: number;
}

export interface PromptTemplateEngineOptions {
  joiner?: string;
}

export interface RenderedPromptSegment {
  id: string;
  role: PromptRole;
  content: string;
  separator?: string;
  depth?: number;
}

export interface PromptCompositionResult {
  segments: RenderedPromptSegment[];
  joiner: string;
}

export class PromptTemplateEngine<Context> {
  private readonly joiner: string;

  constructor(
    private readonly parts: PromptPart<Context>[],
    options: PromptTemplateEngineOptions = {}
  ) {
    this.joiner = options.joiner ?? '\n\n';
  }

  compose(context: Context): PromptCompositionResult {
    const baseData: TemplateData = cloneContext(context);
    const dataWithContext = mergeData(baseData, { context } as TemplateData);

    const renderedParts = this.parts
      .filter((part) => (part.isEnabled ? part.isEnabled(context) : true))
      .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))
      .map((part) => {
        const prepared = part.prepare ? part.prepare(context) : undefined;
        const templateData = prepared
          ? mergeData(dataWithContext, prepared)
          : dataWithContext;
        const rendered = renderTemplate(part.template, templateData).trim();
        const role: PromptRole = part.role ?? 'system';
        const rawDepth = part.depth;
        const depth =
          typeof rawDepth === 'number' && Number.isFinite(rawDepth)
            ? Math.max(0, Math.floor(rawDepth))
            : undefined;
        return {
          rendered,
          separator: part.separator,
          role,
          depth,
          id: part.id,
        };
      })
      .filter(({ rendered }) => rendered.length > 0)
      .map(({ rendered, separator, role, depth, id }) => ({
        id,
        role,
        content: rendered,
        separator,
        depth,
      }));

    return {
      segments: renderedParts,
      joiner: this.joiner,
    };
  }

  composeText(context: Context): string {
    const { segments, joiner } = this.compose(context);
    return joinSegments(segments, joiner);
  }
}

export function joinSegments(
  segments: RenderedPromptSegment[],
  joiner: string
): string {
  if (!segments.length) return '';

  return segments
    .map((segment, index) => {
      const suffix =
        segment.separator ?? (index === segments.length - 1 ? '' : joiner);
      return `${segment.content}${suffix}`;
    })
    .join('')
    .trim();
}
