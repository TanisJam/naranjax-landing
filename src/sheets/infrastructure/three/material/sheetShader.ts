/**
 * GLSL injected into MeshPhysicalMaterial via onBeforeCompile.
 *
 * Everything about the shape lives here and is driven by uniforms. The CPU only
 * ever uploads a (u, v, shell) grid — see shellGeometry.ts. Animating the piece
 * is therefore a matter of writing uniforms, never of touching a buffer.
 */

export const VERTEX_PRELUDE = /* glsl */ `
attribute vec2 aParam;
attribute float aShell;

uniform float uLength;
uniform float uWidth;
uniform float uTipScale;
uniform float uAngleStart;
uniform float uAngleEnd;
uniform float uCrownStart;
uniform float uCrownEnd;
uniform float uRollStart;
uniform float uRollEnd;
uniform float uLift;
uniform float uBow;
uniform float uThickness;
uniform float uCornerRadius;
uniform float uRibFrequency;
uniform float uRibAmplitude;
uniform float uRibPhase;
uniform float uOpen;
uniform float uCurl;
uniform float uBendCenter;
uniform float uBendAmount;

varying vec2 vParam;
varying vec3 vTangentU;
varying vec3 vTangentV;
varying vec3 vWorldPos;
varying float vBevel;

const float SHEET_PI = 3.141592653589793;
const float SHEET_HALF_PI = 1.5707963267948966;
const float SHEET_TWO_PI = 6.283185307179586;

/**
 * How far the drag bend reaches either side of its centre, along the sweep.
 *
 * What the eye reads off a deformation is the SLOPE, not the height — a normal
 * that turns is what changes the shading, and a rise spread thin enough turns
 * nothing. This number is the denominator of that slope, which makes it as much
 * of an amplitude control as the amplitude is: the same displacement over 0.3 of
 * the length is half again as steep as it is over 0.45, and reads at half the
 * travel.
 *
 * The floor is where it stops being a card. A plate pushed at a point flexes
 * along a real fraction of its length, so tightening this much further trades a
 * sheet giving way for a dent punched into a slab.
 */
const float SHEET_BEND_REACH = 0.3;

// The guide curve the cross-section is swept along.
vec3 spineAt(float u) {
  return vec3(
    (u - 0.5) * uLength,
    uLift * uCurl * u * u * u,
    uBow * sin(u * SHEET_PI)
  );
}

// Closed-form derivative of spineAt. The surface is sampled five times per
// vertex for the finite-difference normals, so differencing the spine as well
// would triple the trig in the hottest function in the program.
vec3 spineTangentAt(float u) {
  return vec3(
    uLength,
    3.0 * uLift * uCurl * u * u,
    uBow * SHEET_PI * cos(u * SHEET_PI)
  );
}

// Orthonormal frame on the spine, rolled progressively along the sweep. The
// roll is what turns the tail into a twisted crest instead of a plain arch.
void frameAt(float u, out vec3 origin, out vec3 binormal, out vec3 normalAxis) {
  origin = spineAt(u);
  vec3 tangent = normalize(spineTangentAt(u));
  vec3 b = normalize(cross(tangent, vec3(0.0, 1.0, 0.0)));
  vec3 n = normalize(cross(b, tangent));

  // Biased hard toward the tip. A linear roll twists the whole body into a
  // blade; the reference keeps the body calm and curls only the last stretch.
  float roll = mix(uRollStart, uRollEnd, pow(u, 2.4)) * uCurl;
  float c = cos(roll);
  float s = sin(roll);
  binormal = b * c + n * s;
  normalAxis = n * c - b * s;
}

// Arc cross-section expressed in the (binormal, normalAxis) plane.
//
// Two things vary along the sweep. Arc *length* is held constant while the
// *angle* changes, so a sheet flattening out keeps its width instead of
// collapsing to a point. And the crown — the point of the arc that stays
// tangent to the frame — migrates, which is what raises a single edge into a
// crest while the rest of the sheet stays calm.
void sectionAt(float u, float v, out vec2 offset, out vec2 inPlaneNormal) {
  float k = smoothstep(0.0, 1.0, u);
  float arcLength = uWidth * mix(1.0, uTipScale, k);
  float angle = max(mix(uAngleStart, uAngleEnd, k) * uOpen, 1e-3);
  float crown = mix(uCrownStart, uCrownEnd, k);
  float radius = arcLength / angle;

  float theta = (v - crown) * angle;
  // Anchor v = 0.5 to the spine so moving the crown does not translate the
  // whole sheet away from its own hinge.
  float anchor = (0.5 - crown) * angle;

  offset = vec2(sin(theta) - sin(anchor), cos(theta) - cos(anchor)) * radius;
  inPlaneNormal = vec2(sin(theta), cos(theta));
}

// Bends the square parameter domain onto a rounded rectangle, so the plate
// reads as a card rather than a slab.
//
// The corners are the only region that moves: outside the two corner blocks
// this is the identity, which is why the straight sides stay straight and the
// bevel keeps meeting itself exactly on the boundary. Inside a block, the
// elliptical grid mapping carries the unit square onto the quarter disc while
// holding both of its straight edges fixed, so the arc joins the flat sides
// with no crease. Cutting the corner off with a diagonal instead leaves a
// visible facet at this radius, and a smoothstep falloff bulges the sides.
vec2 roundedRectParam(vec2 p) {
  if (uCornerRadius <= 0.0) return p;

  vec2 halfSize = vec2(uLength, uWidth) * 0.5;
  // Measured against the short side, so the corner is a circle on a card-
  // proportioned plate instead of an ellipse stretched along the long axis.
  float radius = uCornerRadius * min(uLength, uWidth);
  vec2 corner = min(vec2(radius) / halfSize, vec2(1.0));

  vec2 centred = (p - 0.5) * 2.0;
  vec2 t = (abs(centred) - (1.0 - corner)) / corner;
  if (t.x <= 0.0 || t.y <= 0.0) return p;

  vec2 disc = vec2(
    t.x * sqrt(max(1.0 - t.y * t.y * 0.5, 0.0)),
    t.y * sqrt(max(1.0 - t.x * t.x * 0.5, 0.0))
  );

  return sign(centred) * ((1.0 - corner) + corner * disc) * 0.5 + 0.5;
}

// The zero-thickness surface, ribs and hover bend included so the
// finite-difference normals below pick both up for free. That is not a
// convenience for the ribs and it is load-bearing for the bend: a bow the
// silhouette shows but the shading does not reads as a bug, and differencing a
// displacement that is already in the position is exact where a hand-derived
// normal for it would be one more thing to keep in sync.
vec3 basePosition(vec2 raw) {
  vec2 p = roundedRectParam(raw);

  vec3 origin, binormal, normalAxis;
  frameAt(p.x, origin, binormal, normalAxis);

  vec2 offset, inPlaneNormal;
  sectionAt(p.x, p.y, offset, inPlaneNormal);

  vec3 pos = origin + binormal * offset.x + normalAxis * offset.y;

  // Both displacements ride the surface normal, so it is worth computing once.
  // Ten of the eleven layers take neither branch on any given frame — these are
  // uniform conditions, coherent across the whole draw call.
  if (uRibAmplitude > 0.0 || uBendAmount != 0.0) {
    vec3 surfaceNormal = binormal * inPlaneNormal.x + normalAxis * inPlaneNormal.y;

    if (uRibAmplitude > 0.0) {
      float fade = smoothstep(0.0, 0.06, p.x) * smoothstep(0.0, 0.06, 1.0 - p.x);
      pos += surfaceNormal * sin(p.y * uRibFrequency * SHEET_TWO_PI + uRibPhase)
           * uRibAmplitude * fade;
    }

    // The drag bend: the plate giving way under a finger pushing across it.
    //
    // SIGNED, and that is the whole of what makes it a gesture rather than a
    // state. Positive is out of the face, negative is into it, and which one
    // arrives is decided by where the pointer is heading — not by the fact that
    // it is here. A pointer standing still pushes nothing and this is zero.
    //
    // Along the sweep only, and that is a physical claim, not a shortcut. Card
    // stock is stiff across its short axis and flexible along its long one, so
    // a card pushed at one point moves across its ENTIRE width there and falls
    // away toward the ends. Localising it in v as well would be a finger poked
    // through a sheet of rubber.
    //
    // Raised cosine rather than a gaussian, because this one closes. It reaches
    // zero at the edge of its reach and arrives with zero slope, so the flat
    // plate meets the bow with no crease and the term costs nothing outside its
    // own span. A gaussian's tail never quite shuts, and the far end of the card
    // stays imperceptibly bent — which the rim light finds even when the eye
    // does not.
    //
    // Truncation at the ends is correct rather than a case to guard: with the
    // centre near u = 0 the bell is cut off mid-rise and the tip of the card
    // simply swings, which is what a card pushed near its end does.
    if (uBendAmount != 0.0) {
      float d = (p.x - uBendCenter) / SHEET_BEND_REACH;
      if (abs(d) < 1.0) {
        pos += surfaceNormal * (0.5 + 0.5 * cos(d * SHEET_PI)) * uBendAmount;
      }
    }
  }

  return pos;
}

// Bullnose edge. Instead of extruding a flat slab and chamfering it, the
// parameter is pushed inward along a quarter circle of radius thickness/2 while
// the height rises along the same arc. Top and bottom shells therefore meet at
// zero height exactly on the boundary and the plate closes itself.
void bevelAt(vec2 p, out vec2 remapped, out float height, out float angle, out vec2 outward) {
  float r = uThickness * 0.5;

  float du = min(p.x, 1.0 - p.x) * uLength;
  float dv = min(p.y, 1.0 - p.y) * uWidth;

  float au = clamp(du / r, 0.0, 1.0) * SHEET_HALF_PI;
  float av = clamp(dv / r, 0.0, 1.0) * SHEET_HALF_PI;

  float duOut = r * (1.0 - cos(au)) + max(du - r, 0.0);
  float dvOut = r * (1.0 - cos(av)) + max(dv - r, 0.0);

  remapped.x = p.x < 0.5 ? duOut / uLength : 1.0 - duOut / uLength;
  remapped.y = p.y < 0.5 ? dvOut / uWidth : 1.0 - dvOut / uWidth;

  float hu = r * sin(au);
  float hv = r * sin(av);

  height = min(hu, hv);
  angle = min(au, av);
  outward = hu <= hv
    ? vec2(p.x < 0.5 ? -1.0 : 1.0, 0.0)
    : vec2(0.0, p.y < 0.5 ? -1.0 : 1.0);
}

void surfaceAt(
  vec2 p,
  float shell,
  out vec3 position,
  out vec3 shadingNormal,
  out vec3 tangentU,
  out vec3 tangentV,
  out float bevelBlend
) {
  vec2 remapped;
  float height;
  float angle;
  vec2 outward;
  bevelAt(p, remapped, height, angle, outward);

  float e = 1.5e-3;
  vec3 center = basePosition(remapped);
  tangentU = normalize(basePosition(remapped + vec2(e, 0.0)) - basePosition(remapped - vec2(e, 0.0)));
  tangentV = normalize(basePosition(remapped + vec2(0.0, e)) - basePosition(remapped - vec2(0.0, e)));

  vec3 baseNormal = normalize(cross(tangentV, tangentU));
  position = center + baseNormal * (shell * height);

  // Exact bullnose normal: at the rim (angle 0) it points straight out of the
  // edge, in the flat interior (angle PI/2) it is the surface normal. No second
  // round of finite differencing needed.
  vec3 edgeDir = normalize(tangentU * outward.x + tangentV * outward.y);
  shadingNormal = normalize(baseNormal * (shell * sin(angle)) + edgeDir * cos(angle));

  // 0 on the very rim, 1 across the flat interior. The fragment stage uses this
  // to polish and light the bullnose specifically.
  bevelBlend = sin(angle);
}
`

