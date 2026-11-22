export interface CosmicWebGLFrameParams {
  width: number
  height: number
  timeSec: number
  simTime: number
  yaw: number
  pitch: number
  roll: number
  camDist: number
  fov: number
  cx: number
  cy: number
  isLoaf: boolean
  stormActive: boolean
  warpEnergy: number
  cabinBlend: number
  galaxyBlend: number
  pointerNormX: number
  pointerNormY: number
  pointerInside: boolean
  pulseWaves: readonly number[]
  accentRgb: readonly [number, number, number]
}

const VERTEX_SHADER_SOURCE = `#version 300 es
void main() {
  vec2 pos = vec2(
    gl_VertexID == 1 ? 3.0 : -1.0,
    gl_VertexID == 2 ? 3.0 : -1.0
  );
  gl_Position = vec4(pos, 0.0, 1.0);
}
`

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform vec2 u_center;
uniform float u_fov;
uniform float u_camDist;
uniform vec3 u_angles;
uniform vec2 u_times;
uniform vec4 u_state;
uniform vec4 u_blends;
uniform vec3 u_pointer;
uniform vec4 u_pulses;
uniform vec3 u_accent;
uniform float u_quality;

out vec4 fragColor;

const float TAU = 6.28318530718;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float hash31(vec3 p) {
  p = fract(p * vec3(443.897, 441.423, 437.195));
  p += dot(p, p.yzx + 19.19);
  return fract((p.x + p.y) * p.z);
}

vec3 hash33(vec3 p) {
  p = fract(p * vec3(443.8975, 397.2973, 491.1871));
  p += dot(p.zxy, p.yxz + 19.27);
  return fract(vec3(p.x * p.y, p.y * p.z, p.z * p.x));
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm2(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amp * noise2(p);
    p = rot * p * 2.04 + vec2(17.1, 31.7);
    amp *= 0.5;
  }
  return value;
}

float noise3(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);

  float n000 = hash31(i + vec3(0.0, 0.0, 0.0));
  float n100 = hash31(i + vec3(1.0, 0.0, 0.0));
  float n010 = hash31(i + vec3(0.0, 1.0, 0.0));
  float n110 = hash31(i + vec3(1.0, 1.0, 0.0));
  float n001 = hash31(i + vec3(0.0, 0.0, 1.0));
  float n101 = hash31(i + vec3(1.0, 0.0, 1.0));
  float n011 = hash31(i + vec3(0.0, 1.0, 1.0));
  float n111 = hash31(i + vec3(1.0, 1.0, 1.0));

  float nx00 = mix(n000, n100, f.x);
  float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x);
  float nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y);
  float nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}

vec3 camToWorld(vec3 v, vec3 angles) {
  float cy = cos(angles.x);
  float sy = sin(angles.x);
  float cp = cos(angles.y);
  float sp = sin(angles.y);
  float cr = cos(angles.z);
  float sr = sin(angles.z);

  vec3 v1 = vec3(v.x * cr + v.y * sr, -v.x * sr + v.y * cr, v.z);
  vec3 v2 = vec3(v1.x, v1.y * cp + v1.z * sp, -v1.y * sp + v1.z * cp);
  return vec3(v2.x * cy - v2.z * sy, v2.y, v2.x * sy + v2.z * cy);
}

vec3 diskPalette(float temp, float isLoaf, float storm) {
  float t = clamp(temp, 0.0, 1.25);
  vec3 workLow = vec3(0.10, 0.24, 0.56);
  vec3 workMid = vec3(0.24, 0.72, 0.98);
  vec3 workHigh = vec3(0.95, 0.98, 1.00);

  vec3 loafLow = vec3(0.56, 0.19, 0.07);
  vec3 loafMid = vec3(0.98, 0.64, 0.21);
  vec3 loafHigh = vec3(1.00, 0.95, 0.84);

  vec3 lowCol = mix(workLow, loafLow, isLoaf);
  vec3 midCol = mix(workMid, loafMid, isLoaf);
  vec3 highCol = mix(workHigh, loafHigh, isLoaf);

  vec3 base = mix(lowCol, midCol, smoothstep(0.0, 0.55, t));
  base = mix(base, highCol, smoothstep(0.50, 1.15, t));
  if (storm > 0.01) {
    vec3 flare = vec3(0.98, 0.42, 0.50);
    base = mix(base, flare, storm * 0.24 * (1.0 - smoothstep(0.4, 1.0, t)));
  }
  return base;
}

