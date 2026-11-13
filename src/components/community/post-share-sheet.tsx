import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Bookmark, Check, CircleFadingPlus, Instagram, Link2, Loader2, Mail, MessageCircle, Search, Share, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { UserAvatar } from "@/components/user-avatar";
import { BrandGlyph, type BrandMark } from "@/components/community/share-app-icons";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useVisualViewportBox } from "@/hooks/use-touch-viewport";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/instagram-export";
import { isIos } from "@/lib/push/push-client";
import { useSavePost } from "@/lib/community-saves";
import { useSharePost, useShareTargets } from "@/lib/post-share.queries";
import {
  SHARE_APP_LABEL,
  SHARE_SEND_MAX,
  filterTargets,
  mergeTargets,
  opensInNewTab,
  postLink,
  postShareText,
  sendLabel,
  shareAppHref,
  shareAppsFor,
  shareErrorText,
  shareOutcome,
  targetSubtitle,
  toggleTarget,
  type ShareApp,
  type SharePlatform,
  type ShareTarget,
} from "@/lib/post-share";
import type { CommunityPost } from "@/lib/community";

const SELECTED = "bg-[#0095F6]";

const buzz = (ms: number) => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* no haptics here */
  }
};

function platformNow(): SharePlatform {
  if (typeof navigator === "undefined") return "desktop";
  if (isIos()) return "ios";
  if (/Android/i.test(navigator.userAgent || "")) return "android";
  return "desktop";
}

/** Each app on its own colour, the way Instagram's row draws them. */
const APP_LOOK: Record<ShareApp, { tone: string; mark?: BrandMark; icon?: ReactNode }> = {
  messages: { tone: "bg-[#34C759] text-white", icon: <MessageCircle className="h-7 w-7 fill-current" strokeWidth={0} /> },
  whatsapp: { tone: "bg-[#25D366] text-white", mark: "whatsapp" },
  snapchat: { tone: "bg-[#FFFC00] text-black", mark: "snapchat" },
  messenger: { tone: "bg-[#0866FF] text-white", mark: "messenger" },
  facebook: { tone: "bg-[#0866FF] text-white", mark: "facebook" },
  x: { tone: "bg-foreground text-background", mark: "x" },
  threads: { tone: "bg-foreground text-background", mark: "threads" },
  email: { tone: "bg-muted text-foreground", icon: <Mail className="h-6 w-6" /> },
};

/**
 * Instagram's share sheet (a post's ✈️). Search, then the people (and group
 * chats, and your coach chat) you're most likely to send it to, best guess
 * first (community_share_targets); tap one or several, add a message, Send.
 * With nobody picked, the row underneath is every other way out: Add to
 * story, Copy link, Save, Messages, Share to…, WhatsApp, Snapchat,
 * Messenger, Facebook, X, Threads, Email (and Instagram for a coach). In
 * View as client nothing sends (it would go as the coach).
 */
