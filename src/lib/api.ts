import type {
  BashScript,
  ExecutionRecord,
  Incident,
  MigrationResult,
  DangerFlag,
} from "./types";
import {
  mockScripts,
  mockMigrations,
  mockDangers,
  mockIncidents,
  mockExecutions,
} from "./mockData";

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function scanRepo(url: string): Promise<BashScript[]> {
  await delay(400);
  return mockScripts.map((s) => ({ ...s, repoUrl: url || s.repoUrl }));
}

export async function getMigrations(): Promise<{
  migrations: MigrationResult[];
  dangers: DangerFlag[];
  scripts: BashScript[];
}> {
  await delay(200);
  return {
    migrations: mockMigrations,
    dangers: mockDangers,
    scripts: mockScripts,
  };
}

export async function getIncidents(): Promise<Incident[]> {
  await delay(200);
  return mockIncidents;
}

export async function approveIncident(
  id: string,
  approver: string
): Promise<Incident> {
  await delay(300);
  const found = mockIncidents.find((i) => i.id === id);
  if (!found) throw new Error(`incident ${id} not found`);
  return {
    ...found,
    status: "running",
    approvedBy: approver,
    approvedAt: new Date().toISOString(),
  };
}

export async function getExecutions(): Promise<ExecutionRecord[]> {
  await delay(200);
  return mockExecutions;
}
