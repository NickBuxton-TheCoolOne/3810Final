# 3810Final

A multi-tenant live bidding competition game: players compete in timed 7-second
rounds to build the highest score before the match ends.

- What the game does: [`SPEC.md`](SPEC.md)
- REST contract: [`openapi.yaml`](openapi.yaml)
- Engineering rules and locked stack: [`AGENTS.md`](AGENTS.md)
- Where every file lives: [`index.md`](index.md)

## Requirements

- **Node.js 24.9 or newer** (`package.json` `engines`)
- **Microsoft SQL Server** reachable from your machine
- **Redis 7** (a local Docker container or a hosted free tier). The eviction
  policy must be `noeviction`, or BullMQ jobs can silently disappear.

## Setup

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy the environment template and fill in every `TODO` value:

   ```powershell
   Copy-Item .env.example .env
   ```

   `.env` is git-ignored. Never commit it.

3. Check that Redis answers (should print `PONG`):

   ```powershell
   node --env-file=.env -e "const R=require('ioredis'); const r=new R({host:process.env.REDIS_HOST,port:+process.env.REDIS_PORT,password:process.env.REDIS_PASSWORD}); r.ping().then(p=>{console.log(p); return r.quit();}).catch(e=>{console.error(e.message); process.exit(1);})"
   ```

4. Run the database migrations in `db/migrations/` in numeric order
   (0001–0007) with `sqlcmd` or SSMS — the scripts use `GO` batch separators.

5. Create an admin account (admins are never created through the API or UI):

   ```powershell
   npm run seed:admin -- <username>
   ```

   It prompts for the password without echoing it (or reads `ADMIN_PASSWORD`
   if set) and refuses to touch a username that already exists.

Load environment variables with Node's built-in `--env-file=.env`;
the project does not use `dotenv`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Start the Fastify server (`js/server.js`) |
| `npm run dev` | Start the server and restart on file changes |
| `npm run worker` | Start the round-resolution BullMQ worker (needs SQL Server and Redis) |
| `npm run seed:admin -- <username>` | Create an admin account (prompts for the password) |
| `npm test` | Run all Jest tests |
| `npm run test:contract` | Run only the OpenAPI contract tests |

## Agentic toolstack

This project is built with AI coding assistants (Claude Code and others). Rules
every assistant follows are in [`AGENTS.md`](AGENTS.md); `CLAUDE.md` points
there. Commits largely written by an AI carry a `Co-Authored-By:` trailer
(`AGENTS.md` §4).
