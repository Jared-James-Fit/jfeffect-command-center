import { Construction } from "lucide-react";
import { PageHeader } from "./app-shell";

export function ComingSoon({ title, phase = "Phase 2" }: { title: string; phase?: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={`${phase} — coming next`} />
      <div className="grid place-items-center p-12">
        <div className="max-w-md rounded-xl border border-dashed border-border bg-card/50 p-10 text-center">
          <Construction className="mx-auto h-10 w-10 text-primary" />
          <h2 className="mt-4 text-lg font-bold">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This section is part of <span className="font-semibold text-foreground">{phase}</span> of the JF Effect command center build. The structure, data tables and access control are already wired up — the screen will light up once we build it out.
          </p>
        </div>
      </div>
    </>
  );
}