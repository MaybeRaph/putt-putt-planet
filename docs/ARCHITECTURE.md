# Putt-Putt Planet — Architecture

## 1. Stack

| Layer       | Choice                                                                                       | Notes                                                                                                                                                                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Client      | Vite 8 + TypeScript (strict) + Three.js r187                                                 | HTML/CSS UI overlay, no UI framework                                                                                                                                                                                                                                                |
| Physics     | `@dimforge/rapier3d-compat` 0.21                                                             | Same WASM binary on client and server, fixed 60 Hz step                                                                                                                                                                                                                             |
| Server      | Node + `ws`                                                                                  | Plain `ws` (smaller than Colyseus, and our room logic is the shared `Match` anyway)                                                                                                                                                                                                 |
| Persistence | JSON file store (server), `localStorage` (client)                                            | **Deviation:** no SQLite — `better-sqlite3` is a native addon and Node 26 prebuilds are unreliable; a debounced JSON store is enough for guest profiles + daily boards and keeps install friction at zero. The `ProfileStore` interface makes swapping in SQLite a one-file change. |
| Validation  | zod 4                                                                                        | Every network message, every course file                                                                                                                                                                                                                                            |
| Tooling     | ESLint (typescript-eslint), Prettier, Vitest, `concurrently`, `tsx`, esbuild (server bundle) | TypeScript pinned to 6.0 — typescript-eslint does not support TS 7 yet                                                                                                                                                                                                              |
| Audio       | WebAudio synthesis only                                                                      | No asset files at all; every mesh and sound is procedural                                                                                                                                                                                                                           |

## 2. Folder layout (npm workspaces)

```
shared/src/
  config.ts          all balance: physics, XP curve, prices, unlock gates
  schema.ts          zod course schema + inferred types
  protocol.ts        zod client<->server messages
  sim/Simulation.ts  Rapier world for one hole: balls, kinematic obstacles, zones, events
  sim/obstacles.ts   pure pose functions (obstacle, tick) -> transform (render + physics share them)
  match/Match.ts     game rules: modes, turns, strokes, stroke limit, collectibles, hole/course flow
  courses/           builder helpers + 5 worlds (TS data validated by the zod schema)
  daily.ts           seeded procedural hole generator for the daily challenge
  progression.ts     levels, XP, stars, rewards, unlock gates
  achievements.ts    achievement definitions + evaluation
  cosmetics.ts       cosmetic catalog
  profile.ts         profile type, defaults, merge
server/src/
  index.ts           http (health + static in prod) + ws
  Lobby.ts / Room.ts room codes, players, reconnect, host migration, runs a Match at 60 Hz
  ProfileStore.ts    JSON persistence; DailyBoard.ts
client/src/
  core/        Game (state machine Boot→Menu→Lobby→Loading→Playing→Results), EventBus, loop, settings
  physics/     LocalSession (runs Match in-browser for solo/offline)
  net/         NetClient (ws + lag/loss simulator), RemoteSession (snapshot interpolation)
  rendering/   Renderer, materials, sky, CourseView (schema→meshes), BallView, CameraRig, AimView, particles, post-fx
  ui/          screens (menu, lobby, HUD, pause, settings, results, locker/shop, collection), emote wheel, chat
  audio/       Sfx, procedural music (layers by player count), ambience
  progression/ local profile store + reward application
```

Both play modes go through one interface, `Session` (client): `LocalSession` drives a shared `Match` directly; `RemoteSession` mirrors the server's `Match` from messages. The `Playing` scene only knows `Session`, so solo and online share all rendering, HUD and input code.

## 3. Simulation model

- Ball: dynamic sphere, **rotations locked**, friction 0, CCD on. Rolling resistance, surface drag and settling are applied by our code each step (`config.physics`), which gives precise, tunable feel (Rapier friction on a locked sphere is not what golf needs). Visual spin is derived from velocity.
- Course geometry: oriented boxes/cylinders (floors, walls, blocks). Surfaces (sand/ice/sticky/boost/conveyor) are **zones** (no collider seams) plus per-solid surface tags.
- Moving machinery: kinematic bodies whose pose is a pure function of the tick (`obstaclePose`). The client renders obstacles from the same function using the (interpolated) server tick, so moving parts never need to be streamed.
- Cup: detection, not geometry. Inside cup radius and below `sinkSpeed` → sink; faster → lip-out deflection; near and slow → gentle pull.
- Hazards: water zones, out-of-bounds/kill plane (reset to last rest spot, +1 stroke), stuck detection (free reposition offered).

## 4. Network protocol (JSON over WebSocket, all validated with zod)

Client → Server: `hello{guestId,name,profile}` · `createRoom` · `joinRoom{code}` · `resume{token}` · `leaveRoom` · `setReady{ready}` · `configure{courseId,mode,chaos}` · `start` · `shot{seq,dir:[x,z],power}` · `reposition` · `emote{id}` · `chat{text}` · `ping{t,rtt}` · `nextHole` · `dailyStart` · `dailyBoard` · `debugTeleport{pos}` (dev only)

