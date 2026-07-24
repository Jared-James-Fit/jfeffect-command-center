import { useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Download, Share2 } from "lucide-react";
import {
  renderShareCard, downloadCanvas, shareCanvas,
  type ShareCardData, type ShareFormat, type ShareTheme,
} from "./share-card";

export function ShareSheet({
  open,
  onOpenChange,
  data,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ShareCardData | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [format, setFormat] = useState<ShareFormat>("portrait");
  const [theme, setTheme] = useState<ShareTheme>("dark");

  useEffect(() => {
    if (!open || !data || !canvasRef.current) return;
    renderShareCard(canvasRef.current, data, format, theme);
  }, [open, data, format, theme]);

  const filename = data ? `jf-${slug(data.headline)}-${format}.png` : "jf-effect.png";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh]">
        <SheetHeader>
          <SheetTitle>Share insight</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 overflow-y-auto pb-8">
          <div className="flex flex-wrap items-center gap-2">
            <ToggleGroup
              type="single"
              value={format}
              onValueChange={(v) => v && setFormat(v as ShareFormat)}
              className="rounded-full bg-muted p-1"
            >
              <ToggleGroupItem value="portrait" className="rounded-full px-3 py-1 text-xs data-[state=on]:bg-background">Story</ToggleGroupItem>
              <ToggleGroupItem value="square" className="rounded-full px-3 py-1 text-xs data-[state=on]:bg-background">Post</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              value={theme}
              onValueChange={(v) => v && setTheme(v as ShareTheme)}
              className="rounded-full bg-muted p-1"
            >
              <ToggleGroupItem value="dark" className="rounded-full px-3 py-1 text-xs data-[state=on]:bg-background">Dark</ToggleGroupItem>
              <ToggleGroupItem value="light" className="rounded-full px-3 py-1 text-xs data-[state=on]:bg-background">Light</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex justify-center">
            <div
              className="overflow-hidden rounded-2xl border border-border/60 bg-muted/40"
              style={{ width: format === "portrait" ? 270 : 320, height: format === "portrait" ? 480 : 320 }}
            >
              <canvas ref={canvasRef} className="h-full w-full" style={{ display: "block" }} />
            </div>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              onClick={() => canvasRef.current && shareCanvas(canvasRef.current, filename, data?.headline ?? "JF Effect")}
              className="gap-2"
            >
              <Share2 className="h-4 w-4" /> Share
            </Button>
            <Button
              variant="outline"
              onClick={() => canvasRef.current && downloadCanvas(canvasRef.current, filename)}
              className="gap-2"
            >
              <Download className="h-4 w-4" /> Save image
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "insight";
}