/**
 * Replaces `<beginnormal_vertex>`. The locals declared here stay in scope for
 * `<begin_vertex>` further down the same main(), which is how the position
 * survives without a second evaluation.
 */
export const VERTEX_NORMAL_CHUNK = /* glsl */ `
vec3 gPosition;
vec3 gNormal;
vec3 gTangentU;
vec3 gTangentV;
float gBevel;
surfaceAt(aParam, aShell, gPosition, gNormal, gTangentU, gTangentV, gBevel);
vec3 objectNormal = gNormal;
`

export const VERTEX_POSITION_CHUNK = /* glsl */ `
vec3 transformed = gPosition;
vParam = aParam;
vBevel = gBevel;
vWorldPos = (modelMatrix * vec4(gPosition, 1.0)).xyz;
vTangentU = normalize(normalMatrix * gTangentU);
vTangentV = normalize(normalMatrix * gTangentV);
`

/**
 * Replaces `<begin_vertex>` in the shadow depth material.
 *
 * The shadow pass normally renders with three's plain MeshDepthMaterial, which
 * knows nothing about this geometry: the `position` attribute is a zero buffer
 * and every vertex is computed here in the vertex shader (see shellGeometry.ts).
 * Without this chunk a sheet collapses to a point in the shadow map and casts
 * nothing at all.
 *
 * The depth vertex shader has no `<beginnormal_vertex>` chunk, so the surface
 * evaluation runs inline instead of reusing VERTEX_NORMAL_CHUNK. The varyings
 * from the prelude are assigned flat values so the program always links, even
 * though the depth fragment shader never reads them.
 */
