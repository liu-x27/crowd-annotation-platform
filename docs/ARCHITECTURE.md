# Architecture

One Node process serves the API and the built web app. State lives in Postgres — an
embedded copy (PGlite, Postgres compiled to WebAssembly) by default, a real server when
`DATABASE_URL` is set. Background work (LLM drafting, model training) runs in the same
process through a small job queue backed by a table, and reaches the browser over
server-sent events.

```
apps/web      React 19 · TanStack Query · Tailwind 4 · Radix · motion
   │  fetch /api/*  (cookie session)        EventSource /api/events
   ▼
apps/server   Hono ─ routes ─ services ─ Drizzle ─ Postgres (PGlite | pg)
                 │                  └── JobRunner ── prelabel handler ── LLM providers
                 │                               └── train handler ─── worker thread
packages/shared   zod schemas, API types, span/text utilities — imported by both sides
```

## Data model

```mermaid
erDiagram
  users ||--o{ sessions : "signs in with"
  users ||--o{ annotations : "writes (human)"
  projects ||--o{ items : contains
  projects ||--o{ assignments : "restricts by seq range"
  users ||--o{ assignments : "is assigned"
  items ||--o{ annotations : "has"
  projects ||--o{ jobs : runs

  users { int id PK; text username UK; text password_hash; text role; timestamptz disabled_at }
  sessions { text id PK "sha256(token)"; int user_id FK; timestamptz expires_at }
  projects { int id PK; text type "classification | ner"; jsonb labels; jsonb settings; text guidelines }
  assignments { int id PK; int project_id FK; int user_id FK; int seq_from; int seq_to }
  items { int id PK; int project_id FK; int seq UK "per project"; text text; int human_count; text final_label; jsonb final_spans; text final_source }
  annotations { int id PK; int item_id FK; text source "human | llm | import"; int user_id FK; text status; text label; jsonb spans; bool draft_shown; text raw_output; text error }
  jobs { int id PK; text kind "prelabel | train"; text status; jsonb params; jsonb progress; jsonb result }
```

Three decisions carry most of the design:

**Sources are never merged.** An annotation row is one of `human`, `llm` or `import`, and
partial unique indexes enforce one draft and one imported label per item and one answer
per person per item. The item's *final* label is separate again, with `final_source`
saying how it was decided (`consensus`, `review`, `import`). Every statistic and every
export picks its source explicitly.

**The item row carries the queue state.** `human_count` (submitted answers) and
`finalized_at` are maintained in the same transaction as the annotation that changes them,
so "what can this person be served next" is one indexed query, not an aggregation over
annotations.

**Offsets are code points, derived on the server.** NER spans are `[start, end)` over the
text's code points. The client sends offsets only; the server checks them against the
text and derives each span's text itself. A span that points at the wrong characters is
rejected at the API rather than stored.

## The annotation lifecycle

```
                 claim (lease)                 submit
   (eligible) ───────────────▶ claimed ─────────────────▶ submitted ──┐
                                 │  ▲                         │       │ consensus / review
                            skip │  │ reclaim            reject│       ▼
                                 ▼  │                         ▼    item final
                              skipped                     rejected ──(served first to the same person)
```

`GET /projects/:id/queue` serves, in order: the caller's open claim (renewing its lease),
then work a reviewer returned to them, then a fresh item. A fresh item is claimed in one
statement:

```sql
WITH candidate AS (
  SELECT i.id FROM items i
  WHERE <eligible for this user>          -- not final, < redundancy answers or live claims,
  ORDER BY i.seq LIMIT 1                  -- not already touched by this user, inside their
  FOR UPDATE OF i SKIP LOCKED             -- assignment ranges (or outside everyone's)
)
INSERT INTO annotations (…, status, lease_expires_at)
SELECT …, 'claimed', now() + lease FROM candidate
ON CONFLICT (item_id, user_id) WHERE source = 'human' DO NOTHING
RETURNING id, item_id;
```

`SKIP LOCKED` is what makes concurrent requests pick different items on real Postgres; on
PGlite the single connection serialises them anyway. A per-(project, user) advisory lock
stops two browser tabs from opening two claims. Leases expire on their own — there is no
sweeper; the eligibility query simply ignores claims whose lease is in the past.

