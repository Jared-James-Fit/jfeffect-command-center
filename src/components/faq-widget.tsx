import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HelpCircle } from "lucide-react";

type Category = "nutrition" | "workouts" | "cardio";

const TITLES: Record<Category, string> = {
  nutrition: "Nutrition FAQ",
  workouts: "Workouts FAQ",
  cardio: "Cardio FAQ",
};

export function FaqWidget({ category }: { category: Category }) {
  const { data: faqs = [] } = useQuery({
    queryKey: ["faqs", category],
    queryFn: async () => {
      const { data } = await supabase
        .from("coach_faqs")
        .select("id, question, answer")
        .eq("category", category)
        .eq("active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      return data ?? [];
    },
  });

  if (!faqs.length) return null;

  return (
    <Card className="border-border bg-card px-4 py-2">
      <Accordion type="single" collapsible>
        <AccordionItem value="faq" className="border-b-0">
          <AccordionTrigger className="py-2 hover:no-underline">
            <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
              <HelpCircle className="h-4 w-4 text-primary" />
              {TITLES[category]}
              <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-foreground/70">{faqs.length}</span>
            </span>
          </AccordionTrigger>
          <AccordionContent>
            <Accordion type="multiple" className="space-y-1">
              {faqs.map((f: any) => (
                <AccordionItem key={f.id} value={f.id} className="rounded-md border border-border bg-secondary/30 px-3">
                  <AccordionTrigger className="py-2 text-left text-sm font-semibold">{f.question}</AccordionTrigger>
                  <AccordionContent>
                    <p className="whitespace-pre-wrap text-sm text-muted-foreground">{f.answer}</p>
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}