import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Star, Lightbulb, BookOpen, Workflow, FileText } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/business-systems")({
  component: BusinessSystemsHub,
});

const TILES = [
  { to: "/admin/testimonials", label: "Testimonials", desc: "Client wins & transformations.", icon: Star },
  { to: "/admin/content-ideas", label: "Content Ideas", desc: "Reels, posts, talking points.", icon: Lightbulb },
  { to: "/admin/sops", label: "SOPs", desc: "Standard operating procedures.", icon: BookOpen },
  { to: "/admin/automations", label: "Automations", desc: "Workflows & integrations.", icon: Workflow },
  { to: "/admin/programs", label: "Program Templates", desc: "Reusable training templates.", icon: FileText },
] as const;

function BusinessSystemsHub() {
  return (
    <>
      <PageHeader title="Business Systems" subtitle="Internal admin & coaching operations." />
      <div className="grid gap-4 p-6 sm:grid-cols-2 md:p-8">
        {TILES.map((t) => (
          <Link key={t.to} to={t.to}>
            <Card className="group border-border bg-card p-6 transition hover:border-primary hover:bg-secondary/40">
              <div className="flex items-start gap-4">
                <div className="grid h-10 w-10 place-items-center rounded-md bg-gradient-primary text-primary-foreground">
                  <t.icon className="h-5 w-5" />
                </div>
                <div>
                  <div className="text-base font-bold">{t.label}</div>
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