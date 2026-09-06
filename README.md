# Projector

Projection-mapping video player for macOS. Plays local files or YouTube
links/playlists, warps the picture onto one or more wall areas independently,
blacks out shapes you mark (paintings, plant, couch), and plays the same video
full-screen on your TV as a second wall, with the effects running there too.

It also runs a **real-time physics and simulation layer on top of the video** —
water that fills the room and flows around your couch, balls that bounce off
the picture frames, smoke that rolls around them, snow that settles on their
top edges. See [Effects](#effects).

## Run it

```
open dist/Projector-darwin-arm64/Projector.app     # packaged app
npm start                                          # or from source
npm run build                                      # rebuild the .app
```

Requires `yt-dlp` for YouTube (installed via Homebrew).

## The idea

Everything is authored in **output space** — the projector's own 1920x1080
frame, stored as fractions so it survives a resolution change.

- An **Area** (surface) takes a rectangular region of the video (`src`) and maps
  it onto a four-corner quad on the output. The corners can sit anywhere, and
  the texture lookup uses a true inverse homography, so a wall seen at an angle
  gets correct perspective rather than a bent-looking stretch. Raise the warp
  grid above 1x1 for curved or uneven walls.
- A **Mask** is a polygon in output space that turns the projector's light off.
  Because your paintings and couch don't move, masks stay put no matter which
  video plays. Each has its own softness (feather) and grow/shrink.
- Masks are cached on the GPU and only rebuilt when you edit them, so soft
  edges cost nothing per frame.

## Two walls, one picture

1. Set the test pattern to **Grid** and turn on the projector output.
2. Press **Set up two walls** in Presets.
3. Drag the *Main wall* corners so it covers the flat wall exactly up to the
   physical corner.
4. Drag the *Side wall* corners onto the side wall. It will look like a
   trapezoid on the output — that's the keystone correction.
5. Slide **Corner at** so the seam sits on the real corner, then **Split** until
   circles in the grid stay round across both walls. That is the "stretched so
   it doesn't look stretched" control.

For more than two areas, draw them and press **Spread video across all areas** —
each area gets a slice of the video proportional to its width.

## Playlists

**Add URL** accepts a single video, a `playlist?list=...` URL, a `watch?v=...&list=...`
URL, or a channel (its tabs are followed until videos are found). Enumeration
uses a flat listing, so a 183-video playlist comes back in about 2 seconds with
titles and durations; individual stream URLs are only resolved when a track is
about to play. Up to 500 entries are taken from one URL.

- The **repeat** button cycles playlist / one / off; **shuffle** sits next to it.
  Both are remembered between launches.
- Next/prev always move, even in repeat-one, and wrap around the ends.
- The next track's stream URLs are resolved in the background while the current
  one plays, so changeovers take milliseconds rather than seconds.
- A dead or private entry is skipped automatically (up to four in a row) instead
  of stopping playback; it is struck through in the list.
- Private and deleted entries are dropped at import, and duplicates collapse.

## Effects

Press **F**, or turn on *Effects* in the right-hand panel, and the mapped
picture becomes the background of a simulation. Everything you have masked —
the paintings, the plant, the couch — is **solid**: liquid pours around it,
balls land on it, smoke curls past it, snow piles on its upward-facing edges.
The video keeps playing underneath and is refracted, blurred, tinted or torn up
by whatever is running on top of it.

Add layers from the dropdown, or start from one of the **Scenes** (Flood the
room, Aquarium, Ball pit, Storm, Inferno, Break the picture, Overgrown, Event
horizon, Falling into itself, Vaporwave …). Layers stack bottom-to-top and each
has its own opacity. The *Trippy* and *Retro* groups are whole-picture shaders
rather than simulations: they fold, tile and feed the video back into itself.
The *Shapes* group works on the shapes you masked instead: each mask has an
**Effects see this shape** toggle, and the ones that are on cast shadows, stand
off the wall as blocks, are swept by stage lights, or get traced in neon. The
*Look* group re-renders the whole picture: print, text, 8-bit, paint, thermal,
glass.

### The Effects screen

The middle of the Effects view is a catalogue: every effect as a card with a
captured thumbnail — **hover a card and it plays a short clip** of the effect in
motion — searchable and filtered by group, with the scenes along the top. Click a card to add it to the stack on the left, where each layer's
parameters, actions and sound links live. The preview sits on the right with
the world, camera, look and sound controls under it. **Hover the preview** and
it grows over the view so you can watch the wall while you work; the
*Projector / TV* switch in its header shows either wall.

Each layer has three more choices beyond its parameters:

- **Show on** — which walls carry it: the projector, the TV, or both.
- **Colours** — for effects with colour swatches, take the colours from the
  video instead: *From the video* uses its dominant hues, *Complement* the
  opposite hues, *Invert* the negative, *Match the tone* its average. A few
  hundred pixels of the live picture are sampled every few frames and eased,
  so a cut does not flash.
- **Shapes** — which of the masked shapes this layer sees. A lamp can throw
  shadows from the paintings only while the aura ripples out of the couch; a
  layer that sees a subset gets its own distance field.

Any effect that has a position (a lamp, a vanishing point, the centre of a
kaleidoscope, a smoke nozzle) shows a **crosshair handle on the preview** while
its layer is selected. Drag it to place the light or the centre instead of
working two sliders; dragging turns off "follow the pointer" for that layer.

**Sets** keep the catalogue short. Pick *+ New set…* in the Set menu, name it,
and tick the effects that belong in it; from then on the catalogue (and the
phone's effect picker) shows only that set and the scenes it can build. *Edit
set* brings every effect back with a check box per card, so you can still browse
everything while you choose; *All effects* switches the set off. Sets are saved
with the app's settings.

The thumbnails and clips are captured from the running app with
`node scripts/fx-thumbs.mjs` (start the app with `--remote-debugging-port=9222`
and a video playing; `--no-clips` skips the recordings); rerun it after adding
or changing an effect, then `node scripts/readme-gallery.mjs` to refresh the
gallery below.

| | |
| --- | --- |
| **Falling balls** | Rigid spheres — rubber, glass, metal, marble, beachball. Screen-space impostors, so they stay perfectly round at any size; glass ones refract the video behind them, each casts a contact shadow that tightens as it nears a surface, and optional markings (bands, spots, beach ball, football) turn with the solver's own rotation so you can see them roll. |
| **Falling shapes** | Squares, triangles, pentagons, hexagons, stars, flowers and discs as real convex bodies, so they land on a flat side and stack. Bevelled and lit as solid slabs. |
| **Emoji rain** | Whatever emoji you type, dropped into the room as rigid bodies. Presets for party, food, nature, space, sport, hearts and weather, or type your own. |
| **Water** | A genuinely incompressible liquid (Clavet double-density relaxation over a few thousand particles). It pours in, finds a level, sloshes, splashes, and its surface is reconstructed as a metaball meniscus that refracts and tints the video by depth. |
| **Smoke** | Buoyant plume from a Eulerian solver with vorticity confinement, self-shadowed, and it blurs the picture behind it. The dye is reconstructed with a bicubic filter and its thin edges eaten by fine noise, so the grid never shows; a **Resolution** control trades solver size for detail. |
| **Fire** | Same solver with a temperature channel, a blackbody colour ramp, soot that outlives the flame, and firelight spilling onto the wall. |
| **Ink / paint** | Heavy pigment that sinks, pools on ledges and stains the picture. Multicolour option. |
| **Snow** | Flakes drift on a curl-noise wind, collide, and where they land on an up-facing surface they are baked into a depth field — so drifts grow on the top edge of every painting while the film plays, and melt back if you ask. |
| **Rain** | Angled streaks, splash crowns where they land, and a wet sheen that darkens and distorts the wall before it dries. |
| **Sand** | A falling-sand automaton on the GPU: half a million cells, each grain two pixels wide. A thin trickle pours in (one stream, three, a curtain along the top, or from the pointer), rolls down the slopes at a real angle of repose and heaps on the floor and on every shape; your hand (pointer or camera) is a solid the sand flows around. Every grain picks its own side to slide to, and a grain already moving keeps rolling, so avalanches run instead of stacking into a pillar. A drain through the floor is optional. |
| **Ripples** | A damped wave equation across the whole wall. Waves reflect off your shapes and bend the picture as they pass. |
| **Shatter** | A Voronoi crack pattern cuts the frame into shards; each becomes a rigid body but keeps the texture coordinates it had at rest, so it carries its piece of the *live* video down with it. Set **Put it back after** and the picture returns on its own — fading in, through opening doors, a wipe, an iris, or by flying every shard back into place. |
| **Bubbles** | Soap bubbles rise, roll along the underside of shapes and pop, with thin-film iridescence and refraction. |
| **Goo** | Sticky blobs that merge into one another and ooze over ledges, drawn as a metaball surface. |
| **Confetti** | Cards that tumble, catch the light on the flat of the stroke, and settle. |
| **Fireflies** | A flock that steers around your shapes and follows the pointer. |
| **Lightning** | Branching arcs that earth themselves on the nearest shape, with a flash on the wall. |
| **Aurora** | Slow folding curtains of domain-warped light, occluded by your shapes. |
| **Gravity well** | Bends the video around a point, with an accretion disc and a photon ring. |
| **Vines** | Space-colonisation growth that fills the open wall between your shapes and leafs out, with flowers at the tips. The roots look for open wall, so a creeper asked to start at the floor climbs out of the top of a couch you have masked across the bottom instead of dying inside it. Stem thickness follows the pipe model (a stem is as thick as the square root of the growth it carries); when the wall is full the plant withers and grows again. |
| **Kaleidoscope** | The picture mirrored into a turning wheel of wedges, with twist, breathing zoom and colour drift. |
| **Droste spiral** | Escher's *Print Gallery* transform: a ring of the frame repeats at every scale and, twisted, winds into a spiral, so the video falls endlessly into itself. |
| **Video feedback** | A camera pointed at its own monitor: the last frame is zoomed, turned and hue-shifted back under the live picture, receding down an infinite corridor. |
| **Tessellation** | One cell of the picture mirrored across a square, hexagonal, triangular or diamond lattice, seamless like a wallpaper group. |
| **Circle limit** | Escher's hyperbolic tiling: a {p,q} tessellation of the Poincaré disc found by folding every pixel into the fundamental triangle, with a Möbius slide across the disc. |
| **Tunnel** | The picture wrapped round the inside of an endless round, square or star-shaped tunnel you fly down. |
| **Acid** | A slow noise domain-warp that melts the picture while its colours cycle, with colour separation and neon edges. |
| **Synthwave** | A neon grid floor rushing to the horizon, the picture in the sky over a striped sun, pink-and-cyan grade, stars and scanlines. |
| **VHS tape** | Tracking bands, chroma bleed, line jitter, dropouts, head-switching noise and a curved tube. |
| **Glitch** | Torn slices, displaced and pixelated blocks and split channels, in random bursts or fired on the beat. |
| **Mirror & swirl** | The picture reflected through the middle (left onto right, top onto bottom, or four ways) with a swirl and waves on top. |
| **Room** | The wall opens into a box: floor, ceiling, side walls and a back wall in true perspective, each carrying the picture. The vanishing point follows the pointer, so the illusion shifts as you move. |
| **Burn** | Holes catch and spread like film in a hot projector: charred rims, a glowing front, embers and heat shimmer, until the whole picture has burnt away; then it comes back. |
| **Tetris** | Tetrominoes drop into a grid over the picture, steer themselves to the best fit, lock and clear full rows. Masked shapes are solid cells, so the pieces pile on your paintings. Glass tiles with the video showing through. |
| **Shadows** | A lamp in front of the wall makes every masked shape cast a soft shadow, with a warm pool of light around the lamp. The penumbra is a real one — sharp where the shape meets the wall, wide where the shadow is thrown far, with a little light creeping in around the caster and a contact shadow at the base — rather than a stack of hard cut-outs. Move the pointer and the shadows swing with it. |
| **Blocks** | The masked shapes stand off the wall as solid blocks: lit side faces, a highlight along the top edge and a contact shadow at the base, all in perspective from a movable vanishing point. |
| **Aura** | Neon contour waves ripple outwards from every shape along its true distance field, and the picture bulges away from the outlines. Breathing and silhouette growth are there if you want them, off by default. |
| **Field lines** | Lines of force radiate from every shape like a magnetic field, twisted as they travel out, with pulses of light running along them and the picture swept around the outlines. |
| **Shockwave** | A ring bursts out of every shape and runs across the wall, bending the picture and splitting its colours as it passes, with a lit crest and a shaded trough. Fire it by hand, on a timer, or on the beat. |
| **Glass rim** | Every shape is set behind a thick bevelled pane of glass: the picture refracts through the quarter-round bevel, the rim catches the light, a caustic line glows where the glass meets the wall. Frosted if you like. |
| **Plasma edge** | Electric tendrils crawl along every outline and reach out across the wall, flickering like a plasma globe, with a hot core and a coloured halo. |
| **Frost** | Ice creeps out of every shape in feathered crystals, frosts and blurs the picture over, holds, melts back with a glistening edge, and grows again. |
| **Contour map** | The wall as a height map with your shapes as the peaks: bands of colour by distance, contour lines between them, all drifting outwards, with the picture showing through as the shading. |

The **Generative** group runs the picture through the kind of systems that
drive Max Cooper's videos — reaction-diffusion and emergent life (*Order From
Chaos*, *Origins*), circle symmetry operations (*Symmetry*), duplicated built
form receding for ever (*Repetition*), the infinite zoom (*Aleph 2*), crowds as
geometry, transcendental digits and aperiodic tilings (*Perpetual Motion*),
dividing cellular forms, wave interference, weaving, tree maps:

| | |
| --- | --- |
| **Reaction diffusion** | Gray–Scott on the GPU, seeded by the picture's highlights: coral, spots, worms, waves or mitosis grow over the film and eat into it, as a tinted membrane, a refracting layer or an emboss. |
| **Game of Life** | Conway's Life over the picture, seeded from its edges and re-fed by movement, with glowing trails where cells lived. |
| **Rule 110** | An elementary cellular automaton (110, 30, 90, 184 …) pours down the wall from a seed row read off the top of the picture. |
| **Coral growth** | Cells spread from the shapes and the floor into the picture's shadows, so coral fills the dark of the film and leaves the light alone; then it dies back. |
| **Symmetry** | The picture cut into a grid of circles; each carries a rotated, reflected copy, and the operations sweep across the grid in waves. |
| **Sprawl** | The picture duplicates into 2×2, 4×4, 8×8 … copies receding for ever as the camera pulls back, mirrored so the seams meet. |
| **Aleph** | The picture inside itself inside itself, each level turned a little, the camera falling inwards for ever; the centre follows the pointer. |
| **Point cloud** | The picture as a field of dots lifted off the wall by their brightness, seen from a camera that drifts, so bright dots slide over dark ones. |
| **Network** | Points wander over the wall and join their neighbours with lines when they come close: a living network diagram over the film. |
| **Digits** | The picture typed out as seven-segment digits, each cell's digit its brightness: the wall as a transcendental number. |
| **Tree map** | The wall subdivided into a tree map, every rectangle split again and again, the splits sliding, each leaf a zoomed tile of the picture. |
| **Quasicrystal** | Five, seven or nine plane waves summed into a pattern that never repeats, the picture showing through its drifting contours. |
| **Interference** | Circular waves from moving sources add up across the wall and refract the picture; their heights are drawn as contour lines. |
| **Weave** | The picture woven from warp and weft threads that pass over and under, each thread carrying its strip of the film. |
| **Flow lines** | Noise smeared along the picture's own contours (line integral convolution), so the film becomes strands that follow its shapes. |
| **Moiré** | Two line gratings turning against each other, the picture bending the second: interference that rolls across the film. |
| **Waveform rows** | The live spectrum as rows of waveforms: each new row is the sound right now, older rows recede behind it (a picture-driven mode as well). Data as a landscape. |
| **Sonar rings** | The sound as rings pulsing out from the centre: the newest beat the innermost ring, each older one a ring further out. |
| **Parallax camera** | The flat picture given real depth — **Depth Anything V2** runs on the Mac (transformers.js on WebGPU), reads frames a little ahead of the playhead and hands the depth maps to every wall when the film reaches them — or, without the model, depth guessed from the picture. A camera drifts around it so near things slide over far things; follows the pointer. |
| **Circular** | Circles packed over the wall, each turning its own copy of the picture at its own speed, breathing with the film. |
| **Dust** | The picture dissolves into grains that drift up and away, then gathers itself again. |
| **Bar field** | The picture as columns of bars whose heights read the film's brightness: an equaliser made of the video. Link gain to the bass. |
| **Etching** | The film engraved: cross-hatching by brightness, the hatch turning with the picture's contours, on paper. |
| **Platonic** | Wireframe cube, octahedron and tetrahedron turning over the wall, their edges lit by the picture behind them. |
| **Stage lights** | Coloured spotlights on a rail above the wall sweep their beams across it; every shape throws a moving shadow from each. Beam haze, colours and rail height are yours. |
| **Neon outlines** | Every masked shape traced by a glowing tube with a light chasing along it and a little mains flicker; an inner tube and the picture's own edges optional. |
| **Flip tiles** | The picture cut into tiles that turn over in waves from the centre, diagonally or at random, showing a recoloured copy on their backs. |
| **Liquid metal** | A pool of mercury on the wall: a slow height field whose surface reflects the picture with hard highlights. |
| **Halftone print** | CMYK dot screens at their classic angles, or a one-ink comic with outlines, on paper. |
| **Text mode** | The picture typed out in characters from a glyph atlas sorted by ink coverage, in the video's own colours or on a green phosphor. |
| **8-bit** | Chunky pixels snapped to a PICO-8, NES, C64, Game Boy, ZX Spectrum or CGA palette with ordered dither, on a curved tube. |
| **Oil paint** | A Kuwahara filter flattens detail into brush-like patches that keep their edges, on a woven canvas. |
| **Thermal camera** | False colour by brightness: an iron heat palette, rainbow, green night vision or a Predator-style edge view. |
| **Stained glass** | The picture leaded into Voronoi glass panes, each one colour, the light shifting across them. |

### Every effect

<!-- gallery:start -->

**Physics**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/balls.jpg" width="220" alt="Falling balls"><br><sub>Falling balls</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/shapes.jpg" width="220" alt="Falling shapes"><br><sub>Falling shapes</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/emoji.jpg" width="220" alt="Emoji rain"><br><sub>Emoji rain</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/sand.jpg" width="220" alt="Sand"><br><sub>Sand</sub></td>
</tr><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/shatter.jpg" width="220" alt="Shatter"><br><sub>Shatter</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/bubbles.jpg" width="220" alt="Bubbles"><br><sub>Bubbles</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/goo.jpg" width="220" alt="Goo"><br><sub>Goo</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/tetris.jpg" width="220" alt="Tetris"><br><sub>Tetris</sub></td>
</tr></table>

**Fluid**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/water.jpg" width="220" alt="Water"><br><sub>Water</sub></td>
</tr></table>

**Weather**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/snow.jpg" width="220" alt="Snow"><br><sub>Snow</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/rain.jpg" width="220" alt="Rain"><br><sub>Rain</sub></td>
</tr></table>

**Water**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/ripples.jpg" width="220" alt="Ripples"><br><sub>Ripples</sub></td>
</tr></table>

**Particles**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/confetti.jpg" width="220" alt="Confetti"><br><sub>Confetti</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/fireflies.jpg" width="220" alt="Fireflies"><br><sub>Fireflies</sub></td>
</tr></table>

**Energy**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/lightning.jpg" width="220" alt="Lightning"><br><sub>Lightning</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/aurora.jpg" width="220" alt="Aurora"><br><sub>Aurora</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/blackhole.jpg" width="220" alt="Gravity well"><br><sub>Gravity well</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/burn.jpg" width="220" alt="Burn"><br><sub>Burn</sub></td>
</tr></table>

**Growth**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/vines.jpg" width="220" alt="Vines"><br><sub>Vines</sub></td>
</tr></table>

**Trippy**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/kaleido.jpg" width="220" alt="Kaleidoscope"><br><sub>Kaleidoscope</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/droste.jpg" width="220" alt="Droste spiral"><br><sub>Droste spiral</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/feedback.jpg" width="220" alt="Video feedback"><br><sub>Video feedback</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/tessellate.jpg" width="220" alt="Tessellation"><br><sub>Tessellation</sub></td>
</tr><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/hyperbolic.jpg" width="220" alt="Circle limit"><br><sub>Circle limit</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/tunnel.jpg" width="220" alt="Tunnel"><br><sub>Tunnel</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/acid.jpg" width="220" alt="Acid"><br><sub>Acid</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/mirror.jpg" width="220" alt="Mirror & swirl"><br><sub>Mirror & swirl</sub></td>
</tr><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/room.jpg" width="220" alt="Room"><br><sub>Room</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/fliptiles.jpg" width="220" alt="Flip tiles"><br><sub>Flip tiles</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/chrome.jpg" width="220" alt="Liquid metal"><br><sub>Liquid metal</sub></td>
</tr></table>

**Retro**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/synthwave.jpg" width="220" alt="Synthwave"><br><sub>Synthwave</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/vhs.jpg" width="220" alt="VHS tape"><br><sub>VHS tape</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/glitch.jpg" width="220" alt="Glitch"><br><sub>Glitch</sub></td>
</tr></table>

**Look**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/halftone.jpg" width="220" alt="Halftone print"><br><sub>Halftone print</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/ascii.jpg" width="220" alt="Text mode"><br><sub>Text mode</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/eightbit.jpg" width="220" alt="8-bit"><br><sub>8-bit</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/painterly.jpg" width="220" alt="Oil paint"><br><sub>Oil paint</sub></td>
</tr><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/thermal.jpg" width="220" alt="Thermal camera"><br><sub>Thermal camera</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/stainedglass.jpg" width="220" alt="Stained glass"><br><sub>Stained glass</sub></td>
</tr></table>

**Generative**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/reaction.jpg" width="220" alt="Reaction diffusion"><br><sub>Reaction diffusion</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/life.jpg" width="220" alt="Game of Life"><br><sub>Game of Life</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/rule.jpg" width="220" alt="Rule 110"><br><sub>Rule 110</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/coral.jpg" width="220" alt="Coral growth"><br><sub>Coral growth</sub></td>
</tr></table>

**Shapes**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/shadows.jpg" width="220" alt="Shadows"><br><sub>Shadows</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/extrude.jpg" width="220" alt="Blocks"><br><sub>Blocks</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/aura.jpg" width="220" alt="Aura"><br><sub>Aura</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/fieldlines.jpg" width="220" alt="Field lines"><br><sub>Field lines</sub></td>
</tr><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/shockwave.jpg" width="220" alt="Shockwave"><br><sub>Shockwave</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/glassrim.jpg" width="220" alt="Glass rim"><br><sub>Glass rim</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/plasma.jpg" width="220" alt="Plasma edge"><br><sub>Plasma edge</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/frost.jpg" width="220" alt="Frost"><br><sub>Frost</sub></td>
</tr><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/contour.jpg" width="220" alt="Contour map"><br><sub>Contour map</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/stagelights.jpg" width="220" alt="Stage lights"><br><sub>Stage lights</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/neon.jpg" width="220" alt="Neon outlines"><br><sub>Neon outlines</sub></td>
</tr></table>

**AI**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/aitext.jpg" width="220" alt="AI caption"><br><sub>AI caption</sub></td>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/aidream.jpg" width="220" alt="AI dream"><br><sub>AI dream</sub></td>
</tr></table>

**People**

<table><tr>
<td align="center" valign="top"><img src="src/renderer/control/fx-thumbs/people.jpg" width="220" alt="Pixel people"><br><sub>Pixel people</sub></td>
</tr></table>

<!-- gallery:end -->

### How it fits together

Effects render in **output space**, over the warped picture and *before* the
blackout masks — so water flows around a painting and the painting still stays
black on the wall. The chain runs in half-float, so an ember or a specular
glint can be brighter than white and pick up bloom on the way out.

Everything collides against one shared world, rebuilt only when your shapes
change:

- a **signed distance field** (exact Felzenszwalb transform, on the CPU and as
  a texture) for particles, fluids and shading, which want a smooth normal
  anywhere; and
- the same outlines as **triangles** for the rigid-body solver, which wants
  exact contacts so a heap of shards can actually stack on a ledge.

Under *World* you can also make the projection-area edges solid, turn the frame
walls (floor / ceiling / sides) on and off, and set gravity, wind and time
scale. Every effect steps on a fixed 1/60 s timestep driven by the wall clock,
so the control preview and the projector stay in step.

**Quality** trades grid resolution, particle counts and pressure iterations:
Low → Ultra. On an M1 a stack of water + balls + smoke + fireflies holds 60 fps
in both windows at once.

### It listens to the film

Turn on **React to sound** and the effects follow the audio of whatever is
playing. An analyser sits in the audio path of whichever window is actually
carrying the sound — projector, TV or control — and the features it derives are
relayed to the other windows, so the projector can react to what the TV is
playing.

Six signals are available, all normalised and adaptively gained so a quiet film
and a loud one both drive the effects over their full range:

| | |
| --- | --- |
| Loudness | overall level |
| Bass / Low mid / Mid / High / Air | five frequency bands |
| Beat pulse | a decaying spike on each detected onset |
| Beat ramp / Beat wave | a saw and a cosine locked to the estimated tempo, so things can swell *between* beats rather than only on them |
| Attack | raw spectral flux — every transient, not just the beat |

Beats come from spectral flux under 250 Hz (which is where a kick lives)
measured against a running mean and deviation, rate-limited, with the tempo
folded into a musical range.

Two ways to use them:

- **Sound links** on any layer map a signal to any parameter of that effect.
  Bass → flame height, loudness → rain rate, high → aurora fold count. The
  amount is signed, so you can make something *shrink* on the beat too.
- **On the beat** fires one of the effect's own actions — drop a handful of
  balls, throw a ripple, strike lightning, break the picture — every *n* beats.

Under *Sound* the same signals can also drive the world: gravity, playback
speed of the simulation, wind, bloom and exposure.

Six of the scene presets are audio-reactive out of the box (*Beat drop*,
*Equaliser fire*, *Sonar*, *Storm on the beat*, *Breathing aurora*, *Shatter on
the drop*).

Note that the analyser only ever sees what a window is actually playing: with a
calibration pattern up, playback is suspended and the meter reads nothing.

### Interaction

Move the pointer over the stage and the simulation feels it — swat the balls,
stir the water, fan the smoke. Turn on **People push the effects** and the
tracker reuses the camera alignment you already solved for mapping: it
resamples each camera frame into output space through that homography,
differences successive frames, clusters what moved, and hands each cluster to
the simulation as a moving blob. Stand in front of the wall and the water
splashes where you are.

Press **X** to fire every layer's primary action at once (drop a handful of
balls, strike lightning, break the picture).

