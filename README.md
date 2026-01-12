<h1 align="center">Vero Chat</h1>

Advanced multimodal AI chat application built with Next.js 16 (App Router), React 19, Prisma & PostgreSQL. It features advanced chat branching and message versioning, tier‑aware model registry, runtime model capability introspection, and granular administrative controls.

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#chat-branching"><strong>Chat Branching</strong></a> ·
  <a href="#synchronization--caching"><strong>Synchronization</strong></a> ·
  <a href="#providers-creators--byok"><strong>Providers & BYOK</strong></a> ·
  <a href="#clerk-integration"><strong>Clerk Auth</strong></a> ·
  <a href="#archive"><strong>Archive</strong></a> ·
  <a href="#tech-stack"><strong>Tech Stack</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br />

## Features

### Core Chat Experience

- **Multimodal Conversations**: Text plus model-dependent support for image/file/audio (auto-derived from model capabilities)
- **Live Streaming**: Incremental token + tool call streaming via AI SDK (`ai` v6)
- **Conversation Lineage**: Fork chats from any message to create new independent conversation trees (parent/fork metadata persisted in `Chat` table)
- **Message Branching & Versioning**: Seamlessly switch between message edits and regenerations within the same chat using PostgreSQL ltree paths
- **Auto-Resume**: Recent context & pinned archive memory automatically reattached on reload
- **Token Bucket Rate Limiting**: Per-tier configurable capacity/refill stored in `Tier` + per-user runtime state in `UserRateLimit`
- **Guest & Auth Modes**: Seamless anonymous upgrade path without losing context
- **Encrypted Client-Side Caching**: AES-GCM encrypted IndexedDB cache with cross-tab synchronization and realtime updates

> For detailed technical documentation on the core features, see the sections below.

---

## Chat Branching

Chat branching enables exploring multiple conversation paths through message edits and regenerations. Every message exists within a tree structure, allowing navigation between alternative responses without losing context.

### Storage: PostgreSQL ltree

Messages use PostgreSQL's `ltree` extension for efficient hierarchical path queries. Paths like `0.0.1.0` encode sibling positions, enabling O(log N) subtree queries instead of recursive SQL.

**Key Operations**:

- Subtree queries: `WHERE path <@ '0.0'::ltree`
- Direct children: `WHERE path ~ '0.*{1}'::lquery`
- Automatic ordering via alphabetic path sort

### AI SDK Integration

Integrating the Vercel AI SDK's `useChat` hook with a tree-based message store presents several challenges. The hook expects a linear array of messages, but our storage is hierarchical. We solve this by constructing the tree client-side with `buildMessageTree()` and extracting the active branch based on `rootMessageIndex` (the root sibling selected in the chat) and per-node `selectedChildIndex` values.

Branch switching requires careful coordination to avoid breaking the `useChat` state. We use XState (`chat-operations.machine.ts`) to handle the complex state transitions involved: blocking navigation during streaming, optimistically updating the UI, persisting the selection asynchronously, and rolling back on failure.

When a message is edited, we create a new sibling in the database with its own ltree path, truncate the UI messages to the edit point, and replay through `useChat` to trigger the AI response. The state machine defers tree synchronization until streaming completes to prevent race conditions between optimistic updates and server state.

### Schema

```prisma
model Message {
  path     Unsupported("ltree")
  pathText String?
  selectedChildIndex Int @default(0)
  ...
}

model Chat {
  rootMessageIndex Int @default(0)
  ...
}
```

**Why ltree?**: Efficient hierarchical queries enable the client to maintain the complete chat state locally. This allows instant branch switching without waiting for the server to return new messages—the client already knows the entire conversation tree.

---

## Synchronization & Caching

The app maintains an AES-GCM encrypted cache in IndexedDB, synchronized across browser tabs and with the server via incremental sync. This provides ~10ms loads vs 200ms+ HTTP. The cache consists of three IndexedDB tables (chats, documents, metadata) storing encrypted records with ciphertext and initialization vectors. Encryption keys are derived using HKDF from the `CACHE_ENCRYPTION_SECRET` combined with the user's session ID, ensuring session-specific isolation.

Tab coordination uses a lease-based leader election protocol built on localStorage and BroadcastChannel. Incremental sync requests (`POST /api/cache/sync` with `lastSyncedAt` timestamp) fetch only changes since the last sync. The `ChatDeletion` table maintains tombstones for deleted chats, enabling clients to remove stale cache entries when they appear in incremental sync responses. WebSocket notifications trigger immediate syncs (debounced to 500ms), and active generating chats are excluded from sync for 2 seconds to prevent overwrites.

