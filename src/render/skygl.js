// WebGL sky layer: photographic Milky Way (ESO/S. Brunier panorama, CC BY 4.0) mapped through the same
// projection as the 2D layer, plus the atmosphere gradient, horizon skyglow and twilight glow — all per
// pixel in a fragment shader. The 2D canvas draws stars, lines and labels on top.
import { precessionMatrix } from "../engine/transform.js";

// J2000 equatorial → galactic (IAU 1958 pole), rows = galactic x (l=0), y (l=90), z (NGP)
const EQ_TO_GAL = [-0.0548755604, -0.8734370902, -0.4838350155, 0.4941094279, -0.4448296300, 0.7469822445, -0.8676661490, -0.1980763734, 0.4559837762];

const VS = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `
precision highp float;
uniform vec2 u_res; uniform float u_F; uniform vec2 u_c; uniform float u_gnomonic;
uniform mat3 u_cam;      // camera (right, up, forward) rows → ENU: dir = X*r + Y*u + Z*f  (passed as columns r,u,f)
uniform mat3 u_enu2gal;  // ENU → galactic (of date handled inside)
uniform float u_sunAlt;  // radians
uniform vec3 u_sunDir;   // ENU unit vector toward the Sun
uniform float u_mw;      // Milky Way intensity multiplier
uniform float u_sky;     // 1 = draw atmosphere, 0 = transparent (AR)
uniform sampler2D u_tex;
uniform float u_flip;    // 1 or -1: galactic longitude direction in the texture
const float PI = 3.14159265;

vec3 mixSky(float t, float sunAlt) {
  // colour stops by Sun altitude, blended between zenith (t=1) and horizon (t=0)
  vec3 zenNight = vec3(0.008, 0.012, 0.04), horNight = vec3(0.03, 0.04, 0.09);
  vec3 zenAstro = vec3(0.02, 0.03, 0.08), horAstro = vec3(0.05, 0.06, 0.14);
  vec3 zenNaut = vec3(0.04, 0.08, 0.22), horNaut = vec3(0.23, 0.16, 0.26);
  vec3 zenCivil = vec3(0.10, 0.28, 0.62), horCivil = vec3(0.89, 0.60, 0.35);
  vec3 zenDay = vec3(0.11, 0.39, 0.82), horDay = vec3(0.61, 0.77, 0.96);
  float d = degrees(sunAlt);
  vec3 zen, hor;
  if (d > 0.0) { float k = clamp(d / 8.0, 0.0, 1.0); zen = mix(zenCivil, zenDay, k); hor = mix(horCivil, horDay, k); }
  else if (d > -6.0) { float k = -d / 6.0; zen = mix(zenCivil, zenNaut, k); hor = mix(horCivil, horNaut, k); }
  else if (d > -12.0) { float k = (-d - 6.0) / 6.0; zen = mix(zenNaut, zenAstro, k); hor = mix(horNaut, horAstro, k); }
  else if (d > -18.0) { float k = (-d - 12.0) / 6.0; zen = mix(zenAstro, zenNight, k); hor = mix(horAstro, horNight, k); }
  else { zen = zenNight; hor = horNight; }
  return mix(hor, zen, pow(clamp(t, 0.0, 1.0), 0.55));
}

void main() {
  float X1 = (gl_FragCoord.x - u_c.x) / u_F, Y1 = (gl_FragCoord.y - u_c.y) / u_F;
  vec3 cam;
  if (u_gnomonic > 0.5) { cam = normalize(vec3(X1, Y1, 1.0)); }
  else { float r2 = X1 * X1 + Y1 * Y1; float Z = (4.0 - r2) / (4.0 + r2); cam = vec3(X1 * (1.0 + Z) * 0.5, Y1 * (1.0 + Z) * 0.5, Z); }
  vec3 dir = u_cam * cam;                     // ENU
  float alt = asin(clamp(dir.z, -1.0, 1.0));
  float vis = clamp((-degrees(u_sunAlt) - 2.0) / 10.0, 0.0, 1.0);   // star/Milky-Way visibility (1 below −12°)

  // Milky Way from the panorama (galactic coordinates)
  vec3 g = u_enu2gal * dir;
  float l = atan(g.y, g.x), b = asin(clamp(g.z, -1.0, 1.0));
  vec2 uv = vec2(0.5 - u_flip * l / (2.0 * PI), 0.5 - b / PI);
  vec3 tex = texture2D(u_tex, uv).rgb;
  tex = pow(tex, vec3(1.35)) * u_mw * vis;
  float ext = smoothstep(-0.02, 0.22, alt);   // extinction toward the horizon
  tex *= ext;

  vec3 col = vec3(0.0); float a = 0.0;
  if (u_sky > 0.5) {
    col = mixSky(alt / (PI * 0.5), u_sunAlt);
    // skyglow / airglow band above the horizon
    col += vec3(0.10, 0.12, 0.19) * exp(-max(alt, 0.0) / 0.10) * (1.0 - 0.5 * clamp(degrees(u_sunAlt) + 6.0, 0.0, 6.0) / 6.0);
    // twilight glow toward the Sun
    float d = degrees(u_sunAlt);
    if (d > -18.0 && d < 8.0) {
      float k = d < 0.0 ? (d + 18.0) / 18.0 : 1.0;
      vec3 sh = normalize(vec3(u_sunDir.xy, 0.0));
      float c = max(dot(normalize(vec3(dir.xy, 0.0)), sh), 0.0);
      col += vec3(1.0, 0.55, 0.28) * pow(c, 5.0) * k * exp(-max(alt, 0.0) / 0.35) * 0.9;
    }
    if (alt < 0.0) col *= 0.35;
    a = 1.0;
  }
  col += tex;
  gl_FragColor = vec4(col, max(a, u_sky < 0.5 ? clamp(max(max(tex.r, tex.g), tex.b) * 1.5, 0.0, 1.0) : 1.0));
}`;

