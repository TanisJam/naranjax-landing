# MandarinaX — landing

A product landing whose hero is not a picture of the card but the card itself,
rendered live in Three.js and coming apart into the nine things the account can
do. The engine is the sheets renderer vendored from `../3dclaude`.

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm build      # tsc --noEmit && vite build
```

## The brand

Two inks, both sampled off the MandarinaX reference card rather than eyeballed:
orange `#f37d06` and red `#db1811`. They are not interchangeable and each has a
job. Red is the ground — the `ink` ramp in `src/style.css` is that red taken
down to near-black at a constant 2° hue — and orange is everything printed on
it: the accent, the calls to action, the mark, the card body.

The ramp arrived by rotation rather than by re-authoring. It was previously a
violet at a constant 277.7° hue, and every step keeps that step's exact
lightness and saturation with only the hue moved. So the page reads as a
different brand while the contrast relationships that were tuned against the
artwork are, number for number, the ones that were tuned.

## Layout

One column. The hero is the whole viewport and the card is the whole hero, and
that is load-bearing rather than dramatic: opening a layer takes the canvas
fullscreen, so a canvas that already *is* the viewport makes that swap a no-op.
When the stage was a 38% column beside the copy, the same swap cost a measured
29-pixel jump that took a compensation, an aim-point anchor and a flat-plate
approximation to get down to two. The written half of the pitch runs under the
hero, and the feature list there is built from the same `specs.ts` data as the
panels the layers open into, so a name and its panel cannot disagree.

## The artwork

An exploded card stack, following the supplied layer breakdown: eleven layers
spread along the vertical and twisting progressively. The outer two are finished
cards carrying printed artwork; the nine between them are the material the card
is built from — films, a woven core, security print and holographic foil — which
is the only thing an exploded view is for.

Thicknesses are to scale and they matter more than they sound. ID-1 specifies
0.76 mm on an 85.60 mm card, which is 0.89% of the long side; anything heavier
turns the card into a tile. The layers between the cards are thinner still,
because they are not cards.

Three changes to the engine made that possible, all of them in
`material/sheetShader.ts`:

**Rounded corners.** Nothing in the original model could produce them — a bevel
rounds an edge in profile, not in plan. `roundedRectParam` bends the square
parameter domain onto a rounded rectangle before the loft is evaluated, using an
elliptical grid mapping inside the corner blocks and the identity everywhere
else, so the straight sides stay straight and the bullnose still closes on
itself exactly. It costs both axes real tessellation: `u` went from 10 to 72,
because a constant section along a straight spine has nothing to resolve but a
corner arc does, and an under-sampled one shows as a cut-off diagonal.

**A decal that is ink and relief at once.** One texture slot, read twice and
independently: its RGB is ink blended into the albedo by `decalInk`, and its
ALPHA is a height field whose gradient tilts the normal by `decalRelief`. That
split is the whole trick. A printed card face is all ink and no relief; a shape
pressed into plastic is the reverse, because an emboss changes no colour at all
— painting the motif in is exactly what makes relief read as a sticker.
`decalRelief` runs well above 1 on the emboss layers, since the art tops out
near 0.2 alpha over a soft shoulder and it is the resulting tilt that matters,
not the number looking like a weight.

The geometry has no `uv` attribute at all — every vertex carries only its
`(u, v)` parameter — so decals sample `vParam` directly rather than going
through three's UV plumbing. Layers with no decal bind a 1x1 white texture
instead of guarding the sampler with a define, which would split the one shared
program per layer.

**Card proportions.** The plate is ISO/IEC 7810 ID-1, 1.586:1, and the arc angle
drops to near nothing — a card is the degenerate case of the loft. Not zero,
though: a perfectly planar card reads as a cardboard cutout the moment the light
sweeps across it.

Two painters draw all of it with the Canvas 2D API, with no image assets and no
fonts beyond the generic families, so the page renders identically offline:
`material/cardFaceTexture.ts` for the two card faces, and
`material/layerMotifTexture.ts` for the pressed circle medallion and the
banknote engraving. The woven core layer needs neither — its weave is the
shader's own rib and dot fields crossing, which is cheaper than a texture and
never aliases, because both fade to roughness as they shrink below a pixel.

What the reference has that this does not: the heavier folds on its
fabric-like sheets. The layers here bow, peel and crest, but they do not
crumple.

## The deploy

The page opens on a single card, and clicking the panel takes it apart. That is
the whole interaction, and it is the reason the exploded view is worth
rendering live at all: an exploded diagram states that a card has layers, but
watching one come apart is what makes it true.

The closed state is not a second composition. Every layer is already in it —
`AnimationTimeline` interpolates one number, `deployProgress`, and position,
thickness, shape and framing all ride it:

