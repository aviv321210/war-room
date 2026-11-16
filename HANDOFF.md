# War Room (formerly AgentCraft) — session handoff

_For the next Claude Code session. Read this first. Everything lives on `D:\Aviv\Projects\war-room` (this repo, the custom app) and `D:\Aviv\Projects\agentcraft` (the upstream repo clone)._

## What this project is

AgentCraft (upstream: https://github.com/blendi-remade/agentcraft) = a team of Claude agents doing
real work on real code, shown in a studio you can walk around. Upstream renders it as a **Minecraft
Fabric mod**. We **pivoted away from Minecraft** because Minecraft: Java Edition is a paid game and
the user won't ask coworkers to buy it. We are building our **own studio app** (HTML + three.js,
driven by the real Foreman) so there is nothing to buy and nothing to install but one executable.

**End goal:** one installer/`.exe` the user can share by link. Coworkers run it, each with their own
Anthropic API key, their own repos, their own spend.

## Name: War Room (decided 2026-11-16)

The app is now called **War Room** (user's choice). Done: window title, header, office sign, server messages,
Coworkers panel text, and the LAN protocol ids (`warroom` discovery, `warroom-peer` hello, `warroom-team:` code hash;
old AgentCraft builds will not see new ones, which is fine pre-release). **Installer now uses War Room names** (`~/.warroom`, `%LOCALAPPDATA%\WarRoom`, `WarRoom.exe`; see below).
Still AgentCraft: server.mjs's *default* `STATE` (`~/.agentcraft`; the launcher passes `--state`), this repo folder. Keep upstream credit + license
(the Foreman is blendi-remade/agentcraft). Check the name is not taken by other software before shipping.

## Architecture

- **Foreman** (`D:\Aviv\Projects\agentcraft\foreman`, Node/TS) — the real thing: runs the Claude agents, owns
  all state, serves `ws://127.0.0.1:7878`. Protocol in `D:\Aviv\Projects\agentcraft\docs\protocol.md`
  (v1; snapshot + upserts). It **rejects any WebSocket with an `Origin` header** (so a browser can't
  drive it) — this is why our app talks to it through a local bridge, never directly.
- **Studio server** `studio/server.mjs` (Node) — serves the web app on `127.0.0.1:7880` behind a
  random per-run token (handed to the window as `/?t=<token>`, traded for an HttpOnly cookie; token
  written to `~/.agentcraft/studio.json`). Bridges `/ws` → the Foreman as a plain local client
  (strips Origin). **Also now contains the full LAN multiplayer server** (see below).
- **Web app** `studio/web/` — `index.html`, `style.css`, `app.js` (2D view + all panels, dialogs,
  console; exposes `window.AC` helpers + `window.S` state), `view3d.js` (3D view, three.js r169 in
  `vendor/`), `assets/` (skins/textures/icons copied from the mod).

## Machine state (already done)

- winget-installed: Temurin **Java 25**, Prism Launcher, Inno Setup 6. **Node upgraded 20 → 26.**
- (First PC) Repo cloned to `C:\dev\agentcraft` (outside OneDrive). Company Artifactory 403s on public packages,
  so `foreman/.npmrc` and `tools/.npmrc` point at `registry.npmjs.org` (git-excluded). Deps installed.
- `~/.claude/settings.json`: `permissions.defaultMode: bypassPermissions` + `skipDangerousModePermissionPrompt`.
- Mod jar builds clean. Foreman tests: **518/548 pass**; 30 fail = slow e2e git timeouts, not blocking.
- Demo (`sim`) backend verified end-to-end. **Real `claude` backend never tested** (no API key here).

## What works right now (verified by screenshots)

- **2D studio view** — top-down office, agents at desks, task wall, decisions, feed, console, live
  monitor/diff/merge dialogs. All wired to the Foreman.
- **3D studio view** (default) — same studio in three.js. Agents walk/sit/type, screens scroll code,
  podium lamp glows on open decisions, board fills with task cards.
- **Your building + avatar + campus** — `buildOffice()` builds one office; your office at x-origin 0,
  surrounded by grass/road/path/trees/benches/lamps and **free plots** at x-origins in `PLOTS`.
  Avatar creator (name, skin, hair style+color, shirt, trousers; saved to `localStorage`).
  **Walk mode** (WASD/shift/drag/wheel, roof hides when inside, **E** to interact with podium/merge/
  library/board/agents, **Enter** console) and **Overview mode** (orbit, front wall cut away).
- Launch to view it (demo team):
  ```powershell
  # Foreman (sim) — reuse if ~/.agentcraft/sim/foreman.json pid is alive, else:
  node D:\Aviv\Projects\agentcraft\foreman\src\main.ts  # via: node --import tsx ... --backend sim --profile sim --home ~/.agentcraft --port 7878
  # Studio server:
  node D:\Aviv\Projects\war-room\studio\server.mjs --port 7880 --foreman 7878 --foreman-dir D:\Aviv\Projects\agentcraft\foreman
  # Open the window (token from ~/.agentcraft/studio.json):
  msedge --app="http://127.0.0.1:7880/?t=<token>" --user-data-dir=%LOCALAPPDATA%\AgentCraft\studio-window
  ```
- **Screenshot harness** (headless, GPU-less): `msedge --headless=new --use-angle=swiftshader
  --enable-unsafe-swiftshader --virtual-time-budget=8000 --screenshot=out.png "http://127.0.0.1:7880/?t=<token>"`.
  Append `#walk` to the URL to force walk-mode with a throwaway avatar (test hook in view3d.js).

## Moving to another PC (2026-11-16: the first PC was too slow for headless 3D screenshots)

This folder is now a git repo. Not in git (too big / rebuildable): `downloads/`, `out/`, `stage/`.
On the new PC:
1. Install Node 22+ (26 was used) and have Microsoft Edge.
2. Clone this repo, and clone upstream `https://github.com/blendi-remade/agentcraft` next to it;
   `npm install` in its `foreman/` (if a company registry 403s, add `.npmrc` with
   `registry=https://registry.npmjs.org/`).
3. Start the Foreman (`cd foreman; node --import tsx src/main.ts --backend sim --profile sim --home ~/.agentcraft --port 7878`),
   then the studio server and window as in "What works right now". On the second PC (current) everything is under `D:\Aviv\Projects`.
4. `studio/test/fakepeer.mjs` finds `ws` in the sibling `../agentcraft/foreman` (override with `FOREMAN_DIR`).
5. Second PC done 2026-11-16: Node 26.13.1 + Inno Setup 6.7.3 via winget; public npm registry works there, no `.npmrc` needed.

## LAN multiplayer — client is now WIRED (was "in progress")

**P2P on the LAN, no central server.** Design locked with the user:
- UDP broadcast discovery on :7892, peer WS on :7891, fallback = add a coworker by PC name / IP.
  Optional **team code** (only same-code studios connect).
- **Shared over the wire:** name + avatar look, avatar position, chat, game traffic (see "Campus" and
  "Arena" below: notes, carts, cell locks, operatives), and an **activity summary**
  (agents' status line, task titles+status, goal text/progress, decision **count**). **NEVER** logs,
  diffs, code, decision contents, or repo paths. Peers can't reach the Foreman. Visitors are
  **watch-only**. (Note: `cleanOffice` in server.mjs also sends the repo *name*; the client never
  shows it. Ask the user whether to drop it.)

### Done this session
- `mp.part.js` spliced into `view3d.js` (and deleted). Render loop calls `updatePeers`, `peerPlates`,
  `placeMySay`; `findNear` calls `peerNear(offer)`; saving the avatar calls `sendMe()`;
  `View3D.chat` exported; walk/pan limits widened so all six plots are reachable.
- `app.js`: `AC.addFeed`, `AC.prefill`, `AC.modalKind`; console **`/chat <text>`** (alias `/say`), in `/help`.
- `style.css`: `.plate.peer`, `.count.on`, `.peers`, `.kanban.light`, password input in dialogs.
- Test hook: `#walk=x,z` in the URL starts walk mode standing at (x, z).
- `node --check` passes for `view3d.js` and `app.js`.

### Verified by screenshot (two stacks on one PC, studio #2 driven by `fakepeer.mjs`)
- Coworker avatar with nameplate + chat bubble in front of my office; "Coworkers 1" chip; join and
  chat lines in the activity feed; chat toasts.
- Coworker's office appears on plot 48 with "Dana's office" sign; walking in, **E** at the board opens
  the read-only "Dana's task wall" dialog.
- Overview and walk of my own office: no regression.

### Verified on the second PC, 2026-11-16 (two stacks, two real headless windows, `drive.mjs`)
- Coworkers panel: add host, saved host + forget, team code save. A different team code is refused,
  the same code reconnects. `/chat` and `/say`: own bubble, the other studio gets bubble + feed + toast.
- A coworker with a running goal: board cards, agents with nameplates inside their office, "Watch <agent>"
  dialog, **E** at the board opens their task wall, podium refuses. 2D view: no stale coworker plates.
- Peer leaves: office hidden, free-plot sign back, chip back to 0.

### Fixed while verifying
- **Layout:** `body` is a 4-row grid; when `#banner` was hidden, `main` slid into its auto row and the 3D
  view shrank to the height of the side panel. Rows are pinned in `style.css` now.
- **Coworkers panel went stale** (said "Nobody else yet" with a coworker connected, kept listing one who
  left). It now refreshes on join/leave/settings and keeps what is being typed.
- **Wrong team code was silent.** `server.mjs` now sends one notice per address to the window, on both
  sides ("... their team code is different from yours" / "... tried to join with a different team code").

### Still open
- A real **two-machine** test (needs the user): discovery by broadcast, Windows Firewall prompt on :7891.
- Two studios in ONE browser profile overwrite each other's `ac_token` cookie (cookies ignore the port).
  Not a real-use case (each studio has its own window profile), but tests need separate contexts.

### Test tools (`studio/test/`)
- `drive.mjs <scenario.mjs>` — several headless windows in one browser, each with its own cookies; clicks,
  keys, mouse, screenshots (`SHOTS_DIR`, default `%TEMP%/warroom-test`). `GPU=1` renders on the real graphics
  card (120 fps on the second PC); the default software WebGL runs a few fps, so never time game logic in frames.
  `play.scenario.mjs` (play layer), `town.scenario.mjs` (campus, two players), `arena.scenario.mjs` (a whole match).
  Keys go to the page in front: after typing in the console, blur it before sending game keys.
- `fakepeer.mjs <studio.json of stack 2> [seconds]` — acts as stack #2's window: sets a look ("Dana"),
  adds `127.0.0.1:7891`, walks in front of stack #1's office, chats every 3 s. Run only ONE at a time.
- `cdp.mjs <url> <out.png> [waitMs] [js] [key]` — headless Edge over DevTools: load, optionally run JS
  (e.g. click a button) and press a key, screenshot. Software WebGL is very heavy: run one at a time
  and check no `msedge --headless` processes are left (on the slow PC ~36 piled up and froze it;
  the script now kills the whole process tree).
- Second stack: foreman `--port 7879 --profile sim2 --home <temp dir>`; studio
  `--port 7881 --foreman 7879 --peer-port 7893 --disco-port 7894 --state <temp>/studio.json --peer-file <temp>/studio-peer.json`
  (the separate `--peer-file` matters: otherwise both studios share one peer id and ignore each other).
- Newly built offices show black walls for a few seconds under software rendering until textures load.

## Play layer: `studio/web/game.js` (added 2026-11-16, user asked for "minecrafty")

A block-world game on the campus, walk mode only. **Original art drawn in code** (16 px canvas textures);
nothing is copied from Minecraft, and it must stay that way (no Mojang textures, names or look-alikes).
**Pure local game state**: it only READS `S.agents` / `S.tasks`. It never messages an agent, answers a
decision, spends tokens or touches a repo.

- **Blocks:** 1 m cubes outside the offices (never inside buildings, on doorsteps or the road). A seeded
  wild area (stone outcrops with byte ore, trees, sand) is the same for everyone; what you mine and place
  is saved in `localStorage` (`wr-world`). Drawn as one `InstancedMesh` per block type.
- **You:** hotbar 1-9, backpack **I** (click two slots to move; crafting list), hearts, XP/levels, **Space**
  jumps onto blocks, left-click (or **F**) hits, right-click places the held block or drinks coffee.
  Saved in `wr-player`. Dying sends you to your office door, nothing is lost.
- **Bugs:** Glitch, Heisenbug (teleports when hit), Memory leak (grows). A few at night; **two more for
  every agent whose status says failing/error/blocked**. They cannot enter offices or climb blocks, so
  walls work. Finished tasks pay 2 bytes.
- **Day/night** runs on the wall clock (10 min), so coworkers share it. Lamp blocks light up at night.
- Hooks in `view3d.js`: `Game.update/hit/use/blocksMove/show/swing`, `me.y`, `hemi`. Test API:
  `window.WRGame` (`state()`, `give`, `spawn`, `time(0..1)`, `peace()`, `setBlock`, `aimAt`, `hurt`).
- **Not done:** coworkers do not see each other's blocks, bugs or held items yet (needs new peer
  messages; keep them bounded and cosmetic). Blocks do not stop the walk camera. No sound volume setting
  beyond on/off in the backpack. Balance is a first guess.

## Campus: lots, board, cart, cells, nearby talk (`studio/web/town.js`, `view3d.js`; added 2026-11-16)

- **Offices on both sides of the road.** A lot is a column (48 m apart) and a side; a south lot is the same
  plan turned around the middle of the road (z = 26). Everything on a lot is built in office-local
  coordinates through `L.w()` / `L.l()` (`makeLot`, `lotGroup` in `view3d.js`). Your own office is always
  the lot at the origin.
- **One campus for everybody.** Players sorted by id take lots in pairs across the road (`assignLots`), and
  each window shows that campus moved (or turned) so its own office is at the origin. So distances and
  neighbours agree in every window. Places go over the wire in the frame of the nearest office
  (`toWire` / `fromWire`). Up to 8 players are sure to see each other (columns -3..3). A join or leave can
  re-deal the lots; inside a running arena match that would move things, so start matches after everyone is in.
- **Peer protocol is v2** (`PROTO` in `server.mjs`): older builds are refused with a notice on both sides.
- **Game relay:** windows talk through `{type:'g', k, d, to?}` -> peers `{t:'g'}` -> `peer.g`. The server
  only checks kind and size (6 kB) and the per-peer rate limit; it gives the data no meaning. Windows treat
  everything that arrives as untrusted (numbers checked, text cut and escaped). Kinds: `st` (cells, parked
  cart, board notes), `jreq`, `say`, `away`, and the arena's `ar.*`.
- **Announcement board** in front of every office (E, or `/announce`): five notes per player, everyone's
  notes on every board, kept in `localStorage` (`wr-board`).
- **Cart** per player (E in/out, W/S, A/D, Shift; `/cart` brings it): about 13 m/s, 19 with Shift.
- **Holding cells** beside every office: three cells, doors lock from the yard side only (E), also on a
  coworker's cells (a `jreq` the owner applies). From inside you can force the lock after 45 s.
- **`/say`** carries 16 m (everyone gets the message with its position and shows it only when near, so it
  is a game rule, not privacy). `/chat` still reaches the whole campus.
- Test: `studio/test/town.scenario.mjs` (two players). Test handles: `WRView`, `WRTown`.
- **Not done:** voice; other people's carts are not obstacles; block worlds are still per player.

## Arena (`studio/web/arena.js` + "Arena brains" in `server.mjs`; added 2026-11-16)

The user's goal: a competitive game that teaches developers rules/instructions, prompt hygiene and
multi-agent management. Each player has a token budget and uses Sonnet or smaller.

- **Game:** each player fields three operatives (job: guard / raider / talker; brain: demo, Haiku 5.5 or
  Sonnet 5.5) and writes the **team rules** they are told every turn. Last commander with an operative
  standing wins. Operatives are knocked out at 0 health (40 s), can be carried to the winner's cells and
  locked in, finished off while down, freed by a teammate, or **talked into changing sides**.
- **The lesson is built into the turn:** orders come on a private radio (`/order <name|all> text`), speech
  (`/say`, or an operative's `say` move) is listed separately as HEARD and can come from anyone. The default
  rules are naive on purpose. The review in the Arena panel shows, for every defection, what the operative
  had just heard and the reason it gave, plus turns, tokens, cache hits and cost per operative.
- **Budget levers the player feels:** model per operative (Sonnet is 20x Haiku), length of the rules,
  "think at least every N s". At the budget an operative freezes ("out of tokens").
- **Where things run:** all game logic is in the window (`arena.js`); each window is the authority for the
  operatives it runs and tells the others (`ar.st` 4-5 times a second, `ar.hit`, `ar.grab`, `ar.drop`,
  `ar.take`, `ar.say`, `ar.start`, `ar.ev`). It is a friendly LAN game: a modified client could cheat.
- **Brains:** `brain.think` on the `/world` socket -> `brainThink` in `server.mjs` -> the Anthropic SDK that
  ships in the Foreman's `node_modules` (`@anthropic-ai/sdk`, no new dependency). One call per turn, no
  history (the operative's own one-line note carries memory). The rules + game text are a cached prefix.
  The **demo brain** (`demoBrain` in `arena.js`) is free and rule-based: it obeys keyword orders and falls
  for "join ..." unless the team rules contain phrases like "never join" / "only obey".

### Hard lines (replaces the old "simulated only" note; keep them)
- An operative is a **game piece, not a Foreman agent**. The Foreman's coding agents cannot be ordered,
  stolen, hit or read by the game or by a coworker. Nothing here reaches the Foreman, a shell or a repo.
- The only moves an operative has are the nine tools defined **in `server.mjs`** (`ARENA_TOOLS`); a window
  or a peer cannot add one. Models are limited to Haiku and Sonnet there too.
- **Nobody spends someone else's tokens.** Each studio thinks only for the operatives it runs, on its own key.
  An operative that changes sides is handed over (`ar.take`) and from then on runs on the new commander's
  rules and budget. The budget is set only by the studio's own window and capped by `--arena-max` (default $5).
- The API key comes from `ANTHROPIC_API_KEY` or is typed in the Arena panel; it stays in the server's
  memory, is not saved, not logged, never sent to a peer.
- We still refuse the original idea (talk a rival's *real* coding agents into working for you on their bill).

### Verified / not verified
- Verified with `studio/test/arena.scenario.mjs` (two players, demo brains): start, fights, knock-out,
  arrest and lock, rescue, defection by speech (naive rules lose, hardened rules hold), hand-over, winner, review.
- **NOT verified: the Claude brains.** No API key on the second PC, so `brainThink` has never made a real
  call. Check first: the request shape (`output_config.effort: 'low'`, strict tools, cached system blocks,
  the Sonnet `fallbacks: 'default'` beta, which falls back to a plain call on a 400), the prices in `MODELS`,
  and how Haiku/Sonnet actually play (they may need a firmer "one tool call only" line in `GAME`).
- **Not done:** the launcher does not pass the API key to the studio server yet (the setup dialog stores it
  for the Foreman; pass it as `ANTHROPIC_API_KEY` in the server's environment). Commanders can be hit but
  cannot be arrested. No spectators list, no match timer, no best-of. Operatives ignore placed blocks and
  walk only outdoors. Balance of the demo brain is a first guess (a match lasts about a minute).

## After multiplayer

- **Arena:** built 2026-11-16, see "Arena" above. Its hard lines replace the old "simulated only" note.
- **Installer — REWRITTEN for the studio app (2026-11-16, done on the slow PC while multiplayer/look
  work went on elsewhere; it touches only `src/`, `build.ps1`).** `build.ps1` -> `out/WarRoom-Setup.exe`.
  Bundles Node (`downloads/node.zip`) + **MinGit** (`downloads/mingit.zip`: the Foreman needs git for
  the demo repo and the agents' worktrees) + the Foreman (sources + node_modules from `C:\dev\agentcraft`)
  + `studio/server.mjs` + `studio/web`. No Java/Prism/Minecraft (`jre25.zip`, `prism.zip` are unused now).
  Installs per-user to `%LOCALAPPDATA%\WarRoom` (new AppId; the old AgentCraft install is separate).
  `WarRoom.exe` (`src/Launcher.cs`): first run shows the setup dialog (demo team or API key + repo +
  budget; key stored with DPAPI in `~/.warroom/launcher.cfg`, copied once from `~/.agentcraft` if present),
  starts the Foreman (`--home ~/.warroom`, :7878) and the studio server (`--state ~/.warroom/studio.json`,
  :7880; peer file lands next to it), waits for the token, opens Edge `--app` with its own profile in
  `%LOCALAPPDATA%\WarRoom\window` (falls back to the default browser). Re-running it reuses running
  processes and just opens the window. `--stop` kills server + Foreman; `--settings` re-asks.
  Agents keep running when the window closes (Start menu "Stop War Room" ends them).
  **Not done / to check:** run the installer on a clean PC; Windows Firewall: the first time the server
  listens on :7891 for coworkers, Windows asks to allow node.exe, and a non-admin user may not be able
  to approve it. They can still connect *out* to coworkers, but nobody can connect *in* to them. Consider
  a firewall rule in the installer (needs admin) or tell users to accept the prompt.
- Note for the user: unsigned `.exe` → Windows SmartScreen warning (needs a code-signing cert).

## Conventions / gotchas

- `view3d.js` is **CRLF**; bulk edits via a PowerShell `[IO.File]::ReadAllText/Replace/WriteAllText`
  script work, but plain `.Replace` on multi-line `\n` strings silently no-ops (line endings). The
  Edit tool is fine. Always `node --check` after a bulk splice.
- `box(...)` in view3d.js records colliders/occluders and honors `BUILD.parent/ox` so geometry lands
  in the right office group. `solid` = collider; `occlude` = camera/roof occluder; `shown(g)` gates
  hidden colliders (free-plot fences stop blocking once an office replaces them).
- Keep everything **127.0.0.1-only** except the peer port; never widen the Foreman's exposure.
