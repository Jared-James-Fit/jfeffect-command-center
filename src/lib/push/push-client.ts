// Client-only helpers for enabling/disabling browser push subscriptions.
import {
  getVapidPublicKey,
  savePushSubscription,
  removePushSubscription,
} from "@/lib/push/push.functions";

export type PushSupport =
  | { supported: true; needsInstallOnIOS: boolean }
  | { supported: false; reason: "no_window" | "no_sw" | "no_push" | "ios_requires_install" | "unknown" };

export function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // iPadOS reports as Macintosh; check touch points to disambiguate.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
}

export function isStandalonePwa(): boolean {
  if (typeof window === "undefined") return false;
  // iOS Safari uses navigator.standalone; everything else uses display-mode.
  return (
    !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
    !!(window.navigator as any).standalone
  );
}

export function detectPushSupport(): PushSupport {
  if (typeof window === "undefined") return { supported: false, reason: "no_window" };
  if (!("serviceWorker" in navigator)) return { supported: false, reason: "no_sw" };
  if (!("PushManager" in window) || !("Notification" in window)) return { supported: false, reason: "no_push" };
  if (isIos() && !isStandalonePwa()) return { supported: false, reason: "ios_requires_install" };
  return { supported: true, needsInstallOnIOS: false };
}

export function currentPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buf = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToB64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function platformLabel(): string {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent || "";
  if (/Android/.test(ua)) return "android";
  if (isIos()) return "ios";
  if (/Macintosh/.test(ua)) return "macos";
  if (/Windows/.test(ua)) return "windows";
  if (/Linux/.test(ua)) return "linux";
  return "web";
}

function deviceLabel(): string {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent || "";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "Device";
}

async function getReadyRegistration(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.getRegistration();
  if (reg) return reg;
  return navigator.serviceWorker.ready;
}

/**
 * Request permission (only call from a user gesture), subscribe, and persist.
 * Returns { ok, reason }.
 */
export async function enablePushOnThisDevice(): Promise<{ ok: boolean; reason?: string }> {
  const support = detectPushSupport();
  if (!support.supported) return { ok: false, reason: support.reason };

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: `permission_${permission}` };

  const { publicKey } = await getVapidPublicKey();
  if (!publicKey) return { ok: false, reason: "no_vapid_key" };

  const reg = await getReadyRegistration();
  if (!reg.pushManager) return { ok: false, reason: "no_push_manager" };

  // Re-use an existing subscription where possible
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh ?? bufToB64Url(sub.getKey("p256dh"));
  const auth = json.keys?.auth ?? bufToB64Url(sub.getKey("auth"));
  if (!sub.endpoint || !p256dh || !auth) return { ok: false, reason: "missing_keys" };

  await savePushSubscription({
    data: {
      endpoint: sub.endpoint,
      p256dh,
      auth,
      deviceName: deviceLabel(),
      platform: platformLabel(),
      userAgent: navigator.userAgent?.slice(0, 500),
    },
  });
  return { ok: true };
}

export async function disablePushOnThisDevice(): Promise<{ ok: boolean }> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      await removePushSubscription({ data: { endpoint } }).catch(() => {});
    }
    return { ok: true };
  } catch (e) {
    console.warn("[push] disable failed", e);
    return { ok: false };
  }
}

/** Quick check whether this browser currently has a saved subscription. */
export async function hasPushSubscriptionLocally(): Promise<boolean> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    return !!sub;
  } catch { return false; }
}