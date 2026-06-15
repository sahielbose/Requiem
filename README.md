<div align="center">

# Requiem

### Lay your legacy bash scripts to rest.

**Requiem reads the undocumented bash scripts buried in a repository, reasons about what each one is actually trying to do, and rebuilds them as typed, reviewable workflows with safety gates inserted where they belong.** Open source and AI native, built so a script can never again deploy blind, drop a table with no backup, or report a success that never happened.

<br/>

![License](https://img.shields.io/badge/license-MIT-eab308?style=flat-square)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-node--postgres-336791?style=flat-square&logo=postgresql&logoColor=white)

![Claude](https://img.shields.io/badge/Claude-Sonnet%204.5-d97757?style=flat-square&logo=anthropic&logoColor=white)
![Agents](https://img.shields.io/badge/agents-4%20sequential%20passes-5b2ee5?style=flat-square)
![SuperPlane](https://img.shields.io/badge/SuperPlane-execution-0ea5e9?style=flat-square)
![Fallback](https://img.shields.io/badge/fallback%20mode-no%20API%20keys%20needed-3a3d46?style=flat-square)

<br/>

[The problem](#the-problem) &nbsp;&middot;&nbsp; [What it does](#what-it-does) &nbsp;&middot;&nbsp; [How it works](#how-it-works) &nbsp;&middot;&nbsp; [The agent chain](#the-agent-chain) &nbsp;&middot;&nbsp; [Quickstart](#quickstart) &nbsp;&middot;&nbsp; [Architecture](#architecture)

</div>

---

> Every team keeps a graveyard of bash scripts that quietly run production: deploys, migrations, restarts, on-call pages. They do real work, but they are untyped, unreviewed, and run blind. Requiem reads them, understands their intent, and gives them a second life as workflows you can read, gate, and trust.

## The problem

Engineering orgs accumulate hundreds of bash scripts: deploy scripts, runbooks, cron jobs, one-off ops fixes. They restart services, run migrations, snapshot databases, and page on-call, yet they are undocumented, untyped, unreviewed, and run with no checkpoint. The failure modes are specific and expensive:

- A `rm -rf $TMP_DIR/*` wipes the wrong root the moment the variable is unset.
- A `DROP TABLE` runs with no prior backup, so a bad migration is irreversible.
- A Slack message reports "deploy succeeded" unconditionally, so it fires even when the deploy failed and operators trust a status that is a lie.
- A `pm2 restart` touches production with no approval beforehand and no health check after.

Requiem turns each of these scripts into a typed workflow with the safety steps it was always missing, then holds anything destructive for human approval.

## What it does

- **Scan a repository.** Point Requiem at a GitHub repo. It walks the default branch tree, finds every `.sh` file plus shebang scripts under `scripts`, `bin`, `runbooks`, `cron`, `ci`, and `ops`, and pulls their contents.
- **Understand intent, not syntax.** The Migration Agent reads each script and reasons about what it is trying to do, then emits a typed spec: an ordered list of steps, each classified as `command`, `deploy`, `db_migration`, `health_check`, `notification`, `approval_gate`, or `backup`.
- **Find what can break or lie.** The Danger-Audit Agent flags destructive operations with no backup, production changes with no approval gate, notifications that fire unconditionally and report a falsehood, and missing error handling. It rates each finding `critical`, `warning`, or `info`, and injects the safety steps the script lacked.
- **Double-check the safety net.** The Reviewer Agent runs a self-critique pass over the merged workflow and verifies the invariants hold: every deploy and migration is gated, every notification is preceded by a health check, every migration is preceded by a backup. It patches any remaining gap.
- **Diagnose the incident.** When a script carries a critical danger, the Incident Agent writes an operator-facing diagnosis and a concrete proposed fix that references the new safety steps by number, then waits for human approval.
- **Run it for real.** Approved workflows are pushed to SuperPlane for execution, and Requiem records the step-by-step run history.
- **Works without keys.** Every agent has a deterministic fallback. With no `ANTHROPIC_API_KEY`, the full pipeline still runs on rule-based analysis, so the product is always demonstrable.

## How it works

1. **Scan.** Give Requiem a repo URL. The GitHub scanner collects the bash scripts.
2. **Migrate and audit.** A background worker runs each script through the agent chain, then merges the injected safety steps into the workflow at the correct positions.
3. **Review and gate.** Critical findings become incidents that wait for human approval. Nothing destructive runs unattended.
4. **Execute.** Approved workflows go to SuperPlane, and every step result is logged back into the dashboard.

## The agent chain

A prompt-and-schema pipeline turns one raw script into a safe, runnable workflow:

```
bash script
  ->  Migration Agent      typed WorkflowStep[] + summary
  ->  Danger-Audit Agent   DangerFlag[] + injected backup / approval_gate / health_check
  ->  Reviewer Agent       self-critique pass, patches any remaining safety gap
  ->  Incident Agent       diagnosis + proposed fix for every critical danger
  ->  SuperPlane           execution + run history
```

| Agent | Transforms | Responsibility |
| --- | --- | --- |
| Migration | raw bash to typed workflow steps | Reads intent and classifies every step |
| Danger-Audit | script and workflow to flags and safety steps | Finds destructive ops, lies, and missing gates |
| Reviewer | merged workflow to patched workflow | Verifies the safety invariants hold end to end |
| Incident | critical flags to diagnosis and fix | Turns danger into an actionable, approval-gated incident |

Each agent owns a Claude prompt, a LangChain chain, a strict JSON output schema with validation, a deterministic fallback, and audit logging. The fallback is not a stub: it is a real regex-rule engine that produces the same shape of output, so a missing key or a model timeout never breaks the run.

## Safety model

- **Approval gates.** Production-affecting steps such as deploys, restarts, and destructive SQL pause for explicit human approval before they run.
- **Backups before destruction.** A backup step is inserted ahead of any `DROP`, `TRUNCATE`, destructive `DELETE`, or `FLUSHDB`, so a bad change stays recoverable.
- **No status that lies.** A health check is inserted before any notification, so a message reflects reality instead of firing unconditionally.
- **Full audit trail.** Every agent action, from migrate and audit to review, incident, and scan boundaries, is written to an append-only audit log.
- **Idempotent re-scans.** Re-scanning a script clears its prior migration and dangers first, so the ledger never accumulates stale flags.
- **Always available.** Each agent degrades to a deterministic rule engine when Claude is unavailable, so the pipeline runs with only a Postgres URL.

## Quickstart

Requires Node 20 or newer and a Postgres database.

```bash
npm install

# configure: copy the example and set your values
cp .env.example .env
# DATABASE_URL      Postgres connection string (required)
# ANTHROPIC_API_KEY real Claude agents (falls back to rules without it)
# GITHUB_TOKEN      raises GitHub API limits and reaches private repos
# SUPERPLANE_API_KEY pushes workflows to a live SuperPlane instance

# create the schema
npm run db:migrate

# optional: load sample data
npm run db:seed

# run the app and the background worker in two terminals
npm run dev          # http://localhost:3000
npm run worker       # processes scan jobs through the agent chain
```

Without `ANTHROPIC_API_KEY` the agents run in deterministic fallback mode, and without `SUPERPLANE_API_KEY` workflows resolve to local execution stubs, so the whole product runs end to end with only a Postgres URL.

## Architecture

A single Next.js application with a separate background worker for the agent pipeline.

```
src/
  agents/            four sequential Claude passes, each with a deterministic fallback
    migration-agent.ts      raw bash -> typed workflow steps
    danger-audit-agent.ts   safety conscience: flags + injected gates
    reviewer-agent.ts       self-critique pass over the merged workflow
    incident-agent.ts       operator diagnosis + proposed fix
  app/               Next.js App Router: dashboard UI + API route handlers
    api/             scan, overview, migrations, incidents, executions, export
  components/        dashboard shell and tab views
    tabs/            Overview, Scan, Migrations, Incidents, Executions, Audit
  lib/
    github/          repo scanner: finds .sh and shebang scripts on the default branch
    superplane/      workflow execution client (live or local stub)
    db/              Postgres schema, migrations, typed queries, seed
  worker/            background job runner for the agent pipeline
```

## Dashboard

Six tabs over the same ledger:

- **Overview.** Fleet-level risk: scripts scanned, critical and warning dangers, the most common danger pattern, the share of scripts that needed safety gates injected, and incidents awaiting approval.
- **Scan.** Enter a repo URL and watch the agent pipeline run live, script by script.
- **Migrations.** The generated workflows, step by step, with injected safety steps highlighted.
- **Incidents.** Critical findings as diagnoses with proposed fixes, each with an approve action.
- **Executions.** SuperPlane run history, per step, with status and duration.
- **Audit log.** The append-only record of every agent action.

## API

| Method and route | Purpose |
| --- | --- |
| `POST /api/scan` | Start a scan job for a repo URL |
| `GET /api/scan/status` | Poll job progress |
| `GET /api/overview` | Fleet-level risk stats |
| `GET /api/migrations` | Generated workflows |
| `GET, POST /api/incidents` | List or raise incidents |
| `POST /api/incidents/approve` | Approve a proposed fix |
| `GET /api/executions` | Execution history |
| `GET /api/export` | Export the ledger |

## Tech stack

Next.js 15 (App Router) and React 19, TypeScript, Tailwind CSS, LangChain with Anthropic Claude (Sonnet 4.5), Postgres through node-postgres, the GitHub REST API through Octokit, and SuperPlane as the workflow execution backend.

## Team

Built as a hackathon project by Sahiel Bose and Shanay Gaitonde, with SuperPlane as the workflow execution partner.

## License

[MIT](./LICENSE), Copyright (c) 2026 Sahiel Bose and Shanay Gaitonde.
