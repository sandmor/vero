/**
 * Dynamic tool prompts for the runCode sandbox.
 * Generated from API metadata to ensure documentation stays in sync with implementation.
 */

import { SANDBOX_CONFIG } from '../tools/sandbox/config';
import { getApiMetadata } from '../tools/sandbox/api-bridge';

type TsDocBlock =
  | {
      kind: 'interface';
      name: string;
      description?: string;
      extends?: string[];
      members: TsInterfaceMember[];
    }
  | {
      kind: 'type';
      name: string;
      description?: string;
      type: string;
    };

type TsInterfaceMember = {
  kind: 'property' | 'method';
  name: string;
  type?: string;
  signature?: string;
  optional?: boolean;
  description?: string;
};

function renderDocBlock(block: TsDocBlock): string {
  const header = block.description
    ? `/**\n * ${block.description.replace(/\n/g, '\n * ')}\n */\n`
    : '';

  if (block.kind === 'type') {
    return `${header}type ${block.name} = ${block.type};`;
  }

  const extendsClause = block.extends?.length
    ? ` extends ${block.extends.join(', ')}`
    : '';

  const members = block.members
    .map((member) => {
      const lines: string[] = [];
      if (member.description) {
        lines.push('  /**');
        member.description.split('\n').forEach((line) => {
          lines.push(`   * ${line}`);
        });
        lines.push('   */');
      }
      if (member.kind === 'method') {
        lines.push(`  ${member.name}${member.signature ?? '(): void'};`);
      } else {
        lines.push(
          `  ${member.name}${member.optional ? '?' : ''}: ${member.type ?? 'unknown'};`
        );
      }
      return lines.join('\n');
    })
    .join('\n');

  return `${header}interface ${block.name}${extendsClause} {\n${members}\n}`;
}

/**
 * Core type definitions for runCode
 */
