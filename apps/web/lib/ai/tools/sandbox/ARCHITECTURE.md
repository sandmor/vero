# Sandbox Architecture

## Overview

The sandbox provides a secure, isolated JavaScript execution environment using Node.js's built-in `vm` module. It enables AI models to run user code safely while providing controlled access to external APIs including weather data and comprehensive web scraping capabilities.

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         Client Code                              │
│                    (AI Model using runCode)                      │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      run-code.ts                                 │
│                   (Tool Definition)                              │
│  • Zod schema validation                                         │
│  • Delegates to executor                                         │
└────────────────────────────┬─────────────────────────────────────┘
                             │
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                    sandbox/executor.ts                           │
│                  (Main Orchestrator)                             │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ 1. Validate input & clamp timeout                          │  │
│  │ 2. Create VM context with deadline tracking                │  │
│  │ 3. Install API bridges (weather, web scraping, etc.)       │  │
│  │ 4. Execute scripts: bootstrap → api → user code → summary  │  │
│  │ 5. Collect sanitized results and return                    │  │
│  └────────────────────────────────────────────────────────────┘  │
└───┬─────────────┬──────────────┬──────────────┬─────────────┬────┘
    │             │              │              │             │
    ▼             ▼              ▼              ▼             ▼
┌────────┐  ┌──────────┐  ┌───────────┐  ┌──────────┐  ┌─────────┐
│config  │  │ errors   │  │  logger   │  │  types   │  │vm-utils │
│        │  │          │  │           │  │          │  │         │
│Constants│ │Custom    │  │Structured │  │Type      │  │VM       │
│& Limits│  │Error     │  │Logging    │  │Definitions│ │Context  │
│        │  │Hierarchy │  │           │  │          │  │Helpers  │
└────────┘  └──────────┘  └───────────┘  └──────────┘  └─────────┘
    │             │              │              │             │
    └─────────────┴──────────────┴──────────────┴─────────────┘
                             │
                             ▼
            ┌────────────────────────────────┐
            │     sandbox/scripts.ts         │
            │   (Script Generators)          │
            │ ┌────────────────────────────┐ │
            │ │ createBootstrapScript()    │ │
            │ │ createApiScript()          │ │
            │ │ createExecutionScript()    │ │
            │ │ createSummaryScript()      │ │
            │ └────────────────────────────┘ │
            └────────────────────────────────┘
                             │
                             ▼
            ┌────────────────────────────────┐
            │    sandbox/api-bridge.ts       │
            │   (API Bridge System)          │
            │ ┌────────────────────────────┐ │
            │ │ createWeatherBridge()      │ │
            │ │ createFetchBridge()        │ │
            │ │ createWebScrapeBridge()    │ │
            │ │ createWebCrawlBridge()     │ │
            │ │ createWebMapBridge()       │ │
            │ │ createWebSearchBridge()    │ │
            │ │ installApiBridges()        │ │
            │ │ extractLocationHints()     │ │
            │ │ getApiMetadata()           │ │
            │ └────────────────────────────┘ │
            └───────────┬────────────────────┘
                        │
          ┌─────────────┴─────────────┐
          ▼                           ▼
┌─────────────────────────┐   ┌─────────────────────────┐
│  external-apis.ts       │   │     web-apis.ts         │
│  (Utility Services)     │   │   (Web Services)        │
│ ┌─────────────────────┐ │   │ ┌─────────────────────┐ │
│ │ fetchWeather()      │ │   │ │ webScrape()         │ │
│ └─────────────────────┘ │   │ │ webCrawl()          │ │
└─────────────────────────┘   │ │ webMap()            │ │
          │                   │ │ webSearch()         │ │
          ▼                   │ └─────────────────────┘ │
┌─────────────────────────┐   └─────────────────────────┘
│    Open-Meteo API       │             │
└─────────────────────────┘             ▼
                          ┌─────────────────────────┐
                          │     Firecrawl API       │
                          │    (Web Scraping)       │
                          └─────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Node.js VM Sandbox Environment                │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Global Scope (Isolated Context)                          │ │
