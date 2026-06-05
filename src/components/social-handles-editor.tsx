import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOCIAL_PLATFORMS } from "@/lib/social-handles";

export function SocialHandlesEditor({
  values,
  onChange,
  disabled,
}: {
  values: Record<string, any>;
  onChange: (field: string, value: string | null) => void;
  disabled?: boolean;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {SOCIAL_PLATFORMS.map((p) => {
        const isOther = p.key === "other";
        const Icon = p.icon;
        return (
          <div key={p.key} className={isOther ? "md:col-span-2 grid gap-2 md:grid-cols-[1fr_2fr]" : ""}>
            {isOther && (
              <div>
                <Label className="text-[11px]">Other label</Label>
                <Input
                  disabled={disabled}
                  value={values.other_social_label ?? ""}
                  onChange={(e) => onChange("other_social_label", e.target.value || null)}
                  placeholder="e.g. Threads, Snapchat…"
                />
              </div>
            )}
            <div>
              <Label className="flex items-center gap-1.5 text-[11px]">
                <Icon className="h-3.5 w-3.5" />
                {p.label}
              </Label>
              <Input
                disabled={disabled}
                value={values[p.field] ?? ""}
                onChange={(e) => onChange(p.field, e.target.value || null)}
                placeholder={p.placeholder}
                autoComplete="off"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}