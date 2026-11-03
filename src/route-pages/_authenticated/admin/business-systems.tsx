import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { BookOpen, Workflow, FileText } from "lucide-react";

export function BusinessSystemsRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/team", search: { tab: "operations" } as any, replace: true });
  }, [navigate]);
  return null;
}

const TILES = [
  { to: "/admin/sops", label: "SOPs", desc: "Standard operating procedures.", icon: BookOpen },
  { to: "/admin/automations", label: "Automations", desc: "Workflows & integrations.", icon: Workflow },
  { to: "/admin/programs", label: "Program Templates", desc: "Reusable training templates.", icon: FileText },
] as const;

export function BusinessSystemsHub({ embedded = false }: { embedded?: boolean } = {}) {
  return (
    <>
      {!embedded && <PageHeader title="Business Systems" subtitle="Internal admin & coaching operations." />}
      <div className="grid gap-4 p-6 sm:grid-cols-2 md:p-8">
        {TILES.map((t) => (
          <Link key={t.to} to={t.to}>
            <Card className="group p-6 transition hover:bg-accent">
              <div className="flex items-start gap-4">
                <div className="grid h-10 w-10 place-items-center rounded-lg bg-muted text-foreground">
                  <t.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-semibold">{t.label}</div>
                  <div className="text-sm text-muted-foreground">{t.desc}</div>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}