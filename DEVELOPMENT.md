# Developing BioSCom

## Prerequisites

- Node.js v22+
- The repo: `git clone https://github.com/KowalskiBio/bioscom.git` (public — clone freely; push via collaborator invite or fork + PR)

## Layout

npm-workspaces monorepo, TypeScript end-to-end, no Docker:

| Path | What |
| --- | --- |
| `server/` | Fastify + better-sqlite3 backend (REST + WebSocket), serves `web/dist` in production |
| `web/` | Svelte 5 + Vite frontend, legacy styles ported verbatim |
| `shared/` | zod schemas + types shared by server and web |
| `migrate/` | one-shot migration tooling (legacy export → SQLite import) |
| `deploy/` | systemd unit, nginx sites, runbook (see `deploy/DEPLOY.md`) |
| `tests/` | Playwright E2E suites (spawn a scratch server + temp DB) |

## First run

```bash
npm ci                       # installs all workspaces
npm run build -ws            # build shared, server, web
npm test -w server           # 62 unit/API tests (supertest + scratch sqlite)
npm test -w web              # 9 store tests (mock WS)
npm test -w shared           # 27 schema tests
npx playwright test          # 22 E2E tests (auto-builds server+web, spawns scratch stack on :8003)
```

## Dev loop

Two terminals:

```bash
npm run dev -w server    # API on http://localhost:8003 (creates ./bioscom.db, schema auto-applied)
npm run dev -w web       # Vite dev server on http://localhost:5173 (proxies /api + /ws to :8003)
```

Optional `server/.env` for local runs (all optional — defaults in `server/src/config.ts`):

```
PORT=8003
SESSION_SECRET=dev-secret
EMAIL_CAPTURE_FILE=/tmp/bioscom-dev-emails.jsonl   # password-reset links land here instead of real email
```

`EMAIL_CAPTURE_FILE` is the zero-config emailer for local auth testing: trigger a forgot-password, then read the reset link from that file.

Notes:
- Mutating API routes require the `X-Requested-With: XMLHttpRequest` header (CSRF guard) — the web client sends it automatically.
- Password reset links point at `PUBLIC_URL` (default `http://localhost:8003`).
- Orphaned test servers occasionally survive a cancelled E2E run and hold port 8003: `pkill -f "node server/dist/index.js"`.

## Conventions

- Strict TypeScript in all workspaces: `npm run -ws --if-present typecheck` must stay clean.
- No code comments, no CSS frameworks, no renamed legacy classes — visual parity with the legacy app is the acceptance bar (see `tests/parity/`).
- Tests: unit/API tests per workspace (vitest), E2E in `tests/` (Playwright, self-contained scratch DB).
- Never commit: `.env`, `*.db`, dumps — all gitignored; keep it that way.

## Deployment

Not from a dev machine — see `deploy/DEPLOY.md` (proxmox1, systemd + nginx). The VM pulls from a bare repo on the host, not GitHub.