**Position and thickness** come from `assemble` in `composition.ts`, which is
the only place that knows what closed means. It walks the finished layer list,
sums what the layers actually measure, and compresses the whole stack by the one
factor that lands it on `CLOSED_THICKNESS` — one ID-1 card, to spec.

That factor is around 0.175, and the reason is worth stating plainly: eleven
layers at their own thicknesses come to five card-thicknesses. A finished card
is thinner than the things it is made of pressed together, because lamination is
exactly that. So the factor has to reach the plates themselves and not only
their positions — `uThickness` is interpolated per layer alongside the position.
Compressing the layout alone would drive eleven solid plates through each other.
`uThickness` also sets the bullnose radius, so the edge rounds down with the
plate instead of the closed card growing a flat rim.

Both numbers are derived rather than authored, because both are running totals
over the whole list: twenty-two hand-written values that stop agreeing with the
thicknesses the day one of them is tuned. Layers touch rather than clear each
other — a gap reads as eleven cards resting on one another. Touching is safe for
the same reason the exploded draw order is: near-flat plates, back-face culled,
so a seam is one surface over another and never an intersection.

**Shape** is `uCurl` and `uOpen`, which already existed. `uCurl` scales the lift
and the roll, `uOpen` scales the arc, so at 0 every crest, twist and bow relaxes
into a flat plate. Nothing in the timeline has to know which layers are folded,
and a crest cannot push through the face above it inside a closed card, because
at that moment there are no crests.

At card thickness the arc has to reach *nothing*, not merely very little, and
this is the one place where the closed state genuinely changed the engine.
Layers sit 0.0019 apart inside a closed card. An arc left at a tenth of its
authored angle — the 0.12 floor the old intro used — bows a plate by w·a/8 ≈
0.015, eight times the gap it has to stay inside, and the result is a printed
card face with a blue film showing through the middle of it. The shader already
floors the angle at 1e-3, which bows a layer by 0.0002 and stays put. The cost
is that a closed card is perfectly planar, which the composition otherwise
avoids on purpose; square to the camera and still, nothing reads it, and the bow
returns the instant the card opens.

**Framing** rides it too, all three parts of it. The orientation slerps between
a closed pose square to the camera and the authored exploded one — as
quaternions, because the sweep is most of a quarter turn on X while Y unwinds,
and three Euler angles interpolated independently do not describe a rotation.
The closed X angle is not a round 90°: the camera sits above its target, so a
plate at exactly a quarter turn is square to the *world* and not to the lens.
The horizontal nudge on the artwork exists to answer the twist, and a closed
stack has no twist to answer, so it goes to zero and the card sits centred. The
zoom is bounded by the panel's width rather than its height, since a card seen
square-on spans its full 2.36 units across where the exploded stack gives most
of that back to foreshortening — 1.2 puts it at 81% of the panel at 1440x900.

The progress travels at a fixed rate towards its target and the *result* is
eased, rather than damping towards it. A damped value never actually arrives,
and a stack stopped 2% short of closed is exactly the state this piece must not
sit in.

**Each direction owns its curve.** Opening is `easeOutCubic`: it leads with its
speed and settles. Measured, that is 35% of the travel in the first 0.1s, half
of it by 0.15s, and at rest by 0.75s — the number that matters for how fast it
*feels* is the first one. Closing keeps `easeInOutCubic`, because something
being put away should not bolt.

Two curves means a reversal cannot simply carry its progress across: they
disagree about what a given progress means, and the stack would jump on a second
click. So the direction change re-solves for the progress that reproduces the
value currently on screen under the new curve — which is what `easeOutCubicT`
and `easeInOutCubicT` in `easing.ts` are for. Measured over a run with a
reversal at frame 20, the largest single-frame change is 0.078 and it happens in
the fast part of the *opening*, not at the turn.

Under `prefers-reduced-motion` the deploy stays available and becomes a cut: the
stack changes state between two frames instead of sweeping eleven layers across
the panel. It is the largest motion on the page, and also the one thing here the
user asked for by clicking.

The stage carries `role="button"`, a tab stop and `aria-expanded`. A div with a
button role gets none of a button's keyboard behaviour for free, so both keys
are handled — Enter fires on keydown, and Space would otherwise scroll the page
out from under the panel.

## Picking a layer

Hovering an open stack draws that layer out of it: it slides along its own long
axis, rises clear of its neighbours, and its rim and bevel glow come up. All
three are one gesture — a sheet pulled out of a stack — so the slide follows the
*sheet* rather than the screen, and the lift is a fixed ratio of it rather than a
second knob.

The highlight is scaled by the deploy, not gated by it. While the stack is
closed it is one card, and a single layer of it lighting up under the pointer
would be a lie about what the user is looking at.

