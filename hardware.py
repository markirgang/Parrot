"""Raspberry Pi 5 hardware bridge for the Gemmy AI Parrot.

The module degrades gracefully to a pure-software simulation when GPIO
libraries are unavailable (for example while developing on a laptop).

Pin map (BCM numbering)
-----------------------
L298N channel 1 - mouth / eyes motor
    ENA  GPIO 18  (PWM speed)
    IN1  GPIO 23  (forward polarity  = mouth open)
    IN2  GPIO 24  (reverse polarity  = eyes blink)

L298N channel 2 - wing motor
    ENB  GPIO 19  (PWM speed)
    IN3  GPIO 25  (forward polarity  = wings flap)
    IN4  GPIO 8

Spotlight
    LED  GPIO 12  (IRLZ44N logic-level MOSFET gate, PWM brightness)
    PAN  GPIO 13  (servo, 0-180 degrees)
    TILT GPIO 16  (servo, 0-180 degrees)

Stage turntable
    STAGE GPIO 9  (servo, 0-180 degrees)
"""

import threading
import time

try:  # gpiozero works on Raspberry Pi 5 through lgpio
    from gpiozero import AngularServo, DigitalOutputDevice, PWMOutputDevice

    GPIO_AVAILABLE = True
    GPIO_ERROR = None
except Exception as exc:  # pragma: no cover - depends on host hardware
    GPIO_AVAILABLE = False
    GPIO_ERROR = str(exc)


PINS = {
    "l298_ena": 18,
    "l298_in1": 23,
    "l298_in2": 24,
    "l298_enb": 19,
    "l298_in3": 25,
    "l298_in4": 8,
    "spotlight_led": 12,
    "spotlight_pan": 13,
    "spotlight_tilt": 16,
    "stage": 9,
}

MOUTH_DUTY = 1.0
BLINK_DUTY = 0.65
WING_DUTY = 0.9


class ParrotHardware:
    """Small thread-safe wrapper around the L298N, MOSFET and servos."""

    def __init__(self):
        self.available = False
        self.error = GPIO_ERROR
        self._lock = threading.Lock()
        self._last = {}

        self._ena = None
        self._in1 = None
        self._in2 = None
        self._enb = None
        self._in3 = None
        self._in4 = None
        self._led = None
        self._pan = None
        self._tilt = None
        self._stage = None

        if GPIO_AVAILABLE:
            self._initialise()

    def _initialise(self):
        try:
            self._in1 = DigitalOutputDevice(PINS["l298_in1"], initial_value=False)
            self._in2 = DigitalOutputDevice(PINS["l298_in2"], initial_value=False)
            self._in3 = DigitalOutputDevice(PINS["l298_in3"], initial_value=False)
            self._in4 = DigitalOutputDevice(PINS["l298_in4"], initial_value=False)
            self._ena = PWMOutputDevice(PINS["l298_ena"], frequency=1000, initial_value=0)
            self._enb = PWMOutputDevice(PINS["l298_enb"], frequency=1000, initial_value=0)
            self._led = PWMOutputDevice(PINS["spotlight_led"], frequency=1000, initial_value=0)

            servo_kwargs = {
                "min_angle": 0,
                "max_angle": 180,
                "min_pulse_width": 0.5 / 1000,
                "max_pulse_width": 2.5 / 1000,
            }
            self._pan = AngularServo(PINS["spotlight_pan"], initial_angle=90, **servo_kwargs)
            self._tilt = AngularServo(PINS["spotlight_tilt"], initial_angle=90, **servo_kwargs)
            self._stage = AngularServo(PINS["stage"], initial_angle=90, **servo_kwargs)

            self.available = True
            self.error = None
            self.set_mouth("off")
            self.set_wings(False)
            self.set_spotlight(0)
            self.set_spotlight_angles(90, 90)
            self.set_stage(90)
        except Exception as exc:  # pragma: no cover - depends on host hardware
            self.available = False
            self.error = str(exc)
            self._safe_close()

    def _safe_close(self):
        for device in (self._ena, self._enb, self._led):
            try:
                if device is not None:
                    device.value = 0
            except Exception:
                pass
        for device in (self._in1, self._in2, self._in3, self._in4):
            try:
                if device is not None:
                    device.off()
            except Exception:
                pass
        for servo in (self._pan, self._tilt, self._stage):
            try:
                if servo is not None:
                    servo.detach()
            except Exception:
                pass

    def _changed(self, key, value):
        if self._last.get(key) != value:
            self._last[key] = value
            return True
        return False

    def set_mouth(self, mode):
        """mode: 'off', 'open' (forward) or 'blink' (reverse polarity)."""
        mode = str(mode or "off").lower()
        if mode not in ("off", "open", "blink"):
            mode = "off"
        if not self.available:
            return
        with self._lock:
            try:
                if mode == "open":
                    self._in1.on()
                    self._in2.off()
                    self._ena.value = MOUTH_DUTY
                elif mode == "blink":
                    self._in1.off()
                    self._in2.on()
                    self._ena.value = BLINK_DUTY
                else:
                    self._in1.off()
                    self._in2.off()
                    self._ena.value = 0
            except Exception as exc:  # pragma: no cover
                self.error = str(exc)

    def set_wings(self, active):
        if not self.available:
            return
        with self._lock:
            try:
                if active:
                    self._in3.on()
                    self._in4.off()
                    self._enb.value = WING_DUTY
                else:
                    self._in3.off()
                    self._in4.off()
                    self._enb.value = 0
            except Exception as exc:  # pragma: no cover
                self.error = str(exc)

    def set_spotlight(self, intensity):
        try:
            level = max(0.0, min(100.0, float(intensity))) / 100.0
        except Exception:
            level = 0.0
        if not self.available:
            return
        with self._lock:
            try:
                self._led.value = level
            except Exception as exc:  # pragma: no cover
                self.error = str(exc)

    def set_spotlight_angles(self, pan, tilt):
        pan = max(45, min(135, float(pan)))
        tilt = max(45, min(135, float(tilt)))
        if not self.available:
            return
        with self._lock:
            try:
                if self._changed("pan", round(pan, 1)):
                    self._pan.angle = pan
                if self._changed("tilt", round(tilt, 1)):
                    self._tilt.angle = tilt
            except Exception as exc:  # pragma: no cover
                self.error = str(exc)

    def set_stage(self, angle):
        angle = max(30, min(150, float(angle)))
        if not self.available:
            return
        with self._lock:
            try:
                if self._changed("stage", round(angle, 1)):
                    self._stage.angle = angle
            except Exception as exc:  # pragma: no cover
                self.error = str(exc)

    def close(self):
        if self.available:
            self.set_mouth("off")
            self.set_wings(False)
            self.set_spotlight(0)
        if self.available:
            self._safe_close()
        self.available = False


hardware = ParrotHardware()
