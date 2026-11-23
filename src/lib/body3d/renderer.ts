/**
 * A small WebGL2 renderer for the muscle-map body (no 3D library: one mesh,
 * one shader). The body wears the anatomical drawing's three views, each
 * projected from its own side and blended by which way the surface faces
 * (body-mesh.ts' `viewWeights`, the same rule the shader uses), lit with a
 * soft key light and a quiet rim. Rendered on demand, never in a loop
 * unless something is moving.
 */
import { MID } from "@/lib/pain/anatomy/geometry";
import { rayHit, viewWeights, SIDE_CENTER, type BodyMesh } from "@/lib/body3d/body-mesh";

const VS = `#version 300 es
in vec3 aPos;
in vec3 aNrm;
uniform mat4 uProj;
uniform mat4 uView;
out vec3 vAtlas;
out vec3 vN;
out vec3 vVN;
void main() {
  vAtlas = aPos;
  vN = aNrm;
  vec3 w = vec3((aPos.x - 200.0) / 460.0, (460.0 - aPos.y) / 460.0, aPos.z / 460.0);
  vVN = mat3(uView) * vec3(aNrm.x, -aNrm.y, aNrm.z);
  gl_Position = uProj * uView * vec4(w, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vAtlas;
in vec3 vN;
in vec3 vVN;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform sampler2D uSide;
uniform vec3 uRim;
uniform float uAmb;
out vec4 o;
void main() {
  vec3 n = normalize(vN);
  float dx = vAtlas.x - 200.0;
  bool inward = sign(n.x) != sign(dx) && abs(dx) > 20.0;
  float sw = pow(abs(n.x), 4.0) * (inward ? 0.25 : 1.0);
  float fw = pow(max(n.z, 0.0), 4.0);
  float bw = pow(max(-n.z, 0.0), 4.0);
  float s = sw + fw + bw + 1e-5;
  vec3 c = (texture(uFront, vec2(vAtlas.x / 400.0, vAtlas.y / 920.0)).rgb * fw
          + texture(uBack, vec2((400.0 - vAtlas.x) / 400.0, vAtlas.y / 920.0)).rgb * bw
          + texture(uSide, vec2((vAtlas.z + ${SIDE_CENTER.toFixed(1)}) / 400.0, vAtlas.y / 920.0)).rgb * sw) / s;
  vec3 vn = normalize(vVN);
  vec3 key = normalize(vec3(-0.35, 0.55, 0.75));
  vec3 fill = normalize(vec3(0.6, -0.1, 0.5));
  float d = max(dot(vn, key), 0.0) * 0.62 + max(dot(vn, fill), 0.0) * 0.16;
  float rim = pow(1.0 - max(vn.z, 0.0), 3.0);
  vec3 col = c * (uAmb + d) + uRim * rim * 0.22;
  o = vec4(col, 1.0);
}`;

function shader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

