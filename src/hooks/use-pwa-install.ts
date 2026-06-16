import { useCallback, useEffect, useState } from "react";

type BIPEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

let cachedPrompt: BIPEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    cachedPrompt = e as BIPEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    cachedPrompt = null;
    notify();
  });
}

export type Platform = "ios" | "android" | "desktop" | "unknown";
export type Browser = "safari" | "chrome" | "firefox" | "edge" | "samsung" | "in-app" | "other";

export interface PlatformInfo {
  platform: Platform;
  browser: Browser;
  isStandalone: boolean;
  isInAppBrowser: boolean;
  canPrompt: boolean;
}

function detect(): PlatformInfo {
  if (typeof window === "undefined") {
    return { platform: "unknown", browser: "other", isStandalone: false, isInAppBrowser: false, canPrompt: false };
  }
  const ua = navigator.userAgent || "";
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
  const isAndroid = /Android/i.test(ua);
  const platform: Platform = isIOS ? "ios" : isAndroid ? "android" : "desktop";

  const inApp = /FBAN|FBAV|Instagram|Line\/|Snapchat|Twitter|GSA\/|MicroMessenger/i.test(ua)
    || (isIOS && / Gmail/.test(ua));
  let browser: Browser = "other";
  if (inApp) browser = "in-app";
  else if (/SamsungBrowser/i.test(ua)) browser = "samsung";
  else if (/EdgA?\//i.test(ua)) browser = "edge";
  else if (/Firefox|FxiOS/i.test(ua)) browser = "firefox";
  else if (/CriOS|Chrome\//i.test(ua) && !/Edg\//i.test(ua)) browser = "chrome";
  else if (/Safari/i.test(ua) && isIOS) browser = "safari";
  else if (/Safari/i.test(ua)) browser = "safari";

  const isStandalone = window.matchMedia?.("(display-mode: standalone)").matches
    || (navigator as any).standalone === true;

  return {
    platform,
    browser,
    isStandalone,
    isInAppBrowser: browser === "in-app",
    canPrompt: !!cachedPrompt,
  };
}

export function usePwaInstall() {
  const [info, setInfo] = useState<PlatformInfo>(() => detect());

  useEffect(() => {
    const update = () => setInfo(detect());
    update();
    listeners.add(update);
    const mm = window.matchMedia?.("(display-mode: standalone)");
    mm?.addEventListener?.("change", update);
    return () => {
      listeners.delete(update);
      mm?.removeEventListener?.("change", update);
    };
  }, []);

  const promptInstall = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!cachedPrompt) return "unavailable";
    try {
      await cachedPrompt.prompt();
      const choice = await cachedPrompt.userChoice;
      cachedPrompt = null;
      notify();
      return choice.outcome;
    } catch {
      return "unavailable";
    }
  }, []);

  return { ...info, promptInstall };
}