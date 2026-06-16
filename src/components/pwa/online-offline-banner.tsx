import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

export function OnlineOfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  if (online) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500/95 px-3 py-1.5 text-center text-xs font-medium text-amber-950 shadow-md safe-pt"
    >
      <WifiOff className="h-3.5 w-3.5" />
      You're offline. Changes will sync when you reconnect.
    </div>
  );
}