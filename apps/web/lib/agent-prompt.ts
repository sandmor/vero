import { nanoid } from 'nanoid';
import type { PromptPart, PromptRole } from '@/lib/ai/prompt-engine';

type Primitive = string | number | boolean | null;

function clampString(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function sanitizeId(raw: unknown, fallback: string): string {
  if (typeof raw === 'string') {
    const trimmed = clampString(raw.trim(), 64);
    if (trimmed) return trimmed;
  }
  return fallback;
}

function sanitizeSeparator(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  return clampString(raw, 32);
}

function sanitizeJoiner(raw: unknown): string {
  if (typeof raw !== 'string') return DEFAULT_JOINER;
  const trimmed = raw.trim();
  if (!trimmed) return DEFAULT_JOINER;
  return clampString(trimmed, 32);
}

function sanitizeRole(raw: unknown): PromptRole {
  if (raw === 'assistant' || raw === 'user' || raw === 'system') {
    return raw;
  }
  return 'system';
}

function sanitizeDepth(raw: unknown): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return undefined;
  return Math.max(0, Math.floor(numeric));
}

const VARIABLE_KEY_REGEX = /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/;

function sanitizeVariableKey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!VARIABLE_KEY_REGEX.test(trimmed)) return null;
  return trimmed;
}

function sanitizeLabel(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return clampString(trimmed, 80);
}

function sanitizeDescription(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  return clampString(trimmed, 240);
}

function sanitizeDefaultValue(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'string') {
    return clampString(raw, 2000);
  }
  if (typeof raw === 'number' || typeof raw === 'boolean') {
    return String(raw).slice(0, 2000);
  }
  return JSON.stringify(raw).slice(0, 2000);
}

function sanitizeTemplate(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return clampString(raw, 12000);
}

export interface AgentPromptVariable {
  key: string;
  label: string;
  description?: string;
  defaultValue?: string;
  required?: boolean;
}

export interface AgentPromptBlock {
  id: string;
  title: string;
  template: string;
  enabled: boolean;
  separator?: string;
  order: number;
  role: PromptRole;
  depth?: number;
}

export type AgentPromptMode = 'append' | 'replace';

export interface AgentPromptConfig {
  mode: AgentPromptMode;
  joiner: string;
  blocks: AgentPromptBlock[];
  variables: AgentPromptVariable[];
}

export const DEFAULT_JOINER = '\n\n';

export const DEFAULT_AGENT_PROMPT_CONFIG: AgentPromptConfig = {
  mode: 'append',
  joiner: DEFAULT_JOINER,
  blocks: [],
  variables: [],
};

export function cloneAgentPromptConfig(
  config: AgentPromptConfig | undefined | null
): AgentPromptConfig {
  const source = config ?? DEFAULT_AGENT_PROMPT_CONFIG;
  return {
    mode: source.mode,
    joiner: source.joiner,
    blocks: source.blocks.map((block) => ({ ...block })),
    variables: source.variables.map((variable) => ({ ...variable })),
  };
}

export function normalizeAgentPromptConfig(raw: unknown): AgentPromptConfig {
  if (!raw || typeof raw !== 'object') {
    return cloneAgentPromptConfig(DEFAULT_AGENT_PROMPT_CONFIG);
  }

  const input = raw as Record<string, unknown>;
  const mode: AgentPromptMode = input.mode === 'replace' ? 'replace' : 'append';
  const joiner = sanitizeJoiner(input.joiner);

  const seenBlockIds = new Set<string>();
  const blocksRaw = Array.isArray(input.blocks) ? input.blocks : [];
  const blocks: AgentPromptBlock[] = [];

  blocksRaw.forEach((block, index) => {
    if (!block || typeof block !== 'object') return;
    const candidate = block as Record<string, Primitive | undefined> & {
      separator?: unknown;
      enabled?: unknown;
      role?: unknown;
      depth?: unknown;
    };
    const fallbackId = `block-${index + 1}`;
    const id = sanitizeId(candidate.id, fallbackId);
    if (seenBlockIds.has(id)) return;
    seenBlockIds.add(id);

    const title = sanitizeLabel(candidate.title, `Block ${index + 1}`);
    const template = sanitizeTemplate(candidate.template);
    const enabled = candidate.enabled === false ? false : true;
    const separator = sanitizeSeparator(candidate.separator);
    const role = sanitizeRole(candidate.role);
    const depth = sanitizeDepth(candidate.depth);
    let order = Number(candidate.order);
    if (!Number.isFinite(order)) {
      order = index;
    }

    blocks.push({
      id,
      title,
      template,
      enabled,
      separator,
      order,
      role,
      depth,
    });
  });

  blocks.sort((a, b) => a.order - b.order);

  const seenVariableKeys = new Set<string>();
  const variablesRaw = Array.isArray(input.variables) ? input.variables : [];
  const variables: AgentPromptVariable[] = [];

  variablesRaw.forEach((variable) => {
    if (!variable || typeof variable !== 'object') return;
    const candidate = variable as Record<string, unknown>;
    const key = sanitizeVariableKey(candidate.key);
    if (!key) return;
    if (seenVariableKeys.has(key)) return;
    seenVariableKeys.add(key);
    const label = sanitizeLabel(candidate.label, key);
    const description = sanitizeDescription(candidate.description);
    const defaultValue = sanitizeDefaultValue(candidate.defaultValue);
    const required = candidate.required === true;

    variables.push({
      key,
      label,
      description,
      defaultValue,
      required,
    });
  });

  return {
    mode,
    joiner,
    blocks,
    variables,
  };
}

export function agentPromptConfigIsDefault(
  config: AgentPromptConfig | undefined | null
): boolean {
  if (!config) return true;
  if (config.mode !== 'append') return false;
  if (config.joiner !== DEFAULT_JOINER) return false;
  if (config.blocks.some((block) => block.enabled && block.template.trim())) {
    return false;
  }
  if (config.variables.length > 0) return false;
  return true;
}

export function getAgentPromptVariableMap(
  config: AgentPromptConfig | undefined | null
): Record<string, string> {
  if (!config) return {};
  const map: Record<string, string> = {};
  for (const variable of config.variables) {
    map[variable.key] = variable.defaultValue ?? '';
  }
  return map;
}

export function buildPromptPartsFromConfig<Context>(
  config: AgentPromptConfig | undefined | null,
  baseParts: PromptPart<Context>[]
): {
  parts: PromptPart<Context>[];
  joiner?: string;
  normalized: AgentPromptConfig;
} {
  const normalized = normalizeAgentPromptConfig(config);
  const blocks = normalized.blocks.filter(
    (block) => block.enabled && block.template.trim().length > 0
  );

  if (normalized.mode === 'replace') {
    if (blocks.length === 0) {
      return {
        parts: [],
        joiner: normalized.joiner,
        normalized,
      };
    }

    const blockParts = blocks.map((block, index) => ({
      id: `agent-block-${block.id}`,
      template: block.template,
      priority: 200 + index,
      separator: block.separator,
      role: block.role,
      depth: block.depth,
    }));

    return {
      parts: blockParts as PromptPart<Context>[],
      joiner: normalized.joiner,
      normalized,
    };
  }

  if (blocks.length === 0) {
    return {
      parts: baseParts,
      joiner: normalized.joiner,
      normalized,
    };
  }

  const blockParts = blocks.map((block, index) => ({
    id: `agent-block-${block.id}`,
    template: block.template,
    priority: 200 + index,
    separator: block.separator,
    role: block.role,
    depth: block.depth,
  }));

  return {
    parts: [...baseParts, ...blockParts] as PromptPart<Context>[],
    joiner: normalized.joiner,
    normalized,
  };
}

export function createEmptyPromptBlock(): AgentPromptBlock {
  return {
    id: nanoid(8),
    title: 'New Block',
    template: '',
    enabled: true,
    order: Date.now(),
    role: 'system',
  };
}

export function createEmptyPromptVariable(): AgentPromptVariable {
  return {
    key: `var_${nanoid(6)}`,
    label: 'New Variable',
    defaultValue: '',
    required: false,
  };
}
