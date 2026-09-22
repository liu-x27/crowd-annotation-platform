# Migrating from v1

v1 kept everything in MongoDB (`users`, `tasks`, `samples`, `annotations`). The migration
reads that database **read-only** and writes a new v2 database; nothing in v1 is modified,
so it can be repeated into fresh directories as often as needed.

```bash
npm run migrate:v1 -- --mongo mongodb://localhost:27017 --db crowd_platform --data-dir ./data/v1
```

| Option | Default | |
|---|---|---|
| `--mongo` | `mongodb://localhost:27017` | v1's MongoDB |
| `--db` | `crowd_platform` | v1's database name |
| `--data-dir` | `DATA_DIR`, else `./data` | where the embedded Postgres goes; relative to where you run the command. With `DATABASE_URL` set, the migration writes to that server instead |
| `--burst-threshold` | `100` | see *Human or imported* below |
| `--keep-imported-open` | off | don't make imported labels the items' final labels |

The target must be empty; the script refuses otherwise. It prints a per-project table and
writes the full report to `migration-report.json` in the data directory. Then point the
server at it (set `DATA_DIR=./data/v1` in `.env`, or in the environment):

```bash
npm run build && npm start
```

v1 accounts keep their passwords (see *Users*), so v1 admins can sign in straight away.

## What changes on the way

v2 separates what v1 merged, and checks what v1 trusted. Every one of these is counted in
the report rather than applied silently.

### Users

Usernames, roles and bcrypt password hashes are copied. v2 verifies the bcrypt hash on the
first login and replaces it with scrypt. v1 had two roles; `admin` stays admin and
everyone else becomes `annotator`. Promote reviewers afterwards on the People page.

### Tasks → projects, samples → items

Each task becomes a project with its label set (plus any label that annotations used but
the task did not list — none were found in the real data). Samples become items numbered
1…N in import order, which is what v1's assignment ranges counted, and keep their v1 id in
`meta.v1Id`. Project settings start at v2's defaults (redundancy 1, no blind audit).

### Human or imported

v1 stored everything that was not an LLM draft as a *human* annotation, including gold
labels that import scripts wrote in bulk. v2 keeps those apart, so the migration has to
tell them back apart. The rule: a v1 "human" annotation is migrated as `import` when at
least `--burst-threshold` human annotations of the same task were created in the same
minute, or when it has no user. Nobody labels a hundred items a minute through a web form.

On the real v1 database this moved 94,121 annotations to `import` and kept 91 as `human`.

With imported labels finalised (the default, as v1 treated them for training), an item with
an imported label gets it as its final label, `final_source = 'import'`. Otherwise an item
whose human answers all agree is finalised as `consensus`.

### Drafts

- **Duplicates.** v1 had no uniqueness on drafts: there were 479 surplus drafts, and on 99
  items they disagreed with each other. The newest is kept, the others are dropped and
  counted.
- **Confidence.** Drafts that the platform wrote carried a hard-coded confidence of 0.9,
  whatever the model said. Those confidences are dropped (2,274 on the real data).
  Drafts written by the separate batch scripts, which recorded the model's own value, keep it.
- **Empty drafts.** A draft with no label becomes an `error` row — a draft that failed —
  rather than an empty label.
- **Model name.** Recorded as `v1:<model>` where v1 stored it, `v1:unrecorded` where not.

v1's pre-labeller also fell back to the *first label of the task* when the model's reply
didn't contain a label or the request failed, and stored that as the draft. Those rows are
indistinguishable from real drafts in v1's data, so they cannot be filtered out here;
treat v1-era drafts with that in mind.

### NER spans

v1 stored UTF-16 offsets, and its span selection measured them from a DOM range that
included the label badges drawn inside highlighted spans, so some offsets were wrong. Each
span is converted to code points and checked against the text:

- offsets that point at the span's text are kept;
- otherwise the span's text is searched for near where it claimed to be and re-anchored;
- spans that cannot be placed, overlap a kept span, or use an unknown label are dropped.

On the real data: 1,559 spans checked, 3 re-anchored, none dropped.

### Review state and assignments

A v1 annotation with status `rejected` becomes a returned answer, with the note
"Rejected in v1." and the original reviewer and time where recorded. Everything else that
a person submitted becomes `submitted`. v1's per-sample `assignedTo` becomes v2 assignment
ranges, one per contiguous run of item numbers.

## Checking the result

The numbers in the report should add up to v1's totals: human + imported + drafts, plus the
duplicate drafts and duplicate answers dropped, equals v1's annotation count. On the real
database that is 91 + 94,117 + 41,144 + 479 + 4 = 135,835.
