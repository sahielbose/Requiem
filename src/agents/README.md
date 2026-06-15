# Agents

Four sequential Claude passes. Each agent owns its prompt, its LangChain chain, a strict JSON output schema, a deterministic fallback, and audit logging.

| Order | Agent | Owner | Transforms |
| --- | --- | --- | --- |
| 1 | `migration-agent.ts` | Shanay | script to `WorkflowStep[]` |
| 2 | `danger-audit-agent.ts` | Sahiel | script and migration to `DangerFlag[]` plus safety additions |
| 3 | `reviewer-agent.ts` | Sahiel | merged workflow to a patched, gap-free workflow |
| 4 | `incident-agent.ts` | Shanay | alert and workflow to diagnosis plus proposed fix |
