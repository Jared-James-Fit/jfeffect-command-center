import { Link } from "@tanstack/react-router";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { cn } from "@/lib/utils";

/** Settings → Chat media: the GIF and sound libraries people pick from in chat. */
export function ChatMediaHeader({ active }: { active: "gifs" | "sounds" }) {
  const pill = (on: boolean) => cn(
    "rounded-full px-4 py-2 text-xs font-semibold transition active:scale-95",
    on ? "bg-foreground text-background" : "bg-secondary/60 text-muted-foreground hover:text-foreground",
  );
  return (
    <>
      <SettingsTabs />
      <div className="px-4 pt-4 sm:px-6">
        <h1 className="text-lg font-black tracking-tight">Chat media</h1>
        <p className="text-xs text-muted-foreground">The GIFs and sounds clients and coaches can send in chat. Add, edit or turn any off anytime.</p>
        <div className="mt-3 flex gap-1.5">
          <Link to="/admin/chat-gifs" replace className={pill(active === "gifs")}>GIFs</Link>
          <Link to="/admin/chat-sounds" replace className={pill(active === "sounds")}>Sounds</Link>
        </div>
      </div>
    </>
  );
}
