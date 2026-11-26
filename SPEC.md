# SPEC.md — Scope, User Stories & Acceptance Criteria

> **STATUS: DRAFT v0.4 — requirements written; no open questions.**
> Per `AGENTS.md` §1 this file is the single source of truth. Nothing outside it may
> be designed or built. Values marked *(default)* are assumptions agreed in the
> requirements interview and can be tuned without changing the design.

## 1. Product Summary

A multi-tenant live bidding competition game. Players join a match with a nickname
and a join code, then bid coins on items in timed rounds. Each item stays open for
a random number of rounds. When an item's countdown reaches zero, the player who
holds its winning bid earns its points. The highest score when the match timer runs
out wins.

### 1.1 Game loop

1. A **Host** creates a match and shares its **join code**. 2–8 **Players** join with
   a nickname. The Host starts the match.
2. The match runs for a fixed duration (*default 3 minutes*), split into
   **7-second rounds**.
3. **One new item spawns at the start of every round** until the match timer runs out.
   Each item has:
   - a **point value** from 10 to 100, shown to players. Values are weighted
     heavily toward the middle: `pointValue` is the average of three independent
     uniform random integers from 10 to 100, rounded to the nearest integer. That
     gives a bell-shaped spread centred on 55, where extremes are rare;
   - a **lifetime** of a random 1–5 rounds, shown as "rounds left";
   - a **current bid**, shown to everyone with the holder's nickname. It is 0 when
     the item spawns. After that it is the winning total from the previous round.
