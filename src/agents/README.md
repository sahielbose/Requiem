# Agents

Three sequential Claude passes. Each agent owns prompt + LangChain chain + JSON output schema + fallback + audit logging.

1. `migration.ts` — Shanay — script -> WorkflowStep[]
2. `dangerAudit.ts` — Sahiel — script + migration -> DangerFlag[] + safety additions
3. `incident.ts` — Pranav — alert + workflow -> diagnosis + proposed fix
