# SPEC.md — Scope, User Stories & Acceptance Criteria

> **STATUS: STUB — no requirements written yet.**
> Per `AGENTS.md` §1 this file is the single source of truth, and no feature may be
> designed or implemented outside it. Until the sections below are filled in, treat
> the project as having **zero approved features**: do not build routes, migrations,
> queue jobs or UI views from assumptions.

## 1. Product Summary

A multi-tenant live bidding competition game. Players compete in timed 7-second
rounds to accumulate the highest score before match time elapses.

<!-- TODO: define the game loop, scoring rules, win/lose conditions, round timing,
     match duration, and what "multi-tenant" means here (tenants, isolation, admins). -->

## 2. Out of Scope

<!-- TODO: state what this project will NOT do, so later agents don't add it. -->

- _not yet defined_

## 3. Roles & Permissions (RBAC)

<!-- TODO: enumerate roles (e.g. player, host, admin) and what each may call.
     These rows drive the RBAC tests in js/TestingScripts/. -->

| Role | May do | May not do |
| --- | --- | --- |
| _TBD_ | _TBD_ | _TBD_ |

## 4. Data Model

<!-- TODO: entities and relationships. Drives db/migrations/. Do not write SQL here. -->

- _not yet defined_

## 5. User Stories

<!-- TODO: "As a <role>, I want <capability> so that <outcome>." -->

- _none written yet_

## 6. Acceptance Criteria

<!-- TODO: one testable criterion per story above. Each should map to an openapi.yaml
     path and a Jest test name. -->

- _none written yet_

## 7. Non-Functional Requirements

Locked by `AGENTS.md` §2, restated here rather than re-decided:

- Round length: 7 seconds.
- Live updates: HTTP polling at 300–500 ms on `GET /api/matches/:matchId/state`.
- Countdowns must be drift-free: the server returns UTC `roundEndsAt` and the client
  computes remaining time locally.

<!-- TODO: latency targets, concurrent players per match, tenancy limits, retention. -->

---

**Once this file has content:** record every endpoint in `openapi.yaml`, index every
file in `index.md`, then implement.