export const VERTEX_DEPTH_POSITION_CHUNK = /* glsl */ `
vec3 gDepthPosition;
vec3 gDepthNormal;
vec3 gDepthTangentU;
vec3 gDepthTangentV;
float gDepthBevel;
surfaceAt(aParam, aShell, gDepthPosition, gDepthNormal, gDepthTangentU, gDepthTangentV, gDepthBevel);
vec3 transformed = gDepthPosition;
vParam = aParam;
vBevel = gDepthBevel;
vWorldPos = vec3(0.0);
vTangentU = vec3(0.0);
vTangentV = vec3(0.0);
`

export const FRAGMENT_PRELUDE = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec4 uGradient;
uniform float uDotScale;
uniform float uDotDepth;
uniform float uDotContrast;
uniform vec3 uDotTint;
uniform float uRibFrequency;
uniform float uRibPhase;
uniform float uRibShading;
uniform float uRibContrast;
uniform vec3 uRimColor;
uniform float uRimStrength;
uniform float uRimPower;
uniform float uBevelGlow;
uniform vec3 uCoreColor;
uniform float uAbsorption;
uniform sampler2D uDecalMap;
uniform float uDecalInk;
uniform float uDecalRelief;

varying vec2 vParam;
varying vec3 vTangentU;
varying vec3 vTangentV;
varying vec3 vWorldPos;
varying float vBevel;

