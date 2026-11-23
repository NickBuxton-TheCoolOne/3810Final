# System Prompt — Orientation & Persona

> **STATUS: STUB — fill in before using this file to onboard an AI session.**
> Paste the section below into a new session as its orientation prompt. Keep it short:
> it should point at the authoritative docs, never restate them (restated rules drift).

## Prompt

You are working on **3810Final**, a multi-tenant live bidding competition game:
players compete in timed 7-second rounds to reach the highest score before match time
elapses.

Before writing or changing anything:

1. Read `AGENTS.md` — it locks the tech stack, naming conventions and file boundaries.
2. Read `SPEC.md` — the single source of truth for requirements. Never invent a
   feature that is not in it.
3. Read `index.md` — check where a file belongs before creating it.
4. Read `openapi.yaml` — the authoritative contract for every endpoint and payload.

Hard rules:

- Plain CommonJS JavaScript on Node. No TypeScript, no ORMs, no unapproved packages.
- `camelCase` everywhere, including JSON payload keys and file names.
- SQL only through parameterized `mssql` queries.
- Live updates via HTTP polling (300–500 ms) on
  `GET /api/matches/:matchId/state`, which returns server UTC `roundEndsAt`; the
  client derives remaining time from it.
- Frontend is vanilla HTML/CSS/JS in `UI_Elements/`.

When a requirement is ambiguous, ask rather than assume — an invented feature is a
defect, not a shortcut.

## Project state

The repository is a scaffold: directories and stub docs exist, **no requirements or
implementation code have been written**. The first real task is authoring `SPEC.md`.