A submit updates the annotation, increments `items.human_count`, and — if the project
allows it, enough people have answered, all answers agree and nobody flagged the item —
finalises it as `consensus`, all in one transaction. The response carries the next claim,
so moving to the next item is one round trip.

**Blind audit.** When an item is claimed and a draft exists, a deterministic hash of
(project, item, user) decides whether the draft is shown, against the project's
`blindRate`. The decision is stored on the annotation (`draft_shown`). Agreement with the
draft, split by that flag, is the anchoring check: if annotators agree with the draft far
more often when they can see it, the review loop is measuring deference, not correctness.

## Review

The review queue lists unfinalised items that have enough answers, or any flagged answer,
ordered disagreement-first. A reviewer can finalise with any label (`review`), accept the
majority, bulk-finalise unanimous items, or *return* one answer with a note — which moves
that answer to `rejected`, decrements `human_count`, and makes it the first thing its
author is served next time.

## Background jobs

`jobs` is the queue. `JobRunner` runs at most one job per kind at a time (each job
parallelises internally), persists progress at a bounded rate, and publishes every change
on an in-process event bus that the SSE endpoint forwards. Jobs that were running when the
process stopped are re-queued on start; both handlers are written to be resumable
(drafting skips items that already have a draft; training starts over).

### LLM drafting

```
prompt (labels + descriptions + guidelines + worked examples)
   │  the item's own example is never among the worked examples
   ▼
provider.complete(schema)   Ollama: grammar-constrained `format`, think=false for reasoning models
   │                        Claude: official SDK, output_config.format (JSON schema)
   │                        OpenAI-compatible: response_format json_schema → json_object → none
   ▼
parse   strict: one allowed label, or {"entities":[{text,label}]} placed onto the text by code
   ▼
draft row   status 'submitted' with the raw reply, or 'error' with the reason and the raw reply
```

A failed or unparseable call is an `error` row — never a label. Errors that would repeat on
every item (unreachable server, bad key, unknown model) stop the job at the first one.
Entities whose text does not occur in the item are counted, not dropped silently.

### Student models

Training runs in a `worker_thread` so the API stays responsive. The data split happens
first, at the item level: test items are drawn from those with a *reference* label (final,
or imported), and only then are training labels chosen, from whichever source was asked for
(`final`, `human` majority, `llm`, a human-over-draft mix, or `import`), over the remaining
items. So an item's draft can never train a model that is then scored on that same item's
human label.

- Classification: character 1–3-grams and ICU word tokens, feature-hashed, sublinear TF-IDF
  fitted on the training portion only; multinomial logistic regression with sparse AdaGrad.
- NER: character-window features; averaged structured perceptron with BIO-constrained
  Viterbi decoding.

A validation split carved from the training labels selects the epoch; the test set is
touched once. Reports include a trivial baseline (majority class, or a dictionary of
training entities) and the LLM drafts scored on the same test items, so a number means
something.

## Auth

Opaque session tokens in an `HttpOnly`, `SameSite=Lax` cookie; the database stores only
their SHA-256. The user row is read on each request, so a role change, disabled account or
reset password applies immediately. Passwords are scrypt; v1's bcrypt hashes verify and
are replaced on first login. Routes check capabilities (`annotate`, `review`,
`project:manage`, …), and roles are named bundles of them. State-changing requests with a
foreign `Origin` are refused. The first account created on an empty database becomes the
admin, under an advisory lock, and that endpoint closes once any user exists.

## Why these choices

- **Postgres rather than MongoDB (v1).** The core operations are relational and
  transactional: claim an item unless someone else holds it, count answers, keep one draft
  per item. v1 had no claim at all and accumulated duplicate drafts.
- **PGlite by default.** `npm install && npm run dev` works with nothing else running, and
  tests get a fresh in-memory Postgres per file. The same Drizzle schema and SQL run on a
  real server via `DATABASE_URL`.
- **Hono.** Web-standard Request/Response, so SSE and streaming exports are plain streams,
  and tests call `app.request()` without opening a port.
- **In-process jobs rather than a broker.** One process, a table as the queue, a worker
  thread for CPU. The ceiling is a single node; that is the intended deployment.
- **Hand-rolled SVG charts.** A few chart types, drawn to one set of tokens that switch with
  the theme; palettes validated for colour-vision deficiency.
