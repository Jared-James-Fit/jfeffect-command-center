/**
 * MediaPipe's Face Landmarker, loaded on demand for the headshot camera (the
 * same WebAssembly runtime the lift analysis's pose model uses, so a phone that
 * has read a set video already has most of it). Everything is served by the
 * app (public/models/face_landmarker.task, Apache-2.0), never a CDN, and runs
 * on the device: no frame leaves it for this. Client-only.
 */
export type FaceResult = {
  faceLandmarks: { x: number; y: number; z: number }[][];
  faceBlendshapes?: { categories: { categoryName: string; score: number }[] }[];
};
export type FaceLandmarkerLike = {
  detectForVideo: (video: HTMLVideoElement, ts: number) => FaceResult;
  close: () => void;
};

const MODEL_URL = "/models/face_landmarker.task";
let loading: Promise<{ lm: FaceLandmarkerLike; delegate: "GPU" | "CPU" }> | null = null;

/** The model, once per page; rejects (and can be tried again) when this device can't run it. */
export function loadFaceLandmarker(): Promise<{ lm: FaceLandmarkerLike; delegate: "GPU" | "CPU" }> {
  if (loading) return loading;
  loading = (async () => {
    if (typeof WebAssembly === "undefined") throw new Error("no_wasm");
    const [vision, loaderUrl, wasmUrl] = await Promise.all([
      import("@mediapipe/tasks-vision"),
      import("@mediapipe/tasks-vision/vision_wasm_internal.js?url").then((m) => m.default),
      import("@mediapipe/tasks-vision/vision_wasm_internal.wasm?url").then((m) => m.default),
    ]);
    const [model, wasm] = await Promise.all([
      fetch(MODEL_URL, { cache: "force-cache" }).then(async (r) => {
        if (!r.ok) throw new Error(`model ${r.status}`);
        return new Uint8Array(await r.arrayBuffer());
      }),
      fetch(wasmUrl, { cache: "force-cache" }).then(async (r) => {
        if (!r.ok) throw new Error(`wasm ${r.status}`);
        return r.arrayBuffer();
      }),
    ]);
    const wasmBlobUrl = URL.createObjectURL(new Blob([wasm], { type: "application/wasm" }));
    const fileset = { wasmLoaderPath: loaderUrl, wasmBinaryPath: wasmBlobUrl };
    const make = (delegate: "GPU" | "CPU") =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: model, delegate },
        runningMode: "VIDEO",
        // two, so a second face in the frame is seen (and asked out of it)
        numFaces: 2,
        outputFaceBlendshapes: true,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      }) as unknown as Promise<FaceLandmarkerLike>;
    try {
      return { lm: await make("GPU"), delegate: "GPU" as const };
    } catch {
      return { lm: await make("CPU"), delegate: "CPU" as const };
    }
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** The two eye-blink scores from a result's blendshapes (null when the model gave none). */
export function blinkScores(r: FaceResult, i = 0): { left: number; right: number } | null {
  const cats = r.faceBlendshapes?.[i]?.categories;
  if (!cats?.length) return null;
  const get = (n: string) => cats.find((c) => c.categoryName === n)?.score ?? 0;
  return { left: get("eyeBlinkLeft"), right: get("eyeBlinkRight") };
}
