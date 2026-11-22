/**
 * The filters on the GPU (Nov 22 2026): one small WebGL program that does
 * exactly what `gradePixels` (media-grade.ts) does, used for the studio's live
 * preview (a photo once per change, a clip every frame it shows) and for the
 * export (a photo at full size, every frame of a clip as it's re-encoded).
 * A phone without WebGL gets the same grade from the pixel loop, so nothing
 * ever posts without the filter it showed. Nothing here leaves the phone.
 */
import { gradePixels, type CompiledGrade } from "@/lib/media-grade";

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// mirrors gradeRgb / gradePixels in media-grade.ts: keep the two in step
const FRAG = `
precision highp float;
varying vec2 v_uv;
uniform sampler2D u_img;
uniform sampler2D u_lut;
uniform vec3 u_gain;
uniform float u_sat;
uniform float u_vib;
uniform float u_skin;
uniform float u_sharp;
uniform vec2 u_px;
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float lut(float v, int ch) {
  vec4 t = texture2D(u_lut, vec2(clamp(v, 0.0, 1.0) * (255.0 / 256.0) + (0.5 / 256.0), 0.5));
  return ch == 0 ? t.r : (ch == 1 ? t.g : t.b);
}
float skinness(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  if (mx <= 0.08 || mx - mn < 0.04) return 0.0;
  if (!(c.r >= c.g && c.g >= c.b * 0.9)) return 0.0;
  float s = (mx - mn) / mx;
  float h = 60.0 * ((c.g - c.b) / (mx - mn));
  float hueW = h < 5.0 ? h / 5.0 : (h <= 38.0 ? 1.0 : (h < 52.0 ? (52.0 - h) / 14.0 : 0.0));
  float satW = s < 0.12 ? s / 0.12 : (s <= 0.6 ? 1.0 : (s < 0.8 ? (0.8 - s) / 0.2 : 0.0));
  float lumW = mx < 0.2 ? (mx - 0.08) / 0.12 : (mx > 0.97 ? 0.5 : 1.0);
  return clamp(hueW * satW * lumW, 0.0, 1.0);
}
void main() {
  vec3 c0 = texture2D(u_img, v_uv).rgb;
  vec3 g = clamp(c0 * u_gain, 0.0, 1.0);
  vec3 c = vec3(lut(g.r, 0), lut(g.g, 1), lut(g.b, 2));
  float L = luma(c);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float s = mx > 0.0 ? (mx - mn) / mx : 0.0;
  float k = u_sat * (1.0 + u_vib * (1.0 - s) * (1.0 - s));
  float sk = u_skin > 0.0 ? skinness(c0) * u_skin : 0.0;
  k = mix(k, clamp(k, 0.92, 1.06), sk);
  c = clamp(vec3(L) + (c - vec3(L)) * k, 0.0, 1.0);
  if (u_sharp > 0.0) {
    float up = luma(texture2D(u_img, v_uv - vec2(0.0, u_px.y)).rgb);
    float dn = luma(texture2D(u_img, v_uv + vec2(0.0, u_px.y)).rgb);
    float lf = luma(texture2D(u_img, v_uv - vec2(u_px.x, 0.0)).rgb);
    float rt = luma(texture2D(u_img, v_uv + vec2(u_px.x, 0.0)).rgb);
    float d = clamp(luma(c0) - (up + dn + lf + rt) * 0.25, -0.12, 0.12) * u_sharp * 1.6;
    c = clamp(c + vec3(d), 0.0, 1.0);
  }
  gl_FragColor = vec4(c, 1.0);
}`;

type Source = HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap | OffscreenCanvas | VideoFrame;

/** A canvas with the grade program on it: `draw` grades a source into it at w×h. */
export class GradeGL {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private img: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutKey: Uint8Array | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  readonly maxSize: number;
  lost = false;