type Mat4 = Float32Array;
function perspective(fov: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fov / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
/** Rotation (yaw about y, then pitch about x) and a translation, column-major. */
function viewMatrix(
  yaw: number,
  pitch: number,
  tx: number,
  ty: number,
  tz: number,
): { m: Mat4; r: number[] } {
  const cy = Math.cos(yaw),
    sy = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  // R = Rx(pitch) * Ry(yaw)
  const r = [cy, sp * sy, -cp * sy, 0, cp, sp, sy, -sp * cy, cp * cy];
  const m = new Float32Array([
    r[0],
    r[1],
    r[2],
    0,
    r[3],
    r[4],
    r[5],
    0,
    r[6],
    r[7],
    r[8],
    0,
    tx,
    ty,
    tz,
    1,
  ]);
  return { m, r };
}

export type CameraState = { yaw: number; pitch: number; zoom: number; panY: number };

export class BodyRenderer {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private count: number;
  private tex: WebGLTexture[] = [];
  private uni: Record<string, WebGLUniformLocation | null> = {};
  cam: CameraState = { yaw: 0, pitch: 0, zoom: 1, panY: 0 };
  readonly fov = (26 * Math.PI) / 180;
  private dark = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private mesh: BodyMesh,
  ) {
    const gl = canvas.getContext("webgl2", {
      antialias: true,
      alpha: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error("no-webgl2");
    this.gl = gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(p) ?? "link");
    this.prog = p;
    for (const n of ["uProj", "uView", "uFront", "uBack", "uSide", "uRim", "uAmb"])
      this.uni[n] = gl.getUniformLocation(p, n);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const buf = (data: Float32Array, loc: number) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    buf(mesh.positions, gl.getAttribLocation(p, "aPos"));
    buf(mesh.normals, gl.getAttribLocation(p, "aNrm"));
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
    this.count = mesh.indices.length;
    gl.bindVertexArray(null);
    for (let i = 0; i < 3; i++) this.tex.push(gl.createTexture()!);
  }

  setTheme(dark: boolean) {
    this.dark = dark;
  }

  setTextures(views: [TexImageSource, TexImageSource, TexImageSource]) {
    const gl = this.gl;
    views.forEach((img, i) => {
      gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    });
  }

  private matrices() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const aspect = w / Math.max(1, h);
    const fit = Math.max(1.08 / Math.tan(this.fov / 2), 0.55 / (Math.tan(this.fov / 2) * aspect));
    const dist = fit / this.cam.zoom;
    const proj = perspective(this.fov, aspect, 0.1, 50);
    const { m, r } = viewMatrix(this.cam.yaw, this.cam.pitch, 0, -this.cam.panY, -dist);
    return { proj, view: m, r, dist, aspect };
  }

  render() {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    // the mesh is built in the drawing's space (y down): its winding flips in a y-up world
    gl.frontFace(gl.CW);
    gl.useProgram(this.prog);
    const { proj, view } = this.matrices();
    gl.uniformMatrix4fv(this.uni.uProj, false, proj);
    gl.uniformMatrix4fv(this.uni.uView, false, view);
    gl.uniform3f(this.uni.uRim, this.dark ? 0.75 : 1, this.dark ? 0.78 : 1, this.dark ? 0.85 : 1);
    gl.uniform1f(this.uni.uAmb, this.dark ? 0.46 : 0.5);
    ["uFront", "uBack", "uSide"].forEach((n, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, this.tex[i]);
      gl.uniform1i(this.uni[n], i);
    });
    gl.bindVertexArray(this.vao);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  /**
   * The surface point under a canvas pixel (CSS px from the canvas' top left),
   * in the drawing's coordinates, with which view it reads from.
   */
  pick(cssX: number, cssY: number, cssW: number, cssH: number) {
    const { r, dist, aspect } = this.matrices();
    const ndcX = (cssX / cssW) * 2 - 1;
    const ndcY = 1 - (cssY / cssH) * 2;
    const t = Math.tan(this.fov / 2);
    const dv = [ndcX * t * aspect, ndcY * t, -1];
    // view = R*w + T  →  w = Rᵀ(view − T)
    const T = [0, -this.cam.panY, -dist];
    const RT = (v: number[]) => [
      r[0] * v[0] + r[1] * v[1] + r[2] * v[2],
      r[3] * v[0] + r[4] * v[1] + r[5] * v[2],
      r[6] * v[0] + r[7] * v[1] + r[8] * v[2],
    ];
    const ow = RT([-T[0], -T[1], -T[2]]);
    const dw = RT(dv);
    const toAtlas = (w: number[]): [number, number, number] => [
      w[0] * 460 + MID,
      460 - w[1] * 460,
      w[2] * 460,
    ];
    const o = toAtlas(ow);
    const d: [number, number, number] = [dw[0] * 460, -dw[1] * 460, dw[2] * 460];
    const hit = rayHit(this.mesh, o, d);
    if (!hit) return null;
    return { ...hit, weights: viewWeights(hit.p, hit.n) };
  }

  dispose() {
    const ext = this.gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  }
}

export function webgl2Available(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}
