<div align="center">

<a href="https://liu-x27.github.io/crowd-annotation-platform/">
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/lockup-dark.svg">
  <img alt="Crowd Annotation" src="docs/brand/lockup-light.svg" width="420">
</picture>
</a>

### Label with a model. Keep what it said separate.

Assign, annotate, review and export text datasets, with model drafts stored apart from
human labels, and every number reported against the source it came from.

[![CI](https://github.com/liu-x27/crowd-annotation-platform/actions/workflows/ci.yml/badge.svg)](https://github.com/liu-x27/crowd-annotation-platform/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-monorepo-17171a?style=flat-square&logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-embedded_PGlite_or_a_server-17171a?style=flat-square&logo=postgresql&logoColor=white)
![React 19](https://img.shields.io/badge/React_19-Tailwind_4-17171a?style=flat-square&logo=react&logoColor=white)
![LLM drafts](https://img.shields.io/badge/drafts-Ollama_·_Claude_·_OpenAI--compatible-fcd34d?style=flat-square)
![Tests](https://img.shields.io/badge/tests-132-17171a?style=flat-square)
[![License: MIT](https://img.shields.io/badge/license-MIT-17171a?style=flat-square)](LICENSE)

**[Project page](https://liu-x27.github.io/crowd-annotation-platform/)** · [Why a rewrite](#why-a-rewrite) · [What it does](#what-it-does) · [Running it](#running-it) · [Status](#status) · [Architecture](docs/ARCHITECTURE.md)

</div>

<br>

| **91** | **2,274** | **99** | **135,835** |
|:---:|:---:|:---:|:---:|
| of the 3,063 labels v1's README called reviewed one at a time were made at a human pace | v1 drafts carrying a confidence of 0.9 that no model had reported | items whose duplicate drafts disagreed, so "the model's label" depended on row order | v1 annotations migrated through v2's checks in 44 s, every one accounted for |

A labelling tool for the workflow where a language model drafts labels and people check
them. Annotators are served one item at a time, a reviewer settles disagreements, and the
result trains a small model that can be compared against the drafts it learned from.

The forms are the easy part. The hard part is keeping the record honest: knowing for every
label whether a person or a model produced it, whether the person checked the draft or just
accepted it, and whether an accuracy figure was measured against labels the model itself
wrote. None of that fails loudly when it goes wrong. You get a plausible label and no error.

![Annotating a headline, with the model's draft marked as a suggestion](docs/screenshots/annotate.png)

## Why a rewrite

This is v2. [v1](https://github.com/liu-x27/crowd-annotation-platform/tree/v1) ran for one
real labelling job and looked fine doing it. Migrating its database into v2 — which forced
every record to pass v2's checks — showed where it had been quietly recording the wrong
thing:

- **Failures became labels.** When the model's reply didn't contain a label, or the request
  failed, the pre-labeller saved the task's *first* label as the model's answer. It also
  matched labels as substrings anywhere in the reply, so a reply that mentioned two labels
  counted as whichever came first in the list.
- **A confidence nobody measured.** Drafts written by the platform carried a confidence of
  0.9 whatever the model said — 2,274 of them.
- **Duplicate drafts.** Nothing stopped an item being drafted twice: there were 479 surplus
  drafts, and on 99 items they disagreed with each other, so "the model's label" depended
  on which row a query happened to return.
- **Offsets that counted the badges.** The NER page measured selection offsets from a DOM
  range that included the label badges drawn inside highlighted spans. 3 of 1,559 stored
  spans pointed at the wrong characters.
- **Saving the assignment dialog moved people's work.** It displayed each existing
  assignment as items 1…N, whatever range had actually been assigned, and saving wrote
  that back — after clearing the annotator's assignments and without checking anyone
  else's. Changing one task could move an annotator from items 201–400 to 1–200 and take
  those items from whoever held them.
- **Exports weren't filtered.** v1's README said a task could be exported human-only,
  model-only or both. The endpoint wrote every annotation of every source and review status
  into one file, one row per annotation, and left the filtering to whoever opened it.
- **No claims.** Where items were not assigned, everyone drew from one pool and two people
  could be served the same item. (v1's README said so.)

**A correction to v1's README.** It said 3,063 samples "went through the review queue a
sample at a time". The data doesn't support that. v1 stored every non-draft label as a
human annotation, including gold labels written by import scripts. Counting only those
created at a human pace — fewer than 100 in the same minute for the same task — leaves
**91 annotations**. The other 94,121 arrived in bulk and are migrated as imported labels,
not human ones. [docs/MIGRATING_FROM_V1.md](docs/MIGRATING_FROM_V1.md) has the rule and the
full reconciliation.

What v2 does about each:

| v1 | v2 |
|---|---|
| failure → first label | A failed or unparseable call is an `error` row that keeps the raw reply. The parser accepts exactly one allowed label, or entities it can place on the text. |
| made-up confidence | Drafts store no confidence: none of the providers reports one, and v2 doesn't invent it. Migrated values survive only where v1 recorded a real one. |
| duplicate drafts | A partial unique index allows one draft per item, one imported label per item, one answer per person per item. |
| offsets from the DOM | Offsets come from data attributes on each character, are counted in code points, and are re-checked by the server, which derives the span text itself. |
| assignment dialog | Ranges are stored and shown as ranges. They limit who is served what; exclusivity comes from claims. |
| unfiltered export | Every export names its label source: final, human, llm, import, or all. |
| no claims | Items are claimed under a lease with `FOR UPDATE SKIP LOCKED`. |

## What it does

The loop: **import items → an LLM drafts labels → annotators label with the draft as a
suggestion → answers that disagree go to review → final labels train a student model and
export.** Human answers, model drafts and imported labels are separate sources throughout;
nothing merges them silently.

- **Annotation.** Classification and span-level NER, both keyboard-first — number keys for
  labels, `S` to skip, `F` to flag for review, `?` for the rest. Each claim carries a lease;
  redundancy N gives every item to N different people; answers can be changed until the
  item is final.
- **Blind audit.** A fixed share of claims hides the draft, decided by a hash so it is
  stable. Agreement with the draft is then reported separately for shown and hidden
  claims. If annotators agree with the model far more often when they can see it, the
  review loop is measuring deference, not correctness.
- **Review.** A queue ordered disagreement-first; a reviewer finalises with any label,
  accepts the majority, finalises all unanimous items at once, or returns one answer to its
  author with a note (it comes back to them first).
- **Agreement.** Krippendorff's α and pairwise Cohen's κ for classification, pairwise span
  F1 for NER, per-annotator agreement with the final labels and with the drafts.
- **Calibration.** A project can draw a calibration set: items picked at random by a hash
  of their ids, served before all others, never with the draft on screen, and answered by
  at least three people whatever the redundancy. Its blind answers are the reference for
  three reports: how often the draft matches the most common answer, with a Wilson
  interval; the alternative annotator test (Calderon, Reichart & Dror, ACL 2025), which
  asks whether the drafts could stand in for these annotators; and each label's share of
  the project from prediction-powered inference (PPI++), which leans on the drafts only as
  far as they agree with people. In plain TypeScript, checked against scipy, statsmodels
  and ppi_py. In the demo, the product-review project has a set of 40; its drafts come from
  a mock model and are near chance, so they fail the test and PPI++ all but ignores them.
- **LLM drafting.** Ollama (grammar-constrained JSON), Claude (official SDK, structured
  output) or any OpenAI-compatible server. A prompt preview shows the full exchange on a
  few items without saving anything; worked examples never include the item being
  labelled; errors that would repeat (bad key, unknown model) stop the job at the first one.
- **Student models.** Trained in a worker thread: TF-IDF + logistic regression for
  classification, an averaged perceptron with constrained Viterbi for NER. The test set is
  drawn first and only then are training labels chosen, from final labels, human
  majority, the LLM drafts alone, or a mix — so a draft can never train a model that is then
  scored on the same item's human label. Every report shows a trivial baseline and the
  drafts' own score on the same test items.
- **Data.** Import CSV, TSV, JSON or JSONL with de-duplication and optional labels; filter
  by state, text, label or draft status; see everything recorded for an item, including the
  raw model output; export JSONL, CSV or CoNLL.
- **The rest.** Roles built from capabilities (admin, reviewer, annotator); live job
  progress over server-sent events; a command palette; English and Chinese; light and dark.

| | |
|---|---|
| ![Project overview: progress, label distribution, agreement, draft quality](docs/screenshots/overview.png) | ![Review queue with a tie between two annotators](docs/screenshots/review.png) |
| ![NER annotation with the model's suggested entities](docs/screenshots/annotate-ner.png) | ![Item detail: the draft, its raw output, and each answer](docs/screenshots/data.png) |
| ![Pre-labelling: prompt preview and draft quality](docs/screenshots/prelabel.png) | ![Student model trained on LLM drafts, against baselines](docs/screenshots/models.png) |
| ![Overview in Chinese, dark theme](docs/screenshots/overview-dark-zh.png) | ![Sign-in page of a demo instance](docs/screenshots/login.png) |

The screenshots come from a seeded demo instance: template-generated sentences, simulated
annotators (each with a fixed accuracy, copying the draft some of the time when it is
shown), and drafts from a real local model, qwen3:4b. The numbers in them describe that
simulation and nothing else — templated text is easy, which is why a student can score 100%.

## Running it

Requires Node 22.12 or later. Nothing else: the database is an embedded Postgres (PGlite)
in `./data`.

```bash
npm install
npm run dev
```

The API runs on :4000 and the web app on http://localhost:5173. On an empty database the
first page asks for an admin account; that page disappears once one exists. For a single
process serving both, run `npm run build && npm start` and open http://localhost:4000.

Configuration goes in `.env` at the repository root — see [.env.example](.env.example).
The ones that matter most:

| Variable | |
|---|---|
| `DATA_DIR` | where the embedded database and trained models live (default `./data`) |
| `DATABASE_URL` | use a Postgres server instead of the embedded one |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | local drafting |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | drafting with Claude (default model `claude-opus-5`) |
| `ANTHROPIC_BASE_URL` | an Anthropic-compatible endpoint instead of Anthropic's API |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL` | any OpenAI-compatible server |
| `ALLOW_REGISTRATION` | whether people can create annotator accounts themselves |
| `DEMO_MODE` | one-click sign-in as any account — for public demos only |
| `LOW_MEMORY` | a smaller embedded Postgres, for instances with about 512 MB; queries are slower |

**A demo instance.** Point `DATA_DIR` at an empty directory (e.g. `./data/demo`), then:

```bash
npm run seed:demo      # 3 projects, 5 accounts, drafts, reviews, trained models
```

It drafts with Ollama when `OLLAMA_MODEL` is available and falls back to a mock model
otherwise (`--llm ollama|mock|none`, `--model <name>`, `--no-train`). Every account's
password is `demo-password`; with `DEMO_MODE=true` the sign-in page lists them instead.
`npm run screenshots` retakes the images above from a running demo instance, using the
installed Edge or Chrome.

**Migrating a v1 database:** `npm run migrate:v1 -- --data-dir ./data/v1` reads v1's
MongoDB without writing to it. See [docs/MIGRATING_FROM_V1.md](docs/MIGRATING_FROM_V1.md).

**Locked out:** `npm run create-admin -- --username <name> --password <password> [--reset]`.

**In a container:** CI publishes an image from `main`.

```bash
docker run -p 4000:4000 -v crowd-data:/data ghcr.io/liu-x27/crowd-annotation-platform
```

[docs/DEPLOY.md](docs/DEPLOY.md) covers its configuration, a Postgres server, and a public
demo on Render's free plan ([render.yaml](render.yaml)).

## Layout

```
apps/server       Hono API · Drizzle schema and migrations · job runner · LLM providers
                  · training worker · v1 migration · demo seed
apps/web          React 19 · TanStack Query · Tailwind 4 · Radix · hand-drawn SVG charts
packages/shared   zod schemas and API types used by both, code-point span utilities,
                  the statistics behind calibration
docs/             ARCHITECTURE.md · MIGRATING_FROM_V1.md · DEPLOY.md · screenshots
load/             k6 load test of claim → submit, and the check of the database after it
scripts/          smoke tests of a running instance and of the container image
```

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) covers the data model, the claim query, the
job runner, the drafting pipeline and why each piece is the way it is.

## Tests

```bash
npm test           # 123 tests: shared 29, server 89, web 5
npm run typecheck
npm run lint
npm run a11y       # axe on 14 pages in both themes, against a running demo instance
TEST_DATABASE_URL=postgres://user:password@localhost:5432/postgres npm test -w @crowd/server
```

Server tests run against a fresh in-memory Postgres per file and call the app without
opening a port. With `TEST_DATABASE_URL` (a role that may create databases) they run on
that Postgres server instead, each file on its own copy of a template database migrated
once per run, together with nine tests that need connections running in parallel (`postgres.test.ts`); CI does both, on
Postgres 18. Among what they pin down: two annotators asking at the same moment never
get the same item, and redundancy 2 never reaches a third person, also when a claim
commits while another claim's scan is on its way to the same item; an expired lease frees
the item; a returned answer comes back to its author first; failed model calls are
recorded as errors, never as labels; an item is never shown its own answer as a worked
example; no test item ever contributes a training label; the human-only export contains no
model or imported labels; a v1 bcrypt password still signs in and is upgraded; the v1
migration repairs the badge-inflated span; the database and the JS agree on which answers
are the same, so two annotators marking the same entities in a different order are not a
disagreement; and bulk review never overwrites a decision already made. On the web side, span offsets are read from the
DOM's data attributes rather than from rendered text length — the v1 bug.

## Status

Tested here: the suite above; the v1 migration on the real v1 database (94,469 items and
135,835 annotations in 44 s, every annotation accounted for); the item list, text search,
statistics and a streaming JSONL export (47,247 rows, 6.6 MB, under 0.6 s) on its largest
project, 47,345 items; a demo instance seeded end to end with qwen3:4b; the UI in Edge,
in both languages and both themes; the alternative annotator test on the authors' own
data, which gives the winning rate and advantage probability their notebook prints in all
30 cases; and an axe scan of 14 pages in both themes (`npm run a11y`, WCAG 2.0–2.2 A and
AA rules), whose first run found 62 violations, all since fixed: muted text below 4.5:1
contrast, an unnamed button in the header, and form controls whose label was not tied to
them.

Tested in [CI](.github/workflows/ci.yml), for every push to `main` and every pull request:

- **A Postgres server.** The server suite runs on Postgres 18 as well as on the embedded
  one, with nine more tests that need connections running in parallel. The first run
  found a bug: a claim made in one statement could give an item to more people than
  the project's redundancy allows. `SKIP LOCKED` passes over an item only while another
  claim holds it, and the scan's snapshot can predate a claim committed in between. Claims
  now check the item again once it is locked
  ([ARCHITECTURE.md](docs/ARCHITECTURE.md#the-annotation-lifecycle)). A second race, seen in
  the code and then made to fail in CI, is fixed the same way: renewing a claim whose lease
  had run out, while someone else was taking the item, left the item with two holders, and
  a reviewer finalising it at that moment turned the renewal into a 500.
- **Load.** k6 runs 24 annotators looping claim → submit through 4,000 items at redundancy
  1 and 4,000 at redundancy 2, after which the database is asked whether every item was
  answered exactly as often as its project asks. Before the fix, 215 and 400 items were
  answered once too often, while no request failed; since, none. k6, the server and
  Postgres share one runner, so its timings are only for comparing runs with each other:
  since the fix, 67 to 80 submits a second, and a median of 210 to 280 ms for a submit and
  the next claim. It remains a single-node application by design: jobs run in-process.
- **The container image.** Multi-stage, non-root, data in a `/data` volume, a health
  check. It is smoke-tested from a first admin to an export and again after a restart,
  published to `ghcr.io/liu-x27/crowd-annotation-platform` with a build provenance
  attestation, then pulled back, verified and smoke-tested again. The demo variant that
  Render would build starts as a demo and trains a model within 512 MB with
  `LOW_MEMORY=true` (peak 216 MiB; 1,015 MiB without it).

Not tested:

- **The Claude provider** has never been called. It is written against the official SDK,
  but no API key was available here, and the tests only use the mock provider.
- **The OpenAI-compatible provider** has not been run against a real server.
- **A hosted deployment.** [render.yaml](render.yaml) and [docs/DEPLOY.md](docs/DEPLOY.md)
  describe a demo on Render's free plan, but no service has been created, so Render itself
  is unchecked.
- **Accessibility** beyond keyboard use, the screen-reader tables behind the charts and
  that scan has not been checked: no screen reader or other assistive technology has been
  tried, and the scan sees each page as it loads, not dialogs, menus or later states.

## License

MIT — see [LICENSE](LICENSE).