  private constructor(canvas: HTMLCanvasElement | OffscreenCanvas, gl: WebGLRenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    this.prog = prog;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ["u_img", "u_lut", "u_gain", "u_sat", "u_vib", "u_skin", "u_sharp", "u_px"]) this.u[n] = gl.getUniformLocation(prog, n);
    const tex = () => {
      const t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.img = tex();
    this.lutTex = tex();
    this.maxSize = Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, 8192);
    gl.uniform1i(this.u.u_img, 0);
    gl.uniform1i(this.u.u_lut, 1);
    const c = canvas as HTMLCanvasElement;
    c.addEventListener?.("webglcontextlost", () => (this.lost = true));
  }

  /** A program on its own canvas (an on-screen layer's, or one made here); null without WebGL. */
  static create(canvas?: HTMLCanvasElement | OffscreenCanvas | null): GradeGL | null {
    const attempt = (c: HTMLCanvasElement | OffscreenCanvas | null): GradeGL | null => {
      if (!c) return null;
      try {
        const gl = (c.getContext("webgl", { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false }) ?? null) as WebGLRenderingContext | null;
        return gl ? new GradeGL(c, gl) : null;
      } catch {
        return null;
      }
    };
    if (canvas) return attempt(canvas);
    // an offscreen canvas where it takes WebGL (not before Safari 17), else one made in the page
    return (typeof OffscreenCanvas !== "undefined" ? attempt(new OffscreenCanvas(1, 1)) : null) ?? (typeof document !== "undefined" ? attempt(document.createElement("canvas")) : null);
  }

  /** Grades `src` into the canvas at w×h (the source is stretched to it: callers pass its own shape). */
  draw(src: Source, w: number, h: number, c: CompiledGrade): boolean {
    if (this.lost) return false;
    const gl = this.gl;
    const W = Math.max(1, Math.round(w));
    const H = Math.max(1, Math.round(h));
    if (this.canvas.width !== W) this.canvas.width = W;
    if (this.canvas.height !== H) this.canvas.height = H;
    gl.viewport(0, 0, W, H);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    if (this.lutKey !== c.lut) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, c.lut);
      this.lutKey = c.lut;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.img);
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    } catch {
      return false;
    }
    const sw = (src as { videoWidth?: number }).videoWidth || (src as { naturalWidth?: number }).naturalWidth || (src as { displayWidth?: number }).displayWidth || (src as { width: number }).width || W;
    const shh = (src as { videoHeight?: number }).videoHeight || (src as { naturalHeight?: number }).naturalHeight || (src as { displayHeight?: number }).displayHeight || (src as { height: number }).height || H;
    gl.uniform3f(this.u.u_gain, c.gains[0], c.gains[1], c.gains[2]);
    gl.uniform1f(this.u.u_sat, c.saturation);
    gl.uniform1f(this.u.u_vib, c.vibrance);
    gl.uniform1f(this.u.u_skin, c.skinProtect);
    // sharpening reads the neighbours at the output's scale (a big photo shown small isn't over-sharpened)
    gl.uniform1f(this.u.u_sharp, c.sharpen);
    gl.uniform2f(this.u.u_px, Math.max(1 / sw, 1 / W), Math.max(1 / shh, 1 / H));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return gl.getError() === gl.NO_ERROR;
  }

  dispose() {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
    this.lost = true;
  }
}

let shared: GradeGL | null | undefined;
/** The export's renderer (one for the app; made the first time it's needed). */
export function sharedGradeGL(): GradeGL | null {
  if (shared === undefined || shared?.lost) shared = GradeGL.create();
  return shared;
}

/**
 * A canvas graded in place (the export: a framed photo before its card, stickers
 * and words go on). The GPU when it can, else the pixel loop. Returns how long it took.
 */
export function gradeCanvasInPlace(canvas: HTMLCanvasElement, c: CompiledGrade): number {
  if (c.identity || !canvas.width || !canvas.height) return 0;
  const t0 = performance.now();
  const ctx = canvas.getContext("2d");
  if (!ctx) return 0;
  const gl = sharedGradeGL();
  if (gl && canvas.width <= gl.maxSize && canvas.height <= gl.maxSize && gl.draw(canvas, canvas.width, canvas.height, c)) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "copy";
    ctx.drawImage(gl.canvas as CanvasImageSource, 0, 0);
    ctx.restore();
    return performance.now() - t0;
  }
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  gradePixels(img.data, canvas.width, canvas.height, c);
  ctx.putImageData(img, 0, 0);
  return performance.now() - t0;
}

/** The measurements Auto reads, from any drawable (a tiny copy: a few ms). */
export function measureDrawable(src: CanvasImageSource, w: number, h: number, size = 96): Uint8ClampedArray | null {
  if (!w || !h || typeof document === "undefined") return null;
  const s = Math.min(1, size / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    return d;
  } catch {
    return null;
  } finally {
    c.width = 0;
    c.height = 0;
  }
}
