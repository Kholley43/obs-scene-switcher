# OBS Auto Scene Switcher

Replaces the OBS **Auto Scene Switcher** plugin. Switches OBS **program scenes** over **WebSocket** — one scene per pair (EURUSD, XAU, BTC, …) plus optional **Manual TA**.

**No market data.** No subscriptions. Only OBS must be running.

---

## Requirements

| Requirement | Notes |
|-------------|--------|
| **OBS Studio 28+** | Built-in WebSocket (v5) |
| **Node.js 18.18+** | [nodejs.org](https://nodejs.org/) — `node -v` to check |
| **npm** | Comes with Node — only needed to run tests |

Runtime CLI uses **zero npm packages**. `npm install` is only for the optional test suite.

Works on **Windows** and **Linux** (macOS too). Use the `.ps1` scripts on Windows or the `.sh` scripts on Linux.

---

## Turn on OBS WebSocket (required)

The script talks to OBS over **WebSocket**. OBS 28 and newer include this built in — you do **not** install a separate plugin.

### Step-by-step (Windows)

1. **Open OBS Studio** (leave it running while you use this tool).

2. Top menu: **Tools** → **WebSocket Server Settings**  
   - If you do not see **WebSocket Server Settings**, update OBS to **28.0 or newer** from [obsproject.com](https://obsproject.com/).

3. In the WebSocket Server Settings window:
   - Turn **Enable WebSocket server** **ON** (checkbox at the top).
   - **Server Port**: leave **`4455`** unless you changed it on purpose.
   - **Enable authentication** — recommended if OBS asks for a password:
     - Check **Enable authentication** in OBS.
     - Set a **Server Password** in OBS (remember what you type).
     - Put the **exact same** password in `config.json`:

       ```json
       "password": "your-obs-websocket-password"
       ```

     - If authentication is **OFF**, use an empty string:

       ```json
       "password": ""
       ```

     - If the script says `OBS requires WebSocket password — set password in config.json`, OBS has auth **ON** but `config.json` still has `"password": ""`. Add your OBS password there.

   `config.json` is **not** uploaded to GitHub (it is in `.gitignore`). Each person sets their own password locally.

4. Click **Apply** or **OK**.

5. **Verify** from this folder in PowerShell:

   ```powershell
   node bin\obs-scene.mjs list
   ```

   You should see your OBS scene names and `Current: ...`.  
   If you get `Connection refused` or `OBS WebSocket error`, OBS is not running or WebSocket is still off.

### Match `config.json` to OBS

| OBS WebSocket setting | `config.json` field |
|----------------------|---------------------|
| Port `4455` | `"port": 4455` |
| No password | `"password": ""` |
| Password set | `"password": "your-password-here"` |
| Server on same PC | `"host": "127.0.0.1"` |

OBS must stay open. Closing OBS stops WebSocket and the script cannot switch scenes.

---

## Install (first time)

### Windows

```powershell
cd C:\obs-scene-switcher
npm install    # optional — tests only
copy config.example.json config.json
notepad config.json
```

### Linux

```bash
git clone https://github.com/Kholley43/obs-scene-switcher.git
cd obs-scene-switcher
npm install    # required on many Linux distros (see troubleshooting)
cp config.example.json config.json
nano config.json   # or vim, code, etc.
chmod +x start-panel.sh start-rotate.sh test-2-scenes.sh check-setup.sh
./check-setup.sh   # optional — verifies Node, WebSocket, OBS connection
```

### Both platforms

Edit `config.json`:

- `password` — **must match** OBS WebSocket password when authentication is enabled (see above)
- Each `obsScene` — **exact** name as shown in OBS Scenes list (case-sensitive)

---

## Quick test with 2 scenes (before going live)

Use this to prove switching works on your machine.

1. Create **2 scenes** in OBS (any names — e.g. `Scene 1` and `Scene 2`).

2. Copy the 2-scene template:

   ```powershell
   copy config.2-scenes.example.json config.json
   notepad config.json
   ```

   Change `obsScene` values to match your two scene names exactly.

3. Run the guided test:

   ```powershell
   .\Test-2-Scenes.ps1
   ```

   Or manually:

   ```powershell
   node bin\obs-scene.mjs list
   node bin\obs-scene.mjs validate
   node bin\obs-scene.mjs goto ONE
   node bin\obs-scene.mjs goto TWO
   node bin\obs-scene.mjs next
   node bin\obs-scene.mjs rotate --interval 10
   ```

   Watch OBS — program scene should change each command / every 10s on rotate. `Ctrl+C` stops rotate.

---

## Full setup (9 scenes — trading stream)

Template in `config.example.json`:

| Alias | Typical use |
|-------|-------------|
| EURUSD, AUDUSD | Forex |
| XAU, XAG | Metals |
| BTC | Crypto |
| ETH, SOL, BNB | Perps (or swap for your 6 perps snapshot names) |
| MANUAL | Manual TA — **skipped** in auto-rotate by default |

```powershell
copy config.example.json config.json
notepad config.json
node bin\obs-scene.mjs validate
node bin\obs-scene.mjs rotate
```

Set `"includeManualInRotate": true` only if Manual TA should be in the rotation.

---

## Commands

```powershell
node bin\obs-scene.mjs list              # OBS scenes + your config map
node bin\obs-scene.mjs validate          # fail if any obsScene missing in OBS
node bin\obs-scene.mjs goto XAU          # jump by alias
node bin\obs-scene.mjs next              # next scene in rotation list
node bin\obs-scene.mjs prev              # previous
node bin\obs-scene.mjs rotate            # auto-rotate (default interval from config)
node bin\obs-scene.mjs rotate --interval 30
```

Custom config path:

```powershell
$env:OBS_SCENE_CONFIG = "D:\stream\my-config.json"
node bin\obs-scene.mjs goto BTC
```

---

## Hook from other scripts

After a perps snapshot script updates a chart:

```powershell
node C:\obs-scene-switcher\bin\obs-scene.mjs goto SOL
```

---

## Platform shortcuts

| Windows | Linux | Action |
|---------|-------|--------|
| `Start-Panel.ps1` | `./start-panel.sh` | **Web control panel** — speed, scene buttons, rotate |
| `Test-2-Scenes.ps1` | `./test-2-scenes.sh` | Guided 2-scene live test |
| `Start-Rotate.ps1` | `./start-rotate.sh` | Auto-rotate CLI only |

---

## Web control panel

A local browser UI for stream control — no install beyond Node.

```powershell
npm run panel
# or
.\Start-Panel.ps1
```

Linux:

```bash
npm run panel
# or
./start-panel.sh
```

Opens **http://127.0.0.1:8765** (change `panelPort` in `config.json`).

| Feature | What it does |
|---------|----------------|
| **Switch speed** | Slider 5–300s; **Save to config** writes `rotateIntervalSec` |
| **Start / Stop rotate** | Auto-rotate with live countdown |
| **Scene buttons** | One-click jump to any alias (EURUSD, XAU, MANUAL, …) |
| **Prev / Next** | Step through rotation pool |
| **Include Manual TA** | Toggle `includeManualInRotate` (saved with settings) |
| **Validate** | Check all `obsScene` names exist in OBS |
| **Activity log** | Recent switches and errors |

Leave the panel terminal window open while streaming. CLI still works alongside it.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Connection refused` / `connection failed` | OBS must be **open**. **Tools → WebSocket Server Settings** → **Enable WebSocket server** ON. Port `4455` in OBS and `config.json`. |
| No **WebSocket Server Settings** menu | Update OBS to **28+**. Older OBS needs the separate obs-websocket plugin (not this guide). |
| `OBS requires WebSocket password` | OBS has auth ON — set `"password"` in `config.json` to match OBS. |
| `Authentication failed` | Password in `config.json` does not match OBS WebSocket password. |
| `Scene not found` | Run `list` — fix `obsScene` spelling in config |
| `Unknown scene alias` | Use alias from config (`ONE`, `TWO`, `XAU`, …) |
| Rotate too fast/slow | `rotateIntervalSec` in config or `--interval N` |
| `global WebSocket missing` / `WebSocket not available` (Linux) | Some distro Node builds omit `globalThis.WebSocket` even on 18.19+. Run **`npm install`** in the project folder (installs `ws` fallback). Or run **`./check-setup.sh`**. `start-panel.sh` auto-runs `npm install` when needed. |

---

## Project layout

```
obs-scene-switcher/
  bin/obs-scene.mjs          CLI
  bin/panel-server.mjs       Web control panel server
  panel/index.html           Browser UI
  lib/obs-ws-client.mjs      OBS WebSocket v5 client
  lib/websocket.mjs          global WebSocket or npm `ws` fallback
  check-setup.sh             Linux setup + OBS connection check
  lib/switcher.mjs           Config + rotate logic
  config.example.json        9-scene template
  config.2-scenes.example.json   2-scene test template
  Start-Panel.ps1            Launch web panel (Windows)
  start-panel.sh             Launch web panel (Linux)
  Test-2-Scenes.ps1          Live 2-scene test (Windows)
  test-2-scenes.sh           Live 2-scene test (Linux)
  Start-Rotate.ps1           Auto-rotate shortcut (Windows)
  start-rotate.sh            Auto-rotate shortcut (Linux)
  test/smoke.mjs             Automated tests
```

---

## License

MIT — use freely for streams and client setups.
