<h1 align="center">Virid Chat</h1>

Advanced multimodal AI chat application built with Next.js 15 (App Router), React 19, Prisma & PostgreSQL. It features a structured artifact system, persistent memory archive, tier‑aware model registry, runtime model capability introspection, and granular administrative controls.

<p align="center">
  <a href="#features"><strong>Features</strong></a> ·
  <a href="#client-side-caching"><strong>Caching</strong></a> ·
  <a href="#artifacts"><strong>Artifacts</strong></a> ·
  <a href="#archive"><strong>Archive</strong></a> ·
  <a href="#models"><strong>Models</strong></a> ·
  <a href="#auth"><strong>Auth</strong></a> ·
  <a href="#admin"><strong>Admin</strong></a> ·
  <a href="#tech-stack"><strong>Tech Stack</strong></a> ·
  <a href="#running-locally"><strong>Running locally</strong></a>
</p>
<br />

## Features

### Core Chat Experience

- **Multimodal Conversations**: Text plus model-dependent support for image/file/audio (auto-derived from model capabilities)
- **Live Streaming**: Incremental token + tool call streaming via AI SDK (`ai` v5)
- **Conversation Lineage**: Fork chats from any message (parent/fork metadata persisted in `Chat` table)
- **Auto-Resume**: Recent context & pinned archive memory automatically reattached on reload
- **Token Bucket Rate Limiting**: Per-tier configurable capacity/refill stored in `Tier` + per-user runtime state in `UserRateLimit`
- **Guest & Auth Modes**: Seamless anonymous upgrade path without losing context
- **Encrypted Client-Side Caching**: Securely caches chat history and data on the client using IndexedDB and the Web Crypto API. This provides a significant performance boost and enables a near-instant experience when revisiting chats.

### Advanced AI Integration

- **Unified Provider Layer**: OpenRouter, OpenAI, Google (Gemini) exposed through a single abstraction
- **Dynamic Entitlements**: Runtime tier lookup (guest/regular) resolves allowed model IDs
- **Capability Introspection**: Model capabilities (tool support, formats) persisted & auto-synced (OpenRouter catalog fetch with fallback defaults)
- **Selective Tool Access**: Agents/chats may restrict tool allow-lists (see `agent-settings` serialization)
- **Context Preservation**: Persisted `lastContext`, pinned archive entries, and agent settings

### Artifacts System

AI-generated & user-editable structured documents that can be created inline during a conversation:

- **Text Artifacts**: ProseMirror rich text w/ suggestion tracking (stored in `Document` / `Suggestion` tables)
- **Code Artifacts**: CodeMirror editing + diff & syntax highlighting (execution hooks pluggable)
- **Image Artifacts**: Generation via multimodal-capable models; editing UI (client-side transformations)
- **Sheet Artifacts**: CSV / tabular data rendered using React Data Grid with editing & export

### Archive Memory System

Persistent, per-user, queryable knowledge base powering long‑term conversational memory:

- **Entries**: `ArchiveEntry` entities (slug, tags, body) with automatic timestamps
- **Semantic Links**: Directed edges (`ArchiveLink`) with optional bidirectionality
- **Pinned Context**: `ChatPinnedArchiveEntry` join table injects selected memories into prompt scaffolding
- **AI Tools**: Tool layer can create/update/link archive entries on demand
- **Query & Filter**: Tag & (planned) full‑text search over entries (implementation hooks prepared)

### Authentication & Security

- **Clerk**: OAuth / SSO & user management (regular users)
- **Guest Mode**: Cookie-scoped ephemeral identity (pattern `guest-\d+`) with restricted models
- **Admin Assertion**: First-class admin via `ADMIN_USER_ID` (preferred) or fallback `ADMIN_EMAIL`
- **Tier Enforcement**: Model & rate limit entitlements resolved per user type

### Admin Dashboard

Operational management interface (in progress / evolving):

- **Provider API Keys**: Database overrides trump environment variables (`Provider` table)
- **Tier Management**: Adjust model allow lists + bucket config (backed by `Tier` rows, with fallbacks if missing)
- **Model Capabilities**: View persisted model capability matrix & usage (referenced by tiers)
- **Housekeeping Tasks**: Planned actions (sync OpenRouter models, prune unused capabilities)

## Client-Side Caching

To enhance performance and provide a more fluid user experience, Virid Chat implements an encrypted client-side caching mechanism.

### Key Features

