// Client-side helper: upload a single lift-video file to Google Drive via the
// same resumable pipeline as the media-upload-dialog, AND mirror it into the
// `media_items` table so it shows up in the Media Review Inbox.
//
// Returns the Drive embed URL (suitable for video_url on lift_videos rows),
// the Drive file id, and the newly-created media_items row id.
import { initMediaUpload, finalizeMediaUpload, createSubmission } from "@/lib/drive.functions";
import { uploadToDrive } from "@/lib/media";
import { buildDriveDisplayName } from "@/lib/media-naming";

export type LiftDriveUploadResult = {
  url: string;
  driveFileId: string;
  mediaItemId: string | null;
  submissionId: string | null;
};

type Args = {
  clientId: string;
  clientName: string | null | undefined;
  file: File;
  index: number;          // 1-based
  total: number;
  batchNote?: string | null;
  perClipNote?: string | null;
  urgent?: boolean;
  painNote?: string | null;
  submissionId?: string | null; // reuse existing batch submission across clips
  initFn: (args: any) => Promise<any>;
  finalizeFn: (args: any) => Promise<any>;
  createSubFn: (args: any) => Promise<any>;
  onProgress?: (pct: number) => void;
};

export async function uploadLiftClipToDrive(args: Args): Promise<LiftDriveUploadResult> {
  const displayName = buildDriveDisplayName({
    clientName: args.clientName, type: "Lift Videos", index: args.index, total: args.total,
  });
  let subId = args.submissionId ?? null;
  if (!subId) {
    const sub = await args.createSubFn({ data: {
      clientId: args.clientId, submissionType: "Lift Videos",
      batchNote: args.batchNote ?? null, urgent: !!args.urgent,
      painNote: args.painNote ?? null, clipCount: args.total, role: "client",
    }});
    subId = sub?.id ?? null;
  }
  const init = await args.initFn({ data: {
    clientId: args.clientId, mediaType: "Lift Videos",
    fileName: args.file.name, mimeType: args.file.type || "video/mp4", sizeBytes: args.file.size,
    displayName,
  }});
  const uploaded = await uploadToDrive(init.uploadUrl, args.file, args.onProgress);
  const row = await args.finalizeFn({ data: {
    clientId: args.clientId, submissionId: subId, mediaType: "Lift Videos",
    driveFileId: uploaded.id,
    clipNote: args.perClipNote ?? null,
    clipOrder: args.index - 1, urgent: !!args.urgent,
    painNote: args.painNote ?? null, uploadedByRole: "client",
  }});
  const url: string = row?.drive_embed_url ?? row?.drive_url ?? `https://drive.google.com/file/d/${uploaded.id}/preview`;
  return { url, driveFileId: uploaded.id, mediaItemId: row?.id ?? null, submissionId: subId };
}