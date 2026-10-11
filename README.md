# 2ndTry — Learn from your code

2ndTry is a learning-first AI Python tutor. Share your code, work through a personalized lesson about its error, and complete understanding checks to unlock the correction.

Edit `main.py` with Python
syntax highlighting and run it locally in an isolated Pyodide worker. Optional
function tests accept JSON-compatible values; for example, with
`def add(a, b): return a + b`, enter:

```json
[{"functionName":"add","args":[2,3]}]
```

Runs can be stopped and have a five-second execution limit. Captured output is
capped to keep large prints from overwhelming the page.

The **Teach me from this error** action uses the server-side `/api/fix` Gemini endpoint.
Set `GEMINI_API_KEY` in the server environment before starting or deploying the
app; the key is never sent to the browser. The current editor code and recent
Python output or traceback are included automatically. You may optionally add
the intended behavior, an error, example function arguments, and an expected
result. If a detail is genuinely needed, the app asks a focused follow-up
question. Suggested corrections include an explanation and practice pattern;
review them before applying. **Load a bug example** inserts one of three small,
reviewed examples (an average, a running total, or a range endpoint) to try.

Suggested corrections can include optional example tests. Review expected
values before using AI-suggested examples, then run the original and corrected
versions in the isolated browser runner to compare their behavior. These
examples are practice feedback, not proof of correctness. The **Listen**
controls can generate and replay an audio version of the correction
explanation through the server-only ElevenLabs integration. **Reset workspace**
clears unsaved editor and exercise state in the current page; it does not delete
My Practice history or change the anonymous learner cookie.

Gemini correction and ElevenLabs narration share a limit of 10 validated
requests per visitor/IP per fixed UTC hour. The counter uses the existing
Tiger Data PostgreSQL configuration (`DATABASE_URL` and, when needed,
`DATABASE_CA_CERT`) and the `second_try.paid_request_counters` table created
by migration 003. Configured local environments use Tiger too. Only an
unconfigured non-production environment uses a bounded in-memory fallback;
production fails closed with a temporary-unavailable response if the database
or migration is unavailable. No provider is called when the limiter cannot
confirm quota. Deployments must provide trusted client-IP headers: the hosting
ingress should overwrite `X-Real-IP` and normalize `X-Forwarded-For`. The app
hashes the selected address before storing it and never logs the address.
Counter rows expire after two hours; run `npm run db:cleanup:paid-counters`
periodically (for example hourly from a trusted maintenance scheduler) to
remove expired rows in bounded batches. Cleanup only deletes expired quota
counters and does not affect learner or practice data.

The Lessons section contains reviewed exercises for loops and totals, searching
and stopping, and counting endpoints. Each lesson starts with an output prediction,
then provides a guided repair, tests, progressive hints, reset, and an
independent follow-up exercise. Test feedback and completion summaries are for
practice and are not tamper-proof assessments.

## Fix pattern tracking

After a valid `/api/fix` correction response, 2ndTry saves its category in this
browser's local storage, including "other" for fixes outside the three guided
practice patterns. My Practice counts every saved correction; only the three
guided patterns have practice links. It stores no code or error text and keeps
only the latest 50 classified fixes.
Fix patterns are separate from server-backed practice history, are not
synchronized across browsers or devices, and are AI classifications rather than
verified diagnoses. Clearing this browser's site data removes the saved
patterns. If local storage is blocked or unreadable, the current page continues
to work and shows a notice that tracking is temporary or unavailable.

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
or resetting existing rows. Migration
[`db/migrations/003_paid_request_counters.sql`](./db/migrations/003_paid_request_counters.sql)
adds only the paid-request counter table and expiration index. Run the safe
status check before migrating:

```bash
npm run db:status
```

When an authorized database is configured, inspect the status output. The
explicit migration command checks existing tables, refuses partial schemas,
and applies migrations 002 and 003 when needed:

```bash
npm run db:migrate:practice
```

For an empty database it applies the base schema followed by migrations 002
and 003. All migrations are additive/idempotent and do not drop or reset data.
They are never run as part of an application request. Use
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
`public/pyodide`. Copy `.env.example` to `.env.local`, configure the existing
Tiger Data connection to exercise the database-backed shared counter, and set
the server-only `GEMINI_API_KEY` to use **Fix my code**. To enable narration
locally, also configure `ELEVENLABS_API_KEY`; `ELEVENLABS_VOICE_ID` is optional.
Only when no database URL is configured, a non-production server uses its
in-memory counter:

```dotenv
GEMINI_API_KEY=your-gemini-key
ELEVENLABS_API_KEY=your-elevenlabs-key
ELEVENLABS_VOICE_ID=
```

The key is only used by the server-side `/api/fix` route; never expose it in
client-side code. `.env.local` is ignored by Git.

## Deploy on Vercel

In the Vercel project settings, clear **Root Directory** completely to use the
repository root. Configure the existing Tiger Data `DATABASE_URL` and, only
when required, `DATABASE_CA_CERT`, alongside `GEMINI_API_KEY`. Add
`ELEVENLABS_API_KEY` to enable narration and optionally add
`ELEVENLABS_VOICE_ID`. Do not configure Upstash/Redis variables; paid request
limits use the Tiger database. Run `npm run db:status`, then
`npm run db:migrate:practice` from an authorized configured environment to
apply the additive migrations before redeploying. Local `.env.local` values
are not automatically uploaded to Vercel. Ensure the deployment includes the
repository's `public/pyodide` assets and that Vercel-provided client IP
headers are available to the functions.