Server → Client: `welcome{playerId,profile}` · `room{RoomState}` · `error{code,msg}` · `matchStart{courseId|daily seed,mode,holeIndex,players}` · `snap{tick,balls[]}` (20 Hz) · `matchEvent{SimEvent|MatchEvent}` · `score{ScoreState}` · `rewards{profile,grant}` · `emote` · `chat` · `pong{t}` · `dailyBoard{entries}`

Flow: hello → welcome → create/join → room (broadcast on change) → host `start` → `matchStart` → (shot → server validates → sim → `snap`s + `matchEvent`s) → hole end `score` → next hole … → course end `rewards` → back to lobby.

- **Authority:** server simulates every shot; clients only send intents. Power clamped to [0,1], dir normalised, shots rate-limited and only accepted if it is that player's ball/turn and the ball is at rest.
- **Smoothness:** client renders snapshots ~100 ms in the past with interpolation; the putt itself gets instant local feedback (sound, putter swing, squash) to hide RTT.
- **Reconnect:** `resume{token}` within 60 s restores the slot; relay turns skip disconnected players; host migrates to the next player; empty rooms close.
- **Dev flags:** `?lag=150&jitter=30&loss=0.05` on the client delays all traffic and drops snapshots, to prove interpolation holds up.

## 5. Course schema (summary — see `shared/src/schema.ts`)

```
Course { id, name, world, theme{sky, fog, floor colors, wall color, light, decorKit}, holes: Hole[] }
Hole   { id, name, par, tee, cup, solids[], zones[], obstacles[], collectibles[], decor[], path[] }
Solid  { shape: box|cylinder, role: floor|wall|block, center, size, rot, surface? }
Zone   { kind: sand|ice|sticky|boost|conveyor|water|lowGravity|oneWay, center, size, rotY, params }
Obstacle { type: windmill|spinner|mover|bumper|teleporter|loop, ...params }
Collectible { id, kind: coin|gem|golden|crate, pos }
```

`path` is the authored centreline: used for camera hints, the stuck-rescue reposition point and the automated hole solver (`npm run validate:courses`), which proves every hole is completable.

## 6. Milestones

M1 scaffold + one playable hole · M2 loader, obstacles, hazards, world 1 · M3 server, lobby, synced shots · M4 relay/parallel/versus, ghosts, emotes, reconnect · M5 collectibles, progression, shop, achievements, daily · M6 worlds 2–5, juice, audio, touch · M7 perf, tests, README, Docker.

## 7. v1.1 additions

**Rendering.** MeshStandardMaterial everywhere (matte, saturated, low-poly decor flat-shaded) lit by a directional sun + image-based lighting generated from the sky shader via PMREM; ACES tone mapping. `Landscape` builds per-hole terrain (flat around the course, fbm hills, ridged cliffs/mountains), faceted rock spires and up to 45k instanced grass blades with GPU wind sway. Floors get visual "skirts" down to the terrain so raised greens read as terraces. Post stack on High: MSAA target → GTAO → bloom → colour grade/vignette → output. Grass count and post effects scale with the quality setting.

**Host module.** `Lobby`/`Room` moved from `server/` to `shared/src/host/` with injected storage (`HostStorage`) and timer (`Interval`). The dedicated server uses JSON-file storage; a player hosting a direct game runs the same code in their client with in-memory storage and a Web Worker heartbeat timer (main-thread timers are throttled in background tabs).

**Transports.** `NetClient` speaks the protocol over a `Transport`: WebSocket (server / LAN address), RTCDataChannel (direct guest) or an in-process loopback (direct host). Direct-game signalling is manual: host offer and guest answer are deflate-compressed SDP in `PPP1.` codes (~700 chars), ICE gathered before encoding (no trickle). Candidates are applied separately from the description and re-issued whenever connection checks give up, so hole punching keeps going while the humans copy codes back and forth.

**Packaging.** `desktop/` is an Electron shell (custom `app://` scheme, background throttling off, optional LAN server = the bundled server run in a utility process, which also serves the web client). `mobile/` is a Capacitor iOS project (SPM, no CocoaPods). Both load `client/dist-app` (relative-path web build).

## 8. v1.2: Planet Hopper

A roguelike mode built on the same `Match` and `Simulation`. `HopperMatch` extends `Match` through small protected hooks and appends a freshly generated hole to `cfg.holes` before each stage. The skeleton is fixed (4 sectors × [3 holes, boss], with a rest stop between sectors). What varies is the seed, the route chosen at each fork (variant, omen, reward) and the trinkets that shape holes (Magnet Cup → `cupScale`, Power Glove → `powerScale`, Grippy Socks → no sand, Storm Compass → gentler omens). Each `StageSpec` holds everything `stageHole(seed, index, spec)` needs, so clients rebuild holes locally instead of downloading geometry. Run state (`HopperState`) rides on `ScoreState.hopper`. Choices are majority votes resolved on the host. Meta-progression lives in `Profile.hopper` (stardust ledger, upgrade ranks, discovered trinkets, keepsake) and merges monotonically like the rest of the profile.
