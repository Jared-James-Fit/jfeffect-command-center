import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useMediaViewer, getCachedRatio, setCachedRatio } from "@/components/media-viewer";
import { cn } from "@/lib/utils";
import { fallbackEmoji } from "@/lib/gif-fallback";

type ChatImageLike = {
  url?: string | null;
  storage_path?: string | null;
  name?: string | null;
  mime?: string | null;
  fallback_emoji?: string | null;
  category?: string | null;
};

type Candidate =
  | { kind: "url"; sourceType: string; url: string }
  | { kind: "path"; sourceType: string; path: string; initialSignedUrl?: string | null };

const BUCKET = "message-attachments";
const SIGNED_URL_TTL_SECONDS = 60 * 60;

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function asRecord(att: ChatImageLike): Record<string, unknown> {
  return att as Record<string, unknown>;
}

function pushUnique<T extends { key: string }>(items: T[], item: T) {
  if (!items.some((existing) => existing.key === item.key)) items.push(item);
}

function pathFromMessageAttachmentUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    const marker = "/storage/v1/object/";
    const markerIndex = parsed.pathname.indexOf(marker);
    if (markerIndex < 0) return null;
    const rest = parsed.pathname.slice(markerIndex + marker.length);
    const parts = rest.split("/");
    // Expected: sign/message-attachments/<path> or public/message-attachments/<path>.
    if (parts.length < 3) return null;
    if (parts[0] !== "sign" && parts[0] !== "public") return null;
    if (parts[1] !== BUCKET) return null;
    const rawPath = parts.slice(2).join("/");
    return rawPath ? decodeURIComponent(rawPath) : null;
  } catch {
    return null;
  }
}

function buildCandidates(att: ChatImageLike, initialSignedUrl?: string | null): Candidate[] {
  const raw = asRecord(att);
  const candidates: Array<Candidate & { key: string }> = [];

  // Newer/possible generated thumbnail URL fields first. Historical messages
  // often do not have these, so absence must fall through to original media.
  for (const field of ["thumbnail_url", "thumbnailUrl", "thumb_url", "preview_url", "previewSrc"]) {
    const url = raw[field];
    if (isNonEmpty(url)) {
      pushUnique(candidates, { kind: "url", sourceType: field, url, key: `url:${url}` });
      const derivedPath = pathFromMessageAttachmentUrl(url);
      if (derivedPath) {
        pushUnique(candidates, { kind: "path", sourceType: `${field}:derived_path`, path: derivedPath, key: `path:${derivedPath}` });
      }
    }
  }

  // Thumbnail storage paths, if they exist, are signed fresh instead of trusting
  // any stored signed URL that may have expired.
  for (const field of ["thumbnail_storage_path", "thumb_storage_path", "thumbnail_path", "preview_storage_path"]) {
    const path = raw[field];
    if (isNonEmpty(path)) pushUnique(candidates, { kind: "path", sourceType: field, path, key: `path:${path}` });
  }

  if (isNonEmpty(att.storage_path)) {
    pushUnique(candidates, {
      kind: "path",
      sourceType: "storage_path",
      path: att.storage_path,
      initialSignedUrl,
      key: `path:${att.storage_path}`,
    });
  }

  // Some legacy rows stored only a temporary signed/public URL. If it points
  // at this storage bucket, recover the stable path and sign it freshly before
  // falling back to the original URL.
  for (const field of ["original_url", "public_url", "media_url", "signed_url", "url"]) {
    const url = raw[field];
    if (!isNonEmpty(url)) continue;
    const derivedPath = pathFromMessageAttachmentUrl(url);
    if (derivedPath) {
      pushUnique(candidates, { kind: "path", sourceType: `${field}:derived_path`, path: derivedPath, key: `path:${derivedPath}` });
    }
  }

  // Legacy/original URL fields last. These may be public URLs, old signed URLs,
  // or external image URLs; try them only after fresh storage signing options.
  for (const field of ["original_url", "public_url", "media_url", "signed_url", "url"]) {
    const url = raw[field];
    if (isNonEmpty(url)) pushUnique(candidates, { kind: "url", sourceType: field, url, key: `url:${url}` });
  }

  return candidates.map(({ key: _key, ...candidate }) => candidate);
}

async function createFreshSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  if (!data?.signedUrl) throw new Error("No signed URL returned");
  return data.signedUrl;
}

