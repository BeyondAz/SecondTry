# 2ndTry — Learn from your code

**Built for HackRU26.** 2ndTry is a learning-first Python practice app. Write and
run Python in your browser, ask an AI tutor to teach you about an error, and
complete a short lesson before unlocking the correction. Reviewed exercises
and a personal practice dashboard help you choose what to work on next.

## Features

- **Playground:** edit Python with Monaco, run scripts, inspect output and
  tracebacks, and call functions with JSON test arguments.
- **AI tutoring:** use **Teach me from this error** for a personalized lesson
  and understanding checks. Complete the checks to unlock the corrected code.
  Load one of the reviewed bug examples to try the flow.
- **Example comparison:** review AI-suggested expected values, then compare
  the original and corrected code against those examples.
- **Narration:** generate and replay spoken explanations through ElevenLabs.
- **Lessons:** practice loops and totals, searching and stopping, and range
  endpoints through predictions, guided repairs, tests, progressive hints,
  and independent follow-up exercises.
- **My Practice:** see recent lesson runs, next-step recommendations, and
  bar charts of frequently corrected patterns.

Python runs locally in a dedicated Pyodide Web Worker. The Next.js server
handles AI providers and persistent practice history. There is no account
sign-up; saved lesson history uses an anonymous browser cookie.

## Quick start

Use **Node.js 22.18+ or 24 LTS** and npm. The test scripts use Node's built-in
TypeScript stripping. A separate Python installation is not needed.

From the repository root:

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). The Playground and reviewed lessons
work without API keys or a database. The Python runtime assets are included
in `public/pyodide`.

To enable connected features, copy `.env.example` to `.env.local`, fill in the
relevant settings, and restart the server. In PowerShell:

```powershell
Copy-Item .env.example .env.local
```

For local Python practice only, leave `DATABASE_URL` empty instead of retaining
its placeholder value. A configured URL makes the app use the database for
paid-request counters as well as history.

## Environment variables

These settings are server-only. `.env.local` is ignored by Git.

| Variable | Purpose | When needed |
| --- | --- | --- |
| `GEMINI_API_KEY` | Gemini code analysis and personalized lessons | AI tutoring |
| `ELEVENLABS_API_KEY` | Spoken explanations | Narration |
| `ELEVENLABS_VOICE_ID` | Override the built-in narration voice | Optional |
| `DATABASE_URL` | PostgreSQL connection for history and quota counters | Persistent history and production paid features |
| `DATABASE_CA_CERT` | Trusted PEM CA; literal `\n` is accepted between lines | Only if the database CA is not trusted by the host |
| `PRACTICE_TEST_BASE_URL` | Server URL for practice integration tests | Optional; defaults to `http://localhost:3000` |

The current tutoring model is Gemini `gemini-3.5-flash-lite`. Credentials remain
on the server. Database TLS certificate verification stays enabled; connection
string SSL parameters are removed so the explicit TLS configuration takes
precedence.

Without a database URL, a non-production server uses a bounded in-memory counter
for AI and narration. Persistent history remains unavailable. Production paid
features require a working database and migrated counter table; provider calls
are blocked when quota cannot be confirmed.

## Using the app

Enter a script and run it, or supply function calls as a JSON array. For
`def add(a, b): return a + b`, use:

```json
[{"functionName": "add", "args": [2, 3]}]
```

Runs can be stopped and have a five-second execution limit after runtime
initialization. Captured output is capped at 20,000 characters. The bundled
runtime is Pyodide 314.0.7; keep its package and served assets in sync when
upgrading.

AI tutoring automatically includes the current code and recent output or
traceback. You can add intended behavior, an error, example arguments, and an
expected result. The tutor may ask a focused clarification before creating a
lesson. Review corrections before applying them and review AI-suggested
expectations before comparing examples.

**Reset workspace** clears unsaved editor and exercise state on the current
page. It does not delete saved history or change the anonymous learner cookie.

## Practice data and privacy

My Practice uses two separate data sources:

| Data | Storage | Behavior |
| --- | --- | --- |
| Fix pattern charts | Browser local storage | Count the latest 50 AI-classified corrections: accumulator, early return, off-by-one, and other corrections. Only the three guided patterns have practice links. No code or error text is stored. |
| Lesson history | PostgreSQL | Stores exercise ID, outcome, hint count, attempt/session IDs, and occurrence time. Displays up to 50 recent runs, summary metrics, and recommendations. |

Charts count Playground corrections, not failed lesson tests. Pattern counts do
not sync across browsers or devices; clearing site data removes them. Corrections
that were discarded before tracking of “other” was added cannot be recovered.
If browser storage is blocked, new counts last for the current page only and
the app displays a notice.

The server identifies learners with a random HttpOnly, SameSite=Lax cookie that
expires after 90 days. Only a SHA-256 hash of its token is stored. Clearing
cookies creates a new learner; it does not delete the old database history.
Practice history excludes code, test arguments, output, exceptions, and
predictions. AI tutoring sends submitted code and supplied context to Gemini;
narration sends explanation text to ElevenLabs.

If saving fails, completed exercises still work and pending saves remain in
page memory with a retry action. Refreshing or closing the page loses those
unsaved events.

Recommendations are deterministic suggestions based on recorded attempts.
Events are ordered by browser-reported occurrence time, then descending attempt
UUID for ties. Database recording time is retained separately. Browser-reported
results and AI classifications are learning feedback, not verified assessments
or measures of mastery.

## Database setup and maintenance

The project uses Tiger Data PostgreSQL. The current service host is
`qkocflqner.a9mfea0e1s.tsdb.cloud.timescale.com`, port `37633`, database `tsdb`,
and username `tsdbadmin`. Replace the password placeholder in `.env.example`
with the URL-encoded database password in your private environment settings.

