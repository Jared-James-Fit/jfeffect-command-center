import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { MediaHeader } from "@/components/media/media-header";

export const Route = createFileRoute("/_authenticated/media/templates")({
  component: TemplatesPage,
});

function TemplatesPage() {
  return (
    <div className="mx-auto w-full max-w-5xl p-4 md:p-6">
      <MediaHeader
        title="Templates & Brand Kit"
        description="Reusable content templates, brand colors, fonts, and logos for the team."
      />
      <Card className="p-6">
        <h2 className="text-sm font-semibold">No templates yet</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Save approved scripts, caption blocks, and brand assets here so the team can reuse them.
          Template authoring lands in the next phase.
        </p>
      </Card>
    </div>
  );
}