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

/**
 * This layer's place in the stack, and the stack's own frame.
 *
 * uStackMatrix carries a vertex from mesh space into the artwork's space,
 * which is where the layers are genuinely stacked along +Y. It is NOT world
 * space, and that is the point: the idle float, the pointer parallax and the
 * resting pose all sit ABOVE the artwork and move every layer together, so
 * occlusion computed in the artwork's frame is invariant under all three. In
 * world space the same answer would have to be recomputed against a stack axis
 * that swings every frame.
 */
uniform mat4 uStackMatrix;
uniform float uLayerIndex;

/**
 * Every layer's footprint, shared by all of them and rewritten each frame.
 *
 *   uOccluder       — centre.x, centre.z, and the plate's own +X axis in xz
 *   uOccluderExtent — half length, half width, centre.y, how much light it stops
 *
 * An axis rather than an angle because the test wants a dot product and not a
 * trig call, and because the plates only ever rotate about Y — their fan
 * rotation is [0, twist, 0] — so two components describe the frame completely.
 */
uniform vec4 uOccluder[SHEET_LAYERS];
uniform vec4 uOccluderExtent[SHEET_LAYERS];
uniform float uOcclusionStrength;

/**
 * How far a shadow slides sideways per unit of height, in the artwork's frame.
 *
 * This is the key light's own direction, divided through by its vertical
 * component and rewritten every frame — the lights are fixed in the world while
 * the artwork turns under the pointer and floats, so the direction shadows fall
 * in is only constant in world space, and the stack is not.
 */
uniform vec2 uShadowDrift;

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
uniform float uPeel;
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
varying float vOcclusion;
varying float vStackShadow;
varying float vImperfection;
varying float vShell;

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

/**
 * Value noise, smoothed.
 *
 * The hash carries no transcendental on purpose. The obvious
 * fract(sin(dot(p, k)) * big) was measured costing a full vsync step here —
 * eight sines per fragment across eleven overlapping layers — for a roughness
 * wobble a few percent wide. This is the usual multiply-and-fold instead: worse
 * as a random number generator, indistinguishable at this amplitude, and a
 * handful of cheap ops.
 */
float sheetHash(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float sheetNoise(vec2 p) {
  vec2 cell = floor(p);
  vec2 f = fract(p);
  // Hermite, so the field has no derivative jumps at the cell boundaries —
  // linear interpolation here shows up as a faint grid in the highlight, which
  // is the one artefact this effect cannot afford.
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(sheetHash(cell), sheetHash(cell + vec2(1.0, 0.0)), w.x),
    mix(sheetHash(cell + vec2(0.0, 1.0)), sheetHash(cell + vec2(1.0, 1.0)), w.x),
    w.y
  );
}

/**
 * How much of the sweep the peel rolls, counting back from the tail.
 *
 * A sheet lifted off a stack does not bend along its whole length — it stays
 * flat where it is still lying down and turns over a hinge. This is where that
 * hinge sits, and it is also what converts the peel angle into a radius: the
 * same turn over a shorter run is a tighter roll.
 */
const float SHEET_PEEL_REACH = 0.28;

// The guide curve the cross-section is swept along.
//
// The tail rolls back on itself at CONSTANT curvature, which is both what a
// sheet bent over an edge actually does and the only profile whose integral
// closes. That second point is not a convenience: spineTangentAt below is the
// exact derivative of this function, and it is exact because the tangent of a
// circular arc is a rotation of its start. Ease the turn instead — angle going
// with u squared, say — and the position integral becomes a Fresnel integral
// with no closed form, so the derivative would have to become a second finite
// difference inside the hottest function in the program.
//
// What the roll costs in exchange is a curvature step at the hinge. A tangent
// step would crease the surface; a curvature step is the crease, and it is the
// one a sheet folded over an edge is supposed to have.
vec3 spineAt(float u) {
  float x = (u - 0.5) * uLength;
  float y = uLift * uCurl * u * u * u;

  float turn = uPeel * uCurl;
  float run = max(u - (1.0 - SHEET_PEEL_REACH), 0.0);
  if (turn > 1e-4 && run > 0.0) {
    // Curvature, from the turn spread over the length the hinge leaves it.
    float k = turn / (SHEET_PEEL_REACH * uLength);
    float phi = k * run * uLength;
    x = ((1.0 - SHEET_PEEL_REACH) - 0.5) * uLength + sin(phi) / k;
    y += (1.0 - cos(phi)) / k;
  }

  return vec3(x, y, uBow * sin(u * SHEET_PI));
}

// Closed-form derivative of spineAt. The surface is sampled five times per
// vertex for the finite-difference normals, so differencing the spine as well
// would triple the trig in the hottest function in the program.
vec3 spineTangentAt(float u) {
  float dx = uLength;
  float dy = 3.0 * uLift * uCurl * u * u;

  float turn = uPeel * uCurl;
  float run = max(u - (1.0 - SHEET_PEEL_REACH), 0.0);
  if (turn > 1e-4 && run > 0.0) {
    // d/du of sin(phi)/k and of (1 - cos(phi))/k, with phi = k * u * uLength.
    // The 1/k and the k cancel, which is the whole point of the arc.
    float k = turn / (SHEET_PEEL_REACH * uLength);
    float phi = k * run * uLength;
    dx = cos(phi) * uLength;
    dy += sin(phi) * uLength;
  }

  return vec3(dx, dy, uBow * SHEET_PI * cos(u * SHEET_PI));
}

