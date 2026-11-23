# CLAUDE.md — Same Rules As AGENTS.md

> **STATUS: STUB — deliberately a pointer, not a second copy.**

This project keeps its engineering rules in **[`AGENTS.md`](./AGENTS.md)** so that
every AI tool reads one file instead of two that can drift apart. `AGENTS.md` is
authoritative for:

- §1 — Project identity, the `SPEC.md`-first rule, and the repository map
- §2 — The locked tech stack (Fastify, `mssql`, BullMQ/Redis, vanilla frontend,
  polling, `camelCase`, CommonJS)
- §3 — File boundaries

Read `AGENTS.md` in full before writing code. If you are a tool that loads
`CLAUDE.md` and not `AGENTS.md`, do so now.

## If this file must ever diverge

Only to record a Claude-specific workflow note (e.g. a preferred command sequence).
Never to relax a stack rule — change `AGENTS.md` instead, so every agent gets it.

## Related docs

- `SPEC.md` — requirements (source of truth; currently a stub)
- `openapi.yaml` — REST contract
- `index.md` — where every file lives
