# ⛳ Putt-Putt Planet

A cozy, stylised 3D mini golf game for 1–6 players: five worlds (45 holes), online and serverless direct co-op, collectibles, cosmetics and a daily challenge. Built with Three.js, Rapier physics and a small authoritative Node server. The courses, props, skies and almost every sound are procedural; the scenery trees, plants and rocks come from a CC0 model pack, and the one recording is the putter strike (credits below).

## Quick start

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5173. `npm run dev` starts the Vite client (`:5173`) and the game server (`:8787`, proxied at `/ws`) together. Solo play works even if the server is down.

**Testing multiplayer locally:** open two tabs with different local profiles, e.g. `http://localhost:5173/?profile=a` and `http://localhost:5173/?profile=b`. Create a room in one, then join with the code (or the copied invite link `?join=CODE`) in the other.

## Playing with friends (up to 6 players)

| Way | Needs | How |
|---|---|---|
| **Direct (no server)** | nothing but the game | *Play with Friends → Host direct game*, then **Create invite code** for each friend. Send it (Messages, Discord…); they choose *Enter invite code*, paste it and send back the **reply code**, which you paste under that invite. Codes are short (under 200 letters and digits) and survive chat formatting. The game runs on the host's device. The host can remove a player with **✕ Remove** on their card in the lobby, or from *Pause → Players* during a game. |
| **Local network** | desktop app on the host | *Host on local network* shows an address + room code; friends use *Join by address*. Friends without the app can also open `http://<address>:8787` in a browser on the same Wi-Fi. |
| **Online server** | a deployed server (see Deployment) | *Create room* / *Join a room* with the 6-letter code or invite link. |

Direct play uses WebRTC. Public STUN servers only help the two devices find each other through home routers; no game data passes through any server. Codes can be exchanged at any pace: both games keep retrying the link (the guest for 15 minutes, the host for 3 minutes after pasting the reply), which is what lets the two home routers open up to each other. A small number of strict networks (some corporate or mobile carrier NATs) block direct links; then use the same Wi-Fi or the online server. The host's game *is* the server, so the host must keep the game open (backgrounding the iPhone app pauses it).

## How to play