│  │  ├── console (captured → stdout/stderr)                   │ │
│  │  ├── api                                                   │ │
│  │  │   ├── getWeather(coords) → Promise<WeatherData>        │ │
│  │  │   └── fetch(url, options?) → Promise<Response>         │ │
│  │  ├── web                                                   │ │
│  │  │   ├── scrape(params) → Promise<ScrapeResult>           │ │
│  │  │   ├── crawl(params) → Promise<CrawlResult>             │ │
│  │  │   ├── map(params) → Promise<MapResult>                 │ │
│  │  │   └── search(params) → Promise<SearchResult>           │ │
│  │  └── User Code (async execution with result capture)      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Security & Limits:                                             │
│  • Memory: 16 MB soft limit                                     │
│  • Stack: 512 KB soft limit                                     │
│  • Timeout: 250ms - 90,000ms (configurable, enforced)           │
│  • Default timeout: 30,000ms (30 seconds)                       │
│  • Code Size: 12,000 chars max                                  │
│  • Isolated context (no Node.js globals/require)                │
│  • No filesystem or network access (except via bridges)         │
└─────────────────────────────────────────────────────────────────┘
```

## Execution Flow

### 1. Request Validation

```typescript
AI Model → runCode(code, hints) → Zod validation → executor
```

### 2. VM Context Setup

```typescript
createVMContext(deadline) → Isolated sandbox with timeout tracking
```

### 3. Bridge Installation

```typescript
installApiBridges([weatherBridge, fetchBridge, webScrapeBridge, ...]) → VM-native promises for async APIs
```

### 4. Script Execution Sequence

```typescript
1. Bootstrap: Console capture, result container
2. API Setup: Install api.getWeather(), api.fetch(), web.scrape/crawl/map/search()
3. User Code: Execute in async IIFE with try/catch
4. Summary: Collect stdout, stderr, result (sanitized)
```

### 5. Promise Bridge Mechanism

**Host-to-VM Promise Bridge:**

```
User calls api.getWeather(coords)
  ↓
VM creates Promise via __vero_bridge_executor__.dispatch()
  ↓
Host executes async handler (fetchWeather)
  ↓
Host resolves VM promise via evaluateScript()
  ↓
User code receives awaited result
```

This ensures promises created in the VM can await host-side async operations without realm crossing issues.

## Key Design Principles

### 1. **Separation of Concerns**

Each module has a single, clear responsibility:

- `config.ts` → Constants only
- `web-config.ts` → Web API configuration
- `errors.ts` → Error types only
- `logger.ts` → Logging only
- `vm-utils.ts` → VM context management
- `scripts.ts` → Code generation
- `api-bridge.ts` → External API integration
- `web-apis.ts` → Web scraping services
- `executor.ts` → Orchestration

### 2. **Dependency Flow**

```
executor → api-bridge → external-apis, web-apis
    ↓          ↓
  scripts   vm-utils
    ↓          ↓
  config    errors, logger, types, web-types