### Tab Leader Election

To prevent duplicate API calls across browser tabs, only one tab (the "leader") performs server synchronization. The leader is elected using a lease-based protocol: each tab checks localStorage for an existing valid lease, and if none exists or the current lease has expired, it acquires a 10-second lease. The leader broadcasts heartbeat messages every 3 seconds to maintain its lease. Follower tabs monitor the leader's heartbeat and reload their data from IndexedDB when they receive sync completion notifications.

### Encryption

```typescript
// Key derivation (isomorphic, runs in Cloudflare Worker or Next.js)
const key = HKDF(sessionId, CACHE_ENCRYPTION_SECRET, 'vero-cache-encryption');

// Encrypt
const iv = crypto.getRandomValues(new Uint8Array(12));
const ciphertext = await crypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  key,
  data
);
```

**Security**: Session-specific keys, guest sessions isolated, keys never stored.

### Sync Flow

```typescript
// Request: POST /api/cache/sync
// Body: { lastSyncedAt: '2026-01-12T10:30:00Z', pageSize: 100, cursor: null }
// Response: { upserts, deletions, serverTimestamp, hasMore, nextCursor, metadata, totalChats }

// Store encrypted, update lastSyncedAt, notify followers
await cacheManager.storeChats(upserts);
await cacheManager.storeMetadata('lastSyncedAt', serverTimestamp);
tabLeader.notifySyncComplete(serverTimestamp);
```

**Echo Filtering**: Own changes tracked for 5s to ignore realtime echoes.

---

## Providers, Creators & BYOK

Model identity (who made it) is separate from provider infrastructure (who serves it). This separation enables switching model providers without altering the model identity—for example, serving the same OpenAI model through OpenRouter or OpenAI own servers without changing how it's referenced in the application.

### Model vs Provider

The system distinguishes between model creators (companies that develop models) and providers (API endpoints that serve them). A model's composite ID follows the format `creator:model`, where the creator is the organization that developed the model (e.g., `openai`, `google`, `anthropic`, `meta`) and the model is their specific model identifier.

For example, the model ID `openai:gpt-5.2` identifies a GPT-5.2 model from OpenAI. This model can be served through OpenAI's direct API or potentially through aggregator providers like OpenRouter. The `Model` table stores the creator and capabilities, while `ModelProvider` entries link each model to the specific provider(s) that can serve it.

