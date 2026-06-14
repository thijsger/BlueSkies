# Skydive Tracker 🪂

Een persoonlijk skydive-volgsysteem in drie delen die samenwerken:

1. **`/garmin`** — Garmin Connect IQ watch-app (Monkey C), primair voor de **Venu 3**.
2. **`/server`** — Node.js + Express backend (deploy op Render), SQLite-opslag.
3. **`/web`** — webdashboard met grafieken en een interactieve 3D-visualisatie (three.js).

> ⚠️ **Disclaimer — lees dit eerst.** Dit is een *post-jump tracker en logboek*, **geen
> veiligheidsinstrument en geen hoogtemeter-vervanger**. In Nederland zijn een papieren
> logboek, een AAD en een aparte goedgekeurde hoogtemeter wettelijk verplicht. Deze app is
> een persoonlijke aanvulling, geen vervanging van officiële uitrusting of het wettelijke
> logboek.
>
> De Venu 3 heeft een barometer, maar die is traag/gefilterd en raakt **onbetrouwbaar tijdens
> de vrije val** (±200 km/u luchtstroom over de pols). Daarom zijn **absolute vrije-val-hoogte
> en verticale snelheid schattingen** en worden ze in de UI expliciet als *"schatting"*
> gelabeld. Wél betrouwbaar: **exit-hoogte** (vastgelegd in het vliegtuig), **fase-detectie**,
> **canopy-GPS-track en landingspatroon**, **hartslag** en alle **logboekstatistieken**.

## Geen mock-data

Het systeem werkt **uitsluitend met echte data**, via twee echte ingestion-paden. Er zit
nergens nep/demo-data in. Zonder data toont de UI een nette lege staat
(*"Nog geen sprongen — upload een .FIT of maak je eerste opname"*).

---

## Architectuur & dataflow

```
            ┌─────────────────────┐
            │  Garmin Venu 3 app  │
            │  (Monkey C)         │
            └─────────┬───────────┘
                      │
      LIVE: POST JSON │            ┌──────────────────────────────┐
      /api/jumps      ├───────────▶│  Node + Express backend      │
                      │            │  - normaliseert naar canoniek │
   .FIT-bestand   ┌───┘            │    jump-model (model.js)      │
   (backup,       │                │  - SQLite (better-sqlite3)    │
    of test)      │                │    op persistent disk         │
                  │  UPLOAD:       │  - serveert ook het dashboard │
                  └─ POST multipart└──────────┬───────────────────┘
                     /api/jumps/upload         │
                                               │ GET /api/jumps, /:id, /stats
                                               ▼
                                    ┌──────────────────────┐
                                    │  Webdashboard (/web)  │
                                    │  Chart.js + three.js  │
                                    └──────────────────────┘
```

**Twee echte ingestion-paden, één datamodel:**

- **Live pipeline.** De watch-app neemt een sessie op (1 Hz tijdreeks + automatische
  fase-detectie) en `POST`t bij stop een compacte JSON naar `/api/jumps`. Zodra die binnen is,
  verschijnt de sprong in het dashboard.
- **.FIT-upload.** Een echt `.FIT`-bestand (geëxporteerd van de watch — de app schrijft er
  altijd één als backup) wordt geüpload via het dashboard naar `/api/jumps/upload`, server-side
  geparsed en in **hetzelfde** canonieke model gezet. Dit is de primaire manier om
  visualisaties op echte data te testen zonder te hoeven springen.

Het dashboard weet nooit van welke bron een sprong komt — beide paden produceren identieke
canonieke jumps.

---

## Canoniek jump-datamodel

Gedefinieerd en gedocumenteerd in [`server/src/model.js`](server/src/model.js). Eén jump:

```jsonc
{
  "id": "uuid",
  "schema": "skydive.v1",
  "source": "live" | "fit",        // herkomst (UI maakt geen onderscheid)
  "device": "venu3",
  "createdAt": "ISO",
  "startTime": "ISO",
  "endTime": "ISO",
  "durationSec": 120.0,
  "jumpType": "fun",               // bewerkbaar: tandem/AFF/fun/freefly/...
  "jumpNumber": 1,                 // auto-increment, bewerkbaar
  "notes": null,
  "dropzone": "Paracentrum Teuge", // auto uit GPS (dichtstbijzijnde bekende DZ)
  "target": { "lat": 0, "lng": 0 } | null,  // door gebruiker ingesteld
  "summary": {
    "exitAltitude": 4000,          // m — betrouwbaar (in vliegtuig)
    "freefallTime": 37,            // s
    "canopyTime": 74,              // s
    "peakVerticalSpeed": 52,       // m/s — SCHATTING
    "avgVerticalSpeed": 47,        // m/s — SCHATTING
    "peakHr": 154, "avgHr": 129,   // bpm — betrouwbaar
    "exitPoint": { "lat": 0, "lng": 0 },
    "landingPoint": { "lat": 0, "lng": 0 },
    "horizontalDrift": 1200,       // m, exit -> landing
    "distanceToTarget": null,      // m, gezet zodra target bekend is
    "maxGroundSpeed": 14.2,        // m/s canopy
    "dataQuality": "ok" | "no-freefall-detected" | "no-altitude"
  },
  "phases": [ { "phase": "climb|exit|freefall|canopy|landed", "startT": 0, "endT": 40 } ],
  "series": [
    { "t": 0, "alt": 4000, "vs": -52, "fallRate": 52, "hr": 150,
      "lat": 52.24, "lng": 6.04, "groundSpeed": 0.0, "phase": "freefall" }
  ]
}
```

`t` is seconden vanaf start. `vs` is verticale snelheid (negatief = dalend); `fallRate` is de
positieve daalsnelheid. De **fase-detectie en alle afgeleide statistieken worden server-side
berekend** uit het snelheid/hoogte-profiel, zodat live- en FIT-sprongen consistent zijn (de
real-time fase-detectie op de watch is alleen voor on-watch UI + trillingen).

### API

| Methode | Pad | Doel |
|--------|-----|------|
| `POST` | `/api/jumps` | Live JSON-payload van de watch |
| `POST` | `/api/jumps/upload` | `.FIT`-bestand (multipart, veld `file`) |
| `GET`  | `/api/jumps` | Lijst met samenvattingen |
| `GET`  | `/api/jumps/:id` | Volledige tijdreeks + fases |
| `PATCH`| `/api/jumps/:id` | Bewerk `jumpType`/`notes`/`jumpNumber`/`target`/`dropzone` |
| `DELETE`| `/api/jumps/:id` | Verwijder sprong |
| `GET`  | `/api/stats` | Cumulatieve stats + trends |
| `GET`  | `/api/health` | Healthcheck |

---

## Deel 2 — Backend lokaal draaien

```bash
cd server
npm install
npm start            # of: npm run dev  (auto-restart)
# -> http://localhost:3000  (API + dashboard op dezelfde poort)
```

Het dashboard is meteen bereikbaar op `http://localhost:3000`. Lege staat tot er data is.

Env-vars (zie `server/.env.example`): `PORT`, `DATA_DIR` (locatie SQLite-bestand),
`CORS_ORIGIN`, `WEB_DIR`.

### Deploy naar Render via GitHub

1. Push deze repo naar GitHub.
2. Render → **New + → Blueprint** → kies de repo. `render.yaml` (in de root) wordt gelezen en
   maakt één web-service aan die **API én dashboard** serveert, met een **persistent disk**
   (`/var/data`) voor de SQLite-database zodat data herstarts overleeft.
3. Wacht op de deploy. De healthcheck is `/api/health`. Je dashboard staat op
   `https://<service>.onrender.com`.
4. Zet in de Garmin-app-instellingen (Connect-app op je telefoon) **Backend URL** op die URL.

> **Opslag-alternatieven.** Een persistent disk vereist een betaald Render-plan (starter+).
> Wil je gratis blijven: gebruik **Render Postgres** in plaats van SQLite. De code is bewust
> klein gehouden in `server/src/db.js`; vervang de `better-sqlite3`-laag door `pg` met dezelfde
> functies (`insertJump`, `listJumps`, `getJump`, `updateJump`, `deleteJump`) en voeg een
> `databases:`-blok + `DATABASE_URL` toe aan `render.yaml`. `model.js`, de routes en het
> dashboard veranderen niet. (SQLite is hier gekozen omdat het zero externe provisioning is en
> één bestand/datamodel oplevert — ideaal voor een persoonlijk logboek.)

---

## Deel 3 — Webdashboard

Geen build-stap: vanilla JS + ES-modules, met Chart.js en three.js via CDN. Wordt door de
Node-server geserveerd vanuit `/web`. Views:

- **Logboek** — alle sprongen (datum, dropzone, sprongnummer, type, kernstats). Lege staat.
- **Sprongdetail** — samenvattingskaarten (schattingen gelabeld), uitgelijnde grafieken
  (hoogte / daalsnelheid / hartslag met gearceerde fase-banden, plus grondsnelheid-canopy), en
  een **interactieve 3D-track** (three.js): pad gekleurd per fase, grondvlak + exit/landing/
  target-markers, orbit/zoom/pan, en een play/scrub-marker langs de tijd.
- **Statistieken** — cumulatieve totalen + trends (sprongen per maand, cumulatieve vrije-val-
  tijd, verdeling exit-hoogtes).
- **Upload .FIT** — sleep/kies een `.FIT`; wordt direct geparsed en getoond.

Apart hosten kan ook: serveer `/web` statisch en zet `?api=https://<api>.onrender.com` achter
de dashboard-URL (zie `web/js/api.js`).

---

## Deel 1 — Garmin Connect IQ app

Doel: **Venu 3** (degradeert netjes op toestellen zonder barometer — gedetecteerd via
`ActivityMonitor.Info has :floorsClimbed`; baro-velden worden dan uitgeschakeld i.p.v. crashen).

**Wat de app doet:**
- Neemt op 1 Hz op (hoogte/baro, hartslag, GPS, fase) + **hoge-frequentie accelerometer** via
  `Sensor.registerSensorDataListener` als freefall-cue (valt terug op 1 Hz waar niet
  beschikbaar). Schrijft tegelijk een **`.FIT`-bestand** via `ActivityRecording` als backup.
- Draait een **automatische fase-state-machine** (CLIMB → EXIT → FREEFALL → CANOPY → LANDED) op
  basis van verticale snelheid + accel. Geen taps nodig tijdens de sprong; trilt bij elke
  fase-overgang (`Attention.vibrate`).
- Minimale UI: start/stop, live fase-indicator + stats, post-jump samenvattingsscherm.
- `POST`t bij stop een compacte JSON naar de backend; de `.FIT` blijft als backup-ingestion.
- Toont de veiligheids-disclaimer bij de eerste start.

### Bouwen & sideloaden

Vereist de Connect IQ SDK + een developer key.

```bash
cd garmin
SDK="$HOME/Library/Application Support/Garmin/ConnectIQ/Sdks/<jouw-sdk-versie>"

# Sideload-build voor de Venu 3:
"$SDK/bin/monkeyc" -f monkey.jungle -d venu3 \
  -o bin/SkydiveLog-venu3.prg -y /pad/naar/developer_key

# In de simulator draaien:
open "$SDK/bin/ConnectIQ.app"
"$SDK/bin/monkeydo" bin/SkydiveLog-venu3.prg venu3

# Store-pakket (alle toestellen):
"$SDK/bin/monkeyc" -e -f monkey.jungle -o bin/SkydiveLog.iq -y /pad/naar/developer_key
```

Op het toestel: sluit de Venu 3 via USB aan en kopieer de `.prg` naar
`GARMIN/APPS/`, of installeer de `.iq` via de Connect IQ store / sideload-tool.

**Backend-URL instellen:** open in de Garmin Connect-app op je telefoon de app-instellingen
en vul je Render-URL in bij *Backend URL* (default staat al ingevuld in
`resources/settings/properties.xml`).

---

## Je eerste echte test (zonder te springen)

Je hebt geen sprong nodig om de hele pijplijn te valideren — en we injecteren **geen** nepdata:

1. **Backend live.** Deploy naar Render (of draai lokaal) en controleer `/api/health`.
2. **Maak een echte opname.** Sideload de watch-app, accepteer de disclaimer, en start een
   opname tijdens een wandeling of trap-op-trap-af (zo krijg je echte hoogte-, HR- en
   GPS-data). Stop de opname. De app `POST`t naar de backend én bewaart een `.FIT`.
   - Verschijnt de sprong in het dashboard-logboek? → de **live pipeline** werkt.
3. **Test de .FIT-upload.** Exporteer een bestaande activiteit als `.FIT` (Garmin Connect →
   activiteit → exporteren naar origineel/`.FIT`) en upload hem op de **Upload .FIT**-pagina.
   - Verschijnt de geparsede sprong meteen? → het **upload-pad** werkt.
4. Pas type/notities/target aan op de detailpagina en bekijk grafieken + 3D-track op je
   echte data. Pas daarna gerust de fase-drempels in `server/src/model.js` aan op basis van
   een echte sprong.

> Een wandeling toont logischerwijs *"Geen vrije val gedetecteerd"* (de daling is te traag) —
> dat is correct gedrag en bevestigt dat de fase-detectie eerlijk is. Hoogte-, HR-, GPS- en
> 3D-track-weergave werken er volledig mee.

---

## Repostructuur

```
skydive-tracker/
├── README.md
├── render.yaml                 # Render blueprint (web + persistent disk)
├── garmin/                     # Connect IQ app (Monkey C) — compileert
│   ├── manifest.xml  monkey.jungle
│   ├── resources/  (strings, drawables, settings)
│   └── source/  (App, Views, Delegates, JumpRecorder)
├── server/                     # Node + Express + SQLite
│   ├── package.json  .env.example
│   └── src/  (index, db, model, routes/jumps)
└── web/                        # dashboard (vanilla JS + Chart.js + three.js)
    ├── index.html
    ├── css/style.css
    └── js/  (app, api, charts, three-view, util)
```
