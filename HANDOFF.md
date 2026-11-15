# AgentCraft — session handoff

_For the next Claude Code session. Read this first. Everything lives on `C:\dev\agentcraft-dist` (the custom app) and `C:\dev\agentcraft` (the upstream repo clone)._

## What this project is

AgentCraft (upstream: https://github.com/blendi-remade/agentcraft) = a team of Claude agents doing
real work on real code, shown in a studio you can walk around. Upstream renders it as a **Minecraft
Fabric mod**. We **pivoted away from Minecraft** because Minecraft: Java Edition is a paid game and
the user won't ask coworkers to buy it. We are building our **own studio app** (HTML + three.js,
driven by the real Foreman) so there is nothing to buy and nothing to install but one executable.

**End goal:** one installer/`.exe` the user can share by link. Coworkers run it, each with their own
Anthropic API key, their own repos, their own spend.

## Architecture

- **Foreman** (`C:\dev\agentcraft\foreman`, Node/TS) — the real thing: runs the Claude agents, owns
  all state, serves `ws://127.0.0.1:7878`. Protocol in `C:\dev\agentcraft\docs\protocol.md`
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
- Repo cloned to `C:\dev\agentcraft` (outside OneDrive). Company Artifactory 403s on public packages,
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
  node C:\dev\agentcraft\foreman\src\main.ts  # via: node --import tsx ... --backend sim --profile sim --home ~/.agentcraft --port 7878
  # Studio server:
  node C:\dev\agentcraft-dist\studio\server.mjs --port 7880 --foreman 7878 --foreman-dir C:\dev\agentcraft\foreman
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
   then the studio server and window as in "What works right now". Paths in this file say `C:\dev\...`; adjust.
4. `studio/test/fakepeer.mjs` has the foreman path hardcoded (`C:/dev/agentcraft/foreman/package.json`).

## LAN multiplayer — client is now WIRED (was "in progress")

**P2P on the LAN, no central server.** Design locked with the user:
- UDP broadcast discovery on :7892, peer WS on :7891, fallback = add a coworker by PC name / IP.
  Optional **team code** (only same-code studios connect).
- **Shared over the wire:** name + avatar look, avatar position, chat, and an **activity summary**
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

### NOT yet verified — do these next
- The **Coworkers panel** (click the chip): add host, forget, team code save; wrong team code is refused.
- Typing **`/chat hi`** in the console: my own bubble, and that the other studio receives it.
- A coworker with a running goal: agents moving in their office, desk screens, task cards on their board,
  agent nameplates when inside, "Watch <agent>" dialog. (Give stack #2 a goal first.)
- Peer leaves → office hidden, free-plot sign back. 2D view → no stale peer plates.
- A real **two-machine** test (needs the user): discovery by broadcast, Windows Firewall prompt on :7891.

### Test tools (`studio/test/`)
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

## After multiplayer

- **Simulated Arena / warfare mode — LATER (user said "simulated mode will be later").**
  Game units (may borrow agent looks) that fight / defect / capture territory, as **pure game state
  on the world server**. HARD CONSTRAINT, agreed with the user and non-negotiable: it must **never**
  control a real agent, spend anyone's tokens, or touch any repo. We **refused** the original ask
  ("convince a rival's agents to betray their owner and work for me, billed to the enemy's seat,
  attack each other") because AgentCraft agents are real coding agents with shell+repo access and a
  real bill — that's account abuse + remote takeover, and it's exactly the security gate the project
  exists to protect. The simulated version is fine; keep that line.
- **Rewrite the installer to ship the studio app, not Minecraft.** Current `src/Launcher.cs`,
  `src/AgentCraft.iss`, `build.ps1`, and `out/AgentCraft-Setup.exe` (196 MB) are the **STALE Minecraft
  version** (bundles Java/Prism/Minecraft, Prism needs a Microsoft/Minecraft login). New installer
  should bundle **Node + the studio app + the foreman** and have the launcher start foreman + studio
  server and open an Edge `--app` window to the token URL. Drop Java/Prism/Minecraft. Target ~100 MB.
  `downloads/` has node.zip/jre25.zip/prism.zip/mingit.zip; only node.zip is still needed.
- Note for the user: unsigned `.exe` → Windows SmartScreen warning (needs a code-signing cert).

## Conventions / gotchas

- `view3d.js` is **CRLF**; bulk edits via a PowerShell `[IO.File]::ReadAllText/Replace/WriteAllText`
  script work, but plain `.Replace` on multi-line `\n` strings silently no-ops (line endings). The
  Edit tool is fine. Always `node --check` after a bulk splice.
- `box(...)` in view3d.js records colliders/occluders and honors `BUILD.parent/ox` so geometry lands
  in the right office group. `solid` = collider; `occlude` = camera/roof occluder; `shown(g)` gates
  hidden colliders (free-plot fences stop blocking once an office replaces them).
- Keep everything **127.0.0.1-only** except the peer port; never widen the Foreman's exposure.
