import { Component, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

type State = { error: Error | null };

/** Local boundary so a crash in group chat doesn't take down the whole page. */
export class GroupChatErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error("[GroupChat] crashed", { message: error?.message, stack: error?.stack, info });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-full place-items-center p-6">
        <Card className="max-w-md border-border bg-card p-5 text-sm">
          <div className="mb-2 flex items-center gap-2 text-amber-600">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-semibold">Group chat couldn't load</span>
          </div>
          <p className="text-muted-foreground">
            Something went wrong opening this group. Try again — if it keeps
            happening, let your coach know.
          </p>
          <pre className="mt-3 max-h-32 overflow-auto rounded bg-secondary/40 p-2 text-[10px] text-muted-foreground">
            {this.state.error.message}{"\n"}{this.state.error.stack?.split("\n").slice(0,4).join("\n")}
          </pre>
          <div className="mt-3 flex justify-end">
            <Button size="sm" onClick={this.reset}>Try again</Button>
          </div>
        </Card>
      </div>
    );
  }
}