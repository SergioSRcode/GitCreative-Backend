# GitCreative — Backend

REST API and storage layer for GitCreative, a browser-based painting application with Git-style version control.

This is the backend service. It's designed to work with the [GitCreative frontend](https://github.com/SergioSRcode/GitCreative-Frontend) (separate repository), but exposes a plain REST API that could be consumed by any client.

---

## Features

- **JWT authentication** — register/login with bcrypt-hashed passwords, no-enumeration login errors
- **Rate limiting** — on registration, login, project creation, and commit creation, to guard against automated abuse
- **Honeypot field** on registration to deter simple bots
- **Projects, branches, commits** — a Git-inspired data model:
  - Projects have one or more branches
  - Branches point to a HEAD commit and optionally hold "quick-save" state distinct from named commits
  - Commits form a linked-list history via `parent_id` (no merges — matches the app's branching model)
  - Branch history queries use a recursive CTE to walk `parent_id` chains efficiently
- **Binary snapshot storage** — canvas snapshots (`.gitcreative` files) are stored in S3-compatible object storage (MinIO locally, or any S3-compatible provider in production), with only lightweight metadata in Postgres
- **Ownership-scoped queries throughout** — every route verifies the requesting user owns the resource; unauthorized access returns `404`, not `403`, to avoid confirming resource existence
- **Branch protection rules** — `main` and the currently active branch cannot be deleted
- **Integration test suite** — Vitest + Supertest against a real (test) Postgres + MinIO instance, covering auth, ownership, and branch protection

---

## Tech Stack

- **Node.js + Express + TypeScript**
- **PostgreSQL** — relational data (users, projects, commits, branches, settings)
- **MinIO / any S3-compatible object storage** — binary snapshot blobs
- **`minio` npm client** — S3-protocol client, works unchanged against MinIO or a managed provider like Cloudflare R2
- **Vitest + Supertest** — integration tests

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker (for local Postgres + MinIO)

### Install

```bash
npm install
```

### Local infrastructure

From the monorepo root (or wherever your `docker-compose.yml` lives):

```bash
docker compose up -d
```

This starts Postgres (port `5433` locally, to avoid conflicts with any system-installed Postgres) and MinIO (port `9000`, console on `9001`).

### Configure

Create a `.env` file:

```
PORT=3000
DB_HOST=localhost
DB_PORT=5433
DB_NAME=gitcreative
DB_USER=postgres
DB_PASSWORD=postgres
JWT_SECRET=<generate a strong random value — see below>
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=gitcreative-snapshots
FRONTEND_URL=http://localhost:5173
```

Generate a real `JWT_SECRET` (never reuse this example value):

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### Apply the database schema

```bash
psql -h localhost -p 5433 -U postgres -d gitcreative -f src/db/schema.sql
```

### Run in development

```bash
npm run dev
```

API available at `http://localhost:3000/api`.

### Run tests

Tests run against a **separate** test database and bucket — see `.env.test` for the expected variables (same shape as `.env`, pointed at a `gitcreative_test` database and `gitcreative-test-snapshots` bucket). Create and schema-load that test database once before running tests.

```bash
npm run test          # watch mode
npm run test -- --run # single run
```

Note: integration tests run sequentially (`fileParallelism: false` in `vitest.config.ts`) since they share one real database — parallel test files would race against each other's cleanup queries.

---

## API Overview

All routes are prefixed `/api`. Authenticated routes require `Authorization: Bearer <token>`.

| Route | Description |
|---|---|
| `POST /auth/register` | Create an account |
| `POST /auth/login` | Log in, receive a JWT |
| `GET /projects` | List the authenticated user's projects |
| `POST /projects` | Create a project |
| `GET /projects/:id` | Get a single project |
| `PATCH /projects/:id` | Rename a project |
| `DELETE /projects/:id` | Delete a project (cascades to branches/commits) |
| `GET /projects/:id/branches` | List branches |
| `POST /projects/:id/branches` | Create a branch from a given commit |
| `DELETE /projects/:id/branches/:branchId` | Delete a branch (not `main`, not currently active) |
| `PATCH /projects/:id/branches/:branchId/head` | Update a branch's HEAD commit |
| `PUT /projects/:id/branches/:branchId/save` | Quick-save (no history entry) |
| `GET /projects/:id/branches/:branchId/current` | Fetch current state (quick-save if present, else HEAD commit) |
| `GET /projects/:id/branches/:branchId/commits` | List commits reachable from this branch's HEAD (recursive CTE) |
| `POST /projects/:id/commits` | Create a commit (binary body, metadata via query params) |
| `GET /projects/:id/commits` | List all commits in the project |
| `GET /projects/:id/commits/:commitId/snapshot` | Download a commit's raw snapshot |
| `PATCH /projects/:id/lastBranch` | Update which branch was last active (for Gallery navigation) |

---

## Project Structure

```
src/
  routes/          Express route handlers (auth, projects/branches/commits)
  middleware/       Auth (JWT verification) and rate limiting
  db.ts             PostgreSQL connection pool
  db/schema.sql     Full database schema
  storage.ts        MinIO/S3 client and snapshot upload/download
  app.ts            Express app configuration (exported separately from
                     server startup, so tests can attach without a real port)
  index.ts          Server entrypoint
```

---

## Deployment

Designed for a persistent Node process (not serverless) — commit uploads accept binary bodies up to 100MB, which exceeds most serverless platforms' request-size limits.

Recommended: **Railway** or **Render** for the API + managed Postgres, **Cloudflare R2** (or any S3-compatible provider) for object storage.

### Required production environment variables

```
DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD   — production Postgres
JWT_SECRET                                          — strong random value, never reused from dev
MINIO_ENDPOINT, MINIO_PORT, MINIO_ACCESS_KEY,
MINIO_SECRET_KEY, MINIO_BUCKET                      — your object storage provider's credentials
FRONTEND_URL                                        — your deployed frontend's origin (for CORS)
```

Run `src/db/schema.sql` once against the production database before first deploy. No migration tool is currently in place — schema changes are applied manually.
