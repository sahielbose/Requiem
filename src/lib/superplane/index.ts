// SuperPlane integration. Push generated workflows + pull execution history.
// Stubbed behind this interface; real endpoints wired on-site with SuperPlane mentors.

import type { ExecutionRecord, WorkflowStep } from "../types";

export interface SuperPlaneClient {
  pushWorkflow(workflowId: string, steps: WorkflowStep[]): Promise<{ url: string }>;
  fetchExecutions(workflowId: string): Promise<ExecutionRecord[]>;
}
