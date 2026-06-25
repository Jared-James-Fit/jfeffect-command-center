import { createFileRoute } from "@tanstack/react-router";
import { TasksPage } from "@/components/tasks/tasks-page";
import { MediaHeader } from "@/components/media/media-header";

export const Route = createFileRoute("/_authenticated/media/work")({
  component: MyWorkPage,
});

function MyWorkPage() {
  return (
    <div className="mx-auto w-full max-w-7xl p-4 md:p-6">
      <MediaHeader
        title="My Work"
        description="Tasks assigned to you and the Eisenhower matrix. Quick Notes live here too."
      />
      <TasksPage scope="media" storagePrefix="media" />
    </div>
  );
}