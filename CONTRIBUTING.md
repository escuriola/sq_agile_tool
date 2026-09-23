# Contributing

Thanks for taking a look. This started as a tool one Scrum Master built to run their own sprints,
so a lot of it reflects one team's way of working. If something does not fit yours, that is worth
an issue — it is usually a sign the thing should be configurable.

## Getting set up

```bash
make demo
```

That gives you a running instance on port 5190 with sample data, on its own database. It is the
fastest way to see what a change looks like against a board that is already full.

For actually writing code, run the services outside Docker so you get hot reload:

```bash
docker compose up -d db                  # database only, on port 5433
cd api && npm install && npm run dev     # API on 4000, watched by tsx
cd web && npm install && npm run dev     # Vite on 5173, proxies /api to the API
```

To work against the sample data instead of an empty database:

```bash
docker compose exec -T db psql -U agile -d agile < api/seed/demo.sql
```

## How the pieces fit

- **`api/src/migrations/`** is the schema. It is a list of numbered `.sql` files applied in order
  at startup and recorded in `_migrations`. To change the database, add the next number — never
  edit a migration that has already shipped, because existing installs will not re-run it.
- **`api/src/routes/metrics.ts`** is where every number in the Metrics tab and in the generated
  report is computed, in `computeMetrics()`. The report in `report.ts` consumes that same function,
  so a metric added there shows up in both.
- **`web/src/lib/types.ts`** holds the shared shapes and the status/track/type metadata (labels and
  colours) used across the interface.
- **`web/src/lib/csv.ts`** recognises Jira export columns. It carries candidate names in both
  English and Spanish, because Jira exports in the user's language.

## Before opening a pull request

There is no test suite yet — that is the most useful contribution anyone could make. In the
meantime, please check by hand:

1. `make demo-down && make demo` starts cleanly from an empty database. This is the real check that
   migrations apply in order on a fresh install.
2. The tab you touched still renders with the sample data, with no errors in the browser console.
3. `cd api && npx tsc --noEmit` and `cd web && npx tsc --noEmit` are clean.

If the change affects what the user sees, say so in the PR and include a screenshot. If it adds a
migration, say what it does to existing data.

## Things to keep in mind

- **Hours are never rounded.** Jira worklogs arrive as recurring fractions (3.3333 h is 3h 20m) and
  rounding them to quarter hours falsifies the time spent in one direction or the other. Format
  hours for display with `hoursToHm()`; do not round the stored value.
- **Imports must be idempotent.** Re-importing the same CSV must not create a second copy of a
  worklog. Entries carry the Jira worklog id in `external_id`, and editing a task reconciles its
  logged entries by id rather than deleting and recreating them. Breaking that silently duplicates
  people's hours.
- **Every importer has a dry run.** Show what would change before changing it.
- **Blocked is a flag, not a status.** A blocked task keeps its place in the flow.
- **Do not commit data.** `backups/` and `*.csv` are git-ignored on purpose: dumps and Jira exports
  contain real names, ticket keys and sprint goals.

## Language

The interface, reports and API messages are in English. Code comments are in Spanish, which is the
author's working language. New comments in either language are fine — a pull request will not be
rejected over it.