const float SHEET_TWO_PI = 6.283185307179586;

/**
 * Where the decal is read.
 *
 * The raw parameter, not the rounded one: the corner remap belongs to the
 * silhouette, and pushing the artwork through it would drag the layout into
 * the corners with it. The v axis is flipped because the canvas is authored
 * with +y running down.
 */
vec2 decalUv() {
  return vec2(vParam.x, 1.0 - vParam.y);
}

// Shared by the albedo and the normal so both stay in lockstep. Measuring the
// reference showed the dots sitting 6 lightness points below the sheet body and
// 15 points more saturated — they are a real change of surface, not just a
// bump. Perturbing the normal alone made them vanish entirely.
void dotField(out float mask, out vec2 slope, out float fade) {
  vec2 cell = vec2(vParam.x * uDotScale * 0.55, vParam.y * uDotScale);
  cell.x += 0.5 * step(1.0, mod(floor(cell.y), 2.0));

  // Procedural normals cannot mipmap, so fade the pattern out once a pixel
  // spans half a cell or it turns into moire.
  fade = 1.0 - smoothstep(0.2, 0.45, max(fwidth(cell.x), fwidth(cell.y)));

  vec2 local = fract(cell) - 0.5;
  float dist = length(local);
  mask = smoothstep(0.36, 0.14, dist);
  slope = dist > 1e-4 ? (local / dist) * mask * (1.0 - mask) * 4.0 : vec2(0.0);
}