**The real mesh cannot be picked at any price.** Its `position` attribute is a
buffer of zeros and the whole shape is built in the vertex shader, so the CPU
does not know where a single vertex ends up — three would raycast against a
plate collapsed to a point at the origin. Each layer therefore carries a flat
`hitArea` plane. A plane is a fair stand-in because these layers *are* plates,
and what curl is left at the tail is a fraction of the gap between them. Its
material is `visible: false` rather than the object, which is the whole trick:
three skips an invisible object while raycasting, but an object with an
invisible material still tests.

**The hit area takes the deploy and stops there.** It sits beside the mesh under
the carrier, not under the mesh, so it never receives the hover offset — and
that is load-bearing rather than tidy. A target that moved with the hover would
slide out from under the pointer that triggered it: hover on, layer leaves,
hover off, layer returns, at frame rate. It buzzed. A response cannot be allowed
to move its own trigger, and parking the target at rest makes the pick
independent of the hover entirely, so there is no loop left to close. It does
mean the overhang — the sliver a hovered layer sticks out past its resting
silhouette — is not itself hoverable, which is invisible in use and is the whole
price. Measured across a layer edge to edge, the displaced target changed the
pick at two of fifteen sample points; the parked one flips zero times in two
seconds of frames at every one of them.

`LayerPicker` resolves the pick per frame rather than per pointer event, and
that is not a detail — the artwork floats, tilts under the parallax and slides
through the whole deploy, so the layer under a perfectly still pointer changes
on its own. Eleven plane intersections is not the cost anyone was worried about.
Touch pointers are ignored outright: a touch reports a position while the finger
is down and then leaves it there, so a tap would light a layer up and keep it
lit with nothing on screen explaining why.

Reduced motion keeps the rim highlight and drops the slide. The feedback is the
point; the layer travelling to deliver it is not.

## Sound

Three cues in `sound-effects/`, imported as assets so they get hashed and
cached like anything else: the stack opening, the stack closing, and crossing
into a layer.

`src/sound/SoundBoard.ts` is Web Audio rather than `<audio>` elements, because
these are short cues that fire on the same frame as the thing they answer,
retrigger before they have finished and cut each other off — none of which an
`HTMLAudioElement` can do. Open and close share one voice, so an impatient
double click reverses the sound the way it reverses the animation instead of
layering two half-second cues into mud. The pointer cue keeps a 70 ms guard:
one tick per layer boundary is the intent, one per frame is a rattle.

The context is built suspended and the cues decoded immediately, which needs no
gesture; only `resume()` does, and it runs on `pointerdown` — ahead of the click
that will ask for a sound. The pointer cue is therefore silent until the first
click, which is the autoplay policy working rather than a bug to route around.

**The two transitions run exactly as long as the cue that scores them, and the
cue is what says how long.** The page reads the length off the decoded buffer
rather than copying a number, so swapping an mp3 moves the animation with it;
the durations authored on the timeline are the fallback for a page with no
audio. That length is 0.651s, not the 0.72s the container claims — the
difference is encoder padding and it is not audible.

The curves did not change, and the envelopes are why. The open cue attacks at
0 ms, which is where `easeOutCubic` puts most of its travel. The close cue is
nearly silent for its first 100 ms and swells to a peak at 300 ms, which is
where `easeInOutCubic` is moving fastest. Giving the close a fast start would
put its visual burst inside the quiet part of its own sound.

**A cue answers the user, not the scene.** The pick can change under a
perfectly still pointer, because the artwork floats and drifts a boundary
across it — measured at one to two crossings every three seconds on the layers
whose edge lands near the pointer. Following that with the highlight is right:
the layer under the pointer really did change. Making a sound about it is not,
so `onChange` reports whether the pointer caused the change and only a
pointer-caused one is audible. Measured: eight cues from ten deliberate moves
— two of the moves landed on the same layer and correctly said nothing — and
zero from thirty seconds of holding still.

There is no mute control. If the page ever gets one, `SoundBoard.muted` is
already the switch.

## Next

`picker.selected` is the seam for a future click on a layer. Today the click
belongs to the stage and toggles the deploy, so that will have to be settled
when the time comes — a stage-wide toggle and a per-layer action want the same
gesture.

## Transparency

Eleven translucent layers is enough that draw order stops being a detail.

Three sorts transparent objects by the projected position of the mesh **origin**
— one point per object. A card is 2.36 x 1.49 units wide and its neighbours sit
0.31 away, so two layers overlap in depth along a view ray long before their
origins say so. Measured over one ordinary pointer sweep across the panel, that
derived order rearranged itself **six** times, and the closest neighbouring pair
came within 4.4e-8 of the sort key — a tie, which flips back and forth on
floating-point noise with the camera perfectly still. Every rearrangement
changes which layer blends over which.

Worse, translucent layers used to write depth. A layer drawn after one that
already wrote depth, and behind it, is not blended — it is *rejected*, so a
whole layer blinks out of the stack the moment the order moves.

