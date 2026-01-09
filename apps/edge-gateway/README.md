# Vero Edge Gateway

The **Vero Edge Gateway** is a high-performance Cloudflare Worker that serves as the secure entry point for edge services. Its primary responsibility is deriving client-side encryption keys from authenticated sessions (Clerk or Guest), enabling **client-side encryption at rest** for chat history.

Built with [Hono](https://hono.dev), it acts as a lightweight Key Management Service (KMS) at the edge.

## Features

- **Edge Key Derivation:** Securely generates encryption keys from session cookies and a server-side secret.
- **Data Privacy:** Ensures that chat content stored in the client-side database remains encrypted and unreadable by the main application backend.
- **Multi-Provider Auth:** Supports both Clerk authentication and custom Guest sessions.
- **CORS Support:** Configurable CORS policies for cross-origin security.
- **Dynamic Routing:** Supports both subdomain and path-based deployments via `BASE_PATH`.

## Setup & Configuration

### 1. Environment Variables

Create a `.dev.vars` file for local development or configure these secrets in your Cloudflare dashboard:

```ini
# A 32-byte base64 string used to derive the final encryption keys
CACHE_ENCRYPTION_SECRET="<your-secret>"

# Secret used to sign/verify guest session cookies
GUEST_SECRET="<your-guest-secret>"

# Clerk Authentication (if using Clerk)
CLERK_SECRET_KEY="sk_..."
CLERK_PUBLISHABLE_KEY="pk_..."

# Comma-separated list of allowed origins for CORS (e.g., https://your-app.com)
ALLOWED_ORIGINS="http://localhost:3000,https://vero.your-domain.com"

# OPTIONAL: Set this ONLY if deploying via Cloudflare Worker Routes (see below)
# BASE_PATH="/edge"
```

### 2. Critical: Cookie Domain Configuration

For the worker to access authentication cookies (Clerk or Guest), the cookies **must be scoped to the root domain** so they are shared between your main app (`vero.mydomain.com`) and the worker.

In your main app (`apps/web/.env`), ensure `COOKIE_DOMAIN` is set to the root domain (leading dot recommended):

```ini
COOKIE_DOMAIN=.mydomain.com
```

This ensures cookies set by the app are visible to `worker.mydomain.com` or `vero.mydomain.com/edge`.

### 3. Deployment Strategies

You can deploy the gateway in two ways. Choose the one that fits your infrastructure.

#### Option A: Subdomain Deployment (Recommended)

Deploy the worker to a dedicated subdomain, e.g., `edge.mydomain.com`.

1. **Cloudflare:** Map the worker to `edge.mydomain.com`.
2. **Worker Env:** Do **not** set `BASE_PATH`.
3. **App Env (`apps/web`):**
   ```ini
   NEXT_PUBLIC_CACHE_ENCRYPTION_URL=https://edge.mydomain.com
   ```

#### Option B: Worker Routes (Path-based)

Deploy the worker "behind" your main domain using Cloudflare Worker Routes, e.g., `vero.mydomain.com/edge/*`. This avoids some CORS complexities and DNS lookups.

1. **Cloudflare:** Add a Route Rule: `vero.mydomain.com/edge/*` -> `vero-edge-gateway`.
2. **Worker Env:** Set `BASE_PATH=/edge` in your worker configuration.
   - This tells the internal router to expect requests like `/edge/v1/keys` and handle them correctly.
3. **App Env (`apps/web`):**
   ```ini
   NEXT_PUBLIC_CACHE_ENCRYPTION_URL=https://vero.mydomain.com/edge
   ```
   The client library will automatically append `/v1/keys` to this base URL.

## Development

Run the worker locally:

```bash
bun x wrangler dev
```

The server will start at `http://localhost:8787`.

## API Reference

### `POST /v1/keys`

(Or `{BASE_PATH}/v1/keys`)

Derives an encryption key from the request's authentication cookies.

- **Headers:**
  - `Cookie`: Must contain a valid Clerk session cookie or `guest_session`.
  - `Origin`: Checked against `ALLOWED_ORIGINS`.

- **Response (200 OK):**
  ```json
  {
    "key": "base64-encoded-derived-key"
  }
  ```

### `GET /health`

(Or `{BASE_PATH}/health`)

Health check endpoint.

- **Response (200 OK):**
  ```json
  {
    "status": "ok",
    "service": "vero-edge-gateway",
    "timestamp": "..."
  }
  ```
