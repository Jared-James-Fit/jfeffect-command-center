import { useEffect, useState } from "react";
import { getBroadcastFileSignedUrl } from "@/lib/broadcasts";
import { getEmbedUrl } from "@/lib/recipe-format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ExternalLink, Loader2 } from "lucide-react";

export function BroadcastVoicePlayer({ voicePath, voiceUrl, transcript }: { voicePath?: string | null; voiceUrl?: string | null; transcript?: string | null }) {
  const [url, setUrl] = useState<string | null>(voiceUrl ?? null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (voiceUrl) { setUrl(voiceUrl); return; }
    if (!voicePath) return;
    setLoading(true);
    getBroadcastFileSignedUrl(voicePath).then(setUrl).finally(() => setLoading(false));
  }, [voicePath, voiceUrl]);

  if (!voicePath && !voiceUrl) return null;

  return (
    <div className="space-y-2">
      {loading || !url ? (
        <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading voice…
        </div>
      ) : (
        <audio controls src={url} className="w-full" preload="metadata" />
      )}
      {transcript && (
        <div className="rounded-md bg-muted/30 p-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {transcript}
        </div>
      )}
    </div>
  );
}

export function BroadcastVideoPlayer({ videoPath, videoUrl }: { videoPath?: string | null; videoUrl?: string | null }) {
  const [signed, setSigned] = useState<string | null>(null);
  useEffect(() => {
    if (videoPath) getBroadcastFileSignedUrl(videoPath).then(setSigned).catch(() => {});
  }, [videoPath]);

  if (videoUrl) {
    const embed = getEmbedUrl(videoUrl);
    if (embed) {
      return (
        <Card className="overflow-hidden">
          <div className="aspect-video w-full">
            <iframe src={embed} className="h-full w-full" allow="accelerometer; encrypted-media; picture-in-picture" allowFullScreen title="Broadcast video" />
          </div>
        </Card>
      );
    }
    return (
      <Button asChild variant="outline" className="w-full">
        <a href={videoUrl} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" /> Watch Video</a>
      </Button>
    );
  }
  if (videoPath && signed) {
    return (
      <Card className="overflow-hidden">
        <video controls src={signed} className="aspect-video w-full" preload="metadata" />
      </Card>
    );
  }
  return null;
}