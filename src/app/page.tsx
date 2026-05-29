"use client";

import { useState } from "react";
import { TopNav } from "@/components/TopNav";
import { OverviewTab } from "@/components/tabs/OverviewTab";
import { ScanTab } from "@/components/tabs/ScanTab";
import { MigrationsTab } from "@/components/tabs/MigrationsTab";
import { IncidentsTab } from "@/components/tabs/IncidentsTab";
import { ExecutionsTab } from "@/components/tabs/ExecutionsTab";
import { AuditTab } from "@/components/tabs/AuditTab";
import type { TabKey } from "@/components/tabs/types";

export default function Home() {
  const [tab, setTab] = useState<TabKey>("overview");

  return (
    <div className="min-h-screen">
      <TopNav active={tab} onChange={setTab} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        {tab === "overview" && <OverviewTab />}
        {tab === "scan" && <ScanTab />}
        {tab === "migrations" && <MigrationsTab />}
        {tab === "incidents" && <IncidentsTab />}
        {tab === "executions" && <ExecutionsTab />}
        {tab === "audit" && <AuditTab />}
      </main>
    </div>
  );
}
