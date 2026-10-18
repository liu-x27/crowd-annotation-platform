# Deploying

One process serves the API and the web app. With no `DATABASE_URL` the database is the
embedded Postgres (PGlite) in `DATA_DIR`, so a single container with one volume is a
complete instance.

## The container image

CI builds the [Dockerfile](../Dockerfile) on every pull request and push. On `main`, once
the tests, the Postgres suite and the load test have passed, it publishes the image to
`ghcr.io/liu-x27/crowd-annotation-platform` (tags `latest` and `sha-<commit>`) with a build
provenance attestation, pulls it back by digest and smoke-tests it.

```bash
docker run -d --name crowd -p 4000:4000 -v crowd-data:/data ghcr.io/liu-x27/crowd-annotation-platform
```

Open http://localhost:4000; on an empty database the first page creates the admin account.

- **What is in it.** Node 24, the server's production dependencies, the built web app and the
  migrations; no dev dependencies or sources. It runs as the unprivileged `node` user, keeps
  its data in the `/data` volume, and has a health check on `/api/health`.
- **Configuration** is the environment variables in [.env.example](../.env.example), passed
  with `-e`. The image sets `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=4000` and
  `DATA_DIR=/data`.
- **Cookies are `Secure` in production.** Chrome, Edge and Firefox accept that on `localhost`;
  anywhere else it needs HTTPS, or `-e COOKIE_SECURE=false` to serve plain HTTP.
- **A Postgres server** instead of the embedded database: `-e DATABASE_URL=postgres://…`. The
  server applies the migrations when it starts; `/data` then holds only trained models.
- **Locked out:**
  `docker exec crowd node apps/server/dist/create-admin.js --username <name> --password <password> [--reset]`.
- **Checking where an image came from:**
  `gh attestation verify oci://ghcr.io/liu-x27/crowd-annotation-platform:latest --repo liu-x27/crowd-annotation-platform`.

What CI checks on each image (`scripts/docker-smoke.sh`): it runs as `node` and not as
root, declares `/data` and a health check, turns healthy, serves the web app, takes a first
admin, a project, an import, a claim, a submit and an export (`scripts/smoke.mjs`), and
after `docker restart` still has all of it.

## A public demo on Render

[render.yaml](../render.yaml) describes one service on Render's free plan: this Dockerfile,
`DEMO_MODE=true`, registration off, health checks on `/api/health`, and deploys only for
commits whose CI checks passed.

To create it (in the Render dashboard, with your own account):

1. Sign in to [render.com](https://render.com) with GitHub and allow it to read this
   repository.
2. **New → Blueprint**, pick `crowd-annotation-platform`, branch `main`.
3. Review the one service it lists, `crowd-annotation-demo` on the free plan, and apply.
   The region defaults to Oregon and cannot be changed afterwards; to choose another, add
   `region: virginia` (or `ohio`, `frankfurt`, `singapore`) to the service in `render.yaml`
   first.
4. The first build takes a few minutes. The demo is then at the `onrender.com` address the
   dashboard shows.

What to expect from it:

- **It starts from a demo built into the image.** Render passes the service's environment
  variables to the build, and with `DEMO_MODE=true` the build seeds the same demo as
  `npm run seed:demo` (drafts from the mock model, not a real LLM). On start, an empty data
  directory gets a copy with every date moved forward by the image's age, so the demo's
  fortnight of activity ends today. Seeding at start instead would take minutes on 0.1 CPU.
- **It forgets.** The free plan has no persistent disk: a restart, a redeploy, or the sleep
  after 15 minutes without traffic puts the demo back as built. The first visit after a
  sleep waits about a minute.
- **Anyone can be the admin.** Demo mode lists every account on the sign-in page and enters
  any of them without a password. Never turn it on for an instance with real data.
- **It is small.** 0.1 CPU and 512 MB: browsing and annotating are fine; training a model or
  drafting a project is slow.

Not checked from here: Render itself. CI builds the image the way Render will
(`--build-arg DEMO_MODE=true`) and checks that it starts as a demo — the accounts listed,
one-click sign-in, three projects, recent activity — and can train a model, once without
a memory limit and once within 512 MB and no swap, as on the free plan.
