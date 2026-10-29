# 🦜 Gemmy AI Parrot Stage

A Raspberry Pi 5 animatronic controller for a large **Gemmy macaw parrot**.
The parrot talks, sings, flaps its wings, blinks, sweeps a two-axis spotlight
and rotates on a motorised stage. Everything is driven from a local web UI
with a 3D preview, live camera feed, Gemini voice assistant and MP3 dance
synchronisation.

```
Browser UI ──HTTP──> server.py ──GPIO──> L298N / servos / MOSFET
     │                  │
     └── Gemini API     └── music/ library + local_audio.py
```

## Features

- **Gemini AI conversation** with microphone input, camera vision and function
  calling (`parrot_sing`, `parrot_dance`, `parrot_talk`, `parrot_spotlight`,
  `parrot_stage`).
- **Performance modes** – idle, talking and dancing drive the beak, eyes,
  wings, spotlight and stage automatically.
- **MP3 library** – drag & drop or URL import, delete, playlist playback and
  a beat/vocal analyser that synchronises the show to the music.
- **Local or remote audio** – play on the Pi's speaker (PipeWire / ALSA) or in
  the browser that is viewing the page.
- **Manual controls** – L298N motors, spotlight pan/tilt/brightness, stage
  angle, automation override and performance presets.
- **Live camera** – USB / CSI camera with a synthetic feed fallback.
- **Settings** – microphone sensitivity, VU meter, camera source, speaker
  volume, GPIO status and wiring guide.
- **Export** – download a standalone Python control script or a PDF of the
  wiring/instructions.
- **Simulation fallback** – the UI and 3D stage work on any computer even
  when GPIO libraries are missing.

## Hardware

| Function | BCM GPIO | Notes |
| --- | --- | --- |
| L298N ENA (mouth/eyes) | 18 | PWM |
| L298N IN1 / IN2 | 23 / 24 | forward = beak open, reverse = blink |
| L298N ENB (wings) | 19 | PWM |
| L298N IN3 / IN4 | 25 / 8 | forward = wings flap |
| Spotlight LED | 12 | IRLZ44N logic-level MOSFET, PWM |
| Spotlight pan servo | 13 | 0–180°, clamped 45–135° |
| Spotlight tilt servo | 16 | 0–180°, clamped 45–135° |
| Stage turntable servo | 9 | 0–180°, clamped 30–150° |

See [WIRING_DIAGRAM.md](WIRING_DIAGRAM.md) for the full schematic, power
wiring and bill of materials.

## Install

Raspberry Pi OS (Bookworm or newer) on a Pi 5 is recommended:

```bash
sudo apt update
sudo apt install -y python3-pip python3-venv ffmpeg
cd /home/pi/Parrot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

`gpiozero` uses `lgpio` on the Pi 5. If GPIO is unavailable the app starts in
simulation mode and reports the error in the UI.

## Run

```bash
export GEMINI_API_KEY="your-key-here"   # optional, can also be set in the UI
python3 server.py
```

Open <http://127.0.0.1:1790> on the Pi, or `http://<pi-ip>:1790` from another
device on the network. Environment variables:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `1790` | HTTP port |
| `HOST` / `IP` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN access) |
| `GEMINI_API_KEY` | – | Server-side Gemini key |
| `DIRECTORY` | `./static` | Web root |

Do **not** commit API keys. The browser stores a key entered in the UI in
`localStorage`; the server reads `GEMINI_API_KEY` from the environment.

### HTTPS / microphone

Browsers only allow microphone capture on `localhost` or HTTPS. To use the
mic from another device, put `cert.pem` and `key.pem` next to `server.py`;
the server will automatically serve HTTPS.

## Music

Drop `.mp3`, `.wav`, `.ogg`, `.m4a` or `.flac` files into `music/` or use the
**Music** tab. The **Play & Dance** button starts playback and the analyser
drives the beak, wings, stage and spotlight. With local Pi output the show
uses a beat-synchronised synthetic pattern because the browser cannot analyse
audio played by another process.

## Project layout

```
Parrot/
├── server.py              HTTP server, camera, performance loop, APIs
├── hardware.py            L298N / servos / MOSFET abstraction
├── gemini_bridge.py       Gemini chat, vision, voice and function calls
├── local_audio.py         Pi speaker discovery and playback
├── requirements.txt
├── WIRING_DIAGRAM.md
├── music/                 MP3 library (git-ignored)
└── static/
    ├── index.html         Tabs: Stage, Settings, Wiring, Instructions
    ├── style.css          Dark cyber-parrot UI
    ├── app.js             UI orchestration and state polling
    ├── parrot3d.js        Three.js parrot, stage and spotlight preview
    ├── gemini_chat.js     Mic VU/VAD, Gemini chat/voice, TTS
    ├── dance_engine.js    Playlist, Web Audio beat sync, wing/mouth pulses
    ├── audio_output.js    Local vs. browser speaker routing
    └── lib/               Three.js and OrbitControls
```

## Safety

- Power the L298N motor rail and spotlight from a separate 12 V supply with a
  common ground to the Pi. Never drive motors from the Pi's 5 V rail.
- Use a 5 V 3 A UBEC for the Pi and keep servo power on its own 5–6 V rail.
- Add a 10 kΩ pull-down on the MOSFET gate and a 220 Ω series gate resistor.
- Test with the motors disconnected first; `hardware.py` limits servo angles
  and PWM duty cycles.

## License

Hobby project, provided as-is without warranty. Vendored libraries in `static/lib/` keep their
respective licenses.
