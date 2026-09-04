# Projector

Projection-mapping video player for macOS. Plays local files or YouTube
links/playlists, warps the picture onto one or more wall areas independently,
blacks out shapes you mark (paintings, plant, couch), and can mirror the same
video full-screen on your TV.

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
horizon …). Layers stack bottom-to-top and each has its own opacity.

| | |
| --- | --- |
| **Falling balls** | Rigid spheres — rubber, glass, metal, marble, beachball. Screen-space impostors, so they stay perfectly round at any size; glass ones refract the video behind them, each casts a contact shadow that tightens as it nears a surface, and optional markings (bands, spots, beach ball, football) turn with the solver's own rotation so you can see them roll. |
| **Falling shapes** | Squares, triangles, pentagons, hexagons, stars, flowers and discs as real convex bodies, so they land on a flat side and stack. Bevelled and lit as solid slabs. |
| **Emoji rain** | Whatever emoji you type, dropped into the room as rigid bodies. Presets for party, food, nature, space, sport, hearts and weather, or type your own. |
| **Water** | A genuinely incompressible liquid (Clavet double-density relaxation over a few thousand particles). It pours in, finds a level, sloshes, splashes, and its surface is reconstructed as a metaball meniscus that refracts and tints the video by depth. |
| **Smoke** | Buoyant plume from a Eulerian solver with vorticity confinement, self-shadowed, and it blurs the picture behind it. |
| **Fire** | Same solver with a temperature channel, a blackbody colour ramp, soot that outlives the flame, and firelight spilling onto the wall. |
| **Ink / paint** | Heavy pigment that sinks, pools on ledges and stains the picture. Multicolour option. |
| **Snow** | Flakes drift on a curl-noise wind, collide, and where they land on an up-facing surface they are baked into a depth field — so drifts grow on the top edge of every painting while the film plays, and melt back if you ask. |
| **Rain** | Angled streaks, splash crowns where they land, and a wet sheen that darkens and distorts the wall before it dries. |
| **Sand** | Real granular discs with Coulomb friction: pours, avalanches, holds a slope. |
| **Ripples** | A damped wave equation across the whole wall. Waves reflect off your shapes and bend the picture as they pass. |
| **Shatter** | A Voronoi crack pattern cuts the frame into shards; each becomes a rigid body but keeps the texture coordinates it had at rest, so it carries its piece of the *live* video down with it. Set **Put it back after** and the picture returns on its own — fading in, through opening doors, a wipe, an iris, or by flying every shard back into place. |
| **Bubbles** | Soap bubbles rise, roll along the underside of shapes and pop, with thin-film iridescence and refraction. |
| **Goo** | Sticky blobs that merge into one another and ooze over ledges, drawn as a metaball surface. |
| **Confetti** | Cards that tumble, catch the light on the flat of the stroke, and settle. |
| **Fireflies** | A flock that steers around your shapes and follows the pointer. |
| **Lightning** | Branching arcs that earth themselves on the nearest shape, with a flash on the wall. |
| **Aurora** | Slow folding curtains of domain-warped light, occluded by your shapes. |
| **Gravity well** | Bends the video around a point, with an accretion disc and a photon ring. |
| **Vines** | Space-colonisation growth that fills the open wall between your shapes and leafs out. |

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

Landmarks travel as JSON over a WebSocket at 30 Hz — a few kilobytes a second —
and the app maps them through the homography into output space, differences
successive packets for velocity, and hands the result to the same interactor
path the pointer uses. Several phones can be connected at once; they all push.

## Outputs

| Role | What it does |
| --- | --- |
| Projector | Full mapped output: areas, warps and masks |
| TV | Same video plain and full-screen (contain / cover / stretch), or the mapped output |

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
