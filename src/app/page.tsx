"use client";

import { useState } from "react";
import { TopNav } from "@/components/TopNav";
import { ScanTab } from "@/components/tabs/ScanTab";
import { MigrationsTab } from "@/components/tabs/MigrationsTab";
import { IncidentsTab } from "@/components/tabs/IncidentsTab";
import { ExecutionsTab } from "@/components/tabs/ExecutionsTab";
import type { TabKey } from "@/components/tabs/types";

export default function Home() {
  const [tab, setTab] = useState<TabKey>("scan");

  return (
    <div className="min-h-screen">
      <TopNav active={tab} onChange={setTab} />
      <main className="mx-auto max-w-6xl px-6 py-8">
        {tab === "scan" && <ScanTab />}
        {tab === "migrations" && <MigrationsTab />}
        {tab === "incidents" && <IncidentsTab />}
        {tab === "executions" && <ExecutionsTab />}
      </main>
    </div>
  );
}