Check connectivity and schema status, then apply missing migrations:

```sh
npm run db:status
npm run db:migrate:practice
```

The migration command refuses partial base schemas. An empty database receives
all three migrations; an existing schema receives missing follow-up migrations.
Migrations are additive/idempotent and do not drop or reset data. They never run
as part of an application request.

| Migration | Purpose |
| --- | --- |
| `001_practice_history.sql` | Learners, sessions, and practice attempts |
| `002_practice_occurrence_order.sql` | Backfilled occurrence timestamps and ordering indexes |
| `003_paid_request_counters.sql` | Shared paid-request counters and expiration index |

Gemini and ElevenLabs share **10 validated requests per client IP per fixed UTC
hour**. The selected address is hashed before storage and is not logged.
Production ingress must overwrite `X-Real-IP` and normalize `X-Forwarded-For`
so addresses come from trusted headers.

Counter rows expire two hours after their hourly window begins. Schedule this
command periodically, for example hourly:

```sh
npm run db:cleanup:paid-counters
```

Cleanup removes expired quota counters in bounded batches and does not delete
learner history. `db/queries/practice_story.sql` contains read-only,
learner-filtered inspection queries with a documented learner UUID placeholder.

## Development and testing

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the development server |
| `npm run build` | Create the production build |
| `npm start` | Serve a completed production build |
| `npm run lint` | Run ESLint |
| `npx tsc --noEmit` | Check TypeScript types |
| `npm run test:practice` | Test recommendations, pattern counts, and browser storage |
| `npm run test:runner` | Test runner validation and worker behavior |
| `npm run test:paid-limit` | Test quota enforcement logic |
| `npm run test:practice-db` | Test live practice APIs and learner isolation |
| `npm run test:paid-limit-db` | Test live PostgreSQL quota behavior |

The three unit-test commands need no provider credentials or running database.
The practice integration test requires a running app connected to a migrated
database and creates learner/session/attempt records. The paid-limit database
test requires a configured migrated database and exercises temporary counter
rows. Use a development or test environment for integration tests.

For UI changes, check affected browser flows and loading/error states. For
Next.js changes, follow `AGENTS.md` and read the relevant framework guides in
`node_modules/next/dist/docs/` before modifying framework code.

## Architecture and project structure

The stack is Next.js 16.4, React 19.3, TypeScript, Monaco, Pyodide, Zod,
node-postgres, Gemini, and ElevenLabs. Browser Python execution is separate from
server-side provider calls and persistence; connected features require a server
runtime.

```text
src/app/
  page.tsx                    Playground, lessons, and workspace state
  MyPractice.tsx              Charts, history, and recommendations
  ErrorLessonCard.tsx         Personalized lesson checks and unlock flow
  ForestArtwork.tsx           Forest artwork and Pip mascot
  api/fix/                    Gemini tutoring endpoint
  api/speak/                  ElevenLabs narration endpoint
  api/practice/               Session, attempt, and history endpoints
src/lib/
  pythonRunner.ts             Pyodide worker and run validation
  lessons.ts                  Reviewed lessons and exercises
  fix-schema.ts               Tutoring request/response validation
  practice-*.ts               Persistence, client/API helpers, recommendations
  mistake-pattern-storage.ts  Browser correction-category persistence
  paidRequestLimit*.ts        Shared quota enforcement
  db.ts                       Server-only PostgreSQL access
public/pyodide/                Bundled Python runtime assets
db/migrations/                Database schema migrations
db/queries/                   Read-only inspection queries
scripts/                      Maintenance and integration tests
docs/                         Research, planning notes, and screenshots
```

## Deployment

Build and serve with `npm run build` followed by `npm start`, or deploy as a
Next.js project on Vercel.

On Vercel, leave **Root Directory** empty to use the repository root. Set server
environment variables in deployment settings; `.env.local` is not uploaded
automatically. Apply migrations from an authorized configured environment
before enabling connected features. Include `public/pyodide` in the deployment
and ensure trusted client-IP headers reach the server. Quota counters use
PostgreSQL; Redis/Upstash is not required.

Set `DATABASE_URL` in Vercel using this format, replacing `PASSWORD` with the
URL-encoded database password:

```text
postgresql://tsdbadmin:PASSWORD@qkocflqner.a9mfea0e1s.tsdb.cloud.timescale.com:37633/tsdb?sslmode=require
```

The password-free Quick connect URL identifies the service but does not supply
application authentication. Add `GEMINI_API_KEY` and, for narration,
`ELEVENLABS_API_KEY` separately. Select the appropriate Vercel environments
and redeploy after saving the variables. Never commit their real values.

## Troubleshooting

| Symptom | What to check |
| --- | --- |
| Python fails to load | Confirm `/pyodide/pyodide.mjs` and matching WASM assets are served; inspect browser network errors. |
| AI tutoring or Listen is unavailable | Check the corresponding server key and restart/redeploy after changing environment settings. |
| Shared quota reached (429) | Correction and narration share an allowance; wait for the next UTC hourly window. |
| Paid features temporarily unavailable (503) | Check database connectivity, migration 003, and trusted IP headers in production or configured database environments. |
| My Practice history is unavailable | Check the database URL, TLS configuration, and migrations; retry pending saves before leaving the page. |
| Fix chart is empty | Complete a Playground correction in this browser. Lesson test failures do not populate the chart. |
| History differs between browsers | Learner identity is cookie-based; fix charts are stored locally in each browser. |

## Contributing

Keep changes focused, describe user-visible behavior, and run relevant checks.
Preserve learner data when changing the schema and add an explicit migration
rather than changing production data during requests. Keep credentials out of
source control and follow `AGENTS.md`.

## License

This project is licensed under the [MIT License](LICENSE).