float ribField(out float fade) {
  float phase = vParam.y * uRibFrequency * SHEET_TWO_PI + uRibPhase;
  // Narrow window, fully faded well before a cycle nears the pixel grid.
  // Wider windows (1.1..2.8 previously) leave the pattern half-visible right
  // where it interferes with the pixel grid, which is exactly where moire lives.
  fade = 1.0 - smoothstep(1.1, 2.2, fwidth(phase));
  return cos(phase);
}
`

/** Appended to `<color_fragment>`. The gradient is computed, never sampled. */
export const FRAGMENT_COLOR_CHUNK = /* glsl */ `
// Both texture fields are evaluated exactly once, here, and the results ride
// along as locals for the roughness, normal and emissive chunks further down
// the same main(). Sampling them per-consumer instead cost 36 ms/frame — three
// evaluations of fract/length/smoothstep/fwidth per fragment where one does.
float gRibFade = 0.0;
float gRib = 0.0;
if (uRibShading > 0.0 || uRibContrast > 0.0) {
  gRib = ribField(gRibFade);
}

float gDotMask = 0.0;
float gDotFade = 0.0;
vec2 gDotSlope = vec2(0.0);
if (uDotScale > 0.0) {
  dotField(gDotMask, gDotSlope, gDotFade);
}

float gradientT = clamp(
  uGradient.x
    + uGradient.y * vParam.x
    + uGradient.z * vParam.y
    + uGradient.w * (vWorldPos.y * 0.5 + 0.5),
  0.0,
  1.0
);
diffuseColor.rgb *= mix(uColorA, uColorB, gradientT);

if (uDotContrast > 0.0) {
  diffuseColor.rgb *= mix(vec3(1.0), uDotTint, gDotMask * gDotFade * uDotContrast);
}

if (uRibContrast > 0.0) {
  diffuseColor.rgb *= 1.0 + gRib * gRibFade * uRibContrast;
}

// Decal ink. Coverage lives in the alpha channel, which is also the height
// field the normal chunk reads — one texture, two independent uses, so a
// pressed shape and a printed one can share the same drawing.
if (uDecalInk > 0.0) {
  vec4 decal = texture2D(uDecalMap, decalUv());
  float ink = decal.a * uDecalInk;
  diffuseColor.rgb = mix(diffuseColor.rgb, decal.rgb, ink);
  // Ink is opaque even when the film under it is not, and that is the only way
  // a clear layer can carry a print. Tied together, the layer has to choose:
  // enough alpha to read the engraving turns the whole sheet into a grey slab
  // wherever the dark panel is behind it, and enough transparency to disappear
  // takes the engraving with it. Printing on glass does not work that way.
  diffuseColor.a = mix(diffuseColor.a, 1.0, ink);
}
`

/**
 * Appended to `<normal_fragment_maps>`. Ribs and dots are far too fine to
 * tessellate at full frequency, so the geometry carries a low-amplitude version
 * for the silhouette and this carries the shading.
 */
export const FRAGMENT_NORMAL_CHUNK = /* glsl */ `
if (uRibShading > 0.0) {
  normal = normalize(normal + vTangentV * gRib * uRibShading * gRibFade);
}

if (uDotScale > 0.0) {
  normal = normalize(
    normal + (vTangentU * gDotSlope.x + vTangentV * gDotSlope.y) * uDotDepth * gDotFade
  );
}

