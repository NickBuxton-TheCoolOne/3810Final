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