|                            | Mouse / touch                                                | Keyboard                                                  | Gamepad                             |
| -------------------------- | ------------------------------------------------------------ | --------------------------------------------------------- | ----------------------------------- |
| Aim & shoot                | Drag **back** from the ball (slingshot), release             | ←/→ aim (Shift = fine), hold **Space** to charge, release | Left stick aim, hold **A**, release |
| Camera                     | Drag elsewhere / right-drag to orbit, wheel or pinch to zoom | Q/E orbit, W/S zoom                                       | Right stick, LB/RB zoom             |
| Overview                   | 🗺 button                                                     | T                                                         | Y                                   |
| Rescue a stuck ball (free) | ⛑ button                                                     | R                                                         | X                                   |
| Emotes / chat              | 😀 / 💬                                                      | G / Enter                                                 | —                                   |
| Scorecard / pause / debug  | ⏸                                                            | Tab / Esc / \`                                            | Start                               |

All keys are remappable in **Settings**, which also has volume sliders, graphics quality (Low, Medium, High, Ultra), reduced motion, colour-blind aim palettes, **Show FPS** and **Show ping** (online games only, off by default: a small readout of your connection's ping, or *reconnecting…*). Online, the Tab scorecard shows every player's ping, live. In the desktop app, **⏻ Quit to desktop** sits in the main menu's bottom-right corner. **Film grain** (0–100, off by default) lays a fine, moving film grain over the picture. **Anti-aliasing**: *Auto* follows the preset (Low 2x MSAA, Medium 2x MSAA + FXAA, High and Ultra 4x MSAA + SMAA), or pick Off, FXAA, MSAA 2x/4x/8x, or SMAA + MSAA 4x. Changing the quality preset swaps the scenery straight away, mid-hole included. **Moving sun** (on by default, off under reduced motion) lets the golden-hour sun drift slowly across the sky, so shadows and light shafts sweep over the course.

**Graphics presets** (v1.8): **Low** keeps the classic low-poly procedural props with no shadows or post effects, for phones and weak GPUs. **Medium** and up use the painted scenery: stylised trees, pines, bushes, ferns, flowers and cliff rocks, tinted per world (lime meadow canopies, cotton-candy trees, snow-tipped pines, autumn copper, glowing alien teal), with wind sway, soft puffy canopy shading and the new painted skies. **High** adds 4x anti-aliasing, softer shadows, bloom, denser grass and drifting atmosphere (pollen, sparkles, snowfall, embers, stardust). **Ultra** renders at full Retina resolution with 4096 shadows, ambient occlusion and a tilt-shift miniature blur. Measured on an Apple M2 at 1440×810 Retina: Medium ~13 ms a frame, High ~21 ms (faster than v1.7's High), Ultra ~53 ms. Ultra is meant for big desktop GPUs.

**Water** (v1.8.5): ponds, brooks and lagoons are drawn as natural bodies of water: overlapping hazard zones merge into one pond with soft, wandering shores (the shore only ever reaches out past the hazard, so what you see never stops short of where a ball splashes), deep blue in the middle and lighter in the shallows, with lapping shore foam, a pebbly rim and earth banks down to the ground. Meadow ponds have reeds and lily pads, frozen ponds ice floes, candy ponds sugar rings, and boulders sit on every shore. A ball that flies off the course into a pond now splashes instead of going out of bounds, and the camera lingers on the splash before gliding back as the ball pops back in.

**Lighting** (v1.8.2): every world is lit at golden hour: a low warm sun with long shadows, cool blue-violet shade, warm haze towards the horizon, backlit grass and leaves that glow when the sun is behind them, a pink band and rosy clouds on the far side of the sky, and a cinematic colour grade (warm highlights, cool shadows). Medium and up add volumetric light shafts through the trees (about 1 ms on Medium and 2 ms on High on an Apple M2). Space keeps its starlight. Frame times with it all, same machine: Low ~2 ms, Medium ~9 ms, High ~19 ms, Ultra ~40 ms.

- **Par & strokes:** water and out-of-bounds cost +1 and reset you to your last spot; the stroke limit is par + 6.
- **Stars per course:** finish it · team score at or under par · find every gem and the golden ball.
- **Collectibles:** coins respawn every run; gems, golden balls and crates are remembered per profile. Pickups are shared: anything a teammate grabs counts for everyone.
- **Modes:** Solo, **Planet Hopper** (roguelike, see below), **Co-op Relay** (one ball, take turns), **Co-op Parallel** (everyone plays at once, ghost balls, team total), **Casual Versus**, plus **Chaos mode** (balls collide) and the **Daily Challenge** (seeded hole, server leaderboard).
- **Progression:** XP and levels, coins, a shop and locker (balls, trails, putters, hats, victory animations, hole-in-one effects), 25 achievements, worlds unlocked by level _or_ stars.

## Planet Hopper (roguelike mode, solo or co-op)

Main menu → **🪐 Planet Hopper** opens **the Clubhouse**, the hub between runs. For co-op, host a game and pick *Planet Hopper* in the lobby (up to 6 players).

- **A run** crosses 4 planets (Meadow first, Space last, two of Candy/Frozen/Clockwork in between): 3 procedurally generated holes, then a **boss hole**, then a **Wishing Green** rest stop. That makes 19 stages. Holes are built to flow: most corners sweep round in curves, courses step up and down between tiers, and the difficulty comes as much from skilled shots as from obstacles. Holes get longer, narrower, busier and wilder the deeper you go, and par tightens as the run goes on, so the last planets are the hardest, with spinners, sliding gates, windmills, water beside open edges, ice, conveyors and each planet's signature hazards (kept well spaced, never stacked on top of each other).
- **Course design** (v1.8.5, inspired by classic party mini golf): every hole has a feature you can see from the tee, and water is the signature hazard. **Island greens** put the cup on an island in a pond, reached over a bridge (or two); **lakesides** open one edge of the fairway onto a wide lake; **brooks** wander off into the landscape; **scenic ponds** sit beside the course. Greens are wider, holes a little shorter, more corners sweep round in curves, many holes start on a **raised tee** that rolls down onto the course, plain finishes open into a wide **arrival green** round the cup, and **sloping greens** tilt to one side so putts break. Ramps, humps, dips and terraces are smooth eased curves, so a rolling ball no longer hops at the top or thuds at the bottom.
- **Set pieces:** **corkscrews** that wind round a tower down to a lower tier (twice round, late in the run), twisting **slides** and steep fast **chutes**, **loop-the-loops**, covered **tunnels**, **ledge drops**, **leaps** onto a higher ledge (off a kicker ramp, or a **spring pad**: too soft and you splash, too hard and you smack the ledge), kicker-ramp **jumps** over water, ramps, humps, dips and terraces, a **brook** you cross on narrow bridges, a **pond** in a wide green (go round, or brave the plank), **split lanes**, a boulder **plaza**, low **bumps** in the green (roll round them, or take the short line over the top), and a hidden **wormhole**. Some holes have a **forked fairway** whose lanes swoop apart round a lagoon and back together (one steady, one quick but risky: a narrow bridge, a jump, speed pads or ice along the water, machinery).
- Every hole has a **personality** (Classic, Fork, Switchback, Long Drive, Summit, Waterworks, Gauntlet, Funhouse, Skyway, Rolling Hills, and Thrill Ride rollercoasters on the last planets), so neighbouring holes play differently. Each **boss** has its planet's set piece and heaviest machinery, with a stingier par.
- **Hearts** are the team's shared life. Each player's result moves them: birdie +1, ace +2, bogey −1 … picked up −3. A teammate's birdie covers your bogey. At 0 hearts the run ends. The pool scales with team size so runs are about as hard solo as in a group: 3 hearts solo, 6 for two, 12 for three, 16 / 22 / 27 for four to six (Picnics and Second Wind scale too). It is tuned so an average team finishes roughly a third of its runs.
- **Forks:** after each hole you choose (or vote on, in co-op) the next hole. Every route shows its **reward** (Picnic heal, Stardust, Trinket, Vitality, Mystery Box), its par, and its **omen**: Gale wind, Slick Greens, Heavy Ball, Tiny Cup, Fog Bank, Moon Gravity or Short Fuse. Votes auto-resolve after 25 s; ties go to the earliest vote. With three or more players, as soon as a strict majority of the connected players is on one option the countdown drops to 5 s (*Majority reached, deciding in 5s*); it is never put back up, and the others can still change their minds until it runs out.
- **Trinkets** last the whole run, for example Magnet Cup, Power Glove, Mulligan Moth, Gimme Clover, Bank Shot Badge, Bogey Shield and Birdie Feeder (12 in all). Bosses and trinket routes let you pick 1 of 3. Rare trinkets (Gimme Clover, Bank Shot Badge, Bogey Shield) turn up a quarter as often as the others. Drafts also offer **level-ups** of trinkets you already have, each level rarer than the last (Lv1 → Lv3, e.g. Magnet Cup 35% → 50% → 65% wider cups; Storm Compass Lv3 cancels omens). Levels only last for the run; two co-op players with the same keepsake start with it at Lv2.
- **Wishing Green** (rest stop): no hearts at stake and +1 heart on arrival. Putt into the labelled crate holding the reward you want; sinking the cup instead takes a small stardust tip.
- **The Clubhouse:** stardust from every run, won or lost, is banked there and spent on permanent upgrades (extra hearts, Second Wind, rerolls, wider trinket drafts, more stardust, a third route at forks). Trinkets you have found become **keepsakes**: equip one to start runs with it. In co-op, every player's keepsake joins the team, and the host's upgrades apply.

`npx tsx scripts/validate-hopper.ts [seeds]` generates whole runs and proves every stage is completable with the solver.

## Scripts

| Command                                                 | What it does                                                                                              |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                           | client + server with hot reload                                                                           |
| `npm test`                                              | Vitest: physics, rules, progression, protocol, course data, lobby/room integration, latency interpolation |
| `npm run validate:courses [-- courseId [hole]]`         | headless solver proves every hole is completable and reports strokes vs par                               |
| `npm run typecheck` / `npm run lint` / `npm run format` | strict TS, ESLint, Prettier                                                                               |
| `npm run build` then `npm start`                        | production bundle; one Node process serves the client and the WebSocket on `PORT` (default 8787)          |

**Dev URL flags:** `?course=candy&hole=4` jumps straight into a hole · `?hopStage=12&seed=31&omen=fog` previews one generated Planet Hopper stage · `?lag=150&jitter=30&loss=0.05` simulates a bad network · `?profile=x` uses a separate local profile · `?server=ws://host:port/ws` points at another server. Press **\`** in game for the debug overlay (FPS, draw calls, physics/net stats, collider wireframes, click-to-teleport, reload hole).

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full picture and [docs/PROGRESS.md](docs/PROGRESS.md) for decisions, tuning notes and known issues.