const RUN_CODE_TS_DOCS: TsDocBlock[] = [
  {
    kind: 'type',
    name: 'RunCodeLanguage',
    description: 'Supported language for runCode.',
    type: "'javascript'",
  },
  {
    kind: 'interface',
    name: 'RunCodeInvocation',
    description:
      'Input payload when invoking runCode. Execution awaits any returned Promise.',
    members: [
      {
        kind: 'property',
        name: 'language',
        optional: true,
        type: 'RunCodeLanguage',
        description: 'Defaults to `javascript`. Other values are rejected.',
      },
      {
        kind: 'property',
        name: 'code',
        type: 'string',
        description: `JavaScript source code to execute in Node.js VM (max ${SANDBOX_CONFIG.MAX_CODE_LENGTH} characters).`,
      },
      {
        kind: 'property',
        name: 'timeoutMs',
        optional: true,
        type: 'number',
        description: `Optional execution limit (${SANDBOX_CONFIG.MIN_TIMEOUT_MS} ms to ${SANDBOX_CONFIG.MAX_TIMEOUT_MS} ms). Defaults to ${SANDBOX_CONFIG.DEFAULT_TIMEOUT_MS} ms.`,
      },
    ],
  },
  {
    kind: 'interface',
    name: 'RunCodeExecutionEnvironment',
    description: 'Metadata attached to every runCode response.',
    members: [
      { kind: 'property', name: 'language', type: 'RunCodeLanguage' },
      { kind: 'property', name: 'runtime', type: '"nodejs-vm"' },
      { kind: 'property', name: 'timeoutMs', type: 'number' },
      {
        kind: 'property',
        name: 'limits',
        type: `{ maxCodeLength: ${SANDBOX_CONFIG.MAX_CODE_LENGTH}; maxLogLines: ${SANDBOX_CONFIG.MAX_LOG_LINES}; maxCollectionItems: ${SANDBOX_CONFIG.MAX_COLLECTION_ITEMS} }`,
      },
      {
        kind: 'property',
        name: 'locationHints',
        type: '{ latitude: number | null; longitude: number | null; city: string | null; country: string | null } | null',
      },
      { kind: 'property', name: 'warnings', type: 'string[]' },
    ],
  },
  {
    kind: 'type',
    name: 'RunCodeToolError',
    description: 'Structured error payload when execution fails.',
    type: '{ name: string; message: string; stack?: string | null }',
  },
  {
    kind: 'interface',
    name: 'RunCodeToolResultBase',
    description: 'Fields shared by successful and failed executions.',
    members: [
      {
        kind: 'property',
        name: 'stdout',
        type: 'string[]',
        description: `Console.log output (max ${SANDBOX_CONFIG.MAX_LOG_LINES} lines).`,
      },
      {
        kind: 'property',
        name: 'stderr',
        type: 'string[]',
        description: `Console.error output (max ${SANDBOX_CONFIG.MAX_LOG_LINES} lines).`,
      },
      {
        kind: 'property',
        name: 'truncatedStdout',
        type: 'number',
        description: 'Number of stdout lines truncated.',
      },
      {
        kind: 'property',
        name: 'truncatedStderr',
        type: 'number',
        description: 'Number of stderr lines truncated.',
      },
      {
        kind: 'property',
        name: 'runtimeMs',
        type: 'number',
        description: 'Actual execution time in milliseconds.',
      },
      { kind: 'property', name: 'codeSize', type: 'number' },
      {
        kind: 'property',
        name: 'environment',
        type: 'RunCodeExecutionEnvironment',
      },
    ],
  },
  {
    kind: 'interface',
    name: 'RunCodeSuccessResult',
    extends: ['RunCodeToolResultBase'],
    description: 'Response payload when the script completes without throwing.',
    members: [
      { kind: 'property', name: 'status', type: '"ok"' },
      {
        kind: 'property',
        name: 'result',
        type: 'unknown',
        description: 'The value returned by the user code.',
      },
      { kind: 'property', name: 'error', type: 'null' },
    ],
  },
  {
    kind: 'interface',
    name: 'RunCodeErrorResult',
    extends: ['RunCodeToolResultBase'],
    description: 'Response payload when the script throws or times out.',
    members: [
      { kind: 'property', name: 'status', type: '"error"' },
      { kind: 'property', name: 'result', type: 'null' },
      { kind: 'property', name: 'error', type: 'RunCodeToolError' },
    ],
  },
  {
    kind: 'type',
    name: 'RunCodeToolResult',
    description: 'Union of possible runCode outcomes.',
    type: 'RunCodeSuccessResult | RunCodeErrorResult',
  },
];

/**
 * Generate API interface documentation from metadata
 */
function generateApiDocs(): TsDocBlock {
  const apiMethods = getApiMetadata();

  return {
    kind: 'interface',
    name: 'RunCodeApi',
    description:
      'Global `api` object exposed inside the sandbox. Provides access to external services.',
    members: apiMethods.map((method) => ({
      kind: 'method' as const,
      name: method.name,
      signature: method.signature,
      description: method.description,
    })),
  };
}

const RUN_CODE_API_TS = [
  ...RUN_CODE_TS_DOCS.map(renderDocBlock),
  renderDocBlock(generateApiDocs()),
].join('\n\n');

export const RUN_CODE_TOOL_PROMPT = [
  'runCode sandbox (default tool)',
  '- Consider runCode before other tools when required. Always use to confirm math beyond a trivial level. Write JavaScript (Promises supported) and return the result.',
  '- Use the `api` bridge for external data; console output is surfaced back to the user.',
  `- Code is limited to ${SANDBOX_CONFIG.MAX_CODE_LENGTH} characters with a timeout of ${SANDBOX_CONFIG.MIN_TIMEOUT_MS}-${SANDBOX_CONFIG.MAX_TIMEOUT_MS}ms.`,
  '',
  'TypeScript API:',
  '```ts',
  RUN_CODE_API_TS,
  '```',
].join('\n');