export function PostShareSheet({ post, open, onOpenChange, onStory, onInstagram }: {
  post: CommunityPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStory?: () => void;
  onInstagram?: () => void;
}) {
  const navigate = useNavigate();
  const { role } = useAuth();
  const { isImpersonating } = useClientImpersonation();
  const canSend = !isImpersonating;
  const staff = role === "admin" || role === "coach";
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const send = useSharePost();
  const save = useSavePost();
  const view = useVisualViewportBox(open);
  const known = useRef(new Map<string, ShareTarget>());
  const [platform, setPlatform] = useState<SharePlatform>("desktop");
  const [canNative, setCanNative] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPlatform(platformNow());
    setCanNative(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, [open]);

  // a search goes to the server a beat after the last key
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(q.trim()), 220);
    return () => window.clearTimeout(t);
  }, [q]);

  // closed: next time starts clean
  useEffect(() => {
    if (open) return;
    setQ("");
    setSearch("");
    setPicked([]);
    setBody("");
  }, [open]);

  const base = useShareTargets(post.id, "", open && canSend);
  const found = useShareTargets(post.id, search, open && canSend && !!search);
  for (const t of [...(base.data ?? []), ...(found.data ?? [])]) known.current.set(t.key, t);

  const faces = useMemo(() => {
    const ranked = base.data ?? [];
    if (q.trim()) return mergeTargets(filterTargets(ranked, q), found.data ?? []);
    // anyone picked from a search stays in front
    const extra = picked.map((k) => known.current.get(k)).filter((t): t is ShareTarget => !!t && !ranked.some((r) => r.key === t.key));
    return [...extra, ...ranked];
  }, [base.data, found.data, q, picked]);

  const link = postLink(post.id);
  const text = postShareText(post);
  const apps = shareAppsFor(platform, canNative);
  const lift = view?.keyboard ? Math.max(0, window.innerHeight - view.top - view.height) : 0;
  const maxH = view ? Math.max(320, view.height - 24) : undefined;
  const loading = canSend && base.isLoading;
  const searching = !!q.trim() && found.isFetching && !faces.length;

  const close = () => onOpenChange(false);
  const pick = (key: string) => {
    if (!picked.includes(key) && picked.length >= SHARE_SEND_MAX) {
      toast(`You can send it to up to ${SHARE_SEND_MAX} at a time`);
      return;
    }
    buzz(6);
    setPicked((p) => toggleTarget(p, key));
    // picking from a search: back to everyone, the new face kept in front
    if (q.trim() && !picked.includes(key)) setQ("");
  };

  const openChat = (r: { route?: string; group_id?: string; client_id?: string }) => {
    if (r.route === "client" && r.client_id) navigate({ to: "/admin/messages", search: { client: r.client_id } as any });
    else if (r.route === "coach") navigate({ to: "/portal/messages" });
    else if ((r.route === "direct" || r.route === "group") && r.group_id && !staff)
      navigate({ to: "/portal/messages", search: { tab: "groups" } as any, hash: `group=${r.group_id}` });
  };

  const submit = () => {
    if (!picked.length || send.isPending) return;
    send.mutate(
      { postId: post.id, to: picked, body: body.trim() },
      {
        onSuccess: (results) => {
          const all = [...known.current.values()];
          const o = shareOutcome(results, all);
          if (o.message) {
            const only = o.sent.length === 1 ? o.sent[0] : null;
            const canOpen = !!only && (only.route === "coach" || only.route === "client" || (!staff && !!only.group_id));
            toast.success(o.message, canOpen ? { action: { label: "Open chat", onClick: () => openChat(only!) } } : undefined);
          }
          if (o.error) toast.error(o.error);
          if (o.sent.length) close();
          else setPicked(o.failed.map((f) => f.key).filter((k) => picked.includes(k)));
        },
        onError: (e: any) => toast.error(shareErrorText(e?.message)),
      },
    );
  };

  const copyLink = () => {
    void copyText(link).then((ok) => toast(ok ? "Link copied" : "Couldn't copy the link. Try again."));
    close();
  };
  const nativeShare = () => {
    if (typeof navigator.share !== "function") return copyLink();
    navigator.share({ title: "JF Effect", text, url: link }).catch((e: any) => {
      if (e?.name !== "AbortError") void copyText(link).then((ok) => ok && toast("Link copied"));
    });
    close();
  };
  const toggleSave = () => {
    const on = !post.saved;
    save.mutate(
      { post, on },
      {
        onError: (e: any) => toast.error(e?.message ?? "That didn't work. Try again."),
        onSuccess: () =>
          toast(on ? "Saved" : "Removed from Saved", {
            description: on ? "Only you can see what you save. Find it on your profile." : undefined,
            action: { label: "Undo", onClick: () => save.mutate({ post, on: !on }) },
          }),
      },
    );
    close();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="mx-auto flex h-[min(82svh,760px)] max-w-lg flex-col gap-0 rounded-t-[24px] p-0"
        style={{ bottom: lift, ...(maxH ? { maxHeight: maxH } : {}) }}
        onOpenAutoFocus={(e) => e.preventDefault()}
        data-post-share-sheet
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" aria-hidden />
        <SheetTitle className="sr-only">Share</SheetTitle>
        <SheetDescription className="sr-only">Send this post to people in the crew, or share its link</SheetDescription>

        {canSend && (
          <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-muted px-4 text-muted-foreground">
              <Search className="h-[18px] w-[18px] shrink-0" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value.slice(0, 40))}
                placeholder="Search"
                enterKeyHint="search"
                autoCapitalize="none"
                autoCorrect="off"
                className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground"
                aria-label="Search people to send it to"
                data-share-search
              />
              {q && (
                <button type="button" onClick={() => setQ("")} className="grid h-6 w-6 place-items-center rounded-full bg-muted-foreground/25 text-background" aria-label="Clear search">
                  <X className="h-3.5 w-3.5" strokeWidth={3} />
                </button>
              )}
            </label>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3" data-share-faces>
          {!canSend ? (
            <p className="px-6 pt-8 text-center text-[14px] text-muted-foreground">
              Sending is off while you're viewing as a client. Copy the link or share it below.
            </p>
          ) : loading ? (
            <FaceSkeleton />
          ) : faces.length ? (
            <div className="grid grid-cols-3 gap-x-1 gap-y-4 pt-2">
              {faces.map((t) => (
                <FaceButton key={t.key} target={t} on={picked.includes(t.key)} onTap={() => pick(t.key)} />
              ))}
            </div>
          ) : searching ? (
            <div className="grid place-items-center pt-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <p className="px-6 pt-8 text-center text-[14px] text-muted-foreground">
              {q.trim() ? `Nobody matching "${q.trim()}" can get this post.` : "Nobody to send this to yet. Copy the link or share it below."}
            </p>
          )}
        </div>

        <div className="shrink-0 border-t border-border pb-[max(env(safe-area-inset-bottom),12px)]">
          {picked.length ? (
            <div className="space-y-2.5 px-4 pt-3" data-share-compose>
              <AutoGrowTextarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 2000))}
                placeholder="Write a message…"
                enterKeyHint="enter"
                className="min-h-11 max-h-32 w-full resize-none rounded-[22px] border-0 bg-muted px-4 py-[11px] text-base leading-5 focus-visible:ring-0"
                data-share-message
              />
              <Button type="button" onClick={submit} disabled={send.isPending} className="h-12 w-full rounded-xl text-[15px] font-semibold" data-share-send>
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : sendLabel(picked.length)}
              </Button>
            </div>
          ) : (
            <div className="flex gap-1 overflow-x-auto overscroll-x-contain px-3 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-share-apps>
              {onStory && (
                <AppTile label="Add to story" option="story" onClick={() => { close(); onStory(); }}>
                  <span className="grid h-full w-full place-items-center rounded-full bg-muted text-foreground"><CircleFadingPlus className="h-7 w-7" /></span>
                </AppTile>
              )}
              <AppTile label="Copy link" option="copy" onClick={copyLink}>
                <span className="grid h-full w-full place-items-center rounded-full bg-muted text-foreground"><Link2 className="h-6 w-6 -rotate-45" /></span>
              </AppTile>
              {canSend && (
                <AppTile label={post.saved ? "Saved" : "Save"} option="save" onClick={toggleSave}>
                  <span className="grid h-full w-full place-items-center rounded-full bg-muted text-foreground">
                    <Bookmark className={cn("h-6 w-6", post.saved && "fill-current")} />
                  </span>
                </AppTile>
              )}
              {apps.slice(0, apps[0] === "messages" ? 1 : 0).map((app) => (
                <AppLink key={app} app={app} href={shareAppHref(app, link, text, platform)} onNative={nativeShare} onDone={close} />
              ))}
              {canNative && (
                <AppTile label="Share to…" option="native" onClick={nativeShare}>
                  <span className="grid h-full w-full place-items-center rounded-full bg-muted text-foreground"><Share className="h-6 w-6" /></span>
                </AppTile>
              )}
              {apps.filter((a) => a !== "messages").map((app) => (
                <AppLink key={app} app={app} href={shareAppHref(app, link, text, platform)} onNative={nativeShare} onDone={close} />
              ))}
              {onInstagram && (
                <AppTile label="Instagram" option="instagram" onClick={() => { close(); onInstagram(); }}>
                  <span className="grid h-full w-full place-items-center rounded-full bg-[radial-gradient(circle_at_30%_107%,#fdf497_0%,#fdf497_5%,#fd5949_45%,#d6249f_60%,#285AEB_90%)] text-white">
                    <Instagram className="h-6 w-6" strokeWidth={2.2} />
                  </span>
                </AppTile>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** A face in the grid: the photo (two for a group), the name under it, a check once picked. */
function FaceButton({ target, on, onTap }: { target: ShareTarget; on: boolean; onTap: () => void }) {
  const sub = targetSubtitle(target);
  const group = target.kind === "group";
  const faces = (target.faces ?? []).slice(0, 2);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-pressed={on}
      aria-label={`${on ? "Picked: " : ""}${target.name}${sub ? `, ${sub}` : ""}`}
      className="flex min-w-0 flex-col items-center gap-1.5 rounded-2xl px-1 py-1 text-center [touch-action:manipulation] active:scale-95"
      data-share-face={target.kind}
    >
      <span className="relative h-[76px] w-[76px] shrink-0">
        {group ? (
          <span className="relative block h-full w-full">
            <span className="absolute left-0 top-0"><UserAvatar src={faces[0] ?? null} name={target.name} size={52} expandable={false} /></span>
            <span className="absolute bottom-0 right-0 rounded-full ring-[3px] ring-background">
              <UserAvatar src={faces[1] ?? null} name={target.name} size={52} expandable={false} />
            </span>
          </span>
        ) : (
          <UserAvatar src={target.avatar_url} name={target.name} size={76} expandable={false} />
        )}
        {on && (
          <span className={cn("absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full text-white ring-[3px] ring-background", SELECTED)} data-share-picked>
            <Check className="h-3.5 w-3.5" strokeWidth={3.5} />
          </span>
        )}
      </span>
      <span className="line-clamp-2 w-full break-words text-[13px] leading-tight text-foreground">{target.name}</span>
      {sub && <span className="-mt-1 text-[11px] leading-tight text-muted-foreground">{sub}</span>}
    </button>
  );
}

function FaceSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-x-1 gap-y-4 pt-2" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="flex flex-col items-center gap-2 py-1">
          <span className="jf-skeleton h-[76px] w-[76px] rounded-full bg-muted" />
          <span className="jf-skeleton h-3 w-16 rounded-full bg-muted" />
        </span>
      ))}
    </div>
  );
}

