import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Users } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { runJob } from "@/lib/progress-jobs";
import {
  createRecipe,
  updateRecipe,
  setRecipeSelectedClients,
  getRecipeSelectedClients,
  RECIPE_ACCESS_LABELS,
  type Recipe,
  type RecipeAccessScope,
  type RecipeStatus,
} from "@/lib/recipes";
import { RECIPE_CATEGORIES, parseRecipeBody } from "@/lib/recipe-format";
import { RecipeBodyView } from "@/components/recipe-body-view";
import { RecipeAccessPicker } from "@/components/recipe-access-picker";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: Recipe | null;
  onSaved?: (r: Recipe) => void;
};

export function RecipeForm({ open, onOpenChange, initial, onSaved }: Props) {
  const { user } = useAuth();
  const isEdit = !!initial;

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<string>("Breakfast");
  const [access, setAccess] = useState<RecipeAccessScope>("hidden");
  const [status, setStatus] = useState<RecipeStatus>("Draft");
  const [body, setBody] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [tags, setTags] = useState("");
  const [selectedClients, setSelectedClients] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setTitle(initial.title);
      setCategory(initial.category);
      setAccess(initial.access_scope);
      setStatus(initial.status);
      setBody(initial.body);
      setVideoUrl(initial.video_url ?? "");
      setTags((initial.tags ?? []).join(", "));
      getRecipeSelectedClients(initial.id).then(setSelectedClients);
    } else {
      setTitle("");
      setCategory("Breakfast");
      setAccess("hidden");
      setStatus("Draft");
      setBody("");
      setVideoUrl("");
      setTags("");
      setSelectedClients([]);
    }
  }, [open, initial]);

  // Smart-prefill from pasted body, only if admin left fields empty.
  useEffect(() => {
    if (!body) return;
    const parsed = parseRecipeBody(body);
    if (parsed.title && !title) setTitle(parsed.title);
    if (parsed.category && RECIPE_CATEGORIES.includes(parsed.category as any) && category === "Breakfast")
      setCategory(parsed.category);
    if (parsed.videoUrl && !videoUrl) setVideoUrl(parsed.videoUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body]);

  async function persist(publish?: boolean) {
    if (!title.trim()) {
      toast.error("Title is required");
      return;
    }
    setSaving(true);
    try {
      const finalStatus: RecipeStatus = publish ? "Published" : status;
      const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
      const row = await runJob<Recipe>(
        {
          title: publish ? `Publishing "${title}"` : `Saving "${title}"`,
          description: category,
          steps: ["Validate content", "Save content", "Publish to members", "Sync visibility", "Finalize"],
          successToast: publish ? "Recipe published" : "Recipe saved",
        },
        async (job) => {
          job.completeStep(0);
          let saved: Recipe;
          if (isEdit && initial) {
            saved = await updateRecipe(initial.id, {
              title, category, access_scope: access, status: finalStatus,
              body, video_url: videoUrl || null, tags: tagList,
            });
          } else {
            saved = await createRecipe({
              title, category, access_scope: access, status: finalStatus,
              body, video_url: videoUrl || null, tags: tagList,
              authorId: user?.id,
            });
          }
          job.completeStep(1);
          job.completeStep(2);
          if (access === "selected_clients") {
            await setRecipeSelectedClients(saved.id, selectedClients);
          }
          job.completeStep(3);
          job.completeStep(4);
          return saved;
        },
      );
      onSaved?.(row);
      onOpenChange(false);
    } catch (e: any) {
      // runJob handled the toast
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Recipe" : "New Recipe"}</DialogTitle>
          <DialogDescription>
            Paste the formatted recipe into the body — the app will render it cleanly for clients.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="edit">
          <TabsList>
            <TabsTrigger value="edit">Edit</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="edit" className="space-y-4 pt-2">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Protein French Toast" />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECIPE_CATEGORIES.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Access</Label>
                <Select value={access} onValueChange={(v) => setAccess(v as RecipeAccessScope)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(RECIPE_ACCESS_LABELS) as RecipeAccessScope[]).map((k) => (
                      <SelectItem key={k} value={k}>{RECIPE_ACCESS_LABELS[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {access === "selected_clients" && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)} className="mt-1">
                    <Users className="mr-1 h-4 w-4" />
                    {selectedClients.length ? `${selectedClients.length} selected` : "Select Clients"}
                  </Button>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={status} onValueChange={(v) => setStatus(v as RecipeStatus)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Published">Published</SelectItem>
                    <SelectItem value="Archived">Archived</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Recipe Body</Label>
              <Textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={16}
                className="font-mono text-xs"
                placeholder={"Recipe Title:\nProtein French Toast\n\nCategory:\nBreakfast\n\nIngredients:\n- 2 slices bread\n- 200ml egg whites\n…"}
              />
              <p className="text-[11px] text-muted-foreground">
                Tip: paste the output from the Recipe Formatting Guide prompt. Title, category, and video link will auto-fill if blank.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Video Demo Link <span className="text-muted-foreground">(optional)</span></Label>
                <Input value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="YouTube / Vimeo / link" />
              </div>
              <div className="space-y-1.5">
                <Label>Tags <span className="text-muted-foreground">(comma separated, optional)</span></Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="high-protein, quick" />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="preview" className="pt-2">
            <Card className="space-y-2 p-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">{title || "Untitled"}</h2>
                <Badge variant="outline" className="text-[10px]">{category}</Badge>
              </div>
              <RecipeBodyView body={body} videoUrl={videoUrl || null} />
            </Card>
          </TabsContent>
        </Tabs>

        <DialogFooter className="flex-row gap-2 sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" onClick={() => persist(false)} disabled={saving}>
            Save as {status}
          </Button>
          <Button onClick={() => persist(true)} disabled={saving} className="bg-gradient-primary font-bold">
            {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
            Publish
          </Button>
        </DialogFooter>

        <RecipeAccessPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          initial={selectedClients}
          onSave={async (ids) => setSelectedClients(ids)}
        />
      </DialogContent>
    </Dialog>
  );
}