function withAttempt(url: string, attempt: number): string {
  if (attempt <= 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}_img_retry=${attempt}`;
}

function attachmentId(att: ChatImageLike): string | null {
  const raw = asRecord(att);
  for (const field of ["id", "attachment_id", "storage_path", "name"]) {
    const v = raw[field];
    if (isNonEmpty(v)) return v;
  }
  return null;
}

function devLog(event: string, payload: Record<string, unknown>) {
  if (!import.meta.env.DEV) return;
  // Never log signed URLs, tokens, or file contents. Only identifiers + source category.
  console.warn(`[chat-media] ${event}`, payload);
}

async function diagnoseHttpCategory(url: string): Promise<string> {
  if (!import.meta.env.DEV) return "not-collected";
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    if (res.status === 401 || res.status === 403) return `${res.status}:auth-or-expired`;
    if (res.status === 404) return "404:not-found";
    if (res.status >= 500) return `${res.status}:server`;
    if (!res.ok) return `${res.status}:http-error`;
    return `${res.status}:head-ok-image-error`;
  } catch {
    return "network-or-cors";
  }
}

export function ChatImageAttachment({
  att,
  messageId,
  initialSignedUrl,
}: {
  att: ChatImageLike;
  messageId?: string | null;
  initialSignedUrl?: string | null;
}) {
  const viewer = useMediaViewer();
  const candidates = useMemo(() => buildCandidates(att, initialSignedUrl), [att, initialSignedUrl]);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [finalError, setFinalError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [pathRefresh, setPathRefresh] = useState(0);
  const handledSignErrorKey = useRef<string | null>(null);
  const [openingViewer, setOpeningViewer] = useState(false);

  const current = candidates[candidateIndex] ?? null;
  const needsFreshSign = current?.kind === "path" && (!current.initialSignedUrl || pathRefresh > 0);
  const signedQuery = useQuery({
    queryKey: ["chat-media-signed-url", current?.kind === "path" ? current.path : "", pathRefresh],
    enabled: !!current && current.kind === "path" && needsFreshSign,
    staleTime: 45 * 60_000,
    gcTime: 55 * 60_000,
    retry: 1,
    queryFn: () => createFreshSignedUrl((current as Extract<Candidate, { kind: "path" }>).path),
  });

  const rawSrc = current?.kind === "url" ? current.url : current?.kind === "path" ? (needsFreshSign ? signedQuery.data : current.initialSignedUrl) : null;
  const displaySrc = rawSrc ? withAttempt(rawSrc, attempt) : "";
  const sourceType = current?.sourceType ?? "none";

  const stableKey = att.storage_path || (isNonEmpty(asRecord(att).id) ? String(asRecord(att).id) : null) || att.url || att.name || "image";
  const looksLikeGif = !!att.url && /tenor\.com|\.gif(\?|$)/i.test(att.url);
  const cachedRatio = getCachedRatio(stableKey);
  const ratio = looksLikeGif ? 1 : cachedRatio ?? 4 / 3;

  const resetForNextAttempt = useCallback(() => {
    setLoaded(false);
    setFinalError(false);
  }, []);

  const tryNextCandidate = useCallback((reason: string) => {
    const id = attachmentId(att);
    devLog("fallback-attempt", {
      attachmentId: id,
      messageId: messageId ?? null,
      selectedSourceType: sourceType,
      refreshed: pathRefresh > 0,
      fallbackAttempted: candidateIndex < candidates.length - 1,
      reason,
    });

    if (current?.kind === "path" && pathRefresh === 0) {
      // A batched/stored signed URL may be expired. Refresh this same storage
      // path once before falling back to legacy URLs.
      setPathRefresh((value) => value + 1);
      setAttempt((value) => value + 1);
      resetForNextAttempt();
      return;
    }

    if (candidateIndex < candidates.length - 1) {
      setCandidateIndex((value) => value + 1);
      setPathRefresh(0);
      setAttempt((value) => value + 1);
      resetForNextAttempt();
      return;
    }

    setFinalError(true);
  }, [att, candidateIndex, candidates.length, current?.kind, messageId, pathRefresh, resetForNextAttempt, sourceType]);

  useEffect(() => {
    setCandidateIndex(0);
    setLoaded(false);
    setFinalError(false);
    setAttempt(0);
    setPathRefresh(0);
    handledSignErrorKey.current = null;
  }, [stableKey, initialSignedUrl]);

  useEffect(() => {
    if (!signedQuery.error || current?.kind !== "path") return;
    const key = `${current.path}:${pathRefresh}:${candidateIndex}`;
    if (handledSignErrorKey.current === key) return;
    handledSignErrorKey.current = key;
    devLog("sign-failed", {
      attachmentId: attachmentId(att),
      messageId: messageId ?? null,
      selectedSourceType: sourceType,
      refreshed: pathRefresh > 0,
      fallbackAttempted: candidateIndex < candidates.length - 1,
      finalErrorReason: signedQuery.error instanceof Error ? signedQuery.error.message : "sign failed",
    });
    tryNextCandidate("sign-failed");
  }, [att, candidateIndex, candidates.length, current, messageId, pathRefresh, signedQuery.error, sourceType, tryNextCandidate]);

  const retry = () => {
    setFinalError(false);
    setLoaded(false);
    setCandidateIndex(0);
    setPathRefresh((value) => value + 1);
    setAttempt((value) => value + 1);
    handledSignErrorKey.current = null;
    devLog("manual-retry", {
      attachmentId: attachmentId(att),
      messageId: messageId ?? null,
      selectedSourceType: sourceType,
      refreshed: true,
      fallbackAttempted: candidates.length > 1,
    });
  };

  const openViewer = async () => {
    if (!rawSrc || !loaded || openingViewer) return;
    setOpeningViewer(true);
    try {
      let fullSrc = rawSrc;
      if (isNonEmpty(att.storage_path)) {
        try {
          fullSrc = await createFreshSignedUrl(att.storage_path);
        } catch (error) {
          devLog("viewer-refresh-failed", {
            attachmentId: attachmentId(att),
            messageId: messageId ?? null,
            selectedSourceType: "storage_path",
            refreshed: false,
            finalErrorReason: error instanceof Error ? error.message : "viewer sign failed",
          });
        }
      }
      viewer.open(fullSrc, { alt: att.name ?? "Image", previewSrc: rawSrc });
    } finally {
      setOpeningViewer(false);
    }
  };

  if (finalError || candidates.length === 0) {
    return (
      <div className="flex w-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-border bg-secondary/40 p-4">
        <span className="text-4xl">{att.fallback_emoji ?? fallbackEmoji(att.name ?? undefined, att.category ?? undefined)}</span>
        {att.name && <span className="line-clamp-1 text-[11px] text-muted-foreground">{att.name}</span>}
        <Button type="button" variant="outline" size="sm" onClick={retry} className="h-7 px-2 text-[10px] font-semibold uppercase tracking-wider">
          Retry
        </Button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={openViewer}
      disabled={!loaded || !rawSrc}
      className={cn(
        "relative block w-[240px] max-w-full cursor-zoom-in overflow-hidden rounded-md bg-muted disabled:cursor-default",
        "max-h-64",
      )}
      style={{ aspectRatio: String(ratio) }}
      aria-label={att.name ? `Open image ${att.name}` : "Open image"}
      data-chat-media-source={sourceType}
    >
      {!loaded && (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-muted to-secondary/50" aria-hidden="true" />
      )}
      {displaySrc && (
        <img
          key={`${sourceType}:${displaySrc}`}
          src={displaySrc}
          alt={att.name ?? ""}
          loading="lazy"
          decoding="async"
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity",
            loaded ? "opacity-100" : "opacity-0",
          )}
          onLoad={(e) => {
            const el = e.currentTarget;
            if (el.naturalWidth && el.naturalHeight) {
              setCachedRatio(stableKey, el.naturalWidth / el.naturalHeight);
            }
            setLoaded(true);
            devLog("load-success", {
              attachmentId: attachmentId(att),
              messageId: messageId ?? null,
              selectedSourceType: sourceType,
              refreshed: pathRefresh > 0,
              fallbackAttempted: candidateIndex > 0,
            });
          }}
          onError={async () => {
            setLoaded(false);
            const httpCategory = rawSrc ? await diagnoseHttpCategory(rawSrc) : "no-source";
            devLog("image-load-failed", {
              attachmentId: attachmentId(att),
              messageId: messageId ?? null,
              selectedSourceType: sourceType,
              httpCategory,
              refreshed: pathRefresh > 0,
              fallbackAttempted: candidateIndex < candidates.length - 1 || (current?.kind === "path" && pathRefresh === 0),
              finalErrorReason: httpCategory,
            });
            tryNextCandidate(httpCategory);
          }}
          draggable={false}
        />
      )}
    </button>
  );
}