export class SkyGL {
  constructor(canvas, textureUrl) {
    this.canvas = canvas; this.ok = false; this.ready = false; this.flip = 1;
    const gl = canvas.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: false });
    if (!gl) return;
    this.gl = gl;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    try {
      const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      gl.useProgram(prog); this.prog = prog;
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      this.u = {}; for (const n of ["u_res", "u_F", "u_c", "u_gnomonic", "u_cam", "u_enu2gal", "u_sunAlt", "u_sunDir", "u_mw", "u_sky", "u_tex", "u_flip"]) this.u[n] = gl.getUniformLocation(prog, n);
      const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.tex = tex; this.ok = true;
      const img = new Image(); img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img); this.ready = true; this.onReady?.(); };
      img.onerror = () => { this.ok = false; };
      img.src = textureUrl;
    } catch (e) { console.warn("SkyGL disabled:", e.message); this.ok = false; }
  }
  resize(w, h, dpr) { const W = Math.round(w * dpr), H = Math.round(h * dpr); if (this.canvas.width !== W || this.canvas.height !== H) { this.canvas.width = W; this.canvas.height = H; } this.gl?.viewport(0, 0, W, H); }
  /** @param sc scene: projector, sunAlt (deg), sunAz, epochMs, transparent, mwIntensity */
  render(sc, dpr) {
    if (!this.ok) return false;
    const gl = this.gl, P = sc.projector, u = this.u;
    gl.useProgram(this.prog);
    gl.uniform2f(u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.u_F, P.F * dpr); gl.uniform2f(u.u_c, P.cx * dpr, this.canvas.height - P.cy * dpr);
    gl.uniform1f(u.u_gnomonic, P.gnomonic ? 1 : 0);
    // columns = r, u, f  (GL is column-major)
    gl.uniformMatrix3fv(u.u_cam, false, new Float32Array([...P.r, ...P.u, ...P.f]));
    // ENU → eq of date (transpose of eqHor) → J2000 (transpose of precession) → galactic
    const M = precessionMatrix(sc.epochMs), e = P.eqHor;
    const eqOfDateFromEnu = [e[0], e[3], e[6], e[1], e[4], e[7], e[2], e[5], e[8]];           // row-major transpose
    const j2000FromDate = [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
    const A = mul(EQ_TO_GAL, mul(j2000FromDate, eqOfDateFromEnu));                             // row-major
    gl.uniformMatrix3fv(u.u_enu2gal, false, new Float32Array([A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]]));
    gl.uniform1f(u.u_sunAlt, sc.sunAlt * Math.PI / 180);
    const sa = sc.sunAlt * Math.PI / 180, sz = sc.sunAz * Math.PI / 180;
    gl.uniform3f(u.u_sunDir, Math.cos(sa) * Math.sin(sz), Math.cos(sa) * Math.cos(sz), Math.sin(sa));
    gl.uniform1f(u.u_mw, this.ready ? (sc.mwIntensity ?? 1) : 0);
    gl.uniform1f(u.u_sky, sc.transparent ? 0 : 1);
    gl.uniform1f(u.u_flip, this.flip);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(u.u_tex, 0);
    gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    return true;
  }
}
function mul(a, b) { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j]; return r; }
