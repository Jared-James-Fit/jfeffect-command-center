import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Activity } from "lucide-react";

const DEVICES = [
  { name: "Apple Health" },
  { name: "Google Fit / Health Connect" },
  { name: "Fitbit" },
  { name: "Garmin" },
  { name: "Oura" },
  { name: "Whoop" },
];

export function ConnectHealthDeviceCard() {
  return (
    <Card className="border-border bg-card p-6 space-y-4">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Connect Health Device</h3>
      </div>
      <p className="text-xs text-muted-foreground">
        Device sync is coming soon. You can still log your bodyweight and metrics manually — your coach sees them immediately.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {DEVICES.map((d) => (
          <li key={d.name} className="flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
            <span className="text-sm font-semibold">{d.name}</span>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-[10px] text-muted-foreground">Not Connected</Badge>
              <Button size="sm" variant="outline" disabled>Coming soon</Button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}