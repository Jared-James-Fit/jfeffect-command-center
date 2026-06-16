// Web file input camera capture. Capacitor-ready (swap with @capacitor/camera).
export type PickPhotoOptions = { source?: "camera" | "library"; accept?: string };

export function pickPhoto(opts: PickPhotoOptions = {}): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = opts.accept ?? "image/*";
    if (opts.source === "camera") input.setAttribute("capture", "environment");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    input.addEventListener("change", () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    });
    input.addEventListener("cancel", () => {
      input.remove();
      resolve(null);
    });
    document.body.appendChild(input);
    input.click();
  });
}