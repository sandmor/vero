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

  // Filter out web.* methods for separate documentation
  const basicMethods = apiMethods.filter(m => !m.name.startsWith('web.'));

  return {
    kind: 'interface',
    name: 'RunCodeApi',
    description:
      'Global `api` object exposed inside the sandbox. Provides access to external services.',
    members: basicMethods.map((method) => ({
      kind: 'method' as const,
      name: method.name,
      signature: method.signature,
      description: method.description,
    })),
  };
}

/**
 * Web API type definitions for comprehensive documentation
 */
const WEB_API_TYPES_DOCS = `
// Web API Types - Global \`web\` object for web scraping, crawling, and search

interface WebScrapeParams {
  /** URL to scrape (required) */
  url: string;
  /** Output formats: "markdown" | "html" | "links" | "screenshot" | "json" */
  formats?: Array<"markdown" | "html" | "links" | "screenshot" | "json">;
  /** JSON Schema for structured extraction (when format includes "json") */
  jsonSchema?: Record<string, unknown>;
  /** Prompt to guide JSON extraction without schema */
  jsonPrompt?: string;
  /** Actions to perform before scraping */
  actions?: Array<
    | { type: "wait"; milliseconds: number }
    | { type: "click"; selector: string }
    | { type: "write"; text: string; selector?: string }
    | { type: "press"; key: string }
    | { type: "scroll"; direction?: "up" | "down"; amount?: number }
  >;
  /** CSS selector to wait for before scraping */
  waitFor?: string;
  /** Extract only main content (exclude nav, footer) */
  onlyMainContent?: boolean;
  /** Request timeout in milliseconds */
  timeout?: number;
}

interface WebScrapeResult {
  markdown?: string;      // Page content as markdown
  html?: string;          // Page HTML content
  links?: string[];       // Extracted links from the page
  screenshot?: string;    // Screenshot URL
  json?: Record<string, unknown>;  // Structured data (when json format used)
  title?: string;         // Page title
  description?: string;   // Page meta description
  sourceUrl: string;      // The scraped URL
  statusCode: number;     // HTTP status code
}

interface WebCrawlParams {
  /** Starting URL to crawl (required) */
  url: string;
  /** Maximum pages to crawl (default: 10, max: 50) */
  limit?: number;
  /** Maximum link depth to crawl (default: 3, max: 5) */
  maxDepth?: number;
  /** Output formats for each page */
  formats?: Array<"markdown" | "html" | "links">;
  /** URL patterns to include (regex strings) */
  includePaths?: string[];
  /** URL patterns to exclude (regex strings) */
  excludePaths?: string[];
}

interface WebCrawlResult {
  status: "scraping" | "completed" | "failed";
  total: number;      // Total pages discovered
  completed: number;  // Pages successfully scraped
  pages: WebScrapeResult[];
}

interface WebMapParams {
  /** Website URL to map (required) */
  url: string;
  /** Search term to filter URLs */
  search?: string;
  /** Maximum URLs to return (default: 100, max: 500) */
  limit?: number;
  /** Include subdomain URLs */
  includeSubdomains?: boolean;
}

interface WebMapResult {
  urls: string[];  // List of discovered URLs
  total: number;   // Total URLs found
}

interface WebSearchParams {
  /** Search query (required) */
  query: string;
  /** Maximum results (default: 5, max: 10) */
  limit?: number;
  /** Country code for location (e.g., "US", "GB") */
  country?: string;
  /** Language code (e.g., "en", "es") */
  language?: string;
  /** Scrape full content from results */
  scrapeResults?: boolean;
}

interface WebSearchResult {
  results: Array<{
    url: string;
    title: string;
    description?: string;
    markdown?: string;  // Full page content (if scrapeResults=true)
  }>;
  total: number;
}

interface WebApi {
  /** Scrape a URL and extract content as markdown, HTML, or structured JSON */
  scrape(params: WebScrapeParams): Promise<WebScrapeResult>;
  /** Crawl a website, discovering and scraping linked pages */
  crawl(params: WebCrawlParams): Promise<WebCrawlResult>;
  /** Discover all URLs on a website extremely fast */
  map(params: WebMapParams): Promise<WebMapResult>;
  /** Search the web and optionally scrape results for full content */
  search(params: WebSearchParams): Promise<WebSearchResult>;
}
`;

const RUN_CODE_API_TS = [
  ...RUN_CODE_TS_DOCS.map(renderDocBlock),
  renderDocBlock(generateApiDocs()),
  WEB_API_TYPES_DOCS,
].join('\n\n');

export const RUN_CODE_TOOL_PROMPT = [
  'runCode sandbox (default tool)',
  '- Consider runCode before other tools when required. Always use to confirm math beyond a trivial level. Write JavaScript (Promises supported) and return the result.',
  '- Use the `api` bridge for external data and `web` object for web scraping/search; console output is surfaced back to the user.',
  `- Code is limited to ${SANDBOX_CONFIG.MAX_CODE_LENGTH} characters with a timeout of ${SANDBOX_CONFIG.MIN_TIMEOUT_MS}-${SANDBOX_CONFIG.MAX_TIMEOUT_MS}ms.`,
  '',
  '**Web API (`web.*`)** - For web scraping, crawling, and search:',
  '- `web.scrape({ url })` - Scrape a URL and get markdown, HTML, links, or structured JSON. Handles JS-rendered content and anti-bot protection.',
  '- `web.crawl({ url, limit })` - Crawl a website starting from URL, auto-discovering linked pages (max 50 pages).',
  '- `web.map({ url, search })` - Discover all URLs on a website extremely fast (ideal for site mapping).',
  '- `web.search({ query, scrapeResults })` - Search the web and optionally scrape full content from results.',
  '',
  '**Examples:**',
  '```javascript',
  '// Basic scrape',
  'const page = await web.scrape({ url: "https://example.com" });',
  'console.log(page.markdown);',
  '',
  '// Extract structured data',
  'const data = await web.scrape({',
  '  url: "https://example.com/products",',
  '  formats: ["json"],',
  '  jsonPrompt: "Extract all product names and prices as an array"',
  '});',
  'console.log(data.json);',
  '',
  '// Search and get full content',
  'const results = await web.search({',
  '  query: "latest AI research papers",',
  '  limit: 3,',
  '  scrapeResults: true',
  '});',
  'results.results.forEach(r => console.log(r.title, r.markdown?.slice(0, 200)));',
  '',
  '// Crawl documentation',
  'const docs = await web.crawl({',
  '  url: "https://docs.example.com",',
  '  limit: 10,',
  '  includePaths: ["/docs/.*"]',
  '});',
  'docs.pages.forEach(p => console.log(p.title));',
  '```',
  '',
  'TypeScript API:',
  '```ts',
  RUN_CODE_API_TS,
  '```',
].join('\n');