// Emboss. The decal's coverage is a height field, and its gradient tilts the
// normal — which is the whole of what a shape pressed into plastic does to the
// light. Sampled at a deliberately wide offset: these are soft die-pressed
// forms, and a texel-width difference would turn every one of them into a
// wire outline instead of a swell.
if (uDecalRelief > 0.0) {
  vec2 uv = decalUv();
  const float reach = 0.006;
  float dx = texture2D(uDecalMap, uv + vec2(reach, 0.0)).a
           - texture2D(uDecalMap, uv - vec2(reach, 0.0)).a;
  float dy = texture2D(uDecalMap, uv + vec2(0.0, reach)).a
           - texture2D(uDecalMap, uv - vec2(0.0, reach)).a;
  // dy is measured along the flipped v of decalUv(), so it re-enters the
  // surface frame with the opposite sign to dx.
  normal = normalize(normal - (vTangentU * dx - vTangentV * dy) * uDecalRelief);
}
`

/**
 * Appended to `<emissivemap_fragment>`, which runs after the normal is final.
 * This is the white glow that rides the bevel — the bullnose plus the env map
 * gets most of the way there, this pushes the last bit.
 */
export const FRAGMENT_EMISSIVE_CHUNK = /* glsl */ `
// Volumetric absorption — the single thing that separates a translucent polymer
// from painted plastic.
//
// Sampling the reference's top sheet gives lightness 41 / saturation 81 looking
// straight at it, against 47 / 56 at a grazing angle. That is backwards for a
// surface material, where grazing angles are darker. It is exactly right for a
// volume: face-on you are looking *through* the body and the colour deepens as
// light is absorbed, while at grazing angles Fresnel reflection of the
// environment takes over and washes it out.
//
// Multiplying by a saturated core colour absorbs the long wavelengths faster,
// which is Beer-Lambert in spirit and costs one dot product.
//
// This runs before <lights_physical_fragment>, so the lighting sees the
// absorbed colour rather than being layered on top of it.
float facing = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
diffuseColor.rgb *= mix(vec3(1.0), uCoreColor, facing * uAbsorption);

float rimFresnel = pow(
  1.0 - clamp(abs(dot(normalize(normal), normalize(vViewPosition))), 0.0, 1.0),
  uRimPower
);
totalEmissiveRadiance += uRimColor * rimFresnel * uRimStrength;

// The bright band riding every bullnose. A plain fresnel term fires across the
// whole surface at grazing angles; this one is anchored to the bevel itself,
// which is where the reference actually puts it.
totalEmissiveRadiance += uRimColor * (1.0 - smoothstep(0.0, 0.35, vBevel)) * uBevelGlow;
`

/**
 * Appended to `<roughnessmap_fragment>`, which three emits after
 * `<color_fragment>` — that ordering is what lets this reuse the texture-field
 * locals instead of recomputing them.
 *
 * A rounded edge is polished by the same process that rounds it, so the bevel
 * is always glossier than the face it borders. Without this the highlight sits
 * on the edge but stays dull.
 */
export const FRAGMENT_ROUGHNESS_CHUNK = /* glsl */ `
roughnessFactor *= mix(0.25, 1.0, smoothstep(0.0, 0.45, vBevel));

// Detail that shrinks below a pixel must not vanish — it has to become
// roughness.
//
// Fading the rib and dot normals out on their own left a broad soft band
// wherever the fade sat halfway across the surface: "textured" and "smooth"
// shade to different averages, so the eye reads the boundary as a channel
// pressed into the plate. Feeding the lost normal variance back in as roughness
// keeps the average constant and the transition stops being visible at all.
if (uRibShading > 0.0) {
  float lost = (1.0 - gRibFade) * uRibShading;
  roughnessFactor = sqrt(min(roughnessFactor * roughnessFactor + lost * lost, 1.0));
}

if (uDotScale > 0.0) {
  float lost = (1.0 - gDotFade) * uDotDepth * 0.4;
  roughnessFactor = sqrt(min(roughnessFactor * roughnessFactor + lost * lost, 1.0));
}
`