- **Fast Initial Load**: Chat history and messages are loaded from a local IndexedDB cache, making navigation between chats nearly instantaneous.
- **Cache Encryption**: All cached data is encrypted using AES-GCM via the Web Crypto API. The encryption key is derived from a server-side secret and a stable user session identifier, ensuring that each user's data is secure and private.
- **Cache Synchronization**: The client-side cache is kept in sync with the server. The application intelligently refreshes the cache in the background to ensure data consistency.
- **Optimistic Updates**: The UI updates optimistically when new messages are sent or chats are created, providing a responsive feel.

### Implementation Details

- **Storage**: [Dexie.js](https://dexie.org/) is used as a wrapper around IndexedDB for convenient and robust database operations.
- **Encryption**: The Web Crypto API is used for all cryptographic operations, ensuring a high level of security.
- **State Management**: The cache is managed through a React Context provider (`EncryptedCacheProvider`) and a custom hook (`useEncryptedCache`), which integrates seamlessly with `react-query`.

## Artifacts

The artifact system enables AI to create and manipulate structured content during conversations:

### Text Artifacts

- Rich text editing with ProseMirror
- AI-powered suggestions for improvements
- Version history and diff viewing
- Collaborative editing capabilities

### Code Artifacts

- Syntax highlighting (CodeMirror + Shiki hybrid for static render / diff)
- Multi-language editing (JS/TS, Python, others extendable)
- Draft vs current rendering + diff visualization
- (Pluggable) execution/refactor hooks; suggestions stored similarly to text artifacts

### Image Artifacts

- AI-generated images from text prompts
- Image editing and manipulation tools
- Multiple format support (PNG, JPEG, WebP)
- Integration with multimodal conversations

### Sheet Artifacts

- CSV data generation and editing
- Interactive data grid with React Data Grid
- Data visualization and analysis
- Export capabilities

## Archive

The archive serves as a persistent memory system for both users and AI:

### Core Concepts

- **Entries**: Individual knowledge units with titles, content, and tags
- **Links**: Semantic relationships between entries (related, parent/child, etc.)
- **Search**: Full-text search across all entries with tag filtering
- **Ownership**: Per-user isolation with secure access controls

### AI Integration

The archive provides tools for AI assistants to:

- Create new memories from conversations
- Retrieve relevant information for context
- Link related concepts automatically
- Update existing knowledge as new information emerges

### User Interface

- **Explorer View**: Browse and search archive entries
- **Detail View**: Read and edit individual entries
- **Link Visualization**: See relationships between entries
  -- **Bulk Operations**: Import/export and batch management

## Models

Provider-agnostic model registry supporting multiple AI providers:

### Supported (Curated) Models

Curated list included at build time (see `lib/ai/models.ts`). Capabilities may be further enriched automatically:

- OpenAI: `gpt-5`
- Google: `gemini-2.5-flash-image-preview`, `gemini-2.5-flash`, `gemini-2.5-pro`
- OpenRouter Aggregated: `x-ai/grok-4`, `x-ai/grok-4-fast:free`, `moonshotai/kimi-k2:free`

### Provider Integration

- **OpenRouter**: Primary provider with model aggregation
- **Direct OpenAI**: Native OpenAI API integration
- **Google Gemini**: Direct Google AI API access
- **Configurable Registry**: Easy addition of new providers

### Entitlement System

Default tier definitions (fallback when DB rows absent):

| Tier    | Models                                                   | Capacity | Refill | Interval |
| ------- | -------------------------------------------------------- | -------- | ------ | -------- |
| guest   | grok-4-fast:free, kimi-k2:free                           | 60       | 20     | 3600s    |
| regular | gpt-5, gemini flash/pro variants, grok-4 (+ free models) | 300      | 100    | 3600s    |

All values can be overridden by inserting/updating `Tier` rows.

## Auth

Flexible authentication system with enterprise and guest support:

### Clerk Integration

- **SSO Support**: Google, GitHub, and enterprise providers
- **User Management**: Profile management and session handling
- **Admin Controls**: User administration and access management
- **Webhook Integration**: Real-time user event processing

### Guest Mode

- Cookie session identity; upgrade path to Clerk user without losing chats
- Rate & model limitations inherited from `guest` tier
- Data stored under synthetic `User` row keyed by guest id (no email requirement)

## Admin

Administrative interface for system management:

### Provider Management

- **API Key Overrides**: Database-stored keys override environment variables
- **Provider Status**: Monitor provider health and usage
- **Key Rotation**: Secure key management and rotation

### Tier Management

- **User Tiers**: Configure model access and rate limits
- **Rate Limiting**: Token bucket configuration per tier
- **Model Lists**: Curate available models per user type
- **Usage Tracking**: Monitor and analyze system usage

## Tech Stack

### Frontend

- Next.js 15 (App Router, React 19)
- TypeScript + strict type surfaces
- Tailwind CSS v4 + shadcn/ui + Radix primitives
- Framer Motion for transitions
- Progressive streaming UI using `@ai-sdk/react`

### Backend & Data

- AI SDK (`ai` v5) provider unification + streaming handlers
- Prisma ORM with modular schema (model capabilities, archive, artifacts, rate limit)
- PostgreSQL primary storage (Neon friendly)
- Redis (optional) future caching / ephemeral coordination; current rate limiting uses PostgreSQL
- Vercel Blob for file & artifact attachments

### Development & Deployment

- Bun (package manager + fast scripts)
- ESLint + Prettier (configured) — (Biome mention removed; repo uses standard toolchain)
- Playwright (E2E) harness ready (tests reside under `playwright/`)
- OpenTelemetry instrumentation hooks (`instrumentation.ts`, `@vercel/otel`)
- Deploy-first design for Vercel (Edge/Node hybrid)

### Key Libraries

- `ai`, `@ai-sdk/react` (multimodal streaming + tool calls)
- `@clerk/nextjs` (auth), `@tanstack/react-query`, `react-hook-form`, `zod`
- ProseMirror + CodeMirror + Shiki (artifact editors)
- `sonner` (toasts), `lucide-react` (icons), `framer-motion` (animation)
- `diff-match-patch` + custom diff view components
- `dexie`: A wrapper for IndexedDB.

## Running locally

### Prerequisites

- Node.js 18+ (or Bun runtime) — Bun v1.1.x recommended
- PostgreSQL database (local, Docker, or Neon)
- (Optional) Redis if extending caching strategies (not required for baseline)

### Setup

```bash
# 1. Install dependencies
bun install

# 2. (First time) Push schema & generate client
bun run db:push      # Applies schema without creating a migration (dev convenience)
bun run db:generate  # Generates client to ./generated/prisma-client

# Alternatively create an initial migration (idempotent if already created)
bun run db:migrate   # prisma migrate dev --name init

# 3. Start dev server (Next.js + streaming)
bun run dev
```

Navigate to http://localhost:3000.

### Environment Variables

Create `.env.local` (loaded by Next.js) and ensure `DATABASE_URL` is present when invoking Prisma CLI.

#### Essential

| Variable                   | Purpose                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| `AUTH_SECRET`              | Guest session encryption key                                                               |
| `NEXT_PUBLIC_APP_BASE_URL` | Base URL for metadata / OAuth redirects                                                    |
| `DATABASE_URL`             | PostgreSQL connection string                                                               |
| `OPENROUTER_API_KEY`       | OpenRouter API key (model catalog + routing)                                               |
| `CACHE_ENCRYPTION_SECRET`  | A 32-byte, base64-encoded secret used to derive encryption keys for the client-side cache. |

#### Authentication (Clerk)

| Variable                            | Purpose                          |
| ----------------------------------- | -------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (frontend) |
| `CLERK_SECRET_KEY`                  | Clerk secret key (backend)       |

#### Optional

| Variable                       | Purpose                                            |
| ------------------------------ | -------------------------------------------------- |
| `REDIS_URL`                    | (Pluggable) Redis caching / future rate control    |
| `BLOB_READ_WRITE_TOKEN`        | Vercel Blob storage token                          |
| `OPENAI_API_KEY`               | Direct OpenAI API access (bypassing OpenRouter)    |
| `GOOGLE_GENERATIVE_AI_API_KEY` | Direct Gemini API access                           |
| `ADMIN_USER_ID`                | Hard admin (takes precedence over email)           |
| `ADMIN_EMAIL`                  | Fallback admin identity (bootstrap)                |
| `TITLE_GENERATION_MODEL`       | Override model for automatic chat title generation |
| `ARTIFACT_GENERATION_MODEL`    | Override model for artifact creation prompts       |

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

If you plan to enforce tier overrides or seed model capabilities manually, insert rows into `Tier` and `Model` tables (Prisma Studio or SQL). Missing rows fall back to hardcoded safe defaults so the app can boot cold.

### Testing

```bash
# Lint (ESLint)
bun run lint

# Type check
bunx tsc --noEmit
```

## Deployment

### Vercel (Recommended)

1. Connect GitHub repository to Vercel
2. Configure environment variables
3. Enable Vercel integrations:
   - Neon for PostgreSQL
   - Upstash for Redis
   - Vercel Blob for file storage
4. Deploy automatically on push

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
