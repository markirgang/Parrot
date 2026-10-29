/**
 * Main orchestrator for the Gemmy AI Parrot stage.
 * Connects the L298N motor controls, spotlight servos, stage servo,
 * 3D renderer, Gemini voice assistant and music sync engine.
 */

document.addEventListener('DOMContentLoaded', () => {
    let renderer = null;
    try {
        renderer = new Parrot3DRenderer('viewport3d');
    } catch (err) {
        console.warn('3D renderer unavailable:', err);
        const host = document.getElementById('viewport3d');
        if (host) {
            host.innerHTML = '<div style="display:flex;height:100%;align-items:center;justify-content:center;color:var(--text-muted);font-size:0.85rem;text-align:center;padding:20px;">3D preview unavailable (WebGL required).<br>All hardware controls still work.</div>';
        }
    }

    const parrotState = {
        mode: 'idle',
        automation: true,
        mouth_channel1: 'off',
        eyes_blinking: false,
        wings_channel2: false,
        spotlight: { pan: 90, tilt: 90, intensity: 0, mode: 'idle' },
        stage: { angle: 90, mode: 'idle' },
        beat_energy: 0,
        hardware_available: false,
    };

    let speakerVolume = 100;
    let volumeSaveTimer = null;

    function postJSON(url, payload) {
        return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload || {})
        }).then((res) => res.json()).catch(() => ({}));
    }

    const appAPI = {
        getState: () => parrotState,

        setMode: (mode) => {
            parrotState.mode = mode;
            if (mode === 'dancing') parrotState.wings_channel2 = true;
            refreshModeUI();
            return postJSON('/api/parrot/mode', { mode }).then((data) => {
                if (data.state) applyServerState(data.state);
                return data;
            });
        },

        setMusicPerformanceActive: (active) => {
            appAPI.setMode(active ? 'dancing' : 'idle');
        },

        setTalkActive: (active) => {
            appAPI.setMode(active ? 'talking' : 'idle');
        },

        setMouthEnergized: (energized) => {
            const mode = energized ? 'open' : 'off';
            if (parrotState.mouth_channel1 === mode) return;
            parrotState.mouth_channel1 = mode;
            updateMouthUI();
            postJSON('/api/parrot/control', { mouth: mode });
        },

        setMouthMode: (mode) => {
            parrotState.mouth_channel1 = mode;
            updateMouthUI();
            postJSON('/api/parrot/control', { mouth: mode });
        },

        setWings: (active) => {
            parrotState.wings_channel2 = !!active;
            updateWingsUI();
            postJSON('/api/parrot/control', { wings: !!active });
        },

        blinkEyes: () => {
            parrotState.eyes_blinking = true;
            postJSON('/api/parrot/control', { eyes_blink: true });
            setTimeout(() => { parrotState.eyes_blinking = false; }, 250);
        },

        setSpotlight: (opts) => {
            const payload = Object.assign({}, opts);
            if (opts.manual) payload.manual = true;
            return postJSON('/api/parrot/spotlight', payload).then((data) => {
                if (data.state) applyServerState(data.state);
                return data;
            });
        },

        setStage: (opts) => {
            const payload = Object.assign({}, opts);
            if (opts.manual) payload.manual = true;
            return postJSON('/api/parrot/stage', payload).then((data) => {
                if (data.state) applyServerState(data.state);
                return data;
            });
        },

        setAutomation: (enabled) => {
            parrotState.automation = !!enabled;
            refreshModeUI();
            return postJSON('/api/parrot/control', { automation: !!enabled });
        },

        setVolume: (value) => {
            speakerVolume = Math.max(0, Math.min(100, parseInt(value, 10) || 0));
            const player = document.getElementById('danceAudioPlayer');
            if (player) player.volume = speakerVolume / 100;
            const valEl = document.getElementById('valVolumeText');
            if (valEl) valEl.textContent = speakerVolume + '%';
            const settingsSlider = document.getElementById('slideSpeakerVolSettings');
            if (settingsSlider) settingsSlider.value = speakerVolume;
            const settingsVal = document.getElementById('valSpeakerVolSettings');
            if (settingsVal) settingsVal.textContent = speakerVolume + '%';

            clearTimeout(volumeSaveTimer);
            volumeSaveTimer = setTimeout(() => {
                postJSON('/api/hardware/config', { speaker_volume: speakerVolume });
            }, 400);
        }
    };

    window.ParrotApp = appAPI;

    const geminiController = new GeminiAIController(appAPI);
    const performanceEngine = new ParrotPerformanceEngine(appAPI);

    setupTopNavTabs();
    setupRightPanelTabs();
    setupMotorControls(appAPI);
    setupSpotlightStageControls(appAPI);
    setupPresets(appAPI);
    setupCamera(appAPI);
    setupHardwareSettings(appAPI);
    setupExport();

    requestAnimationFrame(animate);

    function animate() {
        requestAnimationFrame(animate);
        if (renderer && renderer.updatePose) {
            renderer.updatePose(null, parrotState);
            renderer.render();
        }
    }

    function refreshModeUI() {
        const modeEl = document.getElementById('statusMode');
        if (modeEl) modeEl.textContent = parrotState.mode.toUpperCase();
        const autoEl = document.getElementById('statusAutomation');
        if (autoEl) {
            autoEl.textContent = parrotState.automation ? 'ON' : 'MANUAL';
            autoEl.style.color = parrotState.automation ? 'var(--accent-green)' : 'var(--accent-orange)';
        }
        const toggle = document.getElementById('toggleAutomation');
        if (toggle) toggle.checked = parrotState.automation;
    }

    function updateMouthUI() {
        const el = document.getElementById('statusMouth');
        if (!el) return;
        if (parrotState.mouth_channel1 === 'open') {
            el.textContent = 'OPEN (FORWARD)';
            el.style.color = 'var(--accent-green)';
        } else if (parrotState.eyes_blinking) {
            el.textContent = 'EYES BLINK (REVERSE)';
            el.style.color = 'var(--accent-purple)';
        } else {
            el.textContent = 'CLOSED';
            el.style.color = 'var(--text-muted)';
        }
    }

    function updateWingsUI() {
        const el = document.getElementById('statusWings');
        if (!el) return;
        el.textContent = parrotState.wings_channel2 ? 'FLAPPING' : 'STILL';
        el.style.color = parrotState.wings_channel2 ? 'var(--accent-orange)' : 'var(--text-muted)';
        const btn = document.getElementById('btnWingsToggle');
        if (btn) {
            btn.textContent = parrotState.wings_channel2 ? '🪽 Stop Wings' : '🪽 Flap Wings';
        }
    }

    function setSliderValue(id, value, suffix) {
        const slider = document.getElementById(id);
        if (slider && document.activeElement !== slider) slider.value = value;
        const map = {
            slideSpotPan: 'valSpotPan',
            slideSpotTilt: 'valSpotTilt',
            slideSpotIntensity: 'valSpotIntensity',
            slideStageAngle: 'valStageAngle'
        };
        const label = document.getElementById(map[id]);
        if (label) label.textContent = Math.round(value) + (suffix || '');
    }

    function applyServerState(state) {
        if (!state) return;
        Object.assign(parrotState, state);
        if (state.spotlight) parrotState.spotlight = state.spotlight;
        if (state.stage) parrotState.stage = state.stage;

        const modeEl = document.getElementById('statusMode');
        if (modeEl) modeEl.textContent = (parrotState.mode || 'idle').toUpperCase();
        const autoEl = document.getElementById('statusAutomation');
        if (autoEl) {
            autoEl.textContent = parrotState.automation ? 'ON' : 'MANUAL';
            autoEl.style.color = parrotState.automation ? 'var(--accent-green)' : 'var(--accent-orange)';
        }
        const toggle = document.getElementById('toggleAutomation');
        if (toggle && document.activeElement !== toggle) toggle.checked = !!parrotState.automation;

        const beatEl = document.getElementById('statusBeat');
        if (beatEl) beatEl.textContent = Math.round(parrotState.beat_energy || 0) + '%';

        const hwEl = document.getElementById('statusHardware');
        if (hwEl) {
            hwEl.textContent = parrotState.hardware_available ? 'GPIO ONLINE' : 'SIMULATION';
            hwEl.style.color = parrotState.hardware_available ? 'var(--accent-green)' : 'var(--accent-orange)';
        }

        updateMouthUI();
        updateWingsUI();

        const spotEl = document.getElementById('statusSpotlight');
        if (spotEl) spotEl.textContent = (parrotState.spotlight.mode || 'idle').toUpperCase();
        const stageEl = document.getElementById('statusStage');
        if (stageEl) stageEl.textContent = (parrotState.stage.mode || 'idle').toUpperCase();

        const beatBar = document.getElementById('danceBeatEnergyBar');
        if (beatBar) beatBar.style.width = Math.min(100, parrotState.beat_energy || 0) + '%';
        const beatVal = document.getElementById('danceBeatEnergyVal');
        if (beatVal) beatVal.textContent = Math.round(parrotState.beat_energy || 0) + '%';

        if (parrotState.automation) {
            setSliderValue('slideSpotPan', parrotState.spotlight.pan, '°');
            setSliderValue('slideSpotTilt', parrotState.spotlight.tilt, '°');
            setSliderValue('slideSpotIntensity', parrotState.spotlight.intensity, '%');
            setSliderValue('slideStageAngle', parrotState.stage.angle, '°');
        }
    }

    function pollState() {
        fetch('/api/parrot/state')
            .then((res) => res.json())
            .then(applyServerState)
            .catch(() => {});
    }

    pollState();
    setInterval(pollState, 350);

    function setupMotorControls(api) {
        const btnOpen = document.getElementById('btnMouthOpen');
        const btnClose = document.getElementById('btnMouthClose');
        const btnBlink = document.getElementById('btnMouthBlink');
        const btnWings = document.getElementById('btnWingsToggle');

        if (btnOpen) btnOpen.addEventListener('click', () => api.setMouthMode('open'));
        if (btnClose) btnClose.addEventListener('click', () => api.setMouthMode('off'));
        if (btnBlink) btnBlink.addEventListener('click', () => api.blinkEyes());
        if (btnWings) {
            btnWings.addEventListener('click', () => {
                api.setWings(!parrotState.wings_channel2);
            });
        }
    }

    function setupSpotlightStageControls(api) {
        document.querySelectorAll('[data-spot-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.spotMode;
                if (mode === 'flash') {
                    api.setMode('dancing');
                } else if (mode === 'breathe') {
                    api.setMode('talking');
                } else if (mode === 'idle') {
                    api.setMode('idle');
                } else if (mode === 'solid') {
                    api.setAutomation(false);
                    api.setSpotlight({ mode: 'solid', intensity: 100, manual: true });
                }
            });
        });

        document.querySelectorAll('[data-stage-mode]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const mode = btn.dataset.stageMode;
                if (mode === 'dance') {
                    api.setMode('dancing');
                } else if (mode === 'talk') {
                    api.setMode('talking');
                } else if (mode === 'idle') {
                    api.setMode('idle');
                } else if (mode === 'manual') {
                    api.setAutomation(false);
                    api.setStage({ angle: parrotState.stage.angle, mode: 'manual', manual: true });
                }
            });
        });

        const pan = document.getElementById('slideSpotPan');
        const tilt = document.getElementById('slideSpotTilt');
        const intensity = document.getElementById('slideSpotIntensity');
        const stage = document.getElementById('slideStageAngle');

        const sendSpot = (manual) => {
            api.setAutomation(false);
            api.setSpotlight({
                pan: parseFloat(pan.value),
                tilt: parseFloat(tilt.value),
                intensity: parseFloat(intensity.value),
                mode: 'manual',
                manual: manual
            });
        };

        if (pan) {
            pan.addEventListener('input', () => {
                setSliderValue('slideSpotPan', pan.value, '°');
                sendSpot(false);
            });
            pan.addEventListener('change', () => sendSpot(true));
        }
        if (tilt) {
            tilt.addEventListener('input', () => {
                setSliderValue('slideSpotTilt', tilt.value, '°');
                sendSpot(false);
            });
            tilt.addEventListener('change', () => sendSpot(true));
        }
        if (intensity) {
            intensity.addEventListener('input', () => {
                setSliderValue('slideSpotIntensity', intensity.value, '%');
                sendSpot(false);
            });
            intensity.addEventListener('change', () => sendSpot(true));
        }
        if (stage) {
            stage.addEventListener('input', () => {
                setSliderValue('slideStageAngle', stage.value, '°');
                api.setAutomation(false);
                api.setStage({ angle: parseFloat(stage.value), mode: 'manual', manual: false });
            });
            stage.addEventListener('change', () => {
                api.setStage({ angle: parseFloat(stage.value), mode: 'manual', manual: true });
            });
        }

        const toggle = document.getElementById('toggleAutomation');
        if (toggle) {
            toggle.addEventListener('change', () => api.setAutomation(toggle.checked));
        }
    }

    function setupPresets(api) {
        const talk = document.getElementById('btnPresetTalk');
        const dance = document.getElementById('btnPresetDance');
        const idle = document.getElementById('btnPresetIdle');
        const beak = document.getElementById('btnPresetBeak');

        if (talk) talk.addEventListener('click', () => api.setMode('talking'));
        if (dance) dance.addEventListener('click', () => {
            const musicTab = document.getElementById('tabMusicPlayer');
            if (musicTab) musicTab.click();
            api.setMode('dancing');
            if (performanceEngine && performanceEngine.playlist && performanceEngine.playlist.length > 0) {
                performanceEngine.selectAndPlayTrack(performanceEngine.playlist[0].name);
            }
        });
        if (idle) idle.addEventListener('click', () => api.setMode('idle'));
        if (beak) {
            beak.addEventListener('click', () => {
                api.setMode('idle');
                api.setWings(false);
                api.setMouthMode('open');
                setTimeout(() => api.setMouthMode('off'), 700);
                setTimeout(() => api.blinkEyes(), 900);
                setTimeout(() => api.setMouthMode('open'), 1200);
                setTimeout(() => api.setMouthMode('off'), 1800);
            });
        }
    }

    function setupCamera(api) {
        const select = document.getElementById('selectCamera');
        const btn = document.getElementById('btnSwitchCamera');
        if (select && btn) {
            btn.addEventListener('click', () => {
                postJSON('/api/camera/select', { source: select.value }).then(() => {
                    const feed = document.getElementById('camFeed');
                    if (feed) feed.src = '/api/camera/frame?t=' + Date.now();
                });
            });
        }

        const feed = document.getElementById('camFeed');
        if (feed) setInterval(() => { feed.src = '/api/camera/frame?t=' + Date.now(); }, 700);
    }

    function setupExport() {
        const btn = document.getElementById('btnExportScript');
        if (!btn) return;
        btn.addEventListener('click', () => {
            fetch('/api/export-python', { method: 'POST', body: JSON.stringify({}) })
                .then((res) => res.blob())
                .then((blob) => {
                    const url = window.URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = 'parrot_stage_control.py';
                    document.body.appendChild(link);
                    link.click();
                    link.remove();
                    window.URL.revokeObjectURL(url);
                });
        });
    }

    function setupHardwareSettings(api) {
        const selectCam = document.getElementById('selectCameraSettings');
        const selectMic = document.getElementById('selectMicSettings');
        const selectMicDevice = document.getElementById('selectMicDevice');
        const selectSpk = document.getElementById('selectSpeakerSettings');
        const slideMicGain = document.getElementById('slideMicGainSettings');
        const slideSpkVol = document.getElementById('slideSpeakerVolSettings');
        const statusEl = document.getElementById('statusHardwareSettings');

        fetch('/api/hardware/config')
            .then((res) => res.json())
            .then((data) => {
                if (selectCam && data.camera_source) selectCam.value = data.camera_source;
                if (selectMic && data.mic_source) selectMic.value = data.mic_source;
                if (selectSpk && data.speaker_source) selectSpk.value = data.speaker_source;
                if (slideMicGain && data.mic_sensitivity !== undefined) {
                    slideMicGain.value = data.mic_sensitivity;
                    const el = document.getElementById('valMicGainSettings');
                    if (el) el.textContent = data.mic_sensitivity + '%';
                }
                if (slideSpkVol && data.speaker_volume !== undefined) {
                    slideSpkVol.value = data.speaker_volume;
                    const el = document.getElementById('valSpeakerVolSettings');
                    if (el) el.textContent = data.speaker_volume + '%';
                    speakerVolume = data.speaker_volume;
                    const player = document.getElementById('danceAudioPlayer');
                    if (player) player.volume = speakerVolume / 100;
                    const mainVol = document.getElementById('volumeAudioSlider');
                    if (mainVol) mainVol.value = speakerVolume;
                    const mainVal = document.getElementById('valVolumeText');
                    if (mainVal) mainVal.textContent = speakerVolume + '%';
                }
                if (selectMicDevice && data.mic_device) {
                    selectMicDevice.dataset.saved = data.mic_device;
                }
                if (data.automation !== undefined) {
                    parrotState.automation = !!data.automation;
                    refreshModeUI();
                }
            })
            .catch(() => {});

        const save = (payload, label) => {
            postJSON('/api/hardware/config', payload).then(() => {
                if (statusEl) {
                    statusEl.textContent = '✅ Saved ' + label;
                    statusEl.style.color = 'var(--accent-green)';
                }
            });
        };

        const btnSaveCam = document.getElementById('btnSaveCameraSettings');
        if (btnSaveCam && selectCam) btnSaveCam.addEventListener('click', () => {
            save({ camera_source: selectCam.value }, 'camera');
            const main = document.getElementById('selectCamera');
            if (main) main.value = selectCam.value;
        });

        const btnSaveMic = document.getElementById('btnSaveMicSettings');
        if (btnSaveMic) btnSaveMic.addEventListener('click', () => {
            save({
                mic_source: selectMic ? selectMic.value : 'browser',
                mic_device: selectMicDevice ? selectMicDevice.value : '',
                mic_sensitivity: slideMicGain ? parseInt(slideMicGain.value, 10) : 100,
                mic_gain: slideMicGain ? parseInt(slideMicGain.value, 10) : 100
            }, 'microphone');
            localStorage.setItem('MIC_SENSITIVITY', slideMicGain ? slideMicGain.value : 100);
            const micSlide = document.getElementById('slideMicSensitivity');
            if (micSlide && slideMicGain) micSlide.value = slideMicGain.value;
            const micVal = document.getElementById('valMicSensitivity');
            if (micVal && slideMicGain) micVal.textContent = slideMicGain.value + '%';
            if (geminiController) geminiController.setMicDevice(selectMicDevice ? selectMicDevice.value : '');
        });

        const btnSaveSpk = document.getElementById('btnSaveSpeakerSettings');
        if (btnSaveSpk && selectSpk) btnSaveSpk.addEventListener('click', () => {
            const value = selectSpk.value.indexOf('local:') === 0 ? 'default' : 'browser';
            save({
                speaker_source: value,
                speaker_volume: slideSpkVol ? parseInt(slideSpkVol.value, 10) : speakerVolume
            }, 'speaker');
            if (slideSpkVol) api.setVolume(slideSpkVol.value);
        });

        if (slideMicGain) {
            slideMicGain.addEventListener('input', (e) => {
                const el = document.getElementById('valMicGainSettings');
                if (el) el.textContent = e.target.value + '%';
                const micSlide = document.getElementById('slideMicSensitivity');
                if (micSlide) micSlide.value = e.target.value;
                const micVal = document.getElementById('valMicSensitivity');
                if (micVal) micVal.textContent = e.target.value + '%';
                localStorage.setItem('MIC_SENSITIVITY', e.target.value);
            });
        }

        if (slideSpkVol) {
            slideSpkVol.addEventListener('input', (e) => {
                const el = document.getElementById('valSpeakerVolSettings');
                if (el) el.textContent = e.target.value + '%';
                api.setVolume(e.target.value);
            });
        }

        const refresh = document.getElementById('btnRefreshMics');
        if (refresh && geminiController) {
            refresh.addEventListener('click', () => geminiController.populateMicDevices());
        }
        if (selectMicDevice && geminiController) {
            selectMicDevice.addEventListener('change', () => {
                geminiController.setMicDevice(selectMicDevice.value);
            });
        }

        fetch('/api/status')
            .then((res) => res.json())
            .then((data) => {
                const gpio = document.getElementById('gpioStatusText');
                if (!gpio) return;
                if (data.hardware_available) {
                    gpio.innerHTML = '🟢 <b style="color:var(--accent-green)">GPIO online.</b> L298N, IRLZ44N spotlight and all three servos are available on the Raspberry Pi 5.';
                } else {
                    gpio.innerHTML = '🟠 <b style="color:var(--accent-orange)">Simulation mode.</b> GPIO is not available: ' +
                        (data.hardware_error || 'unknown error') +
                        '. The UI and 3D stage still work, and the exported Python script can be run on the Pi.';
                }
                const hwEl = document.getElementById('statusHardware');
                if (hwEl) {
                    hwEl.textContent = data.hardware_available ? 'GPIO ONLINE' : 'SIMULATION';
                    hwEl.style.color = data.hardware_available ? 'var(--accent-green)' : 'var(--accent-orange)';
                }
            })
            .catch(() => {});
    }

    function setupTopNavTabs() {
        const navButtons = document.querySelectorAll('.nav-tab-btn');
        const viewScreens = document.querySelectorAll('.view-screen');
        navButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                navButtons.forEach((b) => b.classList.remove('active'));
                viewScreens.forEach((s) => s.classList.remove('active'));
                btn.classList.add('active');
                const target = document.getElementById(btn.dataset.view);
                if (target) target.classList.add('active');
            });
        });
    }

    function setupRightPanelTabs() {
        const tabGemini = document.getElementById('tabGeminiAI');
        const tabMusic = document.getElementById('tabMusicPlayer');
        const sectionGemini = document.getElementById('sectionGeminiAI');
        const sectionMusic = document.getElementById('sectionMusicPlayer');

        if (tabGemini && tabMusic && sectionGemini && sectionMusic) {
            tabGemini.addEventListener('click', () => {
                tabGemini.classList.add('active');
                tabMusic.classList.remove('active');
                sectionGemini.style.display = 'block';
                sectionMusic.style.display = 'none';
            });
            tabMusic.addEventListener('click', () => {
                tabMusic.classList.add('active');
                tabGemini.classList.remove('active');
                sectionMusic.style.display = 'block';
                sectionGemini.style.display = 'none';
            });
        }
    }

    const resetCam = document.getElementById('btnResetCam');
    if (resetCam && renderer && renderer.camera) {
        resetCam.addEventListener('click', () => {
            renderer.camera.position.set(0, 170, 470);
            renderer.controls.target.set(0, 100, 0);
        });
    }

    api_setVolumeInitial();
    function api_setVolumeInitial() {
        const slider = document.getElementById('volumeAudioSlider');
        if (slider) {
            slider.addEventListener('input', (e) => appAPI.setVolume(e.target.value));
            appAPI.setVolume(slider.value || 100);
        }
    }
});
