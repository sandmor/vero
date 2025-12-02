# Sandbox Architecture

## Overview

The sandbox provides a secure, isolated JavaScript execution environment using Node.js's built-in `vm` module. It enables AI models to run user code safely while providing controlled access to external APIs like weather data.

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
│  │ 3. Install API bridges (weather, etc.)                     │  │
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
            │ │ installApiBridges()        │ │
            │ │ extractLocationHints()     │ │
            │ │ getApiMetadata()           │ │
            │ └────────────────────────────┘ │
            └───────────┬────────────────────┘
                        │
                        ▼
            ┌────────────────────────────────┐
            │  sandbox/external-apis.ts      │
            │  (External Services)           │
            │ ┌────────────────────────────┐ │
            │ │ fetchWeather()             │ │
            │ │ (future: other APIs)       │ │
            │ └────────────────────────────┘ │
            └────────────────────────────────┘
                        │
                        ▼
            ┌────────────────────────────────┐
            │    External Services           │
            │  • Open-Meteo Weather API      │
            │  • (Future HTTP endpoints)     │
            └────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   Node.js VM Sandbox Environment                │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │  Global Scope (Isolated Context)                          │ │
│  │  ├── console (captured → stdout/stderr)                   │ │
│  │  ├── api                                                   │ │
│  │  │   ├── getWeather(coords) → Promise<WeatherData>        │ │
│  │  │   └── fetch(url) → Not yet implemented                 │ │
│  │  └── User Code (async execution with result capture)      │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Security & Limits:                                             │
│  • Memory: 16 MB soft limit                                     │
│  • Stack: 512 KB soft limit                                     │
│  • Timeout: 250ms - 5000ms (configurable, enforced)             │
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
installApiBridges([weatherBridge]) → VM-native promises for async APIs
```

### 4. Script Execution Sequence

```typescript
1. Bootstrap: Console capture, result container
2. API Setup: Install api.getWeather() with validation
3. User Code: Execute in async IIFE with try/catch
4. Summary: Collect stdout, stderr, result (sanitized)
```

### 5. Promise Bridge Mechanism

**Host-to-VM Promise Bridge:**

```
User calls api.getWeather(coords)
  ↓
VM creates Promise via __virid_bridge_executor__.dispatch()
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
- `errors.ts` → Error types only
- `logger.ts` → Logging only
- `vm-utils.ts` → VM context management
- `scripts.ts` → Code generation
- `api-bridge.ts` → External API integration
- `executor.ts` → Orchestration

### 2. **Dependency Flow**

```
executor → api-bridge → external-apis
    ↓          ↓
  scripts   vm-utils
    ↓          ↓
  config    errors, logger, types
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

**Purpose:** External service integrations

**Key Functions:**

- `fetchWeather(coords, timeout)` → Calls Open-Meteo API

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

### config.ts

**Purpose:** Configuration constants

**Key Constants:**

- `DEFAULT_TIMEOUT_MS` → 3000
- `MAX_CODE_LENGTH` → 12000
- `MAX_LOG_LINES` → 100
- `MAX_SERIALIZATION_DEPTH` → 10

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
    functionName: '__virid_host_fetch__',
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
    const hostFetch = globalThis.__virid_host_fetch__;
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