Both are gone. Transparent layers no longer write depth at all, and
`application/StackOrder.ts` assigns `renderOrder` explicitly. The order never
needed deriving: the layers are spread along one axis and do not interpenetrate,
so back-to-front is decided entirely by which end of that axis faces the camera —
one dot product per frame, and it changes only when the camera genuinely crosses
the plane of the stack, at which point every layer changes together.

Self-occlusion is what depth writes were originally buying, and back-face
culling now covers it: these layers are near-flat plates, so the far shell's
faces point away and `FrontSide` discards them outright. That was not true of the
original curved vaults, where you could look straight down a tunnel and see the
far wall's front faces — which is exactly why the old composition needed the
depth writes it could not afford.

If the layers ever do interpenetrate — a crest pushed through the plate above —
per-object ordering is wrong again at that intersection, and the honest fix
becomes weighted-blended OIT rather than a better sort. The crests currently
clear their neighbours by about 0.12 units.

Fixing the order exposed what it had been hiding. With most layers being
culled, nobody could see that eleven translucent surfaces each contributing a
fresnel rim and a bevel glow sum into the same pixels — a plate seen this
obliquely fires its rim across most of its area, so the middle of the stack blew
out to white. Those values have to be worth about a eleventh of what they would
be on a single sheet.

The clear foils needed a different fix, in the shader. A film over a dark panel
cannot have both a visible body and a visible print if one alpha controls both:
enough to read the engraving turns the whole sheet into a grey slab, and enough
to disappear takes the engraving with it. Measured alone against the panel, they
came out at rgb 81,100,117 against roughly 170 for every other layer — grey
slabs, exactly as they looked. So ink now carries its own opacity:
`diffuseColor.a` is raised toward 1 by the decal's coverage, which is how
printing on glass actually works. The substrate then drops to 0.16 alpha and
vanishes over the panel while the engraving stays crisp.

## The sheets engine

`src/sheets/` is a vendored copy of the `3dclaude` engine (domain, application,
`infrastructure/three`) minus its dev-only tooling — the debug panel, the swatch
card and their button. Two more things diverge from the original, both in
`stage.ts`, and both because the piece now lives inside a page instead of
filling a window:

**The canvas is transparent.** The original paints a studio backdrop plane and a
clear colour from `composition.background`. Here the page owns the background,
so there is no colour to keep in sync and no seam at any viewport. The backdrop
plane only ever existed to feed transmission refraction, and no sheet transmits
(see the `frost` comment in `composition.ts`), so nothing was lost with it.

**The camera dollies back on narrow viewports.** The stage panel is roughly 0.5
aspect, and a perspective camera holds its *vertical* fov, so the sheets were
cropped hard on both sides. Below `FIT_ASPECT` the camera moves away from its
target along the same view axis instead of widening the fov — widening buys the
width back but destroys the long-lens flatness the composition depends on.

Everything else in the engine is untouched. `composition.ts` was rewritten from
scratch for the card stack — the original four-vault composition is still in
`../3dclaude` if it is ever wanted back.

## The icon and the share card

Everything in `public/` is derived rather than drawn. The favicon is the mark
the header already renders — the orange tile with the X cut out of it in the
page's own ground — and nothing else from the wordmark comes along, because at
sixteen pixels "mandarina" is a smudge and the X is the only part of the name
that survives. `apple-touch-icon.png` is the same mark full-bleed: iOS applies
its own squircle, so an icon carrying its own corners gets them rounded twice.
The `.ico` exists for the bare `/favicon.ico` every browser still requests
whether or not anything points at it.

`og.jpg` is the hero, captured. The product is the card, so a share card drawn
separately in a design tool would agree with the page only by hand and stop
agreeing the first time either moved. It is a screenshot of the running build at
1200x630 with the nav hidden and the touch hint swapped for the claim — both
inline, since the stylesheet is compiled from what the source uses and a class
invented at capture time has no rule behind it. JPEG rather than PNG: the frame
is a render with film grain over it, which is what JPEG is for, and it costs
110KB against 780KB for no visible difference.

**If the hero changes, recapture it** — nothing regenerates it on build. And the
Open Graph URLs in `index.html` are absolute because they have to be: a scraper
fetches the image with no document to resolve a relative path against. If the
site moves off `mandarina-x.vercel.app`, those lines move with it.

## Gotchas

`pnpm-workspace.yaml` exists to anchor the workspace root here. Without it pnpm
walks up, finds the one in `$HOME`, and `pnpm install` reports "Already up to
date" while installing nothing at all.

Motion respects `prefers-reduced-motion`, and the frame loop stops when the tab
is hidden or the stage scrolls out of view — on the stacked layout it otherwise
renders a full budget of pixels nobody is looking at.
