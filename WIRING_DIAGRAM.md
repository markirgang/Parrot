# 🦜 Gemmy AI Parrot Stage — Wiring Diagram

Complete pin map and power wiring for the Raspberry Pi 5 animatronic macaw:
L298N dual H-bridge, two-axis spotlight servos, IRLZ44N spotlight MOSFET and
the stage turntable servo.

> **Pi 5 note:** `gpiozero` uses the `lgpio` backend. Do not install the old
> `RPi.GPIO`-only examples on a Pi 5; this project only needs `gpiozero` and
> `lgpio`. Motors and servos must use a separate power supply with a common
> ground to the Pi.

---

## 1. System Overview

```
                 +-------------------------------------+
                 |  12V 5A DC PSU   +   5V 3A UBEC      |
                 |  +12V motors/LED    +5V Pi/servos    |
                 +----+----------------------+----------+
                      |                      |
        +-------------+-----------+          +-------------------+
        |                         |                              |
        v                         v                              v
+---------------+       +---------------------+         +----------------+
| L298N         |       | IRLZ44N MOSFET      |         | 5V 6A servo    |
| CH1 mouth/eye |       | spotlight LED PWM   |         | BEC / rail     |
| CH2 wings     |       | 220R gate, 10k PD   |         | pan/tilt/stage |
+-------+-------+       +----------+----------+         +--------+-------+
        |                          |                             |
        v                          v                             v
  DC motors                12V LED spotlight            MG996R / DS3218
        ^                          ^                             ^
        |                          |                             |
        +-----------+--------------+-----------------------------+
                    |
        +-----------v-----------+
        |  Raspberry Pi 5 GPIO  |
        |  BCM 18,23,24,19,25,8 |
        |  BCM 12,13,16,9       |
        +-----------------------+
```

All grounds (12 V PSU, 5 V BEC, L298N GND, servo GND, Pi GND, MOSFET source)
must be tied together.

---

## 2. Raspberry Pi 40-Pin Header Map

| Header pin | BCM GPIO | Signal | Connected to | Function |
| :---: | :---: | :--- | :--- | :--- |
| 2 / 4 | 5V | 5 V supply | UBEC 5 V + servo BEC | Pi logic power |
| 6, 9, 14, 20, 25, 30, 34, 39 | GND | Ground | Common ground bus | Shared reference |
| 12 | GPIO 18 | PWM out | L298N ENA | Mouth / eyes speed |
| 16 | GPIO 23 | Digital out | L298N IN1 | Forward = beak open |
| 18 | GPIO 24 | Digital out | L298N IN2 | Reverse = eyes blink |
| 35 | GPIO 19 | PWM out | L298N ENB | Wing motor speed |
| 22 | GPIO 25 | Digital out | L298N IN3 | Forward = wings flap |
| 24 | GPIO 8 | Digital out | L298N IN4 | Wing direction |
| 32 | GPIO 12 | PWM out | IRLZ44N gate (220 Ω) | Spotlight brightness |
| 33 | GPIO 13 | PWM out | Spotlight pan servo signal | 45–135° |
| 36 | GPIO 16 | PWM out | Spotlight tilt servo signal | 45–135° |
| 21 | GPIO 9 | PWM out | Stage servo signal | 30–150° |

Logic levels are 3.3 V. The L298N accepts 3.3 V logic; the IRLZ44N is a
logic-level MOSFET and switches cleanly from 3.3 V.

---

## 3. L298N Dual H-Bridge

```
        +12V ──────────────┐
                           │
                    +------+------+
                    |   L298N     |
   Pi GPIO18 ──────>| ENA     +12V|──── +12V motor rail
   Pi GPIO23 ──────>| IN1         |
   Pi GPIO24 ──────>| IN2     OUT1|──── CH1 motor +
   Pi GPIO19 ──────>| ENB     OUT2|──── CH1 motor −
   Pi GPIO25 ──────>| IN3         |
   Pi GPIO8  ──────>| IN4     OUT3|──── CH2 motor +
   Pi GND    ──────>| GND     OUT4|──── CH2 motor −
                    |   5V (logic) |
                    +------+------+
                           │
                     (remove 5V jumper
                      only if using a
                      separate 5V logic rail)
```

### Channel 1 — beak and eyes (one motor, two directions)

- **Forward** (`IN1=HIGH`, `IN2=LOW`, ENA PWM): pulls the beak open.
- **Reverse** (`IN1=LOW`, `IN2=HIGH`, ENA PWM): drives the eye-blink linkage.
- **Off** (`IN1=LOW`, `IN2=LOW`, ENA=0): beak closes / mechanism rests.