```
shared/   types, config (all balance numbers), course schema + data, Rapier Simulation, Match rules,
          protocol (zod), progression, achievements, cosmetics, daily generator, solver
server/   ws server: Lobby (routing, rate limits, reconnect tokens) + Room (60 Hz authoritative Match)
client/   Game state machine, Session (Local | Remote), rendering, input, UI, audio, profile store
```

The key idea: **the same `Match` + `Simulation` code runs in the browser for solo play and on the server for online play.** The `Playing` scene only talks to a `Session` interface, so rendering, HUD and input are identical in both cases. Online clients send intents (aim + power); the server simulates, validates and streams 20 Hz snapshots, which the client interpolates ~110 ms in the past. Moving machinery is a pure function of time, so it never needs to be streamed.

## Adding a course

1. Create `shared/src/courses/<world>.ts` exporting a `CourseInput` (copy `meadow.ts`). A hole is usually one `fairway(points)` — a centreline that becomes floors, ramps and mitred walls — plus extra `solids`, `zones`, `obstacles` and `collectibles`:

   ```ts
   makeHole({
     id: 'myworld-1',
     name: 'Hello Hole',
     par: 3,
     points: [
       [0, 0, 0],
       [8, 0, 0],
       [8, 0, 6],
     ], // tee ... cup (y = floor height)
     zones: [zone('sand', 8, 3, 2, 1.5, 0)],
     obstacles: [
       {
         type: 'spinner',
         id: 's',
         pos: [4, 0, 0],
         length: 2.2,
         arms: 2,
         speed: 1,
         height: 0.3,
         thickness: 0.18,
         phase: 0,
       },
     ],
     collectibles: [
       ...coinLine('myworld-1', [2, 0, 0], [6, 0, 0], 3),
       item('myworld-1', 'gem', 8.8, 0, -0.8),
     ],
     tip: 'Shown on the HUD when the hole starts.',
   });
   ```

   Rules of thumb: after a turn keep at least half the fairway width flat before a ramp; use `room()` for open areas with entrances; `openStart` / `openEnd` / `noFloor` / `openLeft` / `openRight` make gaps for jumps, water and rail-less edges.