float shearedDiskNoise(vec2 xz, float r, float simTime, float warp) {
  float baseAngle = -simTime * (0.22 + warp * 0.14);
  float cb = cos(baseAngle);
  float sb = sin(baseAngle);
  vec2 basePos = vec2(xz.x * cb - xz.y * sb, xz.x * sb + xz.y * cb);

  float flowRate = 0.075 * (1.0 + warp * 0.45);
  float p0 = fract(simTime * flowRate);
  float p1 = fract(simTime * flowRate + 0.5);
  float blend = abs(2.0 * p0 - 1.0);

  float shearRate = 3.2 / pow(max(r, 0.72), 1.12);
  float swirl = 2.9 * log(max(r, 0.45));

  float a0 = -p0 * shearRate + swirl;
  float a1 = -p1 * shearRate + swirl;

  vec2 uv0 = vec2(
    basePos.x * cos(a0) - basePos.y * sin(a0),
    basePos.x * sin(a0) + basePos.y * cos(a0)
  );
  vec2 uv1 = vec2(
    basePos.x * cos(a1) - basePos.y * sin(a1),
    basePos.x * sin(a1) + basePos.y * cos(a1)
  );

  float n0 = fbm2(uv0 * 1.45 + vec2(3.1, -1.7));
  float n1 = fbm2(uv1 * 1.45 + vec2(3.1, -1.7));
  float coarse = mix(n0, n1, blend);

  float fine0 = noise2(uv0 * 4.4 + vec2(-7.3, 5.2));
  float fine1 = noise2(uv1 * 4.4 + vec2(-7.3, 5.2));
  float fine = mix(fine0, fine1, blend);

  float rings = 0.72 + 0.28 * sin(r * 13.5 - simTime * 0.55 + coarse * 5.2);
  return clamp((coarse * 0.68 + fine * 0.32) * rings, 0.0, 1.0);
}

vec3 evalAccretionPlane(
  vec3 hit,
  vec3 rd,
  float simTime,
  float isLoaf,
  float storm,
  float warp,
  float localWeight,
  vec4 pulses
) {
  float r = length(hit.xz);
  float rIn = 0.76;
  float rOut = 3.65;
  if (r < rIn || r > rOut) return vec3(0.0);

  float radialIn = smoothstep(rIn, rIn + 0.16, r);
  float normR = clamp((r - rIn) / (rOut - rIn), 0.0, 1.0);
  float radialOut = pow(1.0 - normR, 1.85);
  float envelope = radialIn * radialOut;

  float turb = shearedDiskNoise(hit.xz, r, simTime, warp);
  float wisps = smoothstep(0.18, 0.88, turb);
  float density = envelope * (0.34 + 0.92 * wisps);

  float innerGlow = exp(-pow((r - (rIn + 0.11)) / 0.13, 2.0)) * 0.55;
  density += innerGlow * (0.55 + 0.45 * turb);

  vec3 velDir = normalize(vec3(-hit.z, 0.0, hit.x));
  float doppler = dot(velDir, -rd);
  float beaming = pow(clamp(1.0 + 0.42 * doppler, 0.48, 1.82), 1.85);

  float heat = clamp((1.0 - normR * 0.86) + 0.24 * doppler + innerGlow * 0.35, 0.0, 1.25);
  vec3 col = diskPalette(heat, isLoaf, storm) * density * beaming;

  float pulseGlow = 0.0;
  for (int k = 0; k < 4; k++) {
    float p = k == 0 ? pulses.x : (k == 1 ? pulses.y : (k == 2 ? pulses.z : pulses.w));
    if (p > 0.001 && p < 0.999) {
      float waveR = 0.85 + p * 3.8;
      float ring = exp(-pow((r - waveR) / 0.12, 2.0)) * (1.0 - p);
      pulseGlow += ring;
    }
  }
  if (pulseGlow > 0.001) {
    vec3 waveColor = mix(vec3(0.45, 0.86, 1.0), vec3(1.0, 0.82, 0.42), isLoaf);
    col += waveColor * pulseGlow * 0.85;
  }

  return col * localWeight;
}