## Marking areas to black out

- **+ Mask** drags a rectangle, **+ Shape** clicks a polygon (Enter or click the
  first point to close).
- Double-click an edge to add a point, Backspace on a point to remove it.
- **Softness** feathers the edge, **Grow** expands or shrinks it — useful to
  cover a picture frame edge without a visible sliver of light.
- **Show only inside (invert)** flips it: everything outside goes black. Handy
  to restrict the picture to one panel.

## Camera assist (Continuity Camera)

Stand your iPhone facing the wall and pick it in the **Camera** dropdown, then
press **Align to wall**. The app projects four corner markers and asks you to
click each one in the camera image. It solves the camera-to-projector
homography and warps the live camera view into the stage behind your mapping —
so you can trace the paintings and couch directly over what the camera sees
instead of guessing.

## Library

Instead of streaming every time, keep a local collection of music videos. Press
**Library** in the top bar.

- **Add** pastes any number of YouTube video / playlist / channel URLs (one per
  line). Each is expanded and downloaded with yt-dlp; the **artist and song** are
  parsed from the title (`Artist – Song (Official Video)` → *Artist* / *Song*),
  and yt-dlp's own `artist`/`track` fields are used when present.
- Each video gets a **poster** (a representative frame, chosen by ffmpeg so a
  dark intro doesn't become a black thumbnail) and a 25-frame **storyboard**.
  Hover a card — or long-press on a phone — and drag across it to **scrub a quick
  preview** through the whole video.
- Cards show **length, resolution** (1080p/4K…), source and tags, and download
  progress. Select several (the circle in the corner) for **batch** actions.

### Editing (non-destructive)

**Edit** opens a video with three tools, none of which touch the downloaded
file — every edit is metadata, applied live at playback and carried in the
export:

- **Crop / letterbox** — drag a rectangle over the picture, or **Auto-detect**
  runs ffmpeg `cropdetect` to find black bars. In batch, *Detect letterbox*
  processes the whole selection at once. The crop is applied in the projector's
  own shader, so the un-letterboxed picture fills your mapping with no re-encode
  and no quality loss.
- **Trim** — set an in- and out-point; playback starts and ends there.
- **Artist / title / tags**, and a **SponsorBlock** toggle.

### SponsorBlock

When a video is downloaded its SponsorBlock segments (sponsor, self-promo,
intro/outro, non-music) are fetched from sponsor.ajay.app and **skipped during
playback** — again without altering the file. Toggle it per video in the editor.

### Playing, playlists and discovery

- Play a library video with **Play**, or **Queue** it. In the playlist each item
  is badged **lib / stream / file** so you can see at a glance what is local and
  what is being streamed. Streaming still works exactly as before.
- **Save list** stores the current playlist by name; the dropdown loads them
  back. They are plain JSON in `~/Library/Application Support/projector/playlists/`.
- **Auto-discover** keeps the show going on its own: it asks YouTube for the Mix
  (radio) of tracks you already have and streams related videos in ahead of the
  playhead, so a set never runs dry.

### Export / import

**Export** writes a small manifest of every video — its URL and how you renamed,
tagged, trimmed and cropped it — with no media. **Import** it on another machine
and Projector re-downloads everything and re-applies all your edits, so a whole
curated, cropped library travels as one small file.

## Phone camera (people push the effects)

The phone page is styled as a DOS text-mode program: the 16-colour palette, a
VGA face, double-line boxes, hard black shadows and scanlines. It is a
network-first PWA whose shell cache is versioned, so a phone picks the new look
up on its next load; if it does not, you are probably still running the old
packaged `.app`, which serves its own copy of the page. Rebuild with
`npm run build`.

The Continuity Camera path above differences frames on the Mac. The phone path
does better: the phone runs a body tracker on its own camera and only sends
where people are, so the projector reacts to arms and hands, not just to
"something moved".

1. **Share on Wi-Fi** in the left panel starts a small server inside the app
   and shows its address and a QR code. Open it on any phone on the same
   network. The page is served over https with a certificate the app made
   itself, so the phone asks once whether to trust it — browsers only open a
   camera on a secure page.
2. Put the phone on a stand so the whole projection is in its frame and start
   its camera (the rear one by default).
3. Press **Align** — on the phone or in the app. The projector shows the four
   coloured corner squares, the phone looks for them and drops a numbered
   handle on each; drag them onto the squares' centres (a magnifier appears
   while you drag) and press *Done*. That solves the camera-to-projector
   homography, which is remembered with your settings, so a phone left on its
   tripod stays aligned across restarts. Rotating the phone invalidates it and
   the app says so.
