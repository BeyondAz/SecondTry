# Pyspace Python Playground

Pyspace is a browser-based Python playground. Edit `Pymain.py` with Python
syntax highlighting and run it locally in an isolated Pyodide worker. Optional
function tests accept JSON-compatible values; for example, with
`def add(a, b): return a + b`, enter:

```json
[{"functionName":"add","args":[2,3]}]
```

Runs can be stopped and have a five-second execution limit. Captured output is
capped to keep large prints from overwhelming the page.

The **Fix my code** action uses the server-side `/api/fix` Gemini endpoint.
Set `GEMINI_API_KEY` in the server environment before starting or deploying the
app; the key is never sent to the browser. The current editor code and recent
Python output or traceback are included automatically. You may optionally add
the intended behavior, an error, example function arguments, and an expected
result. If a detail is genuinely needed, the app asks a focused follow-up
question. Suggested corrections include an explanation and practice pattern;
review them before applying. **Load average example** inserts a broken
average-score example and its expected behavior into the editor.

Suggested corrections can include optional example tests. Review expected
values before using AI-suggested examples, then run the original and corrected
versions in the isolated browser runner to compare their behavior. These
examples are practice feedback, not proof of correctness. The **Listen**
controls can generate and replay an audio version of the correction
explanation through the server-only ElevenLabs integration. **Reset workspace**
clears unsaved editor and exercise state in the current page; it does not delete
My Practice history or change the anonymous learner cookie.

Gemini correction and ElevenLabs narration share a limit of 10 requests per IP
per fixed hour. In development and tests the counter is in memory. Production
requires `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; without both,
paid endpoints fail closed with a temporary-unavailable response rather than
using per-instance limits. Deployments must provide trusted client-IP headers:
the hosting ingress should overwrite `X-Real-IP` and normalize
`X-Forwarded-For`. The app hashes the selected address before storing it in
Redis and does not log it.

The Lessons section contains reviewed exercises for accumulators, early
returns, and off-by-one errors. Each lesson starts with an output prediction,
then provides a guided repair, tests, progressive hints, reset, and an
independent follow-up exercise. Test feedback and completion summaries are for
practice and are not tamper-proof assessments.

## Persistent practice history

When configured, practice history follows this flow:

**Browser practice → Next.js server → Tiger Postgres → private attempt history
and recommendations → next exercise.**

Python still runs locally in Pyodide. The browser sends only a completed
exercise ID, outcome, hint count, opaque attempt/session IDs, and the attempt's
occurrence timestamp to the server; it does not send code, test arguments,
output, exceptions, or predictions for history. The server identifies an anonymous learner with a random, HttpOnly,
SameSite=Lax cookie and stores only a SHA-256 hash of its token. The cookie
expires after 90 days. Clearing this site's cookies creates a new anonymous
learner; it does not delete the previous learner's history.

History counts describe browser-reported **events**, not distinct learners,
mastery, or verified assessment results. Recommendations are deterministic
practice suggestions based on the learner's recorded attempts. Browser-side
test results and occurrence timestamps can be altered and must not be treated
as a secure assessment. History and recommendations order events by their
browser-reported occurrence timestamp; events with identical timestamps are
ordered by descending attempt UUID. The separate database recording timestamp
is retained for diagnostics.

### Configure the existing Tiger service

Copy [`.env.example`](./.env.example) to `.env.local`, then replace its
placeholders with the authorized connection settings for the existing Tiger
Cloud development service `db-49307` and database `tsdb`. Do not put
credentials in chat or commit `.env.local`; the example contains placeholders
only.

`DATABASE_URL` is server-only. `DATABASE_CA_CERT` is optional and should be
set to a trusted PEM CA only when the service requires a CA not trusted by the
host. TLS certificate validation stays enabled. The application removes SSL
options from the connection string and applies its explicit validating TLS
configuration, avoiding node-postgres connection-string SSL precedence
overriding the trusted CA settings.

The base schema is in
[`db/migrations/001_practice_history.sql`](./db/migrations/001_practice_history.sql);
it was reported as applied through Tiger Cloud SQL Editor. Migration
[`db/migrations/002_practice_occurrence_order.sql`](./db/migrations/002_practice_occurrence_order.sql)
adds a backfilled occurrence timestamp and ordering indexes without deleting
or resetting existing rows. Run the safe status check before migrating:

```bash
npm run db:status
```

When an authorized database is configured, inspect the status output. The
explicit migration command checks existing tables, refuses a partial base
schema, and applies migration 002 when needed:

```bash
npm run db:migrate:practice
```

For an empty database it applies the base schema followed by migration 002.
Both migrations are additive/idempotent and do not drop or reset data. They
are never run as part of an application request. Use
[`db/queries/practice_story.sql`](./db/queries/practice_story.sql) in Tiger SQL
Editor for read-only, learner-filtered history and event-count queries; replace
the documented UUID placeholder with the learner ID being inspected.

If `DATABASE_URL` is missing or Tiger is temporarily unreachable, the app
continues to run Python exercises locally. My Practice shows that persistent
history is unavailable; completed runs remain usable, and any unsaved event
is held only in memory with an explicit retry action. Configure the database
environment and retry; unsaved in-memory runs are lost if the page is
refreshed or closed.

## Run locally

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

The pinned Pyodide 314.0.7 runtime and its matching assets are served from
`public/pyodide`. Copy `.env.example` to `.env.local` and set the server-only
`GEMINI_API_KEY` to use **Fix my code**. To enable narration locally, also
configure `ELEVENLABS_API_KEY`; `ELEVENLABS_VOICE_ID` is optional. Set the
Upstash variables to exercise the shared counter locally; otherwise the
development server uses its in-memory counter:

```dotenv
GEMINI_API_KEY=your-gemini-key
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=
UPSTASH_REDIS_REST_URL=https://your-database.upstash.io
UPSTASH_REDIS_REST_TOKEN=your-upstash-rest-token
```

The key is only used by the server-side `/api/fix` route; never expose it in
client-side code. `.env.local` is ignored by Git.

## Deploy on Vercel

In the Vercel project settings, clear **Root Directory** completely to use the
repository root. Add `GEMINI_API_KEY` under **Settings → Environment
Variables**, plus `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN` for the shared production rate limit. Add
`ELEVENLABS_API_KEY` to enable narration and optionally add
`ELEVENLABS_VOICE_ID`. Local `.env.local` values are not automatically uploaded
to Vercel. Ensure the deployment includes the repository's `public/pyodide`
assets and that Vercel-provided client IP headers are available to the
functions.