vec3 starLayer(vec3 dir, float gridScale, float density, float timeSec) {
  vec3 p = dir * gridScale;
  vec3 cell = floor(p);
  vec3 f = fract(p) - 0.5;
  vec3 rnd = hash33(cell);
  if (rnd.x < density) return vec3(0.0);

  vec3 offset = (rnd - 0.5) * 0.68;
  float dist = length(f - offset);
  float core = smoothstep(0.11, 0.0, dist);
  float halo = exp(-dist * 15.0) * 0.32;
  float mag = pow(hash31(cell + 17.3), 2.6);
  float twinkle = 0.78 + 0.22 * sin(timeSec * (0.9 + rnd.y * 2.2) + rnd.z * TAU);

  vec3 starCol = mix(
    vec3(0.72, 0.87, 1.0),
    vec3(1.0, 0.90, 0.74),
    smoothstep(0.25, 0.85, rnd.z)
  );
  return starCol * (core * 0.95 + halo) * (0.28 + mag * 1.15) * twinkle;
}

vec3 evalSky(vec3 dir, float timeSec, float isLoaf, float warp, float galaxy) {
  vec3 base = mix(vec3(0.006, 0.012, 0.028), vec3(0.010, 0.008, 0.022), isLoaf);

  float galacticLat = abs(dir.y * 0.86 + dir.x * 0.32 - dir.z * 0.38);
  float band = exp(-galacticLat * 4.8);
  float neb = noise3(dir * 3.2 + vec3(0.0, 0.0, timeSec * 0.004));
  float nebFine = noise3(dir * 7.5 - vec3(2.1, 1.3, 0.7));
  vec3 nebTint = mix(
    vec3(0.035, 0.075, 0.145),
    vec3(0.095, 0.062, 0.105),
    isLoaf
  );
  vec3 col = base + nebTint * band * (0.35 + 0.65 * neb * nebFine) * (1.0 - galaxy * 0.35);

  vec3 starDir = dir;
  if (warp > 0.02) {
    starDir = normalize(vec3(dir.xy * (1.0 - warp * 0.18), dir.z));
  }

  col += starLayer(starDir, 68.0, 0.86, timeSec) * 0.78;
  col += starLayer(starDir + vec3(3.1, -1.7, 2.4), 124.0, 0.90, timeSec) * 0.62;
  if (u_quality > 0.5) {
    col += starLayer(starDir + vec3(-4.2, 2.9, -1.3), 196.0, 0.925, timeSec) * 0.45;
  }

  return col;
}

