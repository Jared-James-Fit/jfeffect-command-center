import { Toaster as Sonner } from "sonner";
import { AlertCircle, AlertTriangle, Check, Info, Loader2 } from "lucide-react";
import { installToastSystem } from "@/lib/toast-system";

installToastSystem();

type ToasterProps = React.ComponentProps<typeof Sonner>;

const TOP = "calc(env(safe-area-inset-top, 0px) + var(--ios-edge-room, 0px) + 56px)";

/**
 * The app's one toaster: a compact floating pill, top centre under the status
 * bar (clear of the keyboard, the tab bar and the content). Look: `.toaster`
 * rules in styles.css. Behaviour (one at a time, dedupe, timing): toast-system.ts.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      position="top-center"
      visibleToasts={1}
      gap={8}
      offset={{ top: TOP }}
      mobileOffset={{ top: TOP, left: "16px", right: "16px" }}
      icons={{
        success: <Check className="size-4 text-emerald-500" strokeWidth={2.75} />,
        error: <AlertCircle className="size-4 text-red-500" strokeWidth={2.5} />,
        warning: <AlertTriangle className="size-4 text-amber-500" strokeWidth={2.5} />,
        info: <Info className="size-4 text-muted-foreground" strokeWidth={2.5} />,
        loading: <Loader2 className="size-4 animate-spin text-muted-foreground" />,
      }}
      toastOptions={{ unstyled: false, classNames: { toast: "jf-toast", title: "jf-toast-title", description: "jf-toast-desc", actionButton: "jf-toast-action", cancelButton: "jf-toast-cancel", icon: "jf-toast-icon" } }}
      {...props}
    />
  );
};

export { Toaster };