// Orthonormal frame on the spine, rolled progressively along the sweep. The
// roll is what turns the tail into a twisted crest instead of a plain arch.
void frameAt(float u, out vec3 origin, out vec3 binormal, out vec3 normalAxis) {
  origin = spineAt(u);
  vec3 tangent = normalize(spineTangentAt(u));

  // The width axis, taken as +Z made perpendicular to the spine rather than as
  // cross(tangent, +Y).
  //
  // Identical for every sheet that does not peel: with no bow the spine lies in
  // XY, and cross((tx, ty, 0), (0,1,0)) is (0, 0, tx) — which normalises to +Z
  // exactly, since tx is the sheet's own length and always positive. The
  // Gram-Schmidt form gives the same +Z and keeps giving it once a tail rolls.
  //
  // That is the whole reason for the change. A rolling spine drives the tangent
  // through vertical, and there cross(tangent, +Y) is the cross product of a
  // vector with itself: zero. The frame collapses and the sheet tears itself
  // apart at exactly the angle a peel has to pass through.
  vec3 b = normalize(vec3(0.0, 0.0, 1.0) - tangent * tangent.z);
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
vec3 loftAt(vec2 raw, out vec3 surfaceNormal) {
  vec2 p = roundedRectParam(raw);

  vec3 origin, binormal, normalAxis;
  frameAt(p.x, origin, binormal, normalAxis);

  vec2 offset, inPlaneNormal;
  sectionAt(p.x, p.y, offset, inPlaneNormal);

  vec3 pos = origin + binormal * offset.x + normalAxis * offset.y;

  // The section's own normal, carried out of the function now that the shadow
  // pass has a use for it. Free where it stands: the frame and the in-plane
  // normal are both already here, and this is two scaled adds.
  //
  // It is the exact normal of the swept surface along v and only approximately
  // so along u — the crown, the arc angle and the tip scale all change as the
  // section travels, and a section normal knows nothing about that. It is also
  // blind to the two displacements below. surfaceAt differences the surface
  // for that reason and this is not a replacement for it; see depthPositionAt
  // for the one caller that can afford the difference.
  surfaceNormal = binormal * inPlaneNormal.x + normalAxis * inPlaneNormal.y;

  // Both displacements ride the surface normal, so it is worth computing once.
  // Ten of the eleven layers take neither branch on any given frame — these are
  // uniform conditions, coherent across the whole draw call.
  if (uRibAmplitude > 0.0 || uBendAmount != 0.0) {
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

/** The loft alone, for the four callers that difference it and want no normal. */
vec3 basePosition(vec2 raw) {
  vec3 unused;
  return loftAt(raw, unused);
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

/**
 * How much of this point's own sky survives the rest of the stack.
 *
 * 1 is open to the light, 0 is buried. This is the term the piece was missing
 * outright: eleven plates a third of a unit apart, and not one of them was
 * taking any light from its neighbours, which is why the stack read as eleven
 * separate flat colours rather than as one object taken apart.
 *
 * Screen-space AO cannot do this job here at any quality setting. Seven of the
 * eleven layers are translucent and therefore write no depth — see depthWrite
 * in the material — so a depth-buffer pass is blind to most of the stack, and
 * the occluders it would miss are exactly the ones doing the occluding.
 *
 * What makes the analytic form cheap is a property of the composition rather
 * than an approximation of it: the fan rotation is [0, twist, 0], so in the
 * artwork's frame every plate is a rectangle in xz rotated about Y and nothing
 * else. Coverage is then two dot products and a box test, and it is exact for
 * the silhouette — only the curl at the tail is idealised flat, and that is a
 * fraction of the gap between layers.
 *
 * Evaluated per VERTEX, not per fragment. Occlusion here is a smooth coverage
 * function with no high-frequency content, the plates carry 72x48 interior
 * samples, and the alternative is eleven box tests against every fragment of
 * eleven overlapping translucent layers — roughly two hundred times the work
 * for a term that interpolates cleanly.
 */
void stackVisibility(vec3 stackPos, float side, out float ambient, out float shadow) {
  ambient = 1.0;
  shadow = 1.0;

  for (int j = 0; j < SHEET_LAYERS; j++) {
    // A plate does not shade itself. At rest the gap between two layers is
    // 0.31, but inside the closed card it is nearer 0.002 — no distance
    // threshold can separate self from neighbour across that range, so the
    // identity has to be what excludes it.
    if (float(j) == uLayerIndex) continue;

    vec4 plate = uOccluder[j];
    vec4 extent = uOccluderExtent[j];

    // Toward the face being lit. The side flips with the shell, so the underside
    // of a plate is darkened by what lies BELOW it — which is what makes the
    // bottom card catch light while its neighbours above do not.
    float rise = (extent.z - stackPos.y) * side;
    if (rise <= 0.0) continue;

    // The penumbra widens with distance, which is contact hardening and it
    // falls out of the geometry rather than costing a second control: the same
    // edge is crisp against the plate it nearly touches and diffuse against one
    // across the stack. A fixed feather would give every layer the same rubbery
    // halo and lose the thing that says how far apart they are.
    vec2 feather = vec2(rise);

    // Solid angle of a coaxial disc of the occluder's own area, cosine
    // weighted: r^2 / (r^2 + d^2). Exact for a disc on its axis and the right
    // shape everywhere else — it goes to 1 as two plates close on each other
    // and falls off as the inverse square once they are well apart.
    float radiusSq = 4.0 * extent.x * extent.y / SHEET_PI;
    float form = radiusSq / (radiusSq + rise * rise);
    float weight = form * abs(extent.w) * uOcclusionStrength;

    // AMBIENT. Sampled straight up the stack axis, and that is not a shortcut
    // to be improved later — ambient occlusion asks how much SKY a point has
    // left, and sky arrives from the whole hemisphere at once. A term that
    // leaned toward one light would not be occlusion, it would be a second
    // shadow of it.
    vec2 axial = stackPos.xz - plate.xy;
    vec2 la = vec2(axial.x * plate.z + axial.y * plate.w, -axial.x * plate.w + axial.y * plate.z);
    vec2 ia = vec2(1.0) - smoothstep(extent.xy - feather, extent.xy + feather, abs(la));
    ambient *= 1.0 - ia.x * ia.y * weight;

    // SHADOW. The same coverage, sampled where the light actually comes from:
    // walk from this point toward the key until the walk reaches the occluder's
    // height, and ask whether the plate is over THAT spot. Which is a shadow —
    // the offset grows with the gap, so a distant plate throws its darkness
    // further to the side, exactly as it should.
    //
    // Splitting the two is the whole of this function's honesty. Run as one
    // term they were a shadow cast straight down from a light that is nowhere
    // near straight up, and every layer was dimmed under its own footprint
    // instead of off to the side of it.
    vec2 thrown = axial + uShadowDrift * rise * side;
    vec2 ls = vec2(thrown.x * plate.z + thrown.y * plate.w, -thrown.x * plate.w + thrown.y * plate.z);
    vec2 is = vec2(1.0) - smoothstep(extent.xy - feather, extent.xy + feather, abs(ls));

    // A negative weight marks a plate whose shadow the renderer is already
    // drawing into a real shadow map. It still blocks sky, so it stays in the
    // ambient term — but counting it here as well would darken everything under
    // it twice, once analytically and once for real.
    shadow *= 1.0 - is.x * is.y * weight * step(0.0, extent.w);
  }
}

/**
 * The same point, for the shadow map alone, at a fifth of the price.
 *
 * surfaceAt below evaluates the loft FIVE times per vertex: once for the
 * point and four more to difference the tangents. It needs exactly one thing
 * out of those four extra evaluations — the direction to push the shell along —
 * and the loft already knows that direction analytically.
 *
 * Which makes this the whole shadow pass at a fifth of its vertex cost. At
 * 72x48 plus the bevel, eleven casters carry about a hundred thousand vertices
 * through here every frame, and each evaluation of the loft costs a handful of
 * trig calls in spineAt, spineTangentAt and sectionAt. Four fifths of
 * that was being spent on a normal that is thrown away.
 *
 * What it gives up is real and it is invisible. The analytic normal is not
 * exactly the surface normal — it is blind to the ribs, to the drag bend, and
 * to the section changing shape along the sweep — so it can be off by a few
 * degrees. All it does here is aim an offset of at most half a plate's
 * thickness, which on a film is 0.0047 units. Ten degrees of error moves the
 * recorded depth by seven hundred-thousandths of a unit, against a shadow texel
 * of 0.00625. The map cannot represent the difference.
 *
 * That argument holds for the shadow map and NOWHERE else. The lit pass shades
 * with this normal, where a few degrees is the difference between a highlight
 * and no highlight, and it keeps the finite differences.
 */
vec3 depthPositionAt(vec2 p, float shell) {
  vec2 remapped;
  float height;
  float angle;
  vec2 outward;
  bevelAt(p, remapped, height, angle, outward);

  vec3 surfaceNormal;
  vec3 center = loftAt(remapped, surfaceNormal);
  return center + surfaceNormal * (shell * height);
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
// Which of the two shells this point belongs to, carried through so the print
// can be read from the side it is actually on. Constant across a shell, so the
// interpolation is exact and the fragment stage gets a clean +1 or -1.
vShell = aShell;
vBevel = gBevel;
vWorldPos = (modelMatrix * vec4(gPosition, 1.0)).xyz;
vTangentU = normalize(normalMatrix * gTangentU);
vTangentV = normalize(normalMatrix * gTangentV);

// Which way this point faces along the stack axis. Read off the transformed
// normal rather than off aShell, because the bullnose turns through a quarter
// circle and the rim of a plate genuinely faces sideways — taking the shell
// would hand the rim the full occlusion of whichever face it belongs to and
// leave a dark ring around every layer.
// Faded out by how squarely the point faces along the stack, which is what
// keeps sign() from tearing: a normal crossing the horizontal flips the side it
// is shaded from, and without this fade that flip would draw a hard ring around
// every plate. A face pointing along the plane of the stack sees the horizon
// rather than its neighbours, so it takes no occlusion from them and both
// branches meet at 1.
vec3 gStackPos = (uStackMatrix * vec4(gPosition, 1.0)).xyz;
float gSide = (uStackMatrix * vec4(gNormal, 0.0)).y;
float gAmbient;
float gShadow;
stackVisibility(gStackPos, sign(gSide), gAmbient, gShadow);
float gFacing = clamp(abs(gSide), 0.0, 1.0);
vOcclusion = mix(1.0, gAmbient, gFacing);
vStackShadow = mix(1.0, gShadow, gFacing);

// Where this point sits in the sheet's own unevenness of finish. A handful of
// patches across the plate, which is the scale a moulded or laminated surface
// genuinely varies at — and low enough in frequency that interpolating it
// across the interior grid loses nothing.
vImperfection = sheetNoise(aParam * 5.0) - 0.5;
`

/**
 * Injected into the shadow depth material alone, both stages.
 *
 * The position has to reach the fragment stage because a translucent plate can
 * only cast an honest shadow by discarding a share of its own texels, and the
 * pattern it discards by must be anchored to the PLATE. Anchored to the shadow
 * map instead — which is where `gl_FragCoord` would put it — the piece drifts
 * through a stationary field of holes as it floats, and the shadow boils.
 *
 * Object space rather than the artwork's, because a plate does not deform
 * relative to itself. The stack matrix, the float, the parallax and the resting
 * tilt all move a sheet as a whole, and none of them may be allowed to reach
 * the pattern.
 */
export const DEPTH_SHARED_PRELUDE = /* glsl */ `
varying vec3 vShadowPos;
`

/**
 * How finely the discard pattern is diced, in inverse world units.
 *
 * One cell per shadow texel, and that is the whole of the choice: the shadow is
 * read back through a five-tap Vogel disk that is itself bilinear, so roughly
 * twenty texels are averaged per lookup. A pattern at texel frequency gives
 * those twenty taps twenty nearly independent votes and the average lands on
 * the plate's real opacity. Diced any coarser and neighbouring taps agree with
 * each other, the votes stop being independent, and what should be a uniform
 * grey shadow comes back blotched.
 *
 * The frustum is 6.4 units across 1024 texels, so a texel is 0.00625 and this
 * is its reciprocal. It is tied to those two numbers and has to move if either
 * does.
 */
const SHEET_SHADOW_DICE = 160.0

/**
 * Replaces `<alphahash_fragment>` in the depth material, which is a no-op there
 * — nothing sets `alphaHash` on it.
 *
 * Stochastic transparency, and it is the only way a rasterised shadow map can
 * carry a translucent caster. The map stores one depth per texel and has no
 * channel to say "half blocked"; seven of the eleven layers here are films
 * between 0.56 and 0.93 opaque, and given a plain shadow pass every one of them
 * would throw the solid black shadow of a piece of card.
 *
 * So the coverage is moved out of the value and into the SAMPLE COUNT. A plate
 * at 0.56 discards forty-four texels in every hundred, the filter above averages
 * what survives, and the shadow comes back at 0.56 — the noise turns into
 * density. This is Enderton's stochastic transparency in the small.
 *
 * Deliberately NOT three's own `alphaHash`, which does the same job better: it
 * picks its noise scale from the screen-space derivatives, so its cells hold
 * their size no matter how a surface is raked. It also costs eight sines per
 * fragment, and this file already carries a measurement of what that pattern
 * costs here — a full vsync step, which is why every hash in it is a
 * multiply-and-fold instead. The scale adaptation is worth the least on this
 * geometry of any it could be applied to: eleven plates of nearly one size, all
 * about as far from the light, all facing it within a few degrees. One fixed
 * dice is very close to what the adaptive version would have chosen anyway.
 *
 * Guarded on opacity so the four solid layers pay nothing at all.
 */
export const FRAGMENT_DEPTH_ALPHA_CHUNK = /* glsl */ `
if (diffuseColor.a < 1.0) {
  vec3 cell = floor(vShadowPos * ${SHEET_SHADOW_DICE.toFixed(1)});
  // Folded to two dimensions rather than hashed in three. The plates are thin —
  // four thousandths of their own length — so at this dice the whole thickness
  // of a sheet is a cell or two and the third axis contributes almost nothing
  // to begin with. The odd multiplier keeps the fold from aliasing the two
  // in-plane axes onto each other.
  if (sheetGrainHash(vec2(cell.x + cell.z * 37.0, cell.y)) >= diffuseColor.a) discard;
}
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
 *
 * Through `depthPositionAt` rather than `surfaceAt`, which is where four fifths
 * of this pass went until it was noticed. A shadow map records where a plate
 * is; it has no use for the tangent frame that call spends its time building.
 */
export const VERTEX_DEPTH_POSITION_CHUNK = /* glsl */ `
vec3 transformed = depthPositionAt(aParam, aShell);
// What the stochastic discard dices. See DEPTH_SHARED_PRELUDE.
vShadowPos = transformed;
vParam = aParam;
vBevel = 0.0;
vWorldPos = vec3(0.0);
vTangentU = vec3(0.0);
vTangentV = vec3(0.0);
// A shadow map records where the plate IS, not how lit it is.
vOcclusion = 1.0;
vStackShadow = 1.0;
vImperfection = 0.0;
`

/**
 * Injected into BOTH fragment programs — the lit material and the shadow depth
 * material — because the grain and the stochastic shadow discard are the same
 * question asked twice: give me a stable pseudo-random number for this cell.
 *
 * The vertex prelude carries an identical function and they cannot be shared:
 * the two are injected into different programs. See `sheetHash` there for why
 * neither of them contains a transcendental.
 */
export const FRAGMENT_HASH_PRELUDE = /* glsl */ `
float sheetGrainHash(vec2 cell) {
  vec3 p = fract(vec3(cell.xyx) * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
`

export const FRAGMENT_PRELUDE = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec4 uGradient;
uniform int uWeave;
uniform float uWeaveScale;
uniform float uWeaveStretch;
uniform float uWeaveDepth;
uniform float uWeaveContrast;
uniform vec3 uWeaveTint;
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
uniform float uImperfection;
uniform float uFrost;
uniform vec3 uFrostColor;
uniform sampler2D uBackdrop;
uniform vec2 uBackdropTexel;
uniform float uFrostSpread;
uniform sampler2D uDecalMap;
uniform sampler2D uDecalHeightMap;
uniform float uDecalInk;
uniform float uDecalRelief;

uniform float uStackShadow;
uniform float uCastShare;

uniform float uGrain;
/** Reseeds the grain field at the shutter rate. See FilmGrain. */
uniform vec2 uGrainSeed;

varying vec2 vParam;
varying vec3 vTangentU;
varying vec3 vTangentV;
varying vec3 vWorldPos;
varying float vBevel;
varying float vOcclusion;
varying float vStackShadow;
varying float vImperfection;
varying float vShell;

const float SHEET_TWO_PI = 6.283185307179586;
const float SHEET_PI = 3.141592653589793;

/**
 * How many grain cells span the height of the frame.
 *
 * Measured against the HEIGHT and not against the pixel, which is the same
 * convention the frost radius uses and for the same reason: a grain one device
 * pixel across is invisible dust on a 2x display and coarse sand on a 1x one,
 * so a size fixed in pixels is a different effect on every machine. This one
 * holds its apparent size and lands near a pixel and a half at the ratios this
 * renderer clamps to.
 */
const float SHEET_GRAIN_DENSITY = 900.0;

/**
 * Where the decal is read.
 *
 * The raw parameter, not the rounded one: the corner remap belongs to the
 * silhouette, and pushing the artwork through it would drag the layout into
 * the corners with it. The v axis is flipped because the canvas is authored
 * with +y running down.
 *
 * And the u axis is flipped on the back shell, which is the whole of what makes
 * a printed face readable from the side it is printed on. Both shells carry the
 * same (u, v) — they are the same parameter surface, offset along the normal —
 * so u runs the same way in the plate's own frame on either side. Seen from
 * behind, that direction points the other way ACROSS THE SCREEN, and a layout
 * sampled straight comes out in a mirror. The card's back was the face that
 * said so: an account number reading right to left.
 *
 * Not a property of the card-back artwork, which is why the fix is here and not
 * in the canvas that paints it. Every plate has two faces and any of them can
 * be turned towards the lens now — through the fan, or by turning the closed
 * card over — and a mirrored one is wrong wherever it appears.
 */
vec2 decalUv() {
  float u = vShell > 0.0 ? vParam.x : 1.0 - vParam.x;
  return vec2(u, 1.0 - vParam.y);
}

/**
 * Which family of weave this layer wears. Mirrors WeavePattern in the domain.
 *
 * Kept as an int compared against named constants rather than a set of separate
 * strength uniforms, because the families are ALTERNATIVES — a sheet is woven
 * one way — and because the comparison is then uniform across the draw call.
 * Every fragment of a plate takes the same branch, so the cost of a family is
 * the cost of that family alone and never the sum of all six.
 */
const int SHEET_WEAVE_MICRO_DOT = 1;
const int SHEET_WEAVE_PLAIN = 2;
const int SHEET_WEAVE_TWILL = 3;
const int SHEET_WEAVE_HERRINGBONE = 4;
const int SHEET_WEAVE_WAFFLE = 5;
const int SHEET_WEAVE_GUILLOCHE = 6;

/**
 * Cells across the chevron before a herringbone reverses its diagonal.
 *
 * Three, and the first pass at five is why this is written down. A herringbone
 * is read from the V where the two diagonals MEET; at five cells the eye gets
 * to the reversal too late and the pattern reads as vertical bands of stripe
 * with a seam between them. The chevron has to be about as wide as it is tall.
 */
const float SHEET_CHEVRON_RUN = 3.0;

/**
 * How far the second ruling of a guilloche leans against the first.
 *
 * Not a right angle, and that is the entire effect. Two rulings crossed square
 * make a grid; crossed slightly off, their crests drift in and out of step and
 * the beat between them draws the rosette. Rational-looking values are the ones
 * to avoid — at 0.5 the two families share a period and the beat never happens.
 */
const float SHEET_GUILLOCHE_SKEW = 0.62;

/**
 * Cells of the weave under this fragment.
 *
 * uWeaveStretch is not a second scale, it is the ASPECT of one cell. The
 * plate is about 1.586 long to 1 wide, so a stretch of 1.586 draws square cells
 * and anything under it elongates them along the sweep — which is what a thread
 * running the length of a sheet actually looks like. The polyester's 0.55 was
 * measured off the reference and predates every other family here; it is why
 * this is a knob and not a constant.
 */
vec2 weaveCell() {
  return vec2(vParam.x * uWeaveStretch, vParam.y) * uWeaveScale;
}

/**
 * One weave, as coverage and as slope.
 *
 * Shared by the albedo and the normal so both stay in lockstep. Measuring the
 * reference showed the polyester's dots sitting 6 lightness points below the
 * sheet body and 15 points more saturated — a weave is a real change of
 * surface, not just a bump, and perturbing the normal alone made the pattern
 * disappear entirely. Every family added since answers to the same finding.
 *
 * The five families that are not the dot grid are all built from cosines of the
 * cell, for two reasons. They are cheap, which matters on eleven translucent
 * plates. And a cosine is its own antialiasing: it carries no edge to stair-
 * step, so what is left to defend against is moire alone, which fade handles
 * for all six at once because all six are authored in the same cell space.
 *
 * mask is the pattern's own coverage — for a woven family that is the trough
 * between the threads, which is where cloth is darker. slope is the gradient
 * of the height, divided through by the period so every family arrives at the
 * same magnitude and uWeaveDepth means one thing across the set.
 */
void weaveField(out float mask, out vec2 slope, out float fade) {
  vec2 cell = weaveCell();

  // Procedural normals cannot mipmap, so fade the pattern out once a pixel
  // spans half a cell or it turns into moire.
  fade = 1.0 - smoothstep(0.2, 0.45, max(fwidth(cell.x), fwidth(cell.y)));

  // An early-out on a fully faded weave was tried here and MEASURED WORSE: the
  // governor settled two steps down instead of one. Everything past this point
  // is sines, so skipping them looks free, but fade varies per fragment and
  // the branch is therefore divergent — the warp pays for both sides wherever
  // the fade sits part way across it, which on a fanned plate is most of it.
  // Do not put it back without measuring the settled buffer width again.

  if (uWeave == SHEET_WEAVE_MICRO_DOT) {
    // The halftone the polyester ply has always worn. Rows offset by half a
    // cell, which is what keeps a grid of dots from reading as a grid of lines.
    cell.x += 0.5 * step(1.0, mod(floor(cell.y), 2.0));

    vec2 local = fract(cell) - 0.5;
    float dist = length(local);
    mask = smoothstep(0.36, 0.14, dist);
    slope = dist > 1e-4 ? (local / dist) * mask * (1.0 - mask) * 4.0 : vec2(0.0);
    return;
  }

  vec2 t = cell * SHEET_TWO_PI;
  float height = 0.0;
  vec2 gradient = vec2(0.0);

  if (uWeave == SHEET_WEAVE_PLAIN) {
    // Warp and weft, with the two taking turns on top. That alternation is the
    // whole difference between a weave and two rulings laid across each other:
    // drop it and the pattern reads as a screen door.
    //
    // The PRODUCT of two half-rate cosines, not the cosine of the sum. Both are
    // checkerboards on paper and only one of them is a plain weave: the sum
    // holds its parity along the diagonal, so the crossovers line up into runs
    // and the cloth comes out a zigzag — a herringbone by accident, and this
    // set already has one of those on purpose.
    //
    // The dominance term is deliberately left out of the gradient. It turns
    // over once every two cells while the threads turn over every cell, so its
    // slope is a quarter of theirs and pointed the wrong way — it would tilt
    // the surface along the crossover rather than along the thread.
    float over = 0.5 + 0.5 * cos(cell.x * SHEET_PI) * cos(cell.y * SHEET_PI);
    height = mix(cos(t.y), cos(t.x), over);
    gradient = vec2(-sin(t.x) * over, -sin(t.y) * (1.0 - over));
  } else if (uWeave == SHEET_WEAVE_TWILL || uWeave == SHEET_WEAVE_HERRINGBONE) {
    // A twill is a rib running on the diagonal. A herringbone is the same rib
    // with the diagonal reversed every few cells, so the two share everything
    // but which way direction points — writing them apart would have been two
    // copies of one pattern.
    float direction = uWeave == SHEET_WEAVE_TWILL
      ? 1.0
      : 1.0 - 2.0 * step(1.0, mod(floor(cell.x / SHEET_CHEVRON_RUN), 2.0));

    float diagonal = (cell.x * direction + cell.y) * SHEET_TWO_PI;
    // Breaks the rib into the run of floats a real twill is made of, instead of
    // leaving it a continuous ridge. Slow against the rib, so it stays out of
    // the gradient for the same reason the plain weave's dominance does.
    //
    // A twill only. Reversing the diagonal also reverses this term's phase, so
    // on a herringbone consecutive chevrons landed on its crest and its trough
    // alternately: the pattern came out as vertical stripes of dark and light
    // cloth, which is a stripe and not a chevron. A herringbone is read from
    // the reversal, and the reversal has to be the ONLY thing that changes
    // across the seam.
    float floats = uWeave == SHEET_WEAVE_TWILL
      ? 0.7 + 0.3 * cos((cell.x - cell.y) * SHEET_PI)
      : 1.0;

    height = cos(diagonal) * floats;
    gradient = vec2(-direction, -1.0) * sin(diagonal) * floats;
  } else if (uWeave == SHEET_WEAVE_WAFFLE) {
    // Pique: a field of raised cells with a groove around each of them.
    //
    // The SUM of the two cosines and not their product, which is the whole
    // difference between a waffle and a checkerboard. A product peaks where
    // both cosines peak and dips where either one does, so its highs and lows
    // alternate on a chequer and the eye joins them into diagonals — that is
    // what the first pass drew. A sum holds a ridge along every gridline and
    // leaves a pillow in each cell, which is what pique is.
    height = 0.5 * (cos(t.x) + cos(t.y));
    gradient = 0.5 * vec2(-sin(t.x), -sin(t.y));
  } else if (uWeave == SHEET_WEAVE_GUILLOCHE) {
    // Engine turning, the security-print family. See SHEET_GUILLOCHE_SKEW.
    float first = (cell.x + cell.y * SHEET_GUILLOCHE_SKEW) * SHEET_TWO_PI;
    float second = (cell.x * SHEET_GUILLOCHE_SKEW - cell.y) * SHEET_TWO_PI;

    height = 0.5 * (cos(first) + cos(second));
    gradient = 0.5 * vec2(
      -sin(first) - SHEET_GUILLOCHE_SKEW * sin(second),
      -SHEET_GUILLOCHE_SKEW * sin(first) + sin(second)
    );
  }

  // Crest to 0, trough to 1: the tint belongs in the interstice, not on the
  // thread. The gradient arrives scaled by the period, so it is handed back at
  // the same magnitude the dot grid produces.
  mask = 0.5 - 0.5 * height;
  slope = gradient;
}

/**
 * What is behind this fragment, scattered.
 *
 * Golden-angle spiral rather than a grid or a box: the samples never line up on
 * an axis, so a kernel this sparse dissolves detail instead of printing its own
 * shape over it. sqrt(t) on the radius is what spreads the taps evenly across
 * the DISC — without it they crowd the centre and the edge of the blur goes
 * ragged, since area grows with the square of the radius.
 */
vec3 frostedBackdrop(vec2 uv, float radius, out float coverage) {
  vec4 sum = texture2D(uBackdrop, uv);

  const float GOLDEN_ANGLE = 2.399963229728653;
  for (int i = 1; i <= FROST_TAPS; i++) {
    float t = float(i) / float(FROST_TAPS);
    float angle = float(i) * GOLDEN_ANGLE;
    vec2 offset = vec2(cos(angle), sin(angle)) * sqrt(t) * radius;
    sum += texture2D(uBackdrop, uv + offset * uBackdropTexel);
  }

  sum /= float(FROST_TAPS + 1);
  coverage = sum.a;
  return sum.rgb;
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

float gWeaveMask = 0.0;
float gWeaveFade = 0.0;
vec2 gWeaveSlope = vec2(0.0);
if (uWeave > 0) {
  weaveField(gWeaveMask, gWeaveSlope, gWeaveFade);
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

if (uWeaveContrast > 0.0) {
  diffuseColor.rgb *= mix(vec3(1.0), uWeaveTint, gWeaveMask * gWeaveFade * uWeaveContrast);
}

if (uRibContrast > 0.0) {
  diffuseColor.rgb *= 1.0 + gRib * gRibFade * uRibContrast;
}

// Decal ink. Coverage lives in the alpha channel, which is USUALLY also the
// height field the normal chunk reads — one texture, two independent uses, so a
// pressed shape and a printed one can share the same drawing. A layer whose
// print has to cover its whole rect is the case where they collide, and that
// layer hands the normal chunk a map of its own instead.
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

if (uWeave > 0) {
  normal = normalize(
    normal + (vTangentU * gWeaveSlope.x + vTangentV * gWeaveSlope.y) * uWeaveDepth * gWeaveFade
  );
}

// Emboss. The decal's coverage is a height field, and its gradient tilts the
// normal — which is the whole of what a shape pressed into plastic does to the
// light. Sampled at a deliberately wide offset: these are soft die-pressed
// forms, and a texel-width difference would turn every one of them into a
// wire outline instead of a swell.
//
// Read from uDecalHeightMap, which is the decal itself on every layer that
// can afford to share it — that is what the material binds when a layer offers
// nothing else. The printed cards are the exception and the reason the sampler
// exists: their ink covers the rect edge to edge, so their alpha is a constant
// and a constant has no gradient. Their chip and their wear come from a second
// map drawn in the same frame, which is why nothing here needs to know which
// kind of layer it is running on.
if (uDecalRelief > 0.0) {
  vec2 uv = decalUv();
  const float reach = 0.006;
  float dx = texture2D(uDecalHeightMap, uv + vec2(reach, 0.0)).a
           - texture2D(uDecalHeightMap, uv - vec2(reach, 0.0)).a;
  float dy = texture2D(uDecalHeightMap, uv + vec2(0.0, reach)).a
           - texture2D(uDecalHeightMap, uv - vec2(0.0, reach)).a;
  // Both gradients are measured in the decal's own uv, and the perturbation is
  // written in the plate's parameter frame, so each axis carries the sign of
  // the map between them. v is flipped on every shell, which is the minus on
  // vTangentV. u is flipped on the back one alone — so the relief mirrors with
  // the ink it belongs to, instead of leaving a raised form lit from the side
  // its own artwork no longer sits on.
  normal = normalize(
    normal - (vTangentU * dx * vShell - vTangentV * dy) * uDecalRelief
  );
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

// Frost. The body scatters what a clear sheet would have transmitted.
//
// Both halves ride the same angle and in the same direction, because both come
// from one cause: the path through the material is shortest looking straight
// at it and grows without bound toward the edge. More material in the way means
// more scattering, so the sheet turns milkier AND stops more of what is behind
// it — a frosted edge is nearly solid while its middle still glows.
//
// That is also what separates this from simply raising the opacity. A flat
// alpha closes the sheet evenly and reads as paint thinned down; this closes it
// where the geometry says it should be closed, which is what the eye reads as
// depth in the material rather than as a weaker colour.
//
// The albedo mix stays far under the alpha's, and the gap between them is the
// whole calibration. A frosted sheet is MILKY, not white: it scatters the light
// but it keeps its own dye, and the two are independent — a blue frosted film
// is as closed as a clear one of the same thickness and still blue.
//
// Measured the hard way. At parity the foils came out as pale grey slabs with
// no colour left in them at all, which is the exact failure the layer's own
// notes had already recorded once from the other direction: a near-white body
// reads as grey where anything sits behind it. Alpha is what closes a sheet.
// Albedo is what colours it. Driving both off one number confuses them.
// The albedo term is deliberately the weaker of the two now that the frost has
// a real backdrop to scatter. Milkiness that used to have to be PAINTED into
// the body is produced by the diffused capture instead, and running both at the
// old weight whitened the foils twice over — once as albedo and once again as
// the pale blur composited under them.
if (uFrost > 0.0) {
  float depthAlongView = mix(0.45, 1.0, 1.0 - facing) * uFrost;
  diffuseColor.rgb = mix(diffuseColor.rgb, uFrostColor, depthAlongView * 0.1);
  diffuseColor.a = mix(diffuseColor.a, 1.0, depthAlongView);
}

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
 * Appended to `<colorspace_fragment>`, and BEFORE the backdrop composite below.
 *
 * Film grain, and it belongs to the camera rather than to any sheet — which is
 * why every layer reads the same two uniform objects and arrives at the same
 * value for the same pixel. That shared value is what makes this correct across
 * a stack of eleven translucent plates rather than merely cheap: each layer adds
 * the grain to its own colour, the blend weights that colour by the layer's
 * alpha, and the weights of an `over` composite sum to the coverage of the
 * stack. So the grain lands once at full strength on the solid card and fades
 * out with the object at its edges, instead of being counted eleven times.
 *
 * A post-process pass would be the textbook home for this and would cost a
 * full-screen render target plus a copy for an effect that is four instructions
 * here. It would also have to be taught to leave the transparent canvas alone,
 * since the page owns the backdrop behind it — a thing this gets for free by
 * riding the same alpha as everything else.
 *
 * Ordered before the frost composite deliberately. The frosted layers scatter a
 * capture of the framebuffer, which already carries the grain of everything
 * drawn under them; graining after the composite would apply it a second time to
 * whatever shows through. What is left is a grain that gets blurred along with
 * the backdrop it sits in, which is the right answer anyway — the defocused
 * thing behind the glass is defocused, grain included.
 */
export const FRAGMENT_GRAIN_CHUNK = /* glsl */ `
if (uGrain > 0.0) {
  // Cells locked to the drawing buffer, never to the surface. Grain lives in
  // the film plane: it does not travel with the object, does not stretch at
  // grazing angles, and does not get finer as a plate turns away. Anchored to
  // the geometry it would be a texture, and a texture is what this is not.
  vec2 cell = floor(gl_FragCoord.xy * uBackdropTexel.y * SHEET_GRAIN_DENSITY);
  // The seed offsets the HASH INPUT rather than the grid, so the cells stay
  // pixel-aligned and only their values change. Offsetting the grid instead
  // slides the whole field a fraction of a cell every shutter, which reads as
  // dirt crawling across the lens rather than as grain.
  float g = sheetGrainHash(cell + uGrainSeed) - 0.5;

  // Strongest through the midtones and gone at both ends. Grain is a property
  // of the image's DENSITY rather than of its brightness — nothing is developed
  // in the blacks and everything is in a blown highlight, so both ends of the
  // range come out smooth and the middle is where the silver actually is. Flat
  // noise added everywhere instead puts sparkle in the deep shadows, which is
  // the one place a photograph never has any.
  float density = dot(gl_FragColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor.rgb += g * uGrain * 4.0 * density * (1.0 - density);
}
`

/**
 * Appended to `<colorspace_fragment>`: the frosted layers composite what is
 * behind them by hand, instead of letting the blend do it.
 *
 * AFTER the colour conversion and not before, which is not a detail. The
 * capture is a copy of the framebuffer, so it is already tone mapped and
 * already encoded; mixing it into linear light would put two different curves
 * in the same average and the result goes muddy in the midtones every time.
 *
 * The layer then has to REPLACE what it covers rather than blend into it —
 * `blendDst: ZeroFactor` on the material — because the whole point is that the
 * blend's own `dst` is the sharp version this is here to get rid of. Compositing
 * manually and blending on top would show both.
 *
 * Weighted by the capture's own alpha, so a sheet with nothing behind it shows
 * its body and stays see-through to the page rather than frosting empty space
 * into a grey plate. That is also the physical answer: nothing behind means
 * nothing to transmit.
 */
export const FRAGMENT_BACKDROP_CHUNK = /* glsl */ `
if (uFrostSpread > 0.0) {
  float behindAlpha;
  vec3 behind = frostedBackdrop(
    gl_FragCoord.xy * uBackdropTexel,
    uFrostSpread / uBackdropTexel.y,
    behindAlpha
  );

  // Straight "over", with the diffused capture standing in for the destination.
  // Both sides are premultiplied — the framebuffer holds premultiplied colour
  // after any blend, and this writes premultiplied colour back — so the two
  // stay in the same representation across every layer of the stack.
  float bodyAlpha = gl_FragColor.a;
  gl_FragColor = vec4(
    gl_FragColor.rgb * bodyAlpha + behind * (1.0 - bodyAlpha),
    bodyAlpha + behindAlpha * (1.0 - bodyAlpha)
  );
}
`

/**
 * Appended to `<aomap_fragment>`, which three emits after the lights have been
 * accumulated and before the totals are composed — so both the indirect and the
 * direct terms are still separable here, which is the whole reason this is the
 * hook rather than the albedo.
 *
 * The indirect half is ambient occlusion in the ordinary sense and takes the
 * term at full strength.
 *
 * The direct half is the part that needs stating. Physically a plate lying
 * under another is not merely missing sky — it is in that plate's shadow, and
 * three cannot compute that shadow at any price: the key, the rim and the
 * bounce are all `RectAreaLight`, which supports no shadow at all, and killing
 * the one directional light in the scene changes the frame by about four
 * luminance points. So the only lights capable of casting the stack's own
 * shadow are the ones that cannot. `uStackShadow` is how much of that missing
 * shadow this term stands in for, and it is deliberately partial: the area
 * lights are large and reach well in from the sides, so a plate under another
 * is dimmed rather than blacked out.
 *
 * Specular takes less of it than diffuse, and through three's own occlusion
 * curve rather than raw. A grazing reflection comes off the horizon, which the
 * stack does not block; applying diffuse occlusion to it strips the highlight
 * off exactly the edges the piece is built around.
 */
export const FRAGMENT_AO_CHUNK = /* glsl */ `
reflectedLight.indirectDiffuse *= vOcclusion;

float stackDotNV = saturate(dot(geometryNormal, geometryViewDir));
reflectedLight.indirectSpecular *= computeSpecularOcclusion(
  stackDotNV,
  vOcclusion,
  material.roughness
);

// The direct light is not one thing, and its occlusion is not either. Three of
// the four sources are large panels a few units off: from under a plate they
// are blocked across most of their solid angle at once, which is occlusion in
// the ambient sense and has no direction to it. The fourth is directional, and
// a directional source is the only one here that throws an edge — offset, to
// the side, growing with the gap.
//
// So the two terms are blended by how much of the direct light comes from a
// source small enough to cast. Running the offset term alone was measured
// brightening the frame by 12 luminance points and flattening the middle of the
// stack, and that is a correct result for the wrong question: a plate five gaps
// up genuinely throws its shadow clear of everything, but it has not stopped
// blocking the panels.
//
// What that blend MEANS has changed, and the code did not have to. Every layer
// is rendered into the real shadow map now, so every plate arrives here with a
// negative occluder weight and vStackShadow comes back as 1 everywhere — the
// analytic shadow half has retired, on purpose, because the renderer is drawing
// that shadow for real and counting it twice is exactly what the sign is there
// to prevent. uCastShare therefore no longer divides one analytic term from
// another. It divides the share of direct light the SHADOW MAP is responsible
// for from the share the coverage term still has to stand in for, which is what
// it always meant and now finally describes.
//
// The dead half is left computing. It costs a box test per layer per vertex and
// it is what any layer dropped back out of the shadow map falls back on, which
// is a live possibility while the cost of eleven casters is unmeasured.
float stackDirect = mix(1.0, mix(vOcclusion, vStackShadow, uCastShare), uStackShadow);
reflectedLight.directDiffuse *= stackDirect;
reflectedLight.directSpecular *= computeSpecularOcclusion(
  stackDotNV,
  stackDirect,
  material.roughness
);
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

// The finish wanders. See the imperfection field in the domain types.
//
// The field itself is built per VERTEX and arrives here interpolated — the same
// trade the occlusion makes, and for the same reason: it is smooth, the plates
// carry 72x48 samples, and measuring it per fragment cost a full vsync step
// across eleven overlapping layers for a change of three luminance points. That
// is the wrong side of any trade.
//
// ADDITIVE rather than a multiplier, and that is why it reads at all. The layers
// this matters most on are the glossy ones, and a proportional wobble on a
// roughness of 0.07 moves it by hundredths — far under what a highlight can
// show. What breaks a specular sweep is an ABSOLUTE change in how tight it is.
//
// Kept off the bullnose. A rounded edge is polished by the same process that
// rounds it — the line above already says so — and it is a band a few pixels
// wide holding the brightest specular in the frame, which makes it the one place
// a roughness wobble stops reading as finish and starts reading as sparkle.
// Floored just above zero: a perfect mirror is the artificial case.
if (uImperfection > 0.0) {
  roughnessFactor = clamp(
    roughnessFactor + vImperfection * uImperfection * smoothstep(0.0, 0.5, vBevel),
    0.015,
    1.0
  );
}

// Detail that shrinks below a pixel must not vanish — it has to become
// roughness.
//
// Fading the rib and weave normals out on their own left a broad soft band
// wherever the fade sat halfway across the surface: "textured" and "smooth"
// shade to different averages, so the eye reads the boundary as a channel
// pressed into the plate. Feeding the lost normal variance back in as roughness
// keeps the average constant and the transition stops being visible at all.
if (uRibShading > 0.0) {
  float lost = (1.0 - gRibFade) * uRibShading;
  roughnessFactor = sqrt(min(roughnessFactor * roughnessFactor + lost * lost, 1.0));
}

if (uWeave > 0) {
  float lost = (1.0 - gWeaveFade) * uWeaveDepth * 0.4;
  roughnessFactor = sqrt(min(roughnessFactor * roughnessFactor + lost * lost, 1.0));
}
`