4. **During a round**, players submit **sealed bids** (other players can't see them)
   on any open item. **Bids are cumulative:** each bid adds to the player's
   **running total** on that item. If you bid 2 in one round and 1 in the next,
   your total is 3.
   - A bid is accepted only if it is at least 1, it is no more than the player's
     coin balance, and the player's new total (previous total + this bid) is
     **strictly greater than the item's current bid**. Otherwise the server rejects
     it at once and charges nothing.
   - An accepted bid is **charged immediately and never refunded**, even if it is
     outbid later (all-pay). Only the amount added is charged, not the new total.
   - A player can always see their own running total on each item. Other players'
     totals stay hidden unless they hold the current bid.
   - *(default)* Each player may place at most one accepted bid per item per round.
5. **At the end of each round**, the server resolves every open item:
   - The highest running total on the item becomes its new **current bid**,
     displayed with the holder's nickname. If nobody raised it, the current bid
     stands.
   - **Ties:** among equal top totals, the player who reached that total first wins
     (the earliest `receivedAt` of the bid that brought them to it).
   - Each item's rounds left drops by 1.
   - When an item reaches 0 rounds left it **closes**. The holder of the current
     bid earns the item's points. If the current bid is still 0, nobody scores.
   - Every player in the match receives the match's **round coin income**.
6. When the match timer runs out, any items still open are resolved as if their
   countdown had ended. The final scoreboard is then saved, and each player's
   result is added to the all-time leaderboard.

### 1.2 Economy

| Quantity | Rule |
| --- | --- |
| Coins | Spent on bids. Every player starts with the match's `startingCoins` and gains its `roundCoinIncome` at each round end. The defaults are 25 and 5. Can never go below 0. |
| Score | Total points of items won. Only goes up, and only when a player wins an item. |

Coins and score are separate numbers. Coins are never converted into score.

### 1.3 Multi-tenancy

A **tenant is a match**. Many matches run at the same time, fully isolated from each
other. A player's session is scoped to one match and cannot read or change another
match's state, items, bids or players. Queue jobs and Redis keys are namespaced by
`matchId` (and by `REDIS_KEY_PREFIX` per environment).

## 2. Out of Scope

- Real money, payments, or redeeming coins for anything outside the game.
- Chat or messaging between players.
- Player accounts, passwords or profiles. Players are identified only by a nickname,
  which is unique within its match (§4).
- Anything not listed in §5. Per `AGENTS.md` §1, a missing feature stays missing
  until it is added here.

## 3. Roles & Permissions (RBAC)

| Role | Authenticates by | May do | May not do |
| --- | --- | --- | --- |
| **Player** | Nickname + join code → match-scoped session token | View its own match's state; place bids in its own match; view the results of its own match; view the leaderboard | Create, start or end matches; see sealed bids before a round resolves; act in any other match |
| **Host** | Login (account created by an Admin) | Create matches; start matches it owns; view state and results of matches it owns; view the leaderboard | Bid; act on another host's match; manage accounts |
| **Admin** | Login. Reserved for developers and code owners: Admin accounts are created only by a seed script or migration that a developer runs, never through the API or UI. | Everything a Host may do, on any match; end any match early; create and disable Host accounts | Bid; be created, granted or promoted through the app |

Every row is covered by a test in `js/TestingScripts/`.

## 4. Data Model

Entities and relationships only. The SQL lives in `db/migrations/`.

- **staffAccount**: Host or Admin login (`role`, `username`, password hash, `isActive`).
  Rows with `role = admin` are inserted only by developer-run seed scripts.
- **match**: owned by one staffAccount (host). Fields: `joinCode` (unique while the
  match is open), `status` (`lobby` → `running` → `finished`), `startedAt`,
  `endsAt`, `playerCount` (players currently joined; never above max players, so a
  join is refused once the match is full), settings (duration, starting coins,
  income, max players).
- **matchRound**: one row per round of a match. Fields: `roundNumber` (starts at 1),
  `startedAt`, `endsAt` (sent to clients as `roundEndsAt`), `resolvedAt` (empty
  until the round is resolved). Each round is resolved exactly once: if the
  resolution job is retried, it sees the round is already resolved and does
  nothing, so no player is charged, scored, or given a new item twice.
- **matchPlayer**: belongs to one match. Fields: `nickname`, `coins`, `score`.
  `nickname` is unique **within its match** (compared case-insensitively). The
  same nickname may appear in other matches.
- **item**: belongs to one match. Fields: `pointValue`, `spawnRound`, `lifetimeRounds`,
  `roundsLeft`, `status` (`open` / `closed`), `currentBid` (0 at spawn),
  `currentBidHolder` (matchPlayer, or none), final winner, `closedRound` (used to
  rebuild each player's score round by round for the results graph).
- **bid**: belongs to one item and one matchPlayer. Fields: `amount` (the amount
  added in that round), `roundNumber`, `receivedAt` (server time, used to break
  ties). A player's running total on an item is the sum of their bids on it. Accepted bids only, since
  rejected bids are never stored.
- **leaderboardEntry**: one row per finished matchPlayer (`nickname`, `score`,
  `matchId`, `finishedAt`). Nicknames can repeat across matches, so the
  leaderboard lists individual match results (nickname, score, match date) rather
  than adding up scores per name.

## 5. User Stories

Stories US-1 to US-5 and US-11 come from the project owner's drafts. US-6 to US-10
were added from the requirements interview.

- **US-1 — Bid every round.** As a player, I want to bid on an item every round
  (every 7 seconds) so I can earn points and compete with my friends.
  - At the end of the interval, the bids are added up and resolved (§1.1 step 5).
- **US-2 — New item every round.** As a player, I want one new biddable item every
  round (every 7 seconds) so there is always something new to bid on until time
  runs out.
- **US-3 — Item lifetime.** As a player, I want each item to have a visible lifetime
  (rounds left) so there is a clear limit on when its winner is decided.
- **US-4 — See if my bid won.** As a player, I want to see whether my bid won.
  - When an item's time is up, its bids are compared and the winner is shown
    clearly and correctly.
  - Coins are removed as soon as a bid is submitted and accepted, and the new
    balance is shown at once.
  - A bid larger than the player's coin balance is blocked: the bid control won't
    send it, and the server rejects it anyway.
- **US-5 — Automatic score.** As a player, I want my score to be kept automatically
  and correctly.
- **US-6 — Join with nickname.** As a player, I want to join a match with a
  nickname and a join code so I can play without creating an account.
- **US-7 — Coins.** As a player, I want to earn coins every round so I can keep
  bidding after I spend.
- **US-8 — Host a match.** As a host, I want to create a match, share its join
  code and start it when everyone is in.
- **US-9 — Results & leaderboard.** As a player, I want to see the final scoreboard
  and an all-time leaderboard so I can compare against past games.
- **US-10 — Admin control.** As an admin (a developer or code owner), I want to manage host accounts and end
  any match early.
- **US-11 — Results graphs.** As a player, I want to see graphs and scores so I
  can see who won, by how much, and how everyone performed over the game.

## 6. Acceptance Criteria

Each item lists the stories it covers and the endpoint it is tested through.
Endpoint names are proposed here and must be added to `openapi.yaml` before they
are built.

| ID | Story | Criterion | Endpoint (proposed) |
| --- | --- | --- | --- |
| AC-1 | US-1 | A bid of at least 1 that is no more than the player's coins and lifts the player's running total on the item above its current bid is accepted. Coins drop by exactly the bid amount, not by the new total. | `POST /api/matches/{matchId}/items/{itemId}/bids` |
| AC-1b | US-1 | Bids are cumulative: a player who bids 2 on an item in one round and 1 in the next has a running total of 3, and that total is what's compared at round end. | `POST /api/matches/{matchId}/items/{itemId}/bids`, `GET /api/matches/{matchId}/state` |
| AC-2 | US-1 | A bid that leaves the player's running total at or below the current bid, a bid below 1 or above the player's coins, on a closed item, or after the match ended is rejected (`409` or `422`) and coins don't change. | same |
| AC-3 | US-1 | A second bid on the same item in the same round by the same player is rejected. | same |
| AC-4 | US-1 | Sealed: before a round resolves, the state response contains no other player's bids or totals from the current round. Each player sees only their own running totals. | `GET /api/matches/{matchId}/state` |
| AC-5 | US-1 | At round end, the highest running total becomes the current bid. On a tie, the player who reached that total first (earliest `receivedAt`) wins. | `GET /api/matches/{matchId}/state` |
| AC-6 | US-2 | Exactly one new item appears per round while the match is running, and none after it ends. | same |
| AC-7 | US-3 | Every open item shows `pointValue`, `roundsLeft` and `currentBid` (0 when it spawns, then the winning total from the previous round, with the holder's nickname). `roundsLeft` drops by 1 each round. `lifetimeRounds` is between 1 and 5. | same |
| AC-7b | US-2 | Every `pointValue` is between 10 and 100. Over 10,000 generated items, the mean is 55 ± 2 and at least 60% of values fall between 37 and 73 (a uniform spread would put only about 40% there). | unit test of the item generator |
| AC-8b | US-4 | Right after an accepted bid, the bid response and the next state poll show the player's coins reduced by the bid amount. | `POST /api/matches/{matchId}/items/{itemId}/bids`, `GET /api/matches/{matchId}/state` |
| AC-8c | US-4 | A bid above the player's coin balance is blocked. The UI disables or refuses to submit it, and if it reaches the server anyway it is rejected with `422` and coins don't change. | `POST /api/matches/{matchId}/items/{itemId}/bids` + UI test |
| AC-8 | US-4 | When an item closes, the state shows its winner's nickname and winning total, or "no winner". Every player in the match sees the same result. | same |
| AC-9 | US-5 | A player's score goes up **only** when they win a closing item, and **only** by that item's `pointValue`. Losing, bidding and earning coins never change the score. | same |
| AC-10 | US-5 | Updated scores appear in the first state poll after the round resolves. | same |
| AC-11 | US-6 | A valid join code and a nickname not already in that match (case-insensitive) return a match-scoped player token. The same nickname works in other matches. A duplicate nickname in the same match is rejected with `409`. An unknown code, a full match (8 players) and a match not in `lobby` are also rejected. | `POST /api/matches/join` |
| AC-12 | US-7 | Every player starts with the match's `startingCoins` and gains its `roundCoinIncome` at each round end. Tests read both values from the match settings instead of hardcoding them. | `GET /api/matches/{matchId}/state` |
| AC-13 | US-8 | A host can create a match (getting a unique join code) and start it only once it has 2 or more players. A player token cannot create or start matches. | `POST /api/matches`, `POST /api/matches/{matchId}/start` |
| AC-14 | US-9 | After a match ends, its final scoreboard is readable, and the leaderboard lists each player's result from that match as its own entry, sorted by score. | `GET /api/matches/{matchId}/results`, `GET /api/leaderboard` |
| AC-15 | US-10 | An admin can end any running match, which triggers final resolution (§1.1 step 6). Hosts can end only their own matches. Players get `403`. | `POST /api/matches/{matchId}/end` |
| AC-16 | §1.3 | A player token for match A gets `403` or `404` on every match-B endpoint. | all match endpoints |
| AC-17 | §3 | Staff login returns a session. A disabled account cannot log in. No endpoint can create an Admin account or give a Host the Admin role. | `POST /api/auth/login` |
| AC-18 | US-11 | The results show every player ranked by final score, with the winner marked and each player's gap behind the winner (the winner's gap is 0, and players tied for first are all marked winners). Each row also shows items won and total coins spent. | `GET /api/matches/{matchId}/results` |
| AC-19 | US-11 | The results include each player's score after every round, from round 0 (score 0) to the final round. The last value equals the player's final score, and each step up equals the `pointValue` of an item they won in that round. | same |
| AC-20 | US-11 | The results screen draws a line graph of score against round number, one line per player labelled with their nickname, next to the final scoreboard. It is drawn with plain SVG or canvas in `UI_Elements/`, since `AGENTS.md` §2 allows no chart library. Only players of that match, and its host or an admin, can view it. | UI test + `GET /api/matches/{matchId}/results` |
| AC-21 | US-10 | An admin can create a Host account and disable it. The create request has no role field, so it always makes a Host. A disabled Host cannot log in, and its existing tokens stop working. Hosts and players get `403`. | `POST /api/admin/hosts`, `POST /api/admin/hosts/{hostId}/disable` |

## 7. Non-Functional Requirements

Locked by `AGENTS.md` §2, restated here rather than re-decided:

- Round length: 7 seconds.
- Live updates: HTTP polling every 300–500 ms on `GET /api/matches/:matchId/state`.
  No WebSockets.
- Countdowns must not drift: the server returns UTC `roundEndsAt` (and `matchEndsAt`),
  and the client works out the remaining time locally.
- Round resolution runs server-side as BullMQ jobs, one per match and round. It is
  idempotent, so a retried job never charges, scores or spawns twice.
- *(default)* Up to 8 players per match. Development targets at least 10 concurrent
  matches on one server.

## 8. Open Questions

None open.

### Resolved

- **OQ-2:** the unfinished US-4 note covers taking coins when a bid is submitted,
  and blocking bids larger than the player's balance (AC-8b, AC-8c).
- **OQ-1:** rounds are 7 seconds, matching `AGENTS.md`.
- **OQ-3:** players start with 25 coins and gain 5 per round by default (both are match settings). Item values are
  weighted toward the middle (§1.1). The 3-minute match and the limit of one bid
  per item per round stay as defaults.
- **OQ-4:** nicknames are unique within a match only. The leaderboard lists
  per-match results, so repeated names don't merge (§4).
- Admin is reserved for developers and code owners, and is seeded, never created in
  the app (§3).

---

**Next steps:** record every endpoint from §6 in `openapi.yaml`, index each new file
in `index.md`, then implement in the order `db/migrations` → `js/config` →
`js/api` → `workers` → `UI_Elements`.
