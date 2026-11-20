/** GLSL ES 3.00 sources for the optics viewport. */

const HEADER = `#version 300 es
precision highp float;
precision highp int;
`;

/** Shared uniforms + plain background with optional faint line grid (background and glass passes). */
const BACKDROP = `
uniform vec2 uRes;     // device px
uniform vec3 uView;    // cx, cy (mm), zoom (device px per mm)
uniform float uGrid;   // 1 = show line grid
uniform float uTime;

vec2 fragToWorld(vec2 fc) {
  vec2 s = vec2(fc.x, uRes.y - fc.y);
  return (s - 0.5 * uRes) / uView.z + uView.xy;
}

// 1 px anti-aliased line coverage for a grid of pitch p (mm)
float gridLine(vec2 w, float p) {
  vec2 g = abs(w - p * floor(w / p + 0.5)) * uView.z;   // distance to nearest line, device px
  return 1.0 - smoothstep(0.0, 1.0, min(g.x, g.y));
}

// Plain dark neutral field (#101214); faint 10 mm minor / 50 mm major lines when enabled.
vec3 backdrop(vec2 w) {
  vec3 base = vec3(0.0627, 0.0706, 0.0784);
  if (uGrid < 0.5) return base;
  float ppm = uView.z;
  float minorVis = smoothstep(4.0, 10.0, 10.0 * ppm);
  float majorVis = smoothstep(4.0, 10.0, 50.0 * ppm);
  float c = gridLine(w, 10.0) * minorVis * 0.025 + gridLine(w, 50.0) * majorVis * 0.045;
  // very zoomed out: 500 mm lines so there is still some orientation
  c = max(c, gridLine(w, 500.0) * (1.0 - majorVis) * 0.045);
  return base + vec3(c);
}
`;

