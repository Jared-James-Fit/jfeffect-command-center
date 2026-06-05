// Helpers for turning low-level Google Drive setup errors into audience-appropriate
// messages. Admins see the technical detail; clients see a friendly message
// telling them to contact Coach Jared.

const ADMIN_SETUP_SIGNALS = [
  "Google Drive root folder is not set up",
  "Google Drive connector is not configured",
  "Could not locate a target Drive folder",
  "Drive API 401",
  "Drive API 403",
  "Drive resumable init 401",
  "Drive resumable init 403",
];

export function isDriveSetupError(err: unknown): boolean {
  const msg = (err as any)?.message ?? String(err ?? "");
  return ADMIN_SETUP_SIGNALS.some((s) => msg.includes(s));
}

export const CLIENT_DRIVE_UNAVAILABLE_MESSAGE =
  "Upload is temporarily unavailable. Message Coach Jared and he'll get it fixed.";

export const ADMIN_DRIVE_SETUP_MESSAGE =
  "Google Drive root folder is not set up. Go to Settings → Google Drive to create or connect the root folder.";

export function friendlyDriveError(err: unknown, role: "admin" | "client"): string {
  if (isDriveSetupError(err)) {
    return role === "admin" ? ADMIN_DRIVE_SETUP_MESSAGE : CLIENT_DRIVE_UNAVAILABLE_MESSAGE;
  }
  const msg = (err as any)?.message;
  if (role === "client") {
    return "Upload failed. Try again, or message Coach Jared if it keeps happening.";
  }
  return msg || "Upload failed";
}