function AppTile({ label, option, onClick, children }: { label: string; option: string; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center active:scale-95" data-share-option={option}>
      <span className="block h-[60px] w-[60px]">{children}</span>
      <span className="line-clamp-2 text-[12px] leading-tight text-foreground">{label}</span>
    </button>
  );
}

/** An app in the row: a link straight into it, or (Messenger on an iPhone) the phone's share sheet. */
function AppLink({ app, href, onNative, onDone }: { app: ShareApp; href: string | null; onNative: () => void; onDone: () => void }) {
  const look = APP_LOOK[app];
  const face = (
    <span className={cn("grid h-full w-full place-items-center rounded-full", look.tone)}>
      {look.mark ? <BrandGlyph name={look.mark} className="h-7 w-7" /> : look.icon}
    </span>
  );
  if (!href) {
    return <AppTile label={SHARE_APP_LABEL[app]} option={app} onClick={onNative}>{face}</AppTile>;
  }
  const newTab = opensInNewTab(href);
  return (
    <a
      href={href}
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      onClick={() => window.setTimeout(onDone, 0)}
      className="flex w-[76px] shrink-0 flex-col items-center gap-1.5 text-center active:scale-95"
      data-share-option={app}
    >
      <span className="block h-[60px] w-[60px]">{face}</span>
      <span className="line-clamp-2 text-[12px] leading-tight text-foreground">{SHARE_APP_LABEL[app]}</span>
    </a>
  );
}