Supported providers include `openai` (OpenAI direct API), `google` (Google AI/Gemini), `openrouter` (aggregator serving models from many creators including Anthropic, Meta, Mistral, etc.), and `xai` (xAI's Grok models). Platform administrators can also add custom providers via `UserCustomProvider`, allowing connections to self-hosted or third-party OpenAI-compatible endpoints.

**Why separate?**: The same model can be served by multiple providers, and aggregator providers like OpenRouter serve models from many different creators. This separation allows flexible routing and provider-specific configurations.

### BYOK (Bring Your Own Key)

BYOK allows users to provide their own API keys for platform providers or configure custom OpenAI-compatible endpoints. BYOK model IDs are prefixed with `byok:` to distinguish them from platform-managed models. The format varies by source:

- Platform providers: Model ID remains `creator:model` (e.g., `openai:gpt-5.2`), but the user's API key is used instead of platform credentials
- Custom providers: User-defined endpoints with arbitrary model identifiers configured through `UserCustomProvider`

The `UserByokModel` table tracks user-configured models, linking to either `UserProviderKey` (for platform providers like OpenAI, Google) or `UserCustomProvider` (for self-hosted Ollama, vLLM, etc.).

**Schema**:

```prisma
model UserProviderKey {
  userId String
  providerId String  // 'openai', 'google'
  apiKey String
}

model UserCustomProvider {
  userId String
  slug String  // 'my-ollama'
  baseUrl String
  apiKey String?
}

model UserByokModel {
  userId String
  sourceType String  // 'platform' or 'custom'
  providerModelId String
  displayName String
  supportsTools Boolean
}
```

**Resolution**:

When a user selects a BYOK model, the system parses the model ID, retrieves the user's API key (for platform providers) or custom provider configuration (for self-hosted endpoints), and instantiates the appropriate provider client with the user's credentials.

**Tier Enforcement**: Platform models gated by tier. BYOK bypasses restrictions (user's own resources).

### Creator vs Provider Examples

| Creator   | Model ID                      | Provider   | Provider Model ID             |
| --------- | ----------------------------- | ---------- | ----------------------------- |
| OpenAI    | `openai:gpt-5.2`              | openai     | `gpt-5.2`                     |
| Google    | `google:gemini-3-flash`       | google     | `gemini-3-flash`              |
| Anthropic | `anthropic:claude-4.5-sonnet` | openrouter | `anthropic/claude-4.5-sonnet` |
| xAI       | `xai:grok-4-1-fast-reasoning` | xai        | `grok-4-1-fast-reasoning`     |

---

## Clerk Integration

Authentication via Clerk (OAuth/SSO) with seamless guest mode (cookie-based anonymous access).

### Dual-Mode

1. **Clerk user**: Regular account, full tier entitlements
2. **Guest**: Cookie JWT (`guest_session`), restricted models, upgrade path

### Guest Session

```typescript
// Cookie
{
  uid: 'guest-12345',
  exp: timestamp,
  signature: 'hmac-sha256'
}

// Database
prisma.user.create({
  id: 'guest-12345',
  email: 'guest-12345@guest.local'
});
```

### OAuth/SSO

Clerk handles Google OAuth and email authentication. When a user clicks "Sign in with Google," they're redirected through Clerk's authentication flow and land back on `/sso-callback` with an established session. Additional OAuth providers (GitHub, Microsoft) or enterprise SSO (SAML/OIDC) are trivial to add through Clerk's configuration.

### Guest → User Upgrade

Middleware detects Clerk user + guest cookie:

```typescript
await prisma.$transaction([
  prisma.chat.updateMany({
    where: { userId: guestId },
    data: { userId: clerkUserId },
  }),
  prisma.user.delete({ where: { id: guestId } }),
]);
```

### Realtime & Cache

The WebSocket gateway authenticates connections using Clerk session tokens for authenticated users or guest session identifiers for anonymous users. Client-side encryption keys are derived from the `sessionId` (for Clerk users) or `uid` (for guest users), ensuring each session has its own isolated encryption namespace.

**Why Clerk?**: OAuth abstraction, session management, enterprise SSO, webhooks.

---

## Tech Stack

### Frontend

- Next.js 16 (App Router, React 19)
- TypeScript + strict type surfaces
- Tailwind CSS v4 + shadcn/ui + Radix primitives
- Framer Motion for transitions
- Progressive streaming UI using `@ai-sdk/react`

### Backend & Data

- AI SDK (`ai` v6) provider unification + streaming handlers
- Prisma ORM with modular schema (model capabilities, archive, rate limit)
- PostgreSQL primary storage (Neon friendly) with ltree extension for message trees
- Redis (optional) for resuming interrupted streams via `resumable-stream` package; rate limiting uses PostgreSQL
- Vercel Blob for file attachments
- Cloudflare Workers at `/apps/edge-gateway` derive session-specific encryption keys for client-side cache using HKDF, running the same `deriveEncryptionKey` function as the Next.js app but at the edge for reduced latency

### Development & Deployment

- Bun (package manager + fast scripts)
- ESLint + Prettier (configured) — (Biome mention removed; repo uses standard toolchain)
- Playwright (E2E) harness ready (browser specs live in `tests/e2e`)
- OpenTelemetry instrumentation hooks (`instrumentation.ts`, `@vercel/otel`)
- Deploy-first design for Vercel (Edge/Node hybrid)

### Key Libraries

- `ai`, `@ai-sdk/react` (multimodal streaming + tool calls)
- `@clerk/nextjs` (auth), `@tanstack/react-query`, `react-hook-form`, `zod`

- `sonner` (toasts), `lucide-react` (icons), `framer-motion` (animation)
- `diff-match-patch` + custom diff view components
- `dexie`: A wrapper for IndexedDB.

## Running locally

### Prerequisites

- Node.js 18+ (or Bun runtime) — Bun v1.3.0 recommended
- PostgreSQL database (local, Docker, or Neon)
- (Optional) Redis if extending caching strategies (not required for baseline)

### Setup

The project is structured as a monorepo with:

- `apps/web` - Main Next.js application
- `apps/realtime-gateway` - WebSocket gateway for realtime chat notifications
- `apps/edge-gateway` - Cloudflare Worker for edge encryption key derivation
- `packages/db` - Shared database package with Prisma schema
- `packages/shared` - Shared isomorphic utilities (encryption, auth)

The root `package.json` provides convenience scripts using `concurrently` to run all services together or individually.

```bash
# 1. Install dependencies
bun install

# 2. Set up environment variables
# Web app: copy apps/web/.env.example to apps/web/.env.local (or .env) and fill in values.
# Realtime gateway: copy apps/realtime-gateway/.env.example to apps/realtime-gateway/.env
# Edge gateway: create apps/edge-gateway/.dev.vars with required secrets

# 3. (First time) Initialize database
bun run db:generate  # Generate Prisma client
bun run db:push      # Push schema to database (dev mode)
# OR for production-style migrations:
bun run db:migrate   # Create and apply migration

# 4. Start all services (web + realtime gateway + edge gateway)
bun run dev

# The dev command uses concurrently to run:
# - apps/web (Next.js dev server on port 3000)
# - apps/realtime-gateway (WebSocket gateway on port 3001)
# - apps/edge-gateway (Cloudflare Worker dev on port 8787)

# To run services individually:
bun run dev:web       # Just the Next.js app
bun run dev:realtime  # Just the WebSocket gateway
bun run dev:edge      # Just the edge worker
```

Navigate to http://localhost:3000.

### Environment Variables

Create `apps/web/.env.local` (or `.env`) for the Next app and ensure `DATABASE_URL` is present when invoking Prisma CLI. The Next app loads env vars from its own directory even when started via the monorepo root scripts.

#### Essential

| Variable                   | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`              | Guest session encryption key                                                               |
| `NEXT_PUBLIC_APP_BASE_URL` | Base URL for metadata / OAuth redirects                                                    |
| `NEXT_PUBLIC_APP_URL`      | Alias used in some code paths; keep in sync with `NEXT_PUBLIC_APP_BASE_URL`                |
| `DATABASE_URL`             | PostgreSQL connection string                                                               |
| `OPENROUTER_API_KEY`       | OpenRouter API key (model catalog + routing)                                               |
| `CACHE_ENCRYPTION_SECRET`  | A 32-byte, base64-encoded secret used to derive encryption keys for the client-side cache. |

#### Authentication (Clerk)

| Variable                            | Purpose                          |
| ----------------------------------- | -------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (frontend) |
| `CLERK_SECRET_KEY`                  | Clerk secret key (backend)       |

#### Optional

| Variable                           | Purpose                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GUEST_SECRET`                     | Dedicated guest cookie signing secret; falls back to `AUTH_SECRET` if omitted                              |
| `COOKIE_DOMAIN`                    | Set to `.yourdomain.com` to share guest cookies with subdomains (required for separate worker subdomains). |
| `OPENAI_API_KEY`                   | Direct OpenAI API access (bypassing OpenRouter)                                                            |
| `GOOGLE_GENERATIVE_AI_API_KEY`     | Direct Gemini API access                                                                                   |
| `GOOGLE_API_KEY`                   | Alternate env name for direct Gemini access (either works)                                                 |
| `DEFAULT_CHAT_MODEL`               | Default model for new chats and fallback                                                                   |
| `ARTIFACT_GENERATION_MODEL`        | Override model for artifact generation flows                                                               |
| `GUEST_MODELS`                     | Comma-separated fallback guest tier model list                                                             |
| `REGULAR_MODELS`                   | Comma-separated fallback regular tier model list                                                           |
| `REDIS_URL`                        | (Pluggable) Redis caching / future rate control                                                            |
| `BLOB_READ_WRITE_TOKEN`            | Vercel Blob storage token                                                                                  |
| `ADMIN_USER_ID`                    | Hard admin (takes precedence over email)                                                                   |
| `ADMIN_EMAIL`                      | Fallback admin identity (bootstrap)                                                                        |
| `NEXT_PUBLIC_DISABLE_SOCIAL_AUTH`  | Set to 1 to hide social auth buttons; omit or 0 to allow                                                   |
| `NEXT_PUBLIC_REALTIME_GATEWAY_URL` | WebSocket URL for realtime updates (enable only when the gateway is running)                               |
| `NEXT_PUBLIC_CACHE_ENCRYPTION_URL` | URL of the Cloudflare Cache Worker (e.g., `http://localhost:8787`). If omitted, falls back to Next.js API. |

#### Realtime Gateway (`apps/realtime-gateway/.env`) — optional service

| Variable                | Purpose                                                       |
| :---------------------- | :------------------------------------------------------------ |
| `PORT`                  | Gateway port (default: 3001)                                  |
| `DATABASE_URL_UNPOOLED` | **Unpooled** PostgreSQL connection string for `LISTEN/NOTIFY` |
| `CLERK_SECRET_KEY`      | Clerk Back-end API Key for token verification                 |
| `CORS_ORIGINS`          | Allowed origins (e.g. `http://localhost:3000`)                |

#### Cache Worker (`apps/cache-worker/.dev.vars`) — optional edge service

| Variable                  | Purpose                                                                  |
| :------------------------ | :----------------------------------------------------------------------- |
| `CACHE_ENCRYPTION_SECRET` | Must match the web app's secret for valid decryption                     |
| `GUEST_SECRET`            | Must match web app for guest cookie verification                         |
| `CLERK_SECRET_KEY`        | For verifying Clerk sessions at the edge                                 |
| `CLERK_PUBLISHABLE_KEY`   | Required for Clerk client initialization                                 |
| `ALLOWED_ORIGINS`         | Comma-separated list of origins (e.g., `http://localhost:3000`) for CORS |

### ⚠️ Important: Production Domain Requirement

Because this worker relies on authentication cookies (`guest_session` and `__session`) which are set with `SameSite=Lax`, **you cannot use the default `*.workers.dev` domain** in production if your app is hosted elsewhere (e.g., Vercel). Browsers will block the cookies, resulting in `401 Unauthorized` errors.

**Required Production Setup:**

1.  **Custom Domain:** Assign a subdomain to the worker (e.g., `cache.yourdomain.com`) that shares the same root as your app.
    - Deploy with the domain flag:
      ```bash
      cd apps/cache-worker
      bunx wrangler deploy --domain cache.yourdomain.com
      ```
    - **Update Auth Config:**
      - **Guest:** Set `COOKIE_DOMAIN=.yourdomain.com` in your Vercel env vars.
      - **Clerk:** Go to Clerk Dashboard > Configure > Paths & Domains and set **Cookie Domain** to `.yourdomain.com`.

2.  **Cloudflare Routes (Same-Origin):** If your main domain is proxied by Cloudflare (Orange Cloud), use a Route. This avoids all CORS/Cookie configuration.
    - **Dashboard:** Go to Cloudflare Dashboard > Workers Routes.
    - Add route: `yourdomain.com/api/cache/encryption-key`
    - **Web App:** Unset `NEXT_PUBLIC_CACHE_ENCRYPTION_URL` so it defaults to the relative path.

### Database Setup

```bash
# Apply schema (development convenience) OR create a migration:
bun run db:push        # Fast, no migration file
# or
bun run db:migrate     # Creates/updates migration history

# Generate client (usually triggered by build as well):
bun run db:generate

# (Optional) Inspect / edit data:
bun run db:studio
```

### Monorepo build workflow

- `bun run build` builds in dependency order: shared db package → web app → realtime gateway.
- `bun run build:web` builds only the web app (Vercel-friendly); it runs the db build first via the web `prebuild` hook.
- `bun run build:gateway` builds only the realtime gateway (also runs the db build first).
- `bun run build:db` builds the shared db package and runs `prisma generate` so generated clients stay in sync.

If you plan to enforce tier overrides or seed model capabilities manually, insert rows into `Tier` and `Model` tables (Prisma Studio or SQL). Missing rows fall back to hardcoded safe defaults so the app can boot cold.

### Testing

- `bun test` / `bun run test:unit` – Bun runner executes fast unit tests under `tests/unit` (JSDOM env, shared setup in `tests/unit/setup.ts`).
- `bun run test:e2e` – Playwright spins up the dev server and runs Chromium tests from `tests/e2e`.
- `bun run lint` – ESLint with the repo configuration.
- `bunx tsc --noEmit` – Type check the Next.js app and test utilities.

| Directory          | Runner     | Notes                                                                              |
| ------------------ | ---------- | ---------------------------------------------------------------------------------- |
| `tests/unit`       | Bun        | Uses `bunfig.toml` preload for mocks and DOM stubs.                                |
| `tests/unit/mocks` | Bun        | Shared mocks consumed during unit tests.                                           |
| `tests/e2e`        | Playwright | Browser automation; requires the dev server (managed automatically by the config). |

> Tip: append `--watch` to `bun test` for watch mode, or `--headed` to `bun run test:e2e -- --headed` when debugging Playwright.

## Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Configure environment variables
3. Enable Vercel integrations:
   - Neon for PostgreSQL
   - Upstash for Redis
   - Vercel Blob for file storage
4. Use `bun run build:web` as the Vercel build command so only the web app (and its db dependency) is built
5. Deploy automatically on push

### Manual Deployment

The application is designed to run on any platform supporting Node.js:

```bash
# Production build (generates Prisma client first)
bun run build

# Launch server
bun run start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes with proper TypeScript types
4. Add tests for new functionality
5. Submit a pull request

## License

MIT