vec3 evalSpiralGalaxy(vec3 ro, vec3 rd, float timeSec, float isLoaf, float galaxy) {
  if (galaxy <= 0.005) return vec3(0.0);

  vec3 col = vec3(0.0);

  float tClosest = max(0.0, -dot(ro, rd));
  vec3 pClose = ro + rd * tClosest;
  vec3 scaledClose = vec3(pClose.x, pClose.y * 2.4, pClose.z);
  float dBulge = length(scaledClose);
  float bulge = exp(-dBulge * 0.42) * 0.72 + exp(-dBulge * 0.14) * 0.16;
  vec3 bulgeCol = mix(vec3(1.0, 0.92, 0.76), vec3(1.0, 0.84, 0.54), isLoaf);
  col += bulgeCol * bulge;

  if (abs(rd.y) > 0.004) {
    float tPlane = -ro.y / rd.y;
    if (tPlane > 0.0) {
      vec3 hit = ro + rd * tPlane;
      float gr = length(hit.xz);
      if (gr > 1.1 && gr < 42.0) {
        float rot = timeSec * 0.012;
        float ca = cos(-rot);
        float sa = sin(-rot);
        vec2 p = vec2(hit.x * ca - hit.z * sa, hit.x * sa + hit.z * ca);

        float theta = atan(p.y, p.x);
        float logSpiral = 2.6 * log(max(gr, 0.5) / 3.6);
        float warpN = fbm2(p * 0.16 + vec2(4.2, -2.7));
        float armWave = cos(4.0 * (theta - logSpiral) + (warpN - 0.5) * 2.1);
        float arm = pow(0.5 + 0.5 * armWave, 2.7);
        float secondaryArm = pow(0.5 + 0.5 * cos(4.0 * (theta - logSpiral + 0.35) + warpN * 1.4), 5.0);

        float radialEnv =
          smoothstep(1.3, 4.4, gr) *
          exp(-gr * 0.088) *
          smoothstep(38.0, 20.0, gr);
        float dust = fbm2(p * 0.38 - vec2(1.9, 3.3));
        float fineDust = fbm2(p * 0.92 + vec2(6.4, -5.1));

        vec3 innerArmCol = mix(vec3(0.95, 0.84, 0.68), vec3(0.98, 0.76, 0.44), isLoaf);
        vec3 outerArmCol = mix(vec3(0.36, 0.64, 0.98), vec3(0.52, 0.56, 0.92), isLoaf);
        vec3 armCol = mix(innerArmCol, outerArmCol, smoothstep(4.5, 22.0, gr));
        vec3 pinkKnot = vec3(0.95, 0.56, 0.78);

        float cloud = (arm * (0.28 + 0.88 * dust) + secondaryArm * 0.24) * radialEnv;
        col += armCol * cloud * 0.78;
        col += pinkKnot * pow(arm * fineDust, 2.6) * radialEnv * 0.55;

        vec2 sc = p * 2.15;
        vec2 scCell = floor(sc);
        vec2 scF = fract(sc) - 0.5;
        float sr = hash21(scCell);
        if (sr > 0.58) {
          vec2 sOff = vec2(hash21(scCell + 11.7), hash21(scCell + 29.3)) - 0.5;
          float sd = length(scF - sOff * 0.65);
          float sDot = exp(-sd * sd * 38.0);
          float sTwinkle = 0.82 + 0.18 * sin(timeSec * 1.4 + sr * TAU);
          float armBoost = 0.25 + 1.45 * arm;
          vec3 sTint = mix(vec3(0.75, 0.90, 1.0), vec3(1.0, 0.92, 0.75), hash21(scCell + 5.1));
          col += sTint * sDot * radialEnv * armBoost * sTwinkle * 1.15;
        }
      }
    }
  }

  return col * galaxy;
}

