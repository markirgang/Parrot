/**
 * Gemini AI voice / vision assistant with Web Audio VU meter and VAD.
 * The microphone can be the remote browser or webcam microphone; audio can
 * play on the remote browser or on the Raspberry Pi through audio_output.js.
 */

class GeminiAIController {
    constructor(appOrchestrator) {
        this.app = appOrchestrator;
        this.apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
        this.micSensitivity = parseFloat(localStorage.getItem('MIC_SENSITIVITY')) || 100;
        this.micDevice = localStorage.getItem('MIC_DEVICE') || '';

        this.isListening = false;
        this.aiSpeaking = false;
        this.speechEndTimer = null;
        this.lastMouthState = false;

        this.audioContext = null;
        this.analyser = null;
        this.micStream = null;
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.isRecordingAudio = false;
        this.silenceStart = 0;

        this.initDOM();
        this.initSpeechOutput();
        this.autoStartMicAnalyser();
    }

    initDOM() {
        const input = document.getElementById('inputApiKeySettings');
        if (input) input.value = this.apiKey;
        const keyStatus = document.getElementById('statusApiKeySettings');
        if (keyStatus) {
            keyStatus.textContent = this.apiKey ? '✅ Key stored in this browser' : 'Not configured';
            keyStatus.style.color = this.apiKey ? 'var(--accent-green)' : 'var(--accent-orange)';
        }

        const btnSave = document.getElementById('btnSaveApiKeySettings');
        if (btnSave) {
            btnSave.addEventListener('click', () => {
                const key = (document.getElementById('inputApiKeySettings').value || '').trim();
                if (!key) return;
                this.apiKey = key;
                localStorage.setItem('GEMINI_API_KEY', key);
                if (keyStatus) {
                    keyStatus.textContent = '✅ Key stored in this browser';
                    keyStatus.style.color = 'var(--accent-green)';
                }
                this.addMessage('System', 'Gemini API key saved.');
            });
        }

        const btnClear = document.getElementById('btnResetApiKeySettings');
        if (btnClear) {
            btnClear.addEventListener('click', () => {
                this.apiKey = '';
                localStorage.removeItem('GEMINI_API_KEY');
                if (input) input.value = '';
                if (keyStatus) {
                    keyStatus.textContent = 'Not configured';
                    keyStatus.style.color = 'var(--accent-orange)';
                }
                this.addMessage('System', 'Stored Gemini API key cleared.');
            });
        }

        const btnSend = document.getElementById('btnSendChat');
        if (btnSend) {
            btnSend.addEventListener('click', () => {
                const inputEl = document.getElementById('chatInput');
                if (!inputEl) return;
                const text = inputEl.value.trim();
                if (text) {
                    inputEl.value = '';
                    this.sendPromptToGemini(text);
                }
            });
        }

        const chatInput = document.getElementById('chatInput');
        if (chatInput) {
            chatInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    const text = e.target.value.trim();
                    if (text) {
                        e.target.value = '';
                        this.sendPromptToGemini(text);
                    }
                }
            });
        }

        const btnVision = document.getElementById('btnAskVision');
        if (btnVision) {
            btnVision.addEventListener('click', () => {
                this.sendPromptToGemini('Describe what you see in front of you through your camera!');
            });
        }

        const btnMic = document.getElementById('btnMic');
        if (btnMic) {
            btnMic.addEventListener('click', () => {
                if (this.isListening) this.stopListening();
                else this.startListening();
            });
        }

        const slideSens = document.getElementById('slideMicSensitivity');
        const valSens = document.getElementById('valMicSensitivity');
        if (slideSens) {
            slideSens.value = this.micSensitivity;
            if (valSens) valSens.textContent = Math.round(this.micSensitivity) + '%';
            slideSens.addEventListener('input', (e) => {
                this.micSensitivity = parseFloat(e.target.value);
                if (valSens) valSens.textContent = Math.round(this.micSensitivity) + '%';
                localStorage.setItem('MIC_SENSITIVITY', this.micSensitivity);

                const settingsSlider = document.getElementById('slideMicGainSettings');
                if (settingsSlider) settingsSlider.value = this.micSensitivity;
                const settingsVal = document.getElementById('valMicGainSettings');
                if (settingsVal) settingsVal.textContent = Math.round(this.micSensitivity) + '%';
            });
        }

        this.populateMicDevices();
    }

    setMicDevice(deviceId) {
        this.micDevice = deviceId || '';
        localStorage.setItem('MIC_DEVICE', this.micDevice);
        if (this.isListening) {
            this.stopMicStream();
            this.startMicAudioAnalyser(true);
        }
    }

    async populateMicDevices() {
        const select = document.getElementById('selectMicDevice');
        if (!select || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const inputs = devices.filter((d) => d.kind === 'audioinput');
            const saved = this.micDevice || select.dataset.saved || '';
            select.innerHTML = '<option value="">Browser default microphone</option>';
            inputs.forEach((device, index) => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || ('Microphone ' + (index + 1));
                if (device.deviceId === saved) option.selected = true;
                select.appendChild(option);
            });
            if (saved) this.micDevice = saved;
        } catch (e) {
            // Device labels require permission; the analyser request unlocks them.
        }
    }

    autoStartMicAnalyser() {
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            this.startMicAudioAnalyser(false);
        }
    }

    startListening() {
        this.isListening = true;
        this.updateMicUI(true);
        this.startMicAudioAnalyser(true);
    }

    stopListening() {
        this.isListening = false;
        this.isRecordingAudio = false;
        this.updateMicUI(false);
        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            try { this.mediaRecorder.stop(); } catch (e) {}
        }
    }

    updateMicUI(active) {
        const btn = document.getElementById('btnMic');
        const status = document.getElementById('micStatusText');
        if (btn) {
            btn.textContent = active ? '🔴 Stop Mic VAD' : '🎙️ Start Mic VAD';
            btn.style.background = active
                ? 'linear-gradient(135deg, var(--accent-red), var(--accent-orange))'
                : 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))';
        }
        if (status) {
            status.textContent = active
                ? 'Status: Listening for speech...'
                : 'Status: Click "Start Mic VAD" to listen.';
        }
    }

    stopMicStream() {
        if (this.micStream) {
            try { this.micStream.getTracks().forEach((t) => t.stop()); } catch (e) {}
            this.micStream = null;
        }
    }

    startMicAudioAnalyser(enableRecording) {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
        this.stopMicStream();

        const constraints = { audio: this.micDevice ? { deviceId: { exact: this.micDevice } } : true };
        navigator.mediaDevices.getUserMedia(constraints)
            .then((stream) => {
                this.micStream = stream;
                if (!this.audioContext) {
                    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
                }
                if (this.audioContext.state === 'suspended') this.audioContext.resume();

                const source = this.audioContext.createMediaStreamSource(stream);
                this.analyser = this.audioContext.createAnalyser();
                this.analyser.fftSize = 256;
                source.connect(this.analyser);

                this.populateMicDevices();
                this.startVULoop(enableRecording, stream);
            })
            .catch((err) => {
                console.warn('Microphone access unavailable:', err);
                const status = document.getElementById('micStatusText');
                if (status) status.textContent = 'Status: Microphone not accessible. Check browser permissions.';
            });
    }

    startVULoop(enableRecording, stream) {
        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        const vuBar = document.getElementById('micVuBar');
        const vuVal = document.getElementById('micVuLevelVal');

        const updateVU = () => {
            if (!this.analyser) return;
            this.analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
            const average = sum / dataArray.length;
            const scaledVol = Math.min(100, Math.round((average / 128.0) * (this.micSensitivity / 100.0) * 100));

            if (vuBar) vuBar.style.width = scaledVol + '%';
            if (vuVal) vuVal.textContent = scaledVol + '%';

            if (enableRecording && this.isListening && !this.aiSpeaking) {
                if (scaledVol > 18) {
                    if (!this.isRecordingAudio) this.startAudioChunkRecording(stream);
                    this.silenceStart = 0;
                } else if (this.isRecordingAudio) {
                    if (!this.silenceStart) this.silenceStart = performance.now();
                    if (performance.now() - this.silenceStart > 1200) this.stopAndSendAudioChunk();
                }
            }

            requestAnimationFrame(updateVU);
        };

        updateVU();
    }

    startAudioChunkRecording(stream) {
        this.isRecordingAudio = true;
        this.audioChunks = [];
        try {
            this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        } catch (e) {
            this.mediaRecorder = new MediaRecorder(stream);
        }
        this.mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) this.audioChunks.push(e.data);
        };
        this.mediaRecorder.start(100);
        const status = document.getElementById('micStatusText');
        if (status) status.textContent = 'Status: 🎙️ Listening...';
    }

    stopAndSendAudioChunk() {
        this.isRecordingAudio = false;
        if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') return;

        this.mediaRecorder.onstop = () => {
            const blob = new Blob(this.audioChunks, { type: this.mediaRecorder.mimeType || 'audio/webm' });
            if (blob.size > 2000) this.sendVoiceBlobToGemini(blob, this.mediaRecorder.mimeType || 'audio/webm');
        };
        this.mediaRecorder.stop();
    }

    sendVoiceBlobToGemini(audioBlob, mimeType) {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64Audio = reader.result.split(',')[1];
            fetch('/api/gemini/voice', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    audio_b64: base64Audio,
                    mime_type: mimeType,
                    api_key: this.apiKey,
                    include_vision: true
                })
            })
                .then((res) => res.json())
                .then((data) => {
                    const reply = data.text || 'No response from Gemini.';
                    this.addMessage('You (Voice)', '🎤 spoken request');
                    this.addMessage('Coco', reply);
                    this.speak(reply);
                    if (data.action) this.executeAIAction(data.action);
                    const status = document.getElementById('micStatusText');
                    if (status && this.isListening) status.textContent = 'Status: Voice processed, listening...';
                })
                .catch((err) => {
                    this.addMessage('Error', 'Failed to transcribe voice audio.');
                    console.error(err);
                });
        };
        reader.readAsDataURL(audioBlob);
    }

    initSpeechOutput() {
        this.synth = window.speechSynthesis;
        this.audioPlayer = new Audio();
        this.audioPlayer.crossOrigin = 'anonymous';
        this.audioPlayer.volume = 1.0;

        let speakerCtx = null;
        let speakerAnalyser = null;

        const setupAnalyser = () => {
            if (speakerCtx) return;
            try {
                speakerCtx = new (window.AudioContext || window.webkitAudioContext)();
                const source = speakerCtx.createMediaElementSource(this.audioPlayer);
                speakerAnalyser = speakerCtx.createAnalyser();
                speakerAnalyser.fftSize = 128;
                source.connect(speakerAnalyser);
                speakerAnalyser.connect(speakerCtx.destination);
            } catch (e) {
                console.warn('Speaker analyser unavailable:', e);
            }
        };

        const data = new Uint8Array(64);
        const monitor = () => {
            if (this.aiSpeaking) {
                let audible = false;

                if (speakerAnalyser && this.audioPlayer && !this.audioPlayer.paused) {
                    speakerAnalyser.getByteFrequencyData(data);
                    let sum = 0;
                    for (let i = 0; i < data.length; i++) sum += data[i];
                    audible = (sum / data.length) > 3;
                } else {
                    // Local Pi playback or speech synthesis: pulse the beak.
                    audible = Math.sin(performance.now() * 0.019) > 0;
                }

                if (audible !== this.lastMouthState) {
                    this.lastMouthState = audible;
                    if (this.app && this.app.setMouthEnergized) this.app.setMouthEnergized(audible);
                }
            } else if (this.lastMouthState) {
                this.lastMouthState = false;
                if (this.app && this.app.setMouthEnergized) this.app.setMouthEnergized(false);
            }
            requestAnimationFrame(monitor);
        };

        this.audioPlayer.onplay = () => {
            setupAnalyser();
            if (speakerCtx && speakerCtx.state === 'suspended') speakerCtx.resume();
        };
        this.audioPlayer.onended = () => this.endSpeaking();
        this.audioPlayer.onerror = () => this.endSpeaking();

        monitor();
    }

    beginSpeaking(estimatedMs) {
        this.aiSpeaking = true;
        if (this.app && this.app.setTalkActive) this.app.setTalkActive(true);
        clearTimeout(this.speechEndTimer);
        if (estimatedMs) {
            this.speechEndTimer = setTimeout(() => this.endSpeaking(), estimatedMs);
        }
    }

    endSpeaking() {
        this.aiSpeaking = false;
        clearTimeout(this.speechEndTimer);
        this.speechEndTimer = null;
        if (this.app) {
            if (this.app.setMouthEnergized) this.app.setMouthEnergized(false);
            if (this.app.setTalkActive) this.app.setTalkActive(false);
        }
    }

    speak(text) {
        if (!text) return;
        const cleanText = text.replace(/\*[^*]*\*/g, '').trim();
        if (!cleanText) return;

        const voiceSelect = document.getElementById('selectVoice');
        const voice = voiceSelect ? voiceSelect.value : 'ai_female_us';
        const estimated = Math.max(2200, cleanText.length * 75);

        const target = (window.AudioOutputDevices && AudioOutputDevices.getTarget) ? AudioOutputDevices.getTarget() : '';
        const isLocal = typeof target === 'string' && target.indexOf('local:') === 0;

        if (isLocal) {
            this.audioPlayer.src = '/api/tts/speak?text=' + encodeURIComponent(cleanText) + '&voice=' + encodeURIComponent(voice);
            this.beginSpeaking(estimated);
            this.audioPlayer.play().catch(() => this.speakWithSynthesis(cleanText));
            return;
        }

        this.audioPlayer.src = '/api/tts/speak?text=' + encodeURIComponent(cleanText) + '&voice=' + encodeURIComponent(voice);
        this.beginSpeaking(estimated + 4000);
        this.audioPlayer.play().catch(() => this.speakWithSynthesis(cleanText));
    }

    speakWithSynthesis(text) {
        if (!this.synth) {
            this.endSpeaking();
            return;
        }
        this.synth.cancel();
        if (this.synth.paused) this.synth.resume();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.onstart = () => this.beginSpeaking(Math.max(2200, text.length * 75));
        utterance.onend = () => this.endSpeaking();
        utterance.onerror = () => this.endSpeaking();
        this.synth.speak(utterance);
    }

    addMessage(sender, text) {
        const history = document.getElementById('chatHistory');
        if (!history) return;
        const row = document.createElement('div');
        row.className = 'msg ' + String(sender).toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const strong = document.createElement('strong');
        strong.textContent = sender + ': ';
        row.appendChild(strong);
        row.appendChild(document.createTextNode(text));
        history.appendChild(row);
        history.scrollTop = history.scrollHeight;
    }

    sendPromptToGemini(promptText) {
        this.addMessage('You', promptText);
        fetch('/api/gemini/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                prompt: promptText,
                api_key: this.apiKey,
                include_vision: true
            })
        })
            .then((res) => res.json())
            .then((data) => {
                const reply = data.text || 'No response from Gemini.';
                this.addMessage('Coco', reply);
                this.speak(reply);
                if (data.action) this.executeAIAction(data.action);
            })
            .catch((err) => {
                this.addMessage('Error', 'Failed to reach the Gemini backend.');
                console.error(err);
            });
    }

    executeAIAction(action) {
        if (!action || !action.name) return;
        const args = action.args || {};
        const app = this.app || {};

        if (action.name === 'parrot_dance') {
            if (app.setMode) app.setMode(args.enabled === false ? 'idle' : 'dancing');
        } else if (action.name === 'parrot_talk') {
            if (app.setMode) app.setMode(args.enabled === false ? 'idle' : 'talking');
        } else if (action.name === 'parrot_sing') {
            if (app.setMode) app.setMode('talking');
        } else if (action.name === 'parrot_spotlight') {
            if (app.setAutomation) app.setAutomation(false);
            if (app.setSpotlight) {
                app.setSpotlight({
                    pan: args.pan !== undefined ? Number(args.pan) : undefined,
                    tilt: args.tilt !== undefined ? Number(args.tilt) : undefined,
                    intensity: args.intensity !== undefined ? Number(args.intensity) : undefined,
                    mode: 'manual',
                    manual: true
                });
            }
        } else if (action.name === 'parrot_stage') {
            if (app.setAutomation) app.setAutomation(false);
            if (app.setStage) app.setStage({ angle: Number(args.angle || 90), mode: 'manual', manual: true });
        }
    }
}