export const FULLSCREEN_VS = HEADER + `
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BACKGROUND_FS = HEADER + BACKDROP + `
in vec2 vUv;
out vec4 frag;
void main() {
  vec2 w = fragToWorld(gl_FragCoord.xy);
  vec3 c = backdrop(w);
  frag = vec4(c, 1.0);
}`;

export const GLASS_VS = HEADER + `
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aCentroid;
layout(location=2) in vec3 aTint;
layout(location=3) in float aRadius;
uniform vec2 uRes; uniform vec3 uView;
out vec2 vWorld; out vec2 vCentroid; out vec3 vTint; out float vRadius;
void main() {
  vec2 px = (aPos - uView.xy) * uView.z + 0.5 * uRes;
  vWorld = aPos; vCentroid = aCentroid; vTint = aTint; vRadius = aRadius;
  gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
}`;

export const GLASS_FS = HEADER + BACKDROP + `
in vec2 vWorld; in vec2 vCentroid; in vec3 vTint; in float vRadius;
out vec4 frag;
void main() {
  vec2 d = vWorld - vCentroid;
  float k = clamp(length(d) / max(vRadius, 1e-3), 0.0, 1.0);
  // clean glass: barely-there magnification of the grid behind, flat tint, gentle rim
  vec3 bg = backdrop(vWorld - d * 0.04);
  vec3 col = bg * mix(vec3(1.0), vTint, 0.35) + vTint * 0.045;
  col += vTint * 0.04 * smoothstep(0.55, 1.0, k);
  frag = vec4(col, 1.0);
}`;

export const RAY_VS = HEADER + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSeg;    // ax ay bx by (mm)
layout(location=2) in vec4 aCol;    // r g b widthFactor
layout(location=3) in vec4 aExtra;  // s0 (mm), inMedium, capStart, capEnd
uniform vec2 uRes; uniform vec3 uView; uniform float uDpr; uniform float uWidthMm;
out vec2 vLocal; out float vLen; out float vSigma; out vec3 vCol; out float vS; out vec2 vCaps;
void main() {
  vec2 pa = (aSeg.xy - uView.xy) * uView.z + 0.5 * uRes;
  vec2 pb = (aSeg.zw - uView.xy) * uView.z + 0.5 * uRes;
  vec2 d = pb - pa; float len = length(d);
  vec2 dir = len > 1e-4 ? d / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x);
  // beam width: max(1.5 css px, beam scale), capped so zoomed-in beams stay elegant
  float wPx = clamp(uWidthMm * uView.z, 1.5 * uDpr, 6.0 * uDpr) * aCol.w;
  float sigma = wPx * 0.42;
  float ext = sigma * 3.0 + 1.0;
  float t = aCorner.x * 0.5 + 0.5;
  float capExt = (aCorner.x < 0.0 ? aExtra.z : aExtra.w) > 0.5 ? ext : 0.0;
  vec2 p = mix(pa, pb, t) + dir * aCorner.x * capExt + n * aCorner.y * ext;
  vLocal = vec2(t * len + aCorner.x * capExt, aCorner.y * ext);
  vLen = len; vSigma = sigma; vCol = aCol.rgb; vCaps = aExtra.zw;
  vS = aExtra.x * uView.z / uDpr + vLocal.x / uDpr;   // css px along the path
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;

export const RAY_FS = HEADER + `
in vec2 vLocal; in float vLen; in float vSigma; in vec3 vCol; in float vS; in vec2 vCaps;
uniform float uGain;
out vec4 frag;
void main() {
  float a = vLocal.x; float dd;
  if (a < 0.0) dd = length(vLocal);
  else if (a > vLen) dd = length(vec2(a - vLen, vLocal.y));
  else dd = abs(vLocal.y);
  float s2 = vSigma * vSigma;
  float g = exp(-0.5 * dd * dd / s2);
  float core = exp(-0.5 * dd * dd / (s2 * 0.15));
  // thin beams spread their energy over fewer pixels: keep perceived power stable
  float thin = clamp(1.6 / max(vSigma, 0.75), 0.6, 1.6);
  vec3 c = vCol * (g * 0.85 + core * 0.55) * uGain * thin;
  frag = vec4(c, 1.0);
}`;

export const SPRITE_VS = HEADER + `
layout(location=0) in vec2 aCorner;
layout(location=1) in vec4 aSpr;   // x y (mm) radiusPx(css) soft
layout(location=2) in vec4 aCol;   // r g b _
uniform vec2 uRes; uniform vec3 uView; uniform float uDpr;
out vec2 vQ; out vec3 vCol; out float vSoft;
void main() {
  vec2 c = (aSpr.xy - uView.xy) * uView.z + 0.5 * uRes;
  // soft glows (apertures, fiber ends) shrink when zoomed out; hit spots grow a little when zoomed in
  float r = aSpr.w > 0.5 ? clamp(5.0 * uView.z, 4.0 * uDpr, aSpr.z * uDpr)
                         : max(aSpr.z * uDpr, min(0.9 * uView.z, 12.0 * uDpr));
  vec2 p = c + aCorner * r;
  vQ = aCorner; vCol = aCol.rgb; vSoft = aSpr.w;
  gl_Position = vec4(p.x / uRes.x * 2.0 - 1.0, 1.0 - p.y / uRes.y * 2.0, 0.0, 1.0);
}`;

export const SPRITE_FS = HEADER + `
in vec2 vQ; in vec3 vCol; in float vSoft;
uniform float uGain;
out vec4 frag;
void main() {
  float r2 = dot(vQ, vQ);
  if (r2 > 1.0) discard;
  float g = vSoft > 0.5 ? exp(-r2 * 5.0) * 0.8 + exp(-r2 * 40.0) : exp(-r2 * 7.0) + exp(-r2 * 30.0) * 0.8;
  g *= 1.0 - smoothstep(0.8, 1.0, r2);
  frag = vec4(vCol * g * uGain, 1.0);
}`;

export const BRIGHT_FS = HEADER + `
in vec2 vUv; out vec4 frag;
uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThreshold; uniform float uScale;
void main() {
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 0.5, -0.5)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-0.5,  0.5)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25 * uScale;
  float l = max(c.r, max(c.g, c.b));
  float knee = 0.5;
  float soft = clamp(l - uThreshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float f = max(soft, l - uThreshold) / max(l, 1e-4);
  frag = vec4(c * f, 1.0);
}`;

export const DOWN_FS = HEADER + `
in vec2 vUv; out vec4 frag;
uniform sampler2D uSrc; uniform vec2 uTexel;
void main() {
  vec3 c = texture(uSrc, vUv + uTexel * vec2(-1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0, -1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2(-1.0,  1.0)).rgb
         + texture(uSrc, vUv + uTexel * vec2( 1.0,  1.0)).rgb;
  frag = vec4(c * 0.25, 1.0);
}`;

export const BLUR_FS = HEADER + `
in vec2 vUv; out vec4 frag;
uniform sampler2D uSrc; uniform vec2 uDir; // texel-scaled direction
void main() {
  vec3 c = texture(uSrc, vUv).rgb * 0.2270270270;
  c += texture(uSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture(uSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture(uSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  frag = vec4(c, 1.0);
}`;

export const COMPOSITE_FS = HEADER + `
in vec2 vUv; out vec4 frag;
uniform sampler2D uLight;
uniform sampler2D uB0; uniform sampler2D uB1; uniform sampler2D uB2; uniform sampler2D uB3; uniform sampler2D uB4;
uniform float uBloom; uniform float uExposure; uniform float uScale; uniform float uTime;
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
void main() {
  vec3 hdr = texture(uLight, vUv).rgb * uScale * uExposure;
  if (uBloom > 0.0) {
    vec3 b = texture(uB0, vUv).rgb * 0.10 + texture(uB1, vUv).rgb * 0.08 + texture(uB2, vUv).rgb * 0.06
           + texture(uB3, vUv).rgb * 0.05 + texture(uB4, vUv).rgb * 0.04;
    hdr += b * uBloom;   // bloom chain is already exposed (bright-pass applies uExposure)
  }
  // keep saturated monochrome beams colourful: desaturate toward white only when very hot
  float peak = max(hdr.r, max(hdr.g, hdr.b));
  hdr += vec3(max(peak - 2.5, 0.0) * 0.08);
  vec3 m = aces(hdr);
  m = pow(m, vec3(1.0 / 2.2));
  m += (ign(gl_FragCoord.xy + 0.0) - 0.5) / 255.0;
  frag = vec4(max(m, 0.0), 1.0);
}`;
