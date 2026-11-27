# index.md — Repository Resource Directory

> **STATUS: STUB.** Lists what exists and what the layout expects. Update this file
> whenever a file is created, moved or deleted (`AGENTS.md` §1). Check it here before
> creating a new file.

Legend: ✅ exists · 📝 stub, needs content · ⬜ not yet created

## Root

| Status | Path | Purpose |
| --- | --- | --- |
| ✅ | `readme.md` | Setup instructions & agentic toolstack |
| 📝 | `SPEC.md` | Source of truth: scope, stories, acceptance criteria |
| ✅ | `AGENTS.md` | Agent rules, guardrails, coding conventions |
| 📝 | `CLAUDE.md` | Pointer to `AGENTS.md` (keep the two in sync) |
| 📝 | `index.md` | This directory |
| 📝 | `openapi.yaml` | Authoritative REST contract |
| 📝 | `package.json` | Dependencies & npm scripts |
| 📝 | `.env.example` | Required environment variables |
| ✅ | `.gitignore` | Ignore rules (`.env` ignored, `.env.example` kept) |

## `db/`

| Status | Path | Purpose |
| --- | --- | --- |
| ✅ | `db/migrations/0001_createStaffAccount.sql` | `staffAccount` table (hosts and admins) |
| ✅ | `db/migrations/0002_createMatch.sql` | `[match]` table, open-join-code filtered index |
| ✅ | `db/migrations/0003_createMatchRound.sql` | `matchRound` table (round windows, resolution claim) |
| ✅ | `db/migrations/0004_createMatchPlayer.sql` | `matchPlayer` table (per-match nickname, coins, score) |
| ✅ | `db/migrations/0005_createItem.sql` | `item` table (one spawn per round) |
| ✅ | `db/migrations/0006_createBid.sql` | `bid` table (accepted bids only) |
| ✅ | `db/migrations/0007_createLeaderboardEntry.sql` | `leaderboardEntry` table (finished-match scores) |

Scripts are strictly ordered, never edited after they ship; add a new numbered file instead.

## `workers/`

| Status | Path | Purpose |
| --- | --- | --- |
| ⬜ | `workers/<jobName>Worker.js` | Standalone BullMQ processes — none written |

## `js/`

| Status | Path | Purpose |
| --- | --- | --- |
| 📝 | `js/server.js` | Fastify bootstrap; `app.db` / `app.queue` wired, closed on shutdown — routes not yet registered |
| ✅ | `js/config/db.js` | Shared `mssql` connection pool (`getPool`, `closePool`) |
| ✅ | `js/config/queue.js` | Redis connections and the `roundResolution` BullMQ queue |
| 📝 | `js/api/` | Route plugins, controllers, RBAC hooks — no files yet |
| 📝 | `js/TestingScripts/` | Jest unit, RBAC and OpenAPI contract tests — only `healthz.test.js` so far |

## `UI_Elements/`

| Status | Path | Purpose |
| --- | --- | --- |
| 📝 | `UI_Elements/` | Vanilla HTML/CSS/JS views + polling client — no files yet |

## `prompts/`

| Status | Path | Purpose |
| --- | --- | --- |
| 📝 | `prompts/system_prompt.md` | Orientation & persona for AI sessions |

## Conventions

- Plain CommonJS (`require` / `module.exports`); no TypeScript, no ORM.
- `camelCase` for variables, functions, JSON properties and file names — the sole
  exceptions are the standard root docs (`SPEC.md`, `CLAUDE.md`, `AGENTS.md`,
  `README.md`).
- Note: `AGENTS.md`'s map spells this file `index.md` and the setup doc `readme.md`;
  on case-insensitive Windows they resolve to the same file. Keep lowercase.
