import { Component, type ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

type State = { error: Error | null };

/**
 * Local boundary so a crash inside one section never takes down the entire
 * route. Renders a small inline fallback with the underlying error message,
 * and logs the full error to the console for debugging.
 */
export class SectionErrorBoundary extends Component<
  { children: ReactNode; label?: string; className?: string },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    // eslint-disable-next-line no-console
    console.error(`[Section:${this.props.label ?? "unknown"}] crashed`, {
      message: error?.message,
      stack: error?.stack,
      info,
    });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Card className={"border-destructive/40 bg-destructive/5 p-4 text-sm " + (this.props.className ?? "")}>
        <div className="mb-2 flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <span className="font-semibold">
            {this.props.label ? `${this.props.label} couldn't load` : "This section couldn't load"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          The rest of the page still works. Try again — if it keeps happening, share this with your coach.
        </p>
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-secondary/40 p-2 text-[10px] text-muted-foreground">
          {this.state.error.message}
        </pre>
        <div className="mt-3 flex justify-end">
          <Button size="sm" variant="outline" onClick={this.reset}>Try again</Button>
        </div>
      </Card>
    );
  }
}