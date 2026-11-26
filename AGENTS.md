# AGENTS.md — AI Engineering Rules & Architecture Guide

## 1. Project Identity & Core Objective
You are building a **multi-tenant live bidding competition game** where players compete in timed 7-second rounds to accumulate the highest score before match time elapses.

- **Single Source of Truth:** Always read `SPEC.md` before designing or modifying features. Never invent features outside `SPEC.md`.
- **Repository Map:** Refer to `index.md` for exact file locations before creating new files.
- **API Contract:** `openapi.yaml` is the authoritative specification for every HTTP endpoint, request body, status code, and response payload.

---

## 2. Locked Tech Stack & Conventions
Do NOT introduce unapproved frameworks, ORMs, or TypeScript without explicit approval.

- **Language:** Plain JavaScript (Node.js, CommonJS `require` / `module.exports`).
- **Runtime:** Node.js **24.9 or newer**. The project migrated from Node 22 to 24.9; `package.json` `engines` (`>=24.9`) and CI (`node-version: "24.9"`) must stay in sync with this line.
- **Naming Convention:** Strictly `camelCase` for all variables, functions, JSON payload properties, and file names (except standard root docs like `SPEC.md`, `CLAUDE.md`, `AGENTS.md`).
- **Web Framework:** Fastify (`fastify`), utilizing Fastify's native JSON Schema validation aligned with `openapi.yaml`.
- **Database:** Microsoft SQL Server accessed strictly via the `mssql` package using parameterized queries (no ORMs).
- **Background Queue:** BullMQ (`bullmq`) backed by Redis (`ioredis`).
- **Live Client Updates:** Fast HTTP polling (`300ms–500ms` intervals) on `GET /api/matches/:matchId/state` returning server UTC timestamps (`roundEndsAt`) for drift-free client countdowns.
- **Frontend:** Vanilla HTML, CSS, and JavaScript inside `UI_Elements/` matching the Figma designs.
- **Testing:** Jest (`jest`) + Supertest (`supertest`) + `jest-openapi` for automated OpenAPI contract and RBAC tests.

---

## 3. Repository Structure & File Boundaries
```text
├── readme.md                  # Setup instructions & documented agentic toolstack
├── SPEC.md                    # Architectural scope, user stories, acceptance criteria
├── AGENTS.md / CLAUDE.md      # Agent rules, guardrails, and coding conventions
├── index.md                   # Repository resource directory
├── openapi.yaml               # Authoritative OpenAPI 3.0 REST specification
├── package.json               # Root dependencies and npm scripts
├── .env.example               # Required environment variables template
├── db/
│   └── migrations/            # Sequential, strict MS SQL Server .sql DDL scripts
├── workers/                   # Standalone BullMQ background worker processes
├── js/
│   ├── server.js              # Fastify application bootstrap & plugin registration
│   ├── config/                # Shared mssql connection pool & BullMQ/Redis setup
│   ├── api/                   # Fastify route plugins, controllers, & RBAC hooks
│   └── TestingScripts/        # Jest unit, RBAC, and automated OpenAPI contract tests
├── UI_Elements/               # Frontend views, styles, and polling client scripts
└── prompts/
    └── system_prompt.md       # Orientation & persona prompt for AI sessions
```

---

## 4. Git Commit Attribution
- **AI-Authored Commits Must Be Tagged:** Any commit whose changes were largely written by an AI tool must say so. End the commit message with a `Co-Authored-By:` trailer naming the AI (e.g. `Co-Authored-By: Claude <noreply@anthropic.com>`).
- **Applies to every agent:** Claude, Copilot, Codex, Cursor, or any other assistant. Use that tool's standard co-author trailer.
- **Mixed work:** If a human substantially rewrote the AI's output, the tag is optional; when in doubt, tag it.

---

## 5. API Conventions
- **Read the header of `openapi.yaml` first.** Its `Conventions` comment block is the authoritative list of rules every endpoint follows: ID and timestamp formats, Bearer auth and token scope, the error body shape, which status code to use when a request is rejected, and how cross-tenant access is answered.
- **Technical details live in `openapi.yaml`, not here and not in `SPEC.md`.** Field lengths, numeric ranges, defaults, and status codes are written down once, in the schemas. Fastify route schemas and tests must match them; do not copy the values into code comments or other docs.
- **`SPEC.md` stays broad.** It describes what the game does and its acceptance criteria. If a technical choice changes product behaviour, update the AC in `SPEC.md` in plain language, then put the exact values in `openapi.yaml`.
- **Changing a convention:** edit the `openapi.yaml` header and every affected schema in the same commit.