vec3 acesToneMap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y);
  vec2 rel = (px - u_center) / max(u_fov, 1.0);

  if (u_pointer.z > 0.5) {
    vec2 ptrPx = u_pointer.xy * u_resolution;
    vec2 dp = (px - ptrPx) / max(min(u_resolution.x, u_resolution.y), 1.0);
    float d2 = dot(dp, dp);
    rel += dp * exp(-d2 * 26.0) * 0.012;
  }

  vec3 rdCam = normalize(vec3(rel.x, rel.y, 1.0));
  vec3 roCam = vec3(0.0, 0.0, -u_camDist);

  vec3 ro = camToWorld(roCam, u_angles);
  vec3 rd = normalize(camToWorld(rdCam, u_angles));

  float timeSec = u_times.x;
  float simTime = u_times.y;
  float isLoaf = u_state.x;
  float storm = u_state.y;
  float warp = u_state.z;
  float cabin = u_blends.x;
  float galaxy = u_blends.y;
  float localWeight = 1.0 - smoothstep(0.32, 0.94, galaxy);

  vec3 accum = vec3(0.0);
  bool captured = false;
  vec3 marchDir = rd;

  float rBound = 6.4;
  float tClosest = -dot(ro, rd);
  float ro2 = dot(ro, ro);
  float closestD2 = ro2 - tClosest * tClosest;

  if (localWeight > 0.01 && (ro2 < rBound * rBound || (tClosest > 0.0 && closestD2 < rBound * rBound))) {
    float tStart = 0.0;
    if (ro2 > rBound * rBound) {
      tStart = max(0.0, tClosest - sqrt(max(0.0, rBound * rBound - closestD2)));
    }

    vec3 pos = ro + rd * tStart;
    vec3 dir = rd;
    vec3 L = cross(pos, dir);
    float h2 = dot(L, L);

    float rS = 0.276;
    float rCapture = 0.305;
    int maxSteps = u_quality > 0.5 ? 74 : 54;
    float minR = 999.0;

    for (int i = 0; i < 74; i++) {
      if (i >= maxSteps) break;

      float r2 = dot(pos, pos);
      float r = sqrt(r2);
      minR = min(minR, r);

      if (r < rCapture) {
        captured = true;
        break;
      }
      if (r > rBound + 0.6 && dot(pos, dir) > 0.0) {
        break;
      }

      float planeProx = clamp(abs(pos.y) / max(r * 0.45, 0.25), 0.16, 1.0);
      float dt = clamp(r * 0.095 * (0.45 + 0.55 * planeProx), 0.022, 0.36);

      float invR5 = 1.0 / (r2 * r2 * r + 1e-5);
      vec3 accel = -1.5 * rS * h2 * pos * invR5;

      vec3 prevPos = pos;
      dir = normalize(dir + accel * dt);
      pos += dir * dt;

      if ((prevPos.y > 0.0 && pos.y <= 0.0) || (prevPos.y < 0.0 && pos.y >= 0.0)) {
        float frac = abs(prevPos.y) / (abs(prevPos.y) + abs(pos.y) + 1e-6);
        vec3 hit = mix(prevPos, pos, frac);
        accum += evalAccretionPlane(
          hit,
          dir,
          simTime,
          isLoaf,
          storm,
          warp,
          localWeight,
          u_pulses
        );
      }

      float rXZ = length(pos.xz);
      if (rXZ > 0.72 && rXZ < 3.65 && abs(pos.y) < 0.42) {
        float halfH = 0.065 + (rXZ - 0.72) * 0.055;
        float vFalloff = exp(-(pos.y * pos.y) / (halfH * halfH));
        float rEnv = smoothstep(0.72, 0.95, rXZ) * pow(clamp(1.0 - (rXZ - 0.72) / 2.93, 0.0, 1.0), 2.1);
        float dop = dot(normalize(vec3(-pos.z, 0.0, pos.x)), -dir);
        float heat = clamp(1.0 - (rXZ - 0.72) / 3.1 + 0.18 * dop, 0.0, 1.15);
        accum += diskPalette(heat, isLoaf, storm) * vFalloff * rEnv * dt * 0.24 * localWeight;
      }
    }

    if (!captured && minR < 0.86) {
      float ring = exp(-pow((minR - 0.44) / 0.11, 2.0));
      vec3 ringCol = mix(vec3(0.76, 0.92, 1.0), vec3(1.0, 0.91, 0.74), isLoaf);
      accum += ringCol * ring * 0.52 * localWeight;
    }

    marchDir = dir;
  }

  vec3 col = vec3(0.0);
  if (!captured) {
    col += evalSky(marchDir, timeSec, isLoaf, warp, galaxy);
  }

  if (galaxy > 0.005 && !captured) {
    col += evalSpiralGalaxy(ro, marchDir, timeSec, isLoaf, galaxy);
  }

  col += accum;

  if (!captured) {
    float centerDist = length(rel);
    vec3 softHalo = mix(u_accent, vec3(0.98, 0.72, 0.28), isLoaf * 0.65);
    col += softHalo * exp(-centerDist * 3.8) * 0.045 * localWeight * (1.0 - cabin * 0.25);
  }

  vec2 uv = px / max(u_resolution, vec2(1.0));
  float vig = 1.0 - smoothstep(0.42, 0.98, length((uv - 0.5) * vec2(1.1, 1.0)));
  col *= 0.86 + 0.14 * vig;

  col = acesToneMap(col * 1.18);
  col = pow(col, vec3(1.0 / 2.18));

  fragColor = vec4(col, 1.0);
}
`

interface CosmicWebGLUniforms {
  resolution: WebGLUniformLocation | null
  center: WebGLUniformLocation | null
  fov: WebGLUniformLocation | null
  camDist: WebGLUniformLocation | null
  angles: WebGLUniformLocation | null
  times: WebGLUniformLocation | null
  state: WebGLUniformLocation | null
  blends: WebGLUniformLocation | null
  pointer: WebGLUniformLocation | null
  pulses: WebGLUniformLocation | null
  accent: WebGLUniformLocation | null
  quality: WebGLUniformLocation | null
}

export interface CosmicWebGLRenderer {
  render: (params: CosmicWebGLFrameParams) => void
  resize: (pixelWidth: number, pixelHeight: number) => void
  isContextLost: () => boolean
  dispose: () => void
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string
): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    gl.deleteShader(shader)
    return null
  }
  return shader
}

export function createCosmicWebGLRenderer(
  canvas: HTMLCanvasElement
): CosmicWebGLRenderer | null {
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
    })
  } catch {
    gl = null
  }
  if (!gl) return null

  const vert = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE)
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE)
  if (!vert || !frag) {
    if (vert) gl.deleteShader(vert)
    if (frag) gl.deleteShader(frag)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vert)
    gl.deleteShader(frag)
    return null
  }
  gl.attachShader(program, vert)
  gl.attachShader(program, frag)
  gl.linkProgram(program)
  gl.deleteShader(vert)
  gl.deleteShader(frag)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  const vao = gl.createVertexArray()
  const uniforms: CosmicWebGLUniforms = {
    resolution: gl.getUniformLocation(program, 'u_resolution'),
    center: gl.getUniformLocation(program, 'u_center'),
    fov: gl.getUniformLocation(program, 'u_fov'),
    camDist: gl.getUniformLocation(program, 'u_camDist'),
    angles: gl.getUniformLocation(program, 'u_angles'),
    times: gl.getUniformLocation(program, 'u_times'),
    state: gl.getUniformLocation(program, 'u_state'),
    blends: gl.getUniformLocation(program, 'u_blends'),
    pointer: gl.getUniformLocation(program, 'u_pointer'),
    pulses: gl.getUniformLocation(program, 'u_pulses'),
    accent: gl.getUniformLocation(program, 'u_accent'),
    quality: gl.getUniformLocation(program, 'u_quality'),
  }

  let pixelW = Math.max(canvas.width, 1)
  let pixelH = Math.max(canvas.height, 1)

  const ctx = gl
  return {
    resize(nextW: number, nextH: number) {
      pixelW = Math.max(1, Math.floor(nextW))
      pixelH = Math.max(1, Math.floor(nextH))
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW
        canvas.height = pixelH
      }
      ctx.viewport(0, 0, pixelW, pixelH)
    },
    isContextLost() {
      return ctx.isContextLost()
    },
    render(params: CosmicWebGLFrameParams) {
      if (ctx.isContextLost()) return
      const scaleX = pixelW / Math.max(params.width, 1)
      const scaleY = pixelH / Math.max(params.height, 1)
      const scaleFov = Math.min(scaleX, scaleY)

      ctx.useProgram(program)
      ctx.bindVertexArray(vao)
      ctx.uniform2f(uniforms.resolution, pixelW, pixelH)
      ctx.uniform2f(uniforms.center, params.cx * scaleX, params.cy * scaleY)
      ctx.uniform1f(uniforms.fov, params.fov * scaleFov)
      ctx.uniform1f(uniforms.camDist, params.camDist)
      ctx.uniform3f(uniforms.angles, params.yaw, params.pitch, params.roll)
      ctx.uniform2f(uniforms.times, params.timeSec, params.simTime)
      ctx.uniform4f(
        uniforms.state,
        params.isLoaf ? 1 : 0,
        params.stormActive ? 1 : 0,
        params.warpEnergy,
        0
      )
      ctx.uniform4f(
        uniforms.blends,
        params.cabinBlend,
        params.galaxyBlend,
        0,
        0
      )
      ctx.uniform3f(
        uniforms.pointer,
        params.pointerNormX,
        params.pointerNormY,
        params.pointerInside ? 1 : 0
      )
      ctx.uniform4f(
        uniforms.pulses,
        params.pulseWaves[0] ?? 0,
        params.pulseWaves[1] ?? 0,
        params.pulseWaves[2] ?? 0,
        params.pulseWaves[3] ?? 0
      )
      ctx.uniform3f(
        uniforms.accent,
        params.accentRgb[0],
        params.accentRgb[1],
        params.accentRgb[2]
      )
      ctx.uniform1f(uniforms.quality, params.width >= 640 ? 1 : 0)
      ctx.drawArrays(ctx.TRIANGLES, 0, 3)
    },
    dispose() {
      if (!ctx.isContextLost()) {
        if (vao) ctx.deleteVertexArray(vao)
        ctx.deleteProgram(program)
      }
    },
  }
}

export function hexToNormalizedRgb(hex: string): [number, number, number] {
  const cleaned = hex.replace('#', '')
  if (cleaned.length !== 6) return [0.22, 0.74, 0.97]
  const parsed = Number.parseInt(cleaned, 16)
  if (Number.isNaN(parsed)) return [0.22, 0.74, 0.97]
  return [
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255,
  ]
}