2. Register it in `shared/src/courses/index.ts` and add a gate in `WORLD_GATES` (`shared/src/config.ts`).
3. Run `npm run validate:courses -- <id>` and `npm test`. Any JSON file that parses with `CourseSchema` works too.

## Adding an obstacle

1. Add a variant to `ObstacleSchema` (`shared/src/schema.ts`).
2. In `shared/src/sim/obstacles.ts`, return its static `obstacleSolids`, its moving `kinematicParts`, and its `obstaclePose(o, t)` (pose as a pure function of time).
3. Any special behaviour (like bumpers' kick or teleporters) goes in `Simulation.preStep`/`postStep`; emit a `SimEvent` for feedback.
4. Give it a look in `client/src/rendering/CourseView.ts` (`addObstacle`) and add a sound/particles case in `PlayScene.onMatchEvent`.
5. Add the event type to `MatchEventSchema` in `protocol.ts` if you added one, and write a test in `shared/test/sim.test.ts`.

## Downloadable apps (Mac, Windows, iPhone)

**Download builds** from the [Releases page](https://github.com/MaybeRaph/putt-putt-planet/releases): the newest release is at the top.

### Previous builds

| Version | What changed | Download |
| ------- | ------------ | -------- |
| v1.8.8 | Direct games survive a dropped connection: when the route between two players dies after connecting (a router or VPN dropping it), both sides now re-establish it, and a guest whose host has gone quiet is told so instead of sitting in a lobby where Ready, new players and the match start never arrive (after a minute with nothing, back to the menu with advice). The desktop app keeps a log at `%APPDATA%\Putt-Putt Planet\logs\game.log` | [v1.8.8](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.8.8) |
| v1.8.7 | Smooth hole-intro camera: the flyover glides along a smoothed line instead of swinging at every corner and corkscrew (same pace and length) | [v1.8.7](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.8.7) |
| v1.8.5 | Course design and water overhaul: natural ponds instead of floating water rectangles (merged rounded shores, shallows, foam, pebbly rims, earth banks, reeds, lily pads, floes), island-green finales, lakeside fairways, wandering brooks and scenic ponds on almost every Planet Hopper hole, wider greens, raised tees, arrival greens, sloping greens that make putts break, smooth eased ramps (far fewer hops), and a smoother splash reset | [v1.8.5](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.8.5) |
| v1.8.2 | Golden-hour lighting: low warm sun and long shadows, cool shade, warm atmospheric haze, volumetric light shafts through the trees (Medium and up), backlit glowing grass and leaves, sunset skies (rosy clouds, pink horizon band), a cinematic colour grade, and a slowly moving sun (**Moving sun** setting) | [v1.8.2](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.8.2) |
| v1.8.1 | Graphics fixes: changing quality applies at once (mid-hole and behind the menus); clean tree and leaf edges (no more bright speckled rims); an **Anti-aliasing** setting (FXAA, MSAA 2x/4x/8x, SMAA); film grain no longer makes models flicker, and is about a third as strong at 100; fixed edges flickering on Low | [v1.8.1](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.8.1) |
| v1.8.0 | Graphics overhaul in a classic cartoon battle-royale style: stylised painted trees, pines, bushes, ferns, flowers and cliff rocks (CC0 models) tinted per world with wind sway; painted skies with lit cumulus, cirrus, sun halos, a candy rainbow, frozen auroras, a golden-hour Clockwork sky and space nebulae; reflective stylised water; smooth painted terrain with hazy blue distance; a film grain slider (off by default); retuned presets (Low keeps the classic look; High is faster than before) | shipped in [v1.8.1](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.8.1) |
| v1.7.2 | Fix for guests on Windows 11 who could not ready up: their first messages to a direct-game host could arrive before the host was listening, so the host never learned who they were and ignored everything after (Ready included). The host now listens from the start and the guest re-introduces itself if needed; Ready retries until the host confirms. New **Force start** button for the host. Long-time players are no longer disconnected on joining (profile size limit 4 KB to 256 KB) | [v1.7.2](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.7.2) |
| v1.7.1 | Fix for a ledge you could putt straight through: on Planet Hopper drops (and spring-pad and kicker leaps) the earth face under the upper green was only drawn, so a ball putted back at it rolled in underneath and dropped out of bounds; it is solid now. Bumps in the green now collide exactly where they are drawn. Slick Greens grip another 20% (a putt slides about 30% less far than on ice). A **Quit to desktop** button in the main menu's bottom-right corner (desktop app). Every player's ping on the Tab scorecard online, plus a **Show ping** setting. The hole intro is now one slow pass: 2 s on the cup with the name and par, then a glide back over the whole course to the tee (6–14 s, any key or tap skips); no intro on Planet Hopper rest stops. Co-op votes with three or more players are decided 5 s after a majority agrees | [v1.7.1](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.7.1) |
| v1.7.0 | Shorter invite codes (about a quarter of the length, letters and digits only); fix for a player who couldn't ready up (the Ready button is now always on screen, and retried invites no longer fight each other); the loop-the-loop track no longer goes invisible; Slick Greens now freeze slopes too, in every sector, and slide about 20% less; a camera flyover with the hole's name and par at the start of every hole (any key or tap skips it); more varied scenery (rolling hills, ridges, ice shelves, mesas, dunes, craters, distant mountain layers); a host-only button to remove a player, in the lobby and mid-game; the game version on the main menu | [v1.7.0](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.7.0) |
| v1.6.0 | Polish and fixes: seamless curve and fork floors, tunnels kept clear of the course, grass right up to the rails, Slick Greens / Gimme Clover / spring pad fixes, harder late planets (≈ 1 in 3 runs won), double corkscrews, steep chutes, bumps, new hole types, see-through camera, putter styles and a real putter sound, faster loading | [v1.6.0](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.6.0) |
| v1.5.0 | Corkscrews, slides, loop-the-loops, tunnels, ledge drops, leaps and spring pads; curved forks and flowing corners; less obstacle clutter; hearts scaled to team size | [v1.5.0](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.5.0) |
| v1.4.0 | Hole personalities, forked fairways round lagoons, brooks and ponds, more elevation, tougher bosses, rarer trinket levels, Ultra graphics, lower memory use | [v1.4.0](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.4.0) |
| v1.3.0 | Curves, ramps, jumps, split lanes, trinket levels, Windows fullscreen, fixes | [v1.3.0](https://github.com/MaybeRaph/putt-putt-planet/releases/tag/v1.3.0) |

**Building them yourself:**

```bash
npm run desktop:mac
```

```bash
npm run desktop:win
```

Outputs land in `desktop/release/`: `Putt-Putt-Planet-<version>-mac.dmg` (universal: Apple Silicon + Intel), a `.zip` of the `.app`, `Putt-Putt-Planet-<version>-Setup.exe` (Windows installer with Start-menu/desktop shortcuts) and a portable Windows `.zip`. The Windows build can be made on a Mac, including Apple Silicon without Rosetta: exe re-signing is off (no Wine) and the config opts into electron-builder's unified NSIS toolset (`toolsets.nsis: 1.2.1`), which has a native arm64 compiler.

**Signing:** the Mac app is ad-hoc signed and the Windows installer is unsigned, so on first launch macOS says it's from an unidentified developer (right-click the app → **Open**) and Windows SmartScreen shows **More info → Run anyway**. For friction-free public downloads you need an Apple Developer ID ($99/yr) with notarization and a Windows code-signing certificate; electron-builder picks them up via `CSC_LINK`/`CSC_KEY_PASSWORD` and `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`.

**iPhone** (Capacitor, project in `mobile/ios`):

```bash
npm run build:app && npm run sync -w mobile && npm run open -w mobile
```

In Xcode: select the **App** target → *Signing & Capabilities* → choose your Team (a free Apple ID works for your own phone), plug in your iPhone, pick it as the destination and press **Run**. Requires iOS 16.4+. To share with friends' iPhones you need the paid Apple Developer Program and TestFlight (Product → Archive → Distribute App). `npm run build:sim -w mobile` compiles a Simulator build without signing.

Packaged apps have no online server built in unless you set `VITE_SERVER_URL=wss://your-server/ws` when running `npm run build:app`; direct and local-network play work regardless.

## Credits

- Scenery trees, plants and rocks: [Stylized Nature MegaKit](https://quaternius.com/packs/stylizednaturemegakit.html) by Quaternius, CC0 (public domain). `npx tsx scripts/build-nature.ts <unzipped pack>` rebuilds `client/src/assets/nature.glb` from the free Standard pack (picks the models, bakes the canopy shading, shrinks textures to WebP, compresses the meshes).
- Putter strike: "putt.wav" by [170129 on freesound.org](https://freesound.org/people/170129/sounds/408260/), CC0 (public domain).

## Deployment

The production build is one self-contained server bundle (`server/dist/server.js`, no `node_modules` needed) plus the static client (`client/dist`).

**Docker**

```bash
docker build -t putt-putt-planet .
```

```bash
docker run -p 8080:8080 -v ppp-data:/data putt-putt-planet
```

**Bare Node:** `npm ci && npm run build`, then run `PORT=8080 DATA_DIR=/var/lib/ppp node server/dist/server.js` behind any reverse proxy that forwards WebSocket upgrades on `/ws` (nginx: `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`).

**Split hosting:** serve `client/dist` from any static host/CDN, run the server elsewhere, and build the client with `VITE_SERVER_URL=wss://game.example.com/ws`.

| Env var      | Default       |                                                                  |
| ------------ | ------------- | ---------------------------------------------------------------- |
| `PORT`       | 8787          | HTTP + WebSocket port                                            |
| `DATA_DIR`   | `server/data` | JSON store (profiles, daily leaderboard) — mount a volume        |
| `STATIC_DIR` | `client/dist` | static client to serve (if present)                              |
| `DEV`        | unset         | `1` enables debug-only messages (teleport) — never in production |

Rooms are in memory, so run a single instance (or add sticky sessions) and expect rooms to close on redeploy. Profiles survive restarts.