```

No circular dependencies.

### 3. **Type Safety**

- Explicit types everywhere
- No `any` types
- Runtime validation with type guards
- Compile-time safety with TypeScript

### 4. **Extensibility**

- New APIs added via bridge pattern
- Metadata-driven documentation
- Generated scripts (not hardcoded)
- Pluggable architecture

### 5. **Security**

- Multiple validation layers
- Resource limits enforced
- Sandboxed execution (vm module)
- No host environment access
- Controlled API access via bridges

## Module Reference

### executor.ts

**Purpose:** Main orchestration layer

**Key Functions:**

- `executeSandboxCode(input, hints)` → Coordinates full execution pipeline
- `validateLanguage()` → Ensures JavaScript only
- `clampTimeout()` → Enforces timeout limits
- `generateWarnings()` → Creates user-facing warnings

### vm-utils.ts

**Purpose:** VM context and script execution

**Key Functions:**

- `createVMContext(deadline)` → Creates isolated sandbox
- `evaluateScript()` → Synchronous script execution
- `evaluateAsyncScript()` → Async script execution with promise handling
- `promiseWithTimeout()` → Wraps promises with timeout
- `getContextValue()` / `setContextValue()` → Context manipulation
- `disposeVMContext()` → Cleanup (GC-based)

### scripts.ts

**Purpose:** Generate JavaScript code for VM execution

**Key Functions:**

- `createBootstrapScript()` → Console capture, result container
- `createApiScript(hints)` → Exposes `api` global with methods
- `createExecutionScript(code)` → Wraps user code with error handling
- `createSummaryScript()` → Collects and sanitizes results

### api-bridge.ts

**Purpose:** Bridge host APIs to VM sandbox

**Key Functions:**

- `createWeatherBridge(deadline)` → Weather API handler
- `createFetchBridge(deadline)` → HTTP fetch handler
- `createWebScrapeBridge(deadline)` → Web page scraping handler
- `createWebCrawlBridge(deadline)` → Multi-page crawling handler
- `createWebMapBridge(deadline)` → URL discovery handler
- `createWebSearchBridge(deadline)` → Web search handler
- `installApiBridges(context, bridges)` → Sets up promise dispatch system
- `extractLocationHints(hints)` → Parses request context
- `getApiMetadata()` → Returns API documentation

**Bridge Pattern:**

1. Define `BridgeHandler` async function
2. Create bridge config with `functionName` and `handler`
3. Install via `installApiBridges()`
4. VM-side wrapper returns native promises
5. Host resolves promises via `evaluateScript()`

### external-apis.ts

**Purpose:** Utility service integrations

**Key Functions:**

- `fetchWeather(coords, timeout)` → Calls Open-Meteo API

### web-apis.ts

**Purpose:** Web scraping and search services (Firecrawl-powered)

**Key Functions:**

- `webScrape(params, timeout)` → Scrape single page with optional actions
- `webCrawl(params, timeout)` → Crawl multiple pages from a starting URL
- `webMap(params, timeout)` → Discover URLs on a website
- `webSearch(params, timeout)` → Search the web and optionally scrape results

### web-types.ts

**Purpose:** TypeScript types for web APIs

**Key Types:**

- `WebScrapeParams` / `WebScrapeResult` → Scraping configuration and results
- `WebCrawlParams` / `WebCrawlResult` → Crawling configuration and results
- `WebMapParams` / `WebMapResult` → URL mapping configuration and results
- `WebSearchParams` / `WebSearchResult` → Search configuration and results
- `ScrapeAction` → Page interaction actions (click, write, wait, scroll, press)

### types.ts

**Purpose:** TypeScript type definitions

**Key Types:**

- `ExecutionInput` → User request
- `ExecutionResult` → Execution outcome
- `ExecutionEnvironment` → Runtime metadata
- `RequestHints` → Location/context hints

### errors.ts

**Purpose:** Custom error hierarchy

**Error Types:**

- `SandboxError` → Base class
- `ValidationError` → Invalid input
- `TimeoutError` → Execution timeout
- `VMError` → VM runtime error
- `WebAPIError` → Base class for web API errors
- `WebScrapeError` → Web scraping failures
- `WebCrawlError` → Web crawling failures
- `WebMapError` → URL mapping failures
- `WebSearchError` → Web search failures

### config.ts

**Purpose:** Configuration constants

**Key Constants:**

- `DEFAULT_TIMEOUT_MS` → 3000
- `MAX_CODE_LENGTH` → 12000
- `MAX_LOG_LINES` → 100
- `MAX_SERIALIZATION_DEPTH` → 10

### web-config.ts

**Purpose:** Web API configuration

**Key Constants:**

- `WEB_API_CONFIG.timeouts` → Per-operation timeouts (scrape: 30s, crawl: 60s, etc.)
- `WEB_API_CONFIG.limits` → Operation limits (max pages, max results)
- `WEB_API_CONFIG.defaults` → Default format settings

### logger.ts

**Purpose:** Structured logging

**Log Levels:**

- `debug()` → Verbose execution details
- `info()` → Key execution events
- `warn()` → Non-fatal issues
- `error()` → Failures

## Adding New APIs

To add a new external API (e.g., HTTP fetch):

1. **Add service function** (`external-apis.ts`):

```typescript
export async function fetchHttp(url: string, timeout: number): Promise<string> {
  // Implementation
}
```

2. **Create bridge** (`api-bridge.ts`):

```typescript
export function createHttpBridge(deadline: number): ApiBridgeConfig {
  return {
    functionName: '__vero_host_fetch__',
    handler: async (vmContext, payload) => {
      const { url } = validatePayload(payload);
      return await fetchHttp(url, deadline - Date.now());
    },
  };
}
```

3. **Update API script** (`scripts.ts`):

```typescript
// In createApiScript():
globalThis.api = {
  // ...existing methods
  async fetch(url) {
    const hostFetch = globalThis.__vero_host_fetch__;
    return await hostFetch(JSON.stringify({ url }));
  },
};
```

4. **Install bridge** (`executor.ts`):

```typescript
const httpBridge = createHttpBridge(deadline);
installApiBridges(vmContext, [weatherBridge, httpBridge]);
```

5. **Add metadata** (`api-bridge.ts`):

```typescript
export function getApiMetadata(): ApiMethodMetadata[] {
  return [
    // ...existing entries
    {
      name: 'fetch',
      signature: '(url: string): Promise<string>',
      description: 'Fetch data from HTTP endpoints',
      returnType: 'Promise<string>',
    },
  ];
}
```

Documentation auto-updates! ✨

## Web API Reference

The sandbox exposes a comprehensive `web` global for web interactions:

### web.scrape(params)

Scrapes a single URL and extracts content in various formats.

```javascript
const result = await web.scrape({
  url: 'https://example.com',
  formats: ['markdown', 'html'],
  onlyMainContent: true,
  actions: [
    { type: 'wait', milliseconds: 2000 },
    { type: 'click', selector: '.load-more' },
  ],
});
// result.markdown, result.html, result.metadata
```

### web.crawl(params)

Crawls multiple pages starting from a URL.

```javascript
const result = await web.crawl({
  url: 'https://docs.example.com',
  limit: 10,
  maxDepth: 2,
  includePaths: ['/docs/*'],
  excludePaths: ['/blog/*'],
});
// result.pages - array of scraped pages
```

### web.map(params)

Discovers URLs on a website without scraping content.

```javascript
const result = await web.map({
  url: 'https://example.com',
  search: 'pricing',
  limit: 100,
  includeSubdomains: false,
});
// result.urls - array of discovered URLs
```

### web.search(params)

Searches the web and optionally scrapes results.

```javascript
const result = await web.search({
  query: 'AI assistants 2024',
  limit: 5,
  scrapeResults: true,
});
// result.results - array with url, title, description, and optional content
```

### JSON Extraction

Extract structured data using JSON schemas:

```javascript
const result = await web.scrape({
  url: 'https://shop.example.com/product',
  formats: ['json'],
  jsonSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      price: { type: 'number' },
      inStock: { type: 'boolean' },
    },
  },
});
// result.json - { name: "...", price: 29.99, inStock: true }
```

## Migration from QuickJS

The sandbox was originally built with `quickjs-emscripten` but migrated to Node.js `vm` module for:

1. **Better Promise Support:** Native async/await without realm crossing issues
2. **Simpler Maintenance:** No WASM/Emscripten dependencies
3. **Performance:** Native V8 execution
4. **Debugging:** Better error messages and stack traces

**Key Changes:**

- Replaced `QuickJSContext` with `vm.Context`
- Migrated from `evalCodeAsync()` to `vm.Script.runInContext()`
- Redesigned bridge system for VM-native promises
- Added pending promise map for async resolution

**Preserved:**

- Same API surface for user code
- Security model and resource limits
- Bridge pattern and extensibility
- Test coverage and behavior
