import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { FileText, File as FileIcon, Download, Play, Pause } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { LiftCommentAttachment } from "@/lib/lift-videos";
import { cn } from "@/lib/utils";

function useSigned(path?: string | null) {
  const q = useQuery({
    queryKey: ["lift-att", path],
    enabled: !!path,
    staleTime: 1000 * 60 * 50,
    queryFn: async () => {
      const { data, error } = await supabase.storage
        .from("message-attachments").createSignedUrl(path!, 60 * 60);
      if (error) throw error;
      return data.signedUrl;
    },
  });
  return q.data;
}

function ImagePart({ att }: { att: LiftCommentAttachment }) {
  const signed = useSigned(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  if (!src) return null;
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block max-w-[260px]">
      <img src={src} alt={att.name ?? ""} loading="lazy"
        className={cn(att.kind === "gif" ? "h-[160px] w-[160px] object-cover" : "max-h-72 w-auto", "rounded-md")} />
    </a>
  );
}

function VideoPart({ att }: { att: LiftCommentAttachment }) {
  const signed = useSigned(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  if (!src) return null;
  return (
    <video src={src} controls playsInline preload="metadata"
      className="max-h-72 w-auto max-w-[260px] rounded-md bg-black" />
  );
}

function AudioPart({ att }: { att: LiftCommentAttachment }) {
  const signed = useSigned(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  const [playing, setPlaying] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  if (!src) return null;
  const toggle = () => {
    if (!audio) return;
    if (audio.paused) { audio.play(); setPlaying(true); } else { audio.pause(); setPlaying(false); }
  };
  const dur = att.duration ? `${Math.floor(att.duration / 60)}:${Math.floor(att.duration % 60).toString().padStart(2, "0")}` : null;
  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-background/60 px-2 py-1.5">
      <Button size="icon" variant="ghost" type="button" className="h-7 w-7 rounded-full" onClick={toggle}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <audio ref={setAudio} src={src} onEnded={() => setPlaying(false)} preload="metadata" className="hidden" />
      <span className="text-xs">
        {att.kind === "voice" ? "Voice memo" : (att.name ?? "Audio")}
        {dur && <span className="ml-1 text-muted-foreground">· {dur}</span>}
      </span>
    </div>
  );
}

function FilePart({ att }: { att: LiftCommentAttachment }) {
  const signed = useSigned(att.storage_path);
  const src = att.storage_path ? signed : att.url;
  const Icon = att.type === "pdf" ? FileText : FileIcon;
  return (
    <a href={src ?? "#"} target="_blank" rel="noreferrer"
      className="flex items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs hover:bg-accent">
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate max-w-[180px]">{att.name ?? att.type}</span>
      <Download className="ml-1 h-3.5 w-3.5 text-muted-foreground" />
    </a>
  );
}

export function LiftCommentAttachments({ list }: { list: LiftCommentAttachment[] | null | undefined }) {
  if (!list?.length) return null;
  return (
    <div className="mt-2 flex flex-col gap-2">
      {list.map((a, i) => {
        if (a.type === "image") return <ImagePart key={i} att={a} />;
        if (a.type === "video") return <VideoPart key={i} att={a} />;
        if (a.type === "audio") return <AudioPart key={i} att={a} />;
        return <FilePart key={i} att={a} />;
      })}
    </div>
  );
}