4. Press **Track**. Under *Effects → Camera interaction*, turn on **People push
   things** and choose what a person pushes with: *hands*, *head and arms*, or
   the *whole body*. Limbs become chains of circles along the bone, sized by how
   big the person looks on the wall, so a sweeping forearm shoves everything in
   its path. **Show tracking** draws the skeletons over the stage.

The tracker is MediaPipe's pose landmarker running in the phone's browser
(GPU where available, up to four people; pick *lite / full / heavy* in the
phone's settings sheet). By default the phone loads it from the internet the
first time; run `npm run fetch-models` to bundle it into `assets/mediapipe/`
and the app serves it itself, for venues without internet.

The phone's **Mixer** tab is a full remote for the effects: walls, effects on
the TV, scenes, and every layer — tap a layer's name and its own sliders,
switches and menus unfold, along with which walls it shows on and where it takes
its colours from. The catalogue for adding an effect is grouped the way the
Mac's is. The **Queue** tab shows what is playing with a live picture of the
wall, what is up next, and the library.

Landmarks travel as JSON over a WebSocket at 30 Hz — a few kilobytes a second —
and the app maps them through the homography into output space, differences
successive packets for velocity, and hands the result to the same interactor
path the pointer uses. Several phones can be connected at once; they all push.

## Outputs — two walls

| Role | What it does |
| --- | --- |
| Projector | Full mapped output: areas, warps and masks, with the effects running over the picture and around your shapes |
| TV | The same video plain and full-screen (contain / cover / stretch) **with the same effects running over it** — its own simulation, in its own aspect, with no masked shapes, only the edges of its frame — or a copy of the mapped output |

The TV is a second wall rather than a mirror. *Effects on the TV* in Setup
turns its stack on and off; each effect layer chooses which walls it shows on
(*Show on* in the Effects view), so the water can flood the projector wall
while the TV only carries the kaleidoscope. The live preview's *Projector / TV*
switch shows what each wall is getting.

Each role is pinned to a screen by id *and* name, so a reconnect that renumbers
the displays does not silently send the projector feed to the TV. On first run
the screens are guessed from their EDID names (a *SANYO Z4000* is a projector, an
*LG TV* is not), and the two roles are never allowed to land on the same screen —
if a saved assignment collides, the guess is made again. **Swap the two screens**
exchanges them in one click when the guess comes out backwards, and **Identify
outputs** flashes the role *and* the screen name on each output window.

An output window floats above everything so nothing can appear over the
projection — except on the screen the control window is using, where that would
bury the only way to operate the app. With two screens and two outputs there is
no free screen left, so the output sharing with the control window gives up its
top status; it is still full-screen, and nothing else is on that display anyway.

## Wall setups

The mapping, masks and effects you last had on screen come back by themselves
when you reopen the app — that is the autosaved session. **Wall setups** are for
keeping more than one: name the current setup, save it, and switch between them
from the dropdown. They are plain JSON in
`~/Library/Application Support/projector/mappings/`, so they survive a
reinstall and can be copied between machines. If the session is ever lost, the
most recently saved setup is loaded instead.

**Save mapping** in Presets still writes a portable `.projector.json` anywhere
you like, for sharing a setup as a file.

Both windows derive their playback time from one shared wall clock and nudge
their own playback rate to stay within ~35 ms, so the two screens stay together
without one driving the other. Choose which screen carries the audio under
**Audio from**.

## AI

Everything here is off until **AI on** in Setup → AI. The key is read from the
app's settings, the environment, or a `.env` file at the repository root
(`OPENAI_API_KEY=sk-…`). The models the key can use are listed from the API and
picked from four menus: the **Director** (plans the show; gpt-5.4 by default),
the **Reader** (reads frames for captions; gpt-5.4-mini), the **Painter**
(re-paints frames for AI dream; gpt-image-1.5) and **Sprites** (draws the pixel
people; gpt-image-2). All calls run in
the main process; renderers never see the key.

### The director

**AI steers the effects** (also the *AI* switch in the top bar) hands the model
the show as it stands whenever a track starts: what is playing and what is
next, the measured tempo and the spectrum averaged over the last seconds, the
colours on the wall, the shapes you have masked, which walls are on, its own
recent plans, and a compact catalogue of every effect with its parameters and
ranges. It answers with one tool call — a full plan of one to four layers with
parameters, sound links, beat triggers, palette modes and world settings — which
is validated against the real schemas and applied. A **brief** is a standing
direction it must respect ("dark and slow", "kids' party"). **Re-plan** can be
once per track, on a timer with a random spread, or **when the music changes
section**: a sustained jump or drop in loudness and bass against the previous
half minute is found locally, without a model, and then the director is asked
again — usually, not always, and never within 40 s of the last plan. The Effects
panel shows its latest note; the Setup log keeps the last dozen.

### Reading the film

A second copy of the video runs ahead of the playhead. While an **AI caption**
layer is in the stack, frames are read every so often, described in the voice
you chose (poetic, haiku, film noir, field notes, breaking news, a child
explaining it, tarot …) and language, and the caption is held until the film
reaches that frame, then typeset on the wall in the type, place and animation
the layer chooses. With **AI dream**, frames are re-painted by the image model
in a named medium (oil, woodcut, stained glass, blueprint …) and cross-faded in
when their moment comes — slow and costly, one every half minute or so. **AI
picks the emoji** lets the reader choose the emoji rain's emoji for the scene.

### Depth (local model)

The parallax camera's depth comes from Depth Anything V2 (small), run inside
the control window through transformers.js — WebGPU where it is available,
WASM otherwise. The model is fetched from the Hugging Face hub the first time a
Parallax camera layer asks for it (about 50 MB, then cached) and its runtime is
served from `node_modules` through the app's own protocol. Nothing else leaves
the Mac. Setup shows its state and frame rate, with a *Load now* button.

### Spending

Setup → AI keeps a ledger: every call's token counts priced at list rates, per
day, per function (director, captions, dreams, pixel people). Today, seven days,
the month and all time, plus the last ten days in a table. Estimates, not an
invoice.

## Pixel people

Anyone on the phone opens **F4 Me**, frames themselves, keeps or re-rolls the
suggested name (a verb and a fruit — Juggling Papaya) and presses **Pixelate
me**. The phone is told it has been sent off and need not wait.

A character is drawn the way [pixel-it](../pixel-it) draws them. The photo goes
to the image model with the house hero as a style reference and comes back as
one large **hero** sprite on a magenta field — the identity, locked once. The
Mac keys the magenta out and the person is standing on the wall within a
minute. Then every animation sheet of **Base**, the house template in
`src/main/base/`, is drawn "like Base, but this person", all at once: walk;
run, jump, fall; idle, sit, sleep; crouch, shout, climb; and two rows of dance
moves. Each comes back as rows of figures spaced however the model felt like,
so the sprites are found, clustered into rows, split where two were drawn
touching, and stitched into one sheet with one animation per row and a manifest
saying which cells are which. A vision model describes the hero's wardrobe in a
sentence that is pinned into every sheet prompt, since otherwise the model
dresses the new person in Base's shorts. About a dollar and three minutes a
person. Characters made before this (the flat 4x2 sheets) still work, with the
moves they have; **All the moves** on their card draws the rest from their idle
frame.

The **People** view is the roster: an animated preview of each character
cycling through its moves, a name to edit, on/off, which effect sets they
belong to, the moves it has, what it cost, remove, and *Add from photo…* for
photos on the Mac. The **Pixel people** effect drops everyone who is on (and in
the active set) into the room — tumbling, screaming, shot in from the side or
spun in through a time warp — bouncing on landing, then walking and running the
tops of your masked shapes and the floor, climbing the sides of shapes up and
down (and reaching up for one hanging just overhead), jumping gaps, peering
over edges (and sometimes stepping off), sneaking, sitting and napping when it
is quiet, shouting at the room, dancing to the beat with their own moves, and
getting knocked flying by a hand or a tracked person. A long fall knocks them
out for a moment, stars and all. They are quiet by default; *They talk* gives
them pixel-it's one-liners.

Things pixel-it learnt the hard way are kept: every cell of a sheet has its ink
box measured once, so each frame is drawn at its own natural height with the
feet exactly on the ground (the model draws every cell at a slightly different
scale, and drawing cells raw is what made the walk jitter); airborne frames
keep their lift above the row's floor; the walk cycle advances with the ground
covered rather than with time, so the legs never skate; dance frames advance
with the beat. Sprites are uploaded premultiplied and mipmapped, which is what
removes the dark fringe and the shimmer around them.

## Playing from the phone

The phone's **F5 Play** tab shows the wall live and is a touch surface: fingers
on the picture are hands in front of the wall, with a velocity, and push
whatever effect is running — several fingers at once. Below it, with the Pixel
people effect on the wall, is a pad for **being one of the pixel people**: pick
one (your own is starred), hold ◀ ▶ to walk, tick *Run* for a sprint, and the
moves — jump, dance, sit, sneak, shout, nap, turn, stop. A driven person still
climbs what is in the way, climbs down or steps off ledges, and goes back to a
life of its own a moment after the finger lifts. **Say** puts a line in its
speech bubble, forty characters at most, even when *They talk* is off. Setup →
Phone has three switches for what phones may do: touch the effects (on),
play a pixel person (on), make them talk (off).

## Playlists that keep

Every streamed track is pulled down as it plays (**Pre-download streams** in
Setup) and played from disk the next time it comes round. The copies live in a
cache of the last 25 — *Streamed lately* in the Library — and press **★ Keep**
on a playlist item or a cached card to make one part of the library proper.

## Setup

Setup is laid out as cards in columns — Output, AI, Depth, Wall setups,
Presets, Keys — rather than one sheet of controls the width of the window.

## Booleans are switches

Anything on/off in the app is a switch (or a check box in a list), never a
button that happens to be lit: outputs and blackout in the top bar, handles and
wall guides in the tool bar, every toggle in the panels, the visibility of each
layer and mask. The phone shows the same things as `[ ]` / `[X]` check boxes.

## Keys

| | |
| --- | --- |
| `V` `S` `M` `P` | select / new area / mask rect / mask shape |
| `F` | effects on / off |
| `X` | trigger every effect layer |
| `Shift`+arrows | seek 5s |
| `Space` | play / pause |
| `B` | blackout |
| `G` | wall guides (outlines drawn on the wall itself) |
| arrows | nudge 1px, with `Shift` 10px |
| `Backspace` | delete point or object |
| `Cmd`+scroll | zoom, `Alt`+drag pan |
| `Cmd`+drag | ignore snapping, `Shift`+drag constrain to an axis |

## Files

```
src/main/index.js       windows, displays, transport clock, IPC, media proxy
src/main/ytdlp.js       YouTube resolution (split video+audio, up to 4K)
src/main/library.js      music-video library: downloads, ffmpeg thumbs/crop, sponsorblock
src/shared/gl-engine.mjs  WebGL2 renderer: warp, edge blend, colour, masks
src/shared/mat3.mjs     homography maths (square-to-quad, inverse)
src/shared/mesh.mjs     warp grid, polygon offsetting
src/shared/player.mjs   clock-driven playback, drift correction
src/shared/patterns.mjs calibration patterns
src/renderer/control/   the editor UI
src/renderer/output/    the fullscreen output windows
src/renderer/control/motion.mjs   camera movement -> interaction blobs
src/renderer/control/remote.mjs   phone camera panel, alignment, pose -> interactors
src/renderer/control/qr.mjs       QR encoder for the phone address
src/renderer/control/library.mjs  the Library manager view and video editor
src/main/remote.js       LAN https + WebSocket server for the phone page
src/remote/              the page a phone opens: camera, MediaPipe pose, alignment
src/shared/pose.mjs      body landmarks -> the joints and limbs that push
scripts/fetch-models.sh  bundle the pose tracker so phones need no internet

src/shared/fx/system.mjs     the effect stack: layers, clock, compositing, bloom
src/shared/fx/field.mjs      occluders -> signed distance field + collision triangles
src/shared/fx/bodies.mjs     2-D rigid bodies (sequential impulses, warm starting)
src/shared/fx/particles.mjs  particle pool, Clavet fluid relaxation, sprite batch
src/shared/fx/fluid.mjs      Eulerian solver for smoke / fire / ink
src/shared/fx/wave.mjs       damped wave equation
src/shared/fx/audio.mjs      audio analysis, beat detection, parameter modulation
src/shared/fx/glu.mjs        GL helpers and shared shader chunks
src/shared/fx/effects/       one file per effect family
```

Your mapping, display assignment, settings and playlist autosave to
`~/Library/Application Support/projector/session.json` and come back on launch.
**Save mapping** writes a portable `.projector.json` you can keep per setup.

## Keeping playback smooth

Three things were costing more than they were worth:

- **Texture uploads were never actually gated.** The engine is told whether the
  player has a `requestVideoFrameCallback` loop running, but that only starts
  when a track loads — and the flag was read once, at startup, when it was
  still false. Every window was therefore re-uploading a 1080p frame on every
  animation frame instead of once per decoded frame: 60 uploads a second for 24
  unique frames. `setSource` is now safe to call each frame and refreshes the
  flag.
- **The control preview pulled its own 1080p copy.** It is a few hundred pixels
  wide. yt-dlp now resolves a 480p video-only copy in the same call, and the
  control window uses it whenever an output window is open (*Preview quality*
  under Output).
- **A failed range request killed the stream for good.** Chromium abandons a
  media resource whose read fails — the element parks at readyState 2 and never
  asks the network again, which is the "stuck on Buffering…" symptom. The proxy
  now retries transient socket errors and 5xx responses instead of surfacing
  them, and the player watches for a track that has stopped making progress and
  re-opens it at the shared clock position.

Film shot at 24 or 25 fps also lands on an uneven 3:2 cadence against a 60 Hz
projector, which reads as judder on slow pans. **Smooth motion** under *Look*
cross-fades between the two most recent decoded frames to even it out, at the
cost of a little motion blur; the panel shows the detected source rate.

## Performance notes

Measured on an M1 with a 1080p60 YouTube stream and both windows decoding at
once: 56-58 presented frames per second per window, playback at 1.00x, zero
stalls, ~31s buffered ahead. The renderer runs at ~58 fps with no dropped
frames, and two simultaneous decodes show no contention.

Three things mattered to get there, all of them bugs rather than platform limits:

- **Never re-wrap the upstream response in the media proxy.** YouTube's adaptive
  streams send no `access-control-allow-origin`, so they cannot be used as WebGL
  textures directly and are proxied through the app's own origin. Copying the
  body into a new `Response` pumps every chunk through main-process JS and
  measured **1.4 MB/s** - below what 1080p60 needs, so playback buffered
  constantly. Returning the upstream response object unchanged lets Chromium
  pipe it natively.
- **Pass `req.signal` to `net.fetch`.** Media elements abort range requests
  constantly; without propagating cancellation the upstream sockets leak and the
  connection pool for the CDN host runs dry, which starves video (large stream)
  while audio (small) stays fine.
- **Only one window may steer the shared clock.** If every window can pull the
  clock back to its own media time, two of them oscillate: one drags the clock
  back, the other is then ahead, seeks backwards, loses its buffer, stalls, and
  drags the clock back again. `clockOwner` (the audio-carrying output, else the
  projector) is the only window allowed to correct it.

Texture uploads are also gated on `requestVideoFrameCallback`, so a frame is
uploaded once when it is presented rather than on every animation frame, and the
control preview's render target is capped at 1400px wide instead of following a
2x display.

## Why this is still an Electron app

The effects layer was the obvious moment to consider going native (Swift +
Metal). It is not worth it. What makes this app work is not the drawing API —
it is the tuned video pipeline: the YouTube proxy that has to hand Chromium an
un-rewrapped response to hit 1080p60, the two-window clock with a single
authorised owner, `requestVideoFrameCallback`-gated texture uploads, and
Continuity Camera. All of that would have to be rebuilt from scratch, and none
of it would get faster.

WebGL2 was not the constraint either. Everything here — half-float render
targets, transform feedback, instanced impostors, a pressure solve at 384x216 —
runs on the M1's Metal-backed ANGLE at 60 fps with headroom. No three.js and no
WASM physics engine: a purpose-built 2-D solver over the mask outlines is both
smaller and better suited than a general 3-D engine, and the app stays
dependency-free apart from Electron itself.

If a later effect genuinely needs compute shaders, WebGPU is already available
in this Electron build and can be added as a second renderer beside the
existing one.

## Notes

- YouTube streams are proxied through the app's own origin so they can be used
  as WebGL textures; adaptive video and audio arrive as two streams kept in
  sync by the shared clock.
- The projector display is kept awake while an output window is open.
- `Cmd+Alt+P` closes all output windows from anywhere, and `Esc` closes a
  focused output window. Output windows open without taking focus.
- macOS note: `setVisibleOnAllWorkspaces()` silently switches the process to an
  accessory activation policy, which removes the Dock icon and menu bar. The app
  re-asserts `regular` policy afterwards, otherwise the control window becomes
  unreachable once it loses focus.
- Audio target defaults to **Auto**: the first open output window. A fixed
  target that is not open would otherwise mean silence.
- The app is ad-hoc signed. If macOS blocks the first launch, right-click the
  app and choose Open.
