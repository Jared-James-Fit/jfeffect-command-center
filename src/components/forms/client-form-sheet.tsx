import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClientFormRenderer } from "@/components/forms/client-form-renderer";

/**
 * Full-screen (mobile) / large drawer (desktop) host for a client form.
 * One tap from Home or Nutrition opens the exact form here — no middle
 * "Check-ins & Forms" page, and the sheet's built-in Back pill closes it.
 */
export function ClientFormSheet({
  formId,
  title,
  open,
  onOpenChange,
}: {
  formId: string | null;
  title?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        safeTopClose
        className="h-[95vh] overflow-y-auto rounded-t-2xl p-4 md:p-6"
        style={{ paddingTop: "calc(max(env(safe-area-inset-top) - 5vh, 0px) + 4rem)" }}
      >
        <SheetHeader className="mb-3 text-left">
          <SheetTitle className="text-base font-black uppercase tracking-widest">
            {title || "Form"}
          </SheetTitle>
        </SheetHeader>
        {formId && open && (
          <ClientFormRenderer formId={formId} embedded onClose={() => onOpenChange(false)} />
        )}
      </SheetContent>
    </Sheet>
  );
}
