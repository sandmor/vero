import {
  buildPromptPartsFromConfig,
  getAgentPromptVariableMap,
} from '@/lib/agent-prompt';
import { renderTemplate } from '@/lib/ai/prompt-engine';
import type { RequestHints } from '@/lib/ai/prompts';
import {
  composePromptFromParts,
  getRequestPromptFromHints,
} from '@/lib/ai/prompts';
import { DEFAULT_CHAT_SYSTEM_AGENT_PROMPT } from '@/lib/ai/system-agents';
import { describe, expect, it } from 'bun:test';

const baseRequestHints: RequestHints = {
  latitude: '48.8566',
  longitude: '2.3522',
  city: 'Paris',
  country: 'France',
};

describe('composePromptFromParts', () => {
  it('includes archive guidance only when archive tools are allowed', () => {
    const baseResolution = buildPromptPartsFromConfig(
      DEFAULT_CHAT_SYSTEM_AGENT_PROMPT,
      [],
      { blockPriorityStart: 0 }
    );

    const withoutArchiveComposition = composePromptFromParts({
      requestHints: baseRequestHints,
      allowedTools: [],
      pinnedEntries: [],
      variables: {},
      parts: baseResolution.parts,
      joiner: baseResolution.joiner,
    });

    const withArchiveComposition = composePromptFromParts({
      requestHints: baseRequestHints,
      allowedTools: ['readArchive'],
      pinnedEntries: [],
      variables: {},
      parts: baseResolution.parts,
      joiner: baseResolution.joiner,
    });

    expect(withoutArchiveComposition.system).not.toContain(
      'Archive tools (long-form knowledge base)'
    );
    expect(withArchiveComposition.system).toContain(
      'Archive tools (long-form knowledge base)'
    );
  });

  it('always includes formatting guidance', () => {
    const baseResolution = buildPromptPartsFromConfig(
      DEFAULT_CHAT_SYSTEM_AGENT_PROMPT,
      [],
      { blockPriorityStart: 0 }
    );

    const composition = composePromptFromParts({
      requestHints: baseRequestHints,
      allowedTools: [],
      pinnedEntries: [],
      variables: {},
      parts: baseResolution.parts,
      joiner: baseResolution.joiner,
    });

    const prompt = composition.system;

    expect(prompt).toContain('Render math with KaTeX syntax');
    expect(prompt).toContain('```mermaid');
  });

  it('adds pinned entries respecting size guard', () => {
    const baseResolution = buildPromptPartsFromConfig(
      DEFAULT_CHAT_SYSTEM_AGENT_PROMPT,
      [],
      { blockPriorityStart: 0 }
    );
    const longBody = 'a'.repeat(21_000);
    const composition = composePromptFromParts({
      requestHints: baseRequestHints,
      allowedTools: [],
      pinnedEntries: [
        {
          slug: 'alpha',
          entity: 'Project Alpha',
          body: longBody,
        },
      ],
      variables: {},
      parts: baseResolution.parts,
      joiner: baseResolution.joiner,
    });

    const prompt = composition.system;

    expect(prompt).toContain('=== alpha — Project Alpha ===');
    expect(prompt).toContain('a'.repeat(20_000));
    expect(prompt).not.toContain('a'.repeat(20_001));
  });

  it('appends custom agent blocks and resolves variables', () => {
    const baseResolution = buildPromptPartsFromConfig(
      DEFAULT_CHAT_SYSTEM_AGENT_PROMPT,
      [],
      { blockPriorityStart: 0 }
    );
    const { parts, joiner, normalized } = buildPromptPartsFromConfig(
      {
        mode: 'append',
        joiner: '\n---\n',
        blocks: [
          {
            id: 'custom',
            title: 'Custom',
            template: 'Project context: {{variables.project}}',
            enabled: true,
            order: 0,
            role: 'system',
          },
        ],
        variables: [
          {
            key: 'project',
            label: 'Project',
            defaultValue: 'Aurora',
          },
        ],
      },
      baseResolution.parts,
      { blockPriorityStart: 200 }
    );

    const composition = composePromptFromParts({
      requestHints: baseRequestHints,
      allowedTools: ['createDocument', 'updateDocument'],
      pinnedEntries: [],
      variables: {
        ...getAgentPromptVariableMap(baseResolution.normalized),
        ...getAgentPromptVariableMap(normalized),
      },
      parts,
      joiner,
    });

    const prompt = composition.system;

    expect(prompt).toContain('Project context: Aurora');
    expect(prompt).toContain('---');
  });

  it('replaces default prompt when agent mode is replace', () => {
    const baseResolution = buildPromptPartsFromConfig(
      DEFAULT_CHAT_SYSTEM_AGENT_PROMPT,
      [],
      { blockPriorityStart: 0 }
    );
    const { parts, joiner, normalized } = buildPromptPartsFromConfig(
      {
        mode: 'replace',
        joiner: '\n',
        blocks: [
          {
            id: 'replace',
            title: 'Minimal',
            template: 'Minimal prompt for {{variables.role}}',
            enabled: true,
            order: 0,
            role: 'system',
          },
        ],
        variables: [
          {
            key: 'role',
            label: 'Role',
            defaultValue: 'analysis',
          },
        ],
      },
      baseResolution.parts,
      { blockPriorityStart: 200 }
    );

    const composition = composePromptFromParts({
      requestHints: baseRequestHints,
      allowedTools: [],
      pinnedEntries: [],
      variables: {
        ...getAgentPromptVariableMap(baseResolution.normalized),
        ...getAgentPromptVariableMap(normalized),
      },
      parts,
      joiner,
    });

    const prompt = composition.system;

    expect(prompt).toContain('Minimal prompt for analysis');

    expect(prompt).not.toContain('You are a friendly');
  });

  it('produces additional messages when blocks target non-system roles', () => {
    const baseResolution = buildPromptPartsFromConfig(
      DEFAULT_CHAT_SYSTEM_AGENT_PROMPT,
      [],
      { blockPriorityStart: 0 }
    );
    const { parts, joiner, normalized } = buildPromptPartsFromConfig(
      {
        mode: 'append',
        joiner: '\n',
        blocks: [
          {
            id: 'assistant-prelude',
            title: 'Assistant prelude',
            template: 'Remember to stay concise.',
            enabled: true,
            order: 0,
            role: 'assistant',
            depth: 1,
          },
        ],
        variables: [],
      },
      baseResolution.parts,
      { blockPriorityStart: 200 }
    );

    const composition = composePromptFromParts({
      requestHints: baseRequestHints,
      allowedTools: [],
      pinnedEntries: [],
      variables: {
        ...getAgentPromptVariableMap(baseResolution.normalized),
        ...getAgentPromptVariableMap(normalized),
      },
      parts,
      joiner,
    });

    expect(composition.system).toContain('You are a friendly');
    if (composition.messages.length !== 1) {
      throw new Error('Expected a single auxiliary prompt message');
    }
    const assistantPrelude = composition.messages[0];
    if (assistantPrelude.role !== 'assistant') {
      throw new Error('Expected auxiliary message to target assistant role');
    }
    expect(assistantPrelude.content).toContain('Remember to stay concise.');
    if (assistantPrelude.depth !== 1) {
      throw new Error('Expected auxiliary message depth to equal 1');
    }
  });
});

describe('getRequestPromptFromHints', () => {
  it('renders location hints with fallback', () => {
    const prompt = getRequestPromptFromHints({
      latitude: undefined,
      longitude: undefined,
      city: 'Madrid',
      country: undefined,
    });

    expect(prompt).toContain('- lat: undefined');
    expect(prompt).toContain('- lon: undefined');
    expect(prompt).toContain('- city: Madrid');
    expect(prompt).toContain('- country: undefined');
  });
});

describe('renderTemplate', () => {
  it('supports datetime insertables', () => {
    const result = renderTemplate('Timestamp: {{datetime "yyyy"}}', {});
    const currentYear = String(new Date().getFullYear());
    expect(result).toContain(currentYear);
  });
});
