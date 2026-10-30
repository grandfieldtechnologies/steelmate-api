# Steelmate API

Authoritative backend (Clerk, Neon Postgres, Upstash Redis). Runs on port **3001** in dev.

## Local setup

```bash
npm install
cp .env.example .env.local
# fill env vars, run drizzle migration against Neon
npm run dev
```

Link engine while editing rules:

```bash
npm link ../steelmate-engine
```

## Environment variables

| Variable | Purpose |
|----------|---------|
| `CLERK_SECRET_KEY` | Clerk backend API (same app as web) |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Same publishable key as `steelmate` (required for session verification) |
| `DATABASE_URL` | Neon Postgres (pooled) |
| `UPSTASH_REDIS_REST_URL` | Active match state |
| `UPSTASH_REDIS_REST_TOKEN` | |
| `CATALOG_VERSION` | Must match `steelmate-engine/data/catalog-version.json` |
| `ALLOWED_ORIGINS` | Comma-separated web origins for CORS (e.g. `http://localhost:3000`) |

## Database

Apply schema once:

```bash
# using psql or Neon SQL editor
psql "$DATABASE_URL" -f drizzle/0000_init.sql
psql "$DATABASE_URL" -f drizzle/0001_match_lobby.sql
```

Or `npm run db:migrate` with `DATABASE_URL` set.

## Vercel deployment (private repos)

1. Import **steelmate-api** project from GitHub.
2. Grant Vercel GitHub app access to **steelmate-engine** (Settings → Git).
3. Set env vars (Production + Preview).
4. In `package.json`, for deploy pin engine:

   `"@steelmate/engine": "git+https://github.com/grandfieldtechnologies/steelmate-engine.git#v0.1.0"`

   Use `file:../steelmate-engine` locally; swap or use `pnpm link` for development.

5. Root directory `.`, Framework Next.js, Node runtime on `/api/v1/*`.

## API surface

- `GET /api/health`
- `GET|POST /api/v1/decks`
- `GET|PATCH|DELETE /api/v1/decks/[id]`
- `POST /api/v1/matches` — create lobby `{ deckId }`
- `POST /api/v1/matches/queue` — find match `{ deckId }`
- `POST /api/v1/matches/join` — `{ inviteCode, deckId }` (enters ready lobby)
- `GET /api/v1/matches/active`
- `POST /api/v1/matches/[id]/start` — mark ready; starts when both players ready
- `POST /api/v1/matches/[id]/cancel` — cancel solo waiting lobby (host only)
- `GET /api/v1/matches/[id]?sinceVersion=N`
- `POST /api/v1/matches/[id]/actions` — `{ action }`

Send Clerk session token: `Authorization: Bearer <token>` from `@clerk/nextjs` `getToken()`.
