import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { MessageCircle, Search, ArrowLeft } from "lucide-react";
import { NUTRITION_FAQS, NUTRITION_RESOURCES } from "@/content/nutrition-help";

export function NutritionHelpSheet({
  open,
  onOpenChange,
  viewer,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  viewer: "member" | "client";
}) {
  const [q, setQ] = useState("");
  const ql = q.trim().toLowerCase();
  const faqs = useMemo(
    () => (ql ? NUTRITION_FAQS.filter((f) => f.q.toLowerCase().includes(ql) || f.a.toLowerCase().includes(ql)) : NUTRITION_FAQS),
    [ql],
  );
  const resources = useMemo(
    () => (ql ? NUTRITION_RESOURCES.filter((r) => r.title.toLowerCase().includes(ql) || r.bullets.some((b) => b.toLowerCase().includes(ql))) : NUTRITION_RESOURCES),
    [ql],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-0" hideCloseButton>
        <div className="sticky top-0 z-10 bg-background border-b">
          <SheetHeader className="p-4">
            <div className="flex items-center gap-3">
              <SheetClose
                aria-label="Back"
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-background hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ArrowLeft className="h-4 w-4" />
              </SheetClose>
              <div className="min-w-0 flex-1 text-left">
                <SheetTitle>Nutrition Help</SheetTitle>
                <SheetDescription>Answers to the common questions, and short guides.</SheetDescription>
              </div>
            </div>
          </SheetHeader>
          <div className="px-4 pb-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search help…"
                className="pl-9"
                inputMode="search"
              />
            </div>
          </div>
        </div>

        <div className="p-4 pb-24 space-y-4">
          <Tabs defaultValue="faq">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="faq">FAQs ({faqs.length})</TabsTrigger>
              <TabsTrigger value="resources">Resources ({resources.length})</TabsTrigger>
            </TabsList>
            <TabsContent value="faq" className="mt-4">
              {faqs.length === 0 ? (
                <div className="text-sm text-muted-foreground p-4 text-center">No FAQs match your search.</div>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {faqs.map((f, i) => (
                    <AccordionItem key={i} value={`faq-${i}`}>
                      <AccordionTrigger className="text-left text-sm font-semibold">{f.q}</AccordionTrigger>
                      <AccordionContent className="text-sm text-muted-foreground">{f.a}</AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </TabsContent>
            <TabsContent value="resources" className="mt-4">
              {resources.length === 0 ? (
                <div className="text-sm text-muted-foreground p-4 text-center">No resources match your search.</div>
              ) : (
                <Accordion type="single" collapsible className="w-full">
                  {resources.map((r, i) => (
                    <AccordionItem key={i} value={`res-${i}`}>
                      <AccordionTrigger className="text-left text-sm font-semibold">{r.title}</AccordionTrigger>
                      <AccordionContent>
                        <ul className="list-disc pl-5 space-y-1 text-sm text-muted-foreground">
                          {r.bullets.map((b, j) => (
                            <li key={j}>{b}</li>
                          ))}
                        </ul>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              )}
            </TabsContent>
          </Tabs>

          {viewer === "client" && (
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <div className="text-sm font-bold mb-1">Need more help?</div>
              <div className="text-xs text-muted-foreground mb-3">
                Contact your coach with the dates, food logs, or progress info you'd like reviewed.
              </div>
              <Button asChild size="sm" variant="outline" className="h-10 gap-1.5">
                <Link to="/portal/messages" onClick={() => onOpenChange(false)}>
                  <MessageCircle className="h-4 w-4" /> Contact Coach
                </Link>
              </Button>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}