The mouth and eyes share one L298N channel because they are never used at the
same time. If your mechanism needs independent motors, use a second L298N and
move the eye motor to a free channel.

### Channel 2 — wings

- **Forward** (`IN3=HIGH`, `IN4=LOW`, ENB PWM): flaps the wings.
- **Off**: wings rest.
- Add mechanical end stops so the wing linkage cannot over-travel.

Set the L298N onboard 5 V regulator jumper only when the motor rail is
≥ 7 V. If you power the L298N logic from the Pi's 5 V rail, remove the jumper
and connect 5 V directly to the logic terminal.

---

## 4. IRLZ44N Spotlight MOSFET

```
                       +12V
                         │
                    ┌────┴────┐
                    │  LED    │  (12V spotlight, correct polarity)
                    └────┬────┘
                         │
                    ┌────┴────┐
                    │ Drain   │
   Pi GPIO12 ──220Ω─┤ Gate    │ IRLZ44N (TO-220)
                    │ Source  │
                    └────┬────┘
                         │
                        GND
               10kΩ from Gate to GND
```

- **220 Ω** series resistor between GPIO 12 and the gate.
- **10 kΩ** pull-down from gate to ground prevents flicker at boot.
- The MOSFET switches the **low side** of the 12 V spotlight.
- Add a flyback diode (e.g. 1N5408) across a long LED lead if the cable run
  is noisy. The spotlight must not draw more than the MOSFET/PSU rating.
- PWM frequency is 1 kHz in `hardware.py`.

If you use a 5 V LED spotlight instead, power it from the 5 V rail and keep
the same low-side MOSFET wiring.

---

## 5. Servos

| Servo | Signal | Power | Range used |
| :--- | :--- | :--- | :--- |
| Spotlight pan | GPIO 13 | 5–6 V BEC | 45–135° |
| Spotlight tilt | GPIO 16 | 5–6 V BEC | 45–135° |
| Stage turntable | GPIO 9 | 5–6 V BEC | 30–150° |

- Use a **separate 5 V 6 A BEC** for the servos. Do not power three servos
  from the Pi's 5 V pin.
- Connect all servo grounds to the Pi ground.
- The stage servo should drive the turntable through a slip clutch or a
  geared reduction; a direct-coupled MG996R can strip gears if the stage
  jams.
- `hardware.py` clamps angles and detaches servos on shutdown to reduce
  jitter. Mechanical limits must still be set physically.
- Signal wire is usually orange/yellow; power is red; ground is brown/black.

---

## 6. Audio and Camera

- **Audio out:** 3.5 mm jack, USB speaker or HDMI. The UI lists local
  PipeWire/ALSA outputs and can also play in the browser.
- **Microphone:** USB microphone or webcam mic. Browser capture requires
  `localhost` or HTTPS; place `cert.pem` and `key.pem` next to `server.py`
  to enable HTTPS.
- **Camera:** USB webcam (`/dev/video0`) or CSI camera. Select the source in
  **Hardware & Settings**. A synthetic feed is shown when no camera is found.

---

## 7. Bill of Materials

1. Raspberry Pi 5 (4 GB or 8 GB) with official 5 V 5 A USB-C PSU.
2. Gemmy macaw shell with hinged beak, eye linkage, wing linkage and
   turntable stage.
3. L298N dual H-bridge module.
4. 2 × 12 V DC gearmotors or linear actuators (beak/eyes and wings).
5. 1 × IRLZ44N logic-level MOSFET, 220 Ω resistor, 10 kΩ resistor.
6. 12 V LED spotlight.
7. 3 × metal-gear servos (pan, tilt, stage) — MG996R or DS3218 recommended.
8. 5 V 6 A UBEC for servos; 12 V 5 A PSU for motors and spotlight.
9. USB webcam or Raspberry Pi Camera Module.
10. USB microphone and powered speaker.
11. Fuses, screw terminals, 18–22 AWG wire and strain reliefs.

---

## 8. Power-Up Checklist

1. Disconnect the motors and spotlight; boot the Pi and confirm the UI shows
   **GPIO ONLINE**.
2. Verify 5 V at the servo rail and 12 V at the L298N motor rail.
3. Test one actuator at a time with short moves in the UI.
4. Confirm the beak opens on **Mouth Open** and the eyes blink on **Blink**.
5. Set pan/tilt limits so the spotlight cannot hit the shell.
6. Run the stage slowly through its full range and check for cable strain.
7. Reconnect the spotlight and test brightness from 0–100 %.
8. Only then run a full **Talk** and **Dance** preset.
