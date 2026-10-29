/**
 * MP3 import and dance synchroniser for the Gemmy AI Parrot.
 *
 * Real-time Web Audio analysis pulses the beak, flaps the wings, reports beat
 * energy to the server (which sweeps the stage and flashes the spotlight) and
 * works with both remote-browser and local Raspberry Pi audio output.
 */

class ParrotPerformanceEngine {
    constructor(appOrchestrator) {
        this.app = appOrchestrator;
        this.syncEnabled = true;
        this.currentTrack = null;
        this.playlist = [];
        this.sensitivity = 1.0;
        this.isLooping = false;
        this.playing = false;
        this.localPlaying = false;
        this.localEndTimer = null;

        this.audioCtx = null;
        this.analyser = null;
        this.sourceNode = null;
        this.audioPlayer = document.getElementById('danceAudioPlayer');

        this.loopRunning = false;
        this.lastBeatSent = 0;
        this.lastMouthState = false;

        this.initUI();
        this.loadPlaylist();
    }

    isLocalOutput() {
        if (!window.AudioOutputDevices || !AudioOutputDevices.getTarget) return false;
        const target = AudioOutputDevices.getTarget() || '';
        if (typeof target !== 'string' || !target) return false;
        return target.indexOf('local:') === 0 ||
            ['default', 'usb_audio', 'usb_speaker', 'aux_35mm', 'audio_jack',
             'hdmi', 'hdmi_audio', 'bluetooth_speaker', 'emeet_pixy_speaker',
             'local'].indexOf(target) !== -1;
    }

    initUI() {
        const fileInput = document.getElementById('mp3FileInput');
        const dropZone = document.getElementById('dropZone');

        if (dropZone && fileInput) {
            dropZone.addEventListener('click', () => fileInput.click());
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('dragover');
            });
            dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
            dropZone.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('dragover');
                if (e.dataTransfer.files && e.dataTransfer.files.length) {
                    this.handleFileImportList(e.dataTransfer.files);
                }
            });
        }

        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length) this.handleFileImportList(e.target.files);
                e.target.value = '';
            });
        }

        const btnUrl = document.getElementById('btnDownloadMp3Url');
        const inputUrl = document.getElementById('inputMp3Url');
        const statusUrl = document.getElementById('statusDownloadMp3Url');
        if (btnUrl && inputUrl) {
            btnUrl.addEventListener('click', () => {
                const url = inputUrl.value.trim();
                if (!url) return;
                if (statusUrl) {
                    statusUrl.style.display = 'block';
                    statusUrl.style.color = 'var(--accent-cyan)';
                    statusUrl.textContent = '⏳ Downloading song...';
                }
                fetch('/api/audio/download_url', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url })
                })
                    .then((res) => res.json())
                    .then((data) => {
                        if (data.success) {
                            inputUrl.value = '';
                            if (statusUrl) {
                                statusUrl.style.color = 'var(--accent-green)';
                                statusUrl.textContent = '✅ Downloaded ' + data.filename;
                            }
                            this.loadPlaylist(() => this.selectAndPlayTrack(data.filename));
                        } else if (statusUrl) {
                            statusUrl.style.color = 'var(--accent-red)';
                            statusUrl.textContent = '❌ ' + (data.error || 'Download failed');
                        }
                    })
                    .catch((err) => {
                        if (statusUrl) {
                            statusUrl.style.color = 'var(--accent-red)';
                            statusUrl.textContent = '❌ ' + err.message;
                        }
                    });
            });
        }

        const btnPlay = document.getElementById('btnPlayPauseNav');
        const btnStop = document.getElementById('btnStopNav');
        const btnPrev = document.getElementById('btnPrevTrack');
        const btnNext = document.getElementById('btnNextTrack');
        const btnLoop = document.getElementById('btnLoopToggle');
        const btnSync = document.getElementById('btnToggleDance');

        if (btnPlay) {
            btnPlay.addEventListener('click', () => {
                if (this.playing) this.pauseTrack();
                else if (this.currentTrack) this.playCurrent();
                else if (this.playlist.length) this.selectAndPlayTrack(this.playlist[0].name);
            });
        }

        if (btnStop) {
            btnStop.addEventListener('click', () => {
                this.stopPlayback();
            });
        }

        if (btnPrev) btnPrev.addEventListener('click', () => this.playPrevTrack());
        if (btnNext) btnNext.addEventListener('click', () => this.playNextTrack());

        if (btnLoop) {
            btnLoop.addEventListener('click', () => {
                this.isLooping = !this.isLooping;
                if (this.audioPlayer) this.audioPlayer.loop = this.isLooping;
                btnLoop.textContent = this.isLooping ? '🔁 Loop: On' : '🔁 Loop: Off';
                btnLoop.style.color = this.isLooping ? 'var(--accent-cyan)' : 'var(--text-primary)';
            });
        }

        if (btnSync) {
            btnSync.addEventListener('click', () => {
                this.syncEnabled = !this.syncEnabled;
                btnSync.textContent = this.syncEnabled ? '🎵 Audio Sync: ON' : '🎵 Audio Sync: OFF';
                btnSync.style.background = this.syncEnabled
                    ? 'linear-gradient(135deg, var(--accent-cyan), var(--accent-purple))'
                    : 'var(--panel-bg)';
                if (!this.syncEnabled) this.stopPerformance();
                else if (this.playing) this.startPerformance();
            });
        }

        const seek = document.getElementById('seekAudioSlider');
        if (seek && this.audioPlayer) {
            seek.addEventListener('change', (e) => {
                if (!this.audioPlayer.duration) return;
                this.audioPlayer.currentTime = (parseFloat(e.target.value) / 100.0) * this.audioPlayer.duration;
            });
        }

        const danceSens = document.getElementById('slideDanceSensitivity');
        const danceVal = document.getElementById('valDanceSensitivity');
        if (danceSens) {
            danceSens.addEventListener('input', (e) => {
                const value = parseInt(e.target.value, 10);
                this.sensitivity = value / 100.0;
                if (danceVal) danceVal.textContent = value + '%';
            });
        }

        if (this.audioPlayer) {
            this.audioPlayer.addEventListener('play', () => {
                this.playing = true;
                this.updatePlayPauseUI(true);
                this.startPerformance();
            });

            this.audioPlayer.addEventListener('pause', () => {
                if (this.isLocalOutput()) return;
                this.playing = false;
                this.updatePlayPauseUI(false);
                this.stopPerformance();
            });

            this.audioPlayer.addEventListener('ended', () => {
                if (this.isLocalOutput()) return;
                this.playing = false;
                this.updatePlayPauseUI(false);
                this.stopPerformance();
                if (!this.isLooping) this.playNextTrack();
            });

            this.audioPlayer.addEventListener('timeupdate', () => this.updateTimeUI());
            this.audioPlayer.addEventListener('loadedmetadata', () => {
                this.updateTimeUI();
                this.scheduleLocalEnd();
            });
        }

        const mainVolume = document.getElementById('volumeAudioSlider');
        if (mainVolume && this.audioPlayer) {
            this.audioPlayer.volume = (parseInt(mainVolume.value, 10) || 100) / 100;
        }
    }

    scheduleLocalEnd() {
        clearTimeout(this.localEndTimer);
        if (!this.localPlaying || !this.audioPlayer || !this.audioPlayer.duration) return;
        const remaining = Math.max(0, this.audioPlayer.duration - this.audioPlayer.currentTime);
        this.localEndTimer = setTimeout(() => {
            if (!this.localPlaying) return;
            this.localPlaying = false;
            this.playing = false;
            this.updatePlayPauseUI(false);
            this.stopPerformance();
            if (!this.isLooping) this.playNextTrack();
        }, remaining * 1000 + 400);
    }

    handleFileImportList(files) {
        const list = Array.from(files);
        if (!list.length) return;

        let completed = 0;
        let lastUploaded = null;

        list.forEach((file) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                fetch('/api/audio/upload', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename: file.name, data: e.target.result })
                })
                    .then((res) => res.json())
                    .then((data) => {
                        if (data.success) lastUploaded = data.filename;
                        completed += 1;
                        if (completed === list.length) {
                            this.loadPlaylist(() => {
                                if (lastUploaded) this.selectAndPlayTrack(lastUploaded);
                            });
                        }
                    })
                    .catch(() => {
                        completed += 1;
                        if (completed === list.length) this.loadPlaylist();
                    });
            };
            reader.readAsDataURL(file);
        });
    }

    loadPlaylist(callback) {
        fetch('/api/audio/list')
            .then((res) => res.json())
            .then((data) => {
                this.playlist = data.files || [];
                const container = document.getElementById('playlistContainer');
                if (container) {
                    container.innerHTML = '';
                    if (!this.playlist.length) {
                        const empty = document.createElement('div');
                        empty.style.cssText = 'color:var(--text-muted);font-size:0.8rem;text-align:center;padding:12px;';
                        empty.textContent = 'No songs imported yet. Drop an MP3 above.';
                        container.appendChild(empty);
                    } else {
                        this.playlist.forEach((file) => container.appendChild(this.buildTrackRow(file)));
                    }
                }
                if (callback) callback();
            })
            .catch((err) => console.error('Audio list error:', err));
    }

    buildTrackRow(file) {
        const row = document.createElement('div');
        row.className = 'track-item' + (this.currentTrack === file.name ? ' active' : '');

        const info = document.createElement('div');
        info.className = 'track-info';
        const name = document.createElement('div');
        name.className = 'track-name';
        name.textContent = file.name;
        const meta = document.createElement('div');
        meta.className = 'track-meta';
        meta.textContent = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
        info.appendChild(name);
        info.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'track-actions';

        const play = document.createElement('button');
        play.className = 'btn-preset primary';
        play.style.cssText = 'padding:4px 8px;font-size:0.72rem;';
        play.textContent = '🎤 Play & Dance';
        play.addEventListener('click', () => this.selectAndPlayTrack(file.name));

        const download = document.createElement('a');
        download.href = '/music/' + encodeURIComponent(file.name);
        download.download = file.name;
        download.className = 'btn-preset';
        download.style.cssText = 'padding:4px 8px;font-size:0.72rem;text-decoration:none;display:inline-flex;align-items:center;';
        download.textContent = '⬇️';

        const remove = document.createElement('button');
        remove.className = 'btn-preset';
        remove.style.cssText = 'background:var(--accent-red);color:#fff;padding:4px 8px;font-size:0.72rem;';
        remove.textContent = '🗑️';
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            this.deleteTrack(file.name);
        });

        actions.appendChild(play);
        actions.appendChild(download);
        actions.appendChild(remove);
        row.appendChild(info);
        row.appendChild(actions);
        return row;
    }

    selectAndPlayTrack(filename) {
        this.currentTrack = filename;
        const title = document.getElementById('nowPlayingTitle');
        if (title) title.textContent = '🎤 Dancing: ' + filename;

        if (this.audioPlayer) {
            this.audioPlayer.src = '/music/' + encodeURIComponent(filename);
        }
        this.loadPlaylist();
        this.playCurrent();
    }

    playCurrent() {
        if (!this.audioPlayer) return;
        this.playing = true;
        this.localPlaying = this.isLocalOutput();
        this.updatePlayPauseUI(true);
        this.startPerformance();

        this.audioPlayer.play().catch((err) => console.warn('Play error:', err));

        if (this.localPlaying) {
            this.scheduleLocalEnd();
        }
    }

    pauseTrack() {
        if (this.localPlaying || this.isLocalOutput()) {
            this.localPlaying = false;
            this.playing = false;
            clearTimeout(this.localEndTimer);
            fetch('/api/audio/stop', { method: 'POST', body: '{}' }).catch(() => {});
            if (this.audioPlayer) {
                try { this.audioPlayer.pause(); } catch (e) {}
            }
            this.updatePlayPauseUI(false);
            this.stopPerformance();
            return;
        }
        if (this.audioPlayer) this.audioPlayer.pause();
    }

    stopPlayback() {
        this.localPlaying = false;
        this.playing = false;
        clearTimeout(this.localEndTimer);
        fetch('/api/audio/stop', { method: 'POST', body: '{}' }).catch(() => {});
        if (this.audioPlayer) {
            try { this.audioPlayer.pause(); } catch (e) {}
            this.audioPlayer.currentTime = 0;
        }
        this.updatePlayPauseUI(false);
        this.stopPerformance();
        const seek = document.getElementById('seekAudioSlider');
        if (seek) seek.value = 0;
    }

    playNextTrack() {
        if (!this.playlist.length) return;
        let index = this.playlist.findIndex((f) => f.name === this.currentTrack);
        index = (index + 1) % this.playlist.length;
        this.selectAndPlayTrack(this.playlist[index].name);
    }

    playPrevTrack() {
        if (!this.playlist.length) return;
        let index = this.playlist.findIndex((f) => f.name === this.currentTrack);
        index = (index - 1 + this.playlist.length) % this.playlist.length;
        this.selectAndPlayTrack(this.playlist[index].name);
    }

    deleteTrack(filename) {
        if (!confirm('Delete track ' + filename + '?')) return;
        fetch('/api/audio/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
        })
            .then((res) => res.json())
            .then((data) => {
                if (!data.success) return;
                if (this.currentTrack === filename) {
                    this.currentTrack = null;
                    this.stopPlayback();
                    const title = document.getElementById('nowPlayingTitle');
                    if (title) title.textContent = 'No Track Selected';
                }
                this.loadPlaylist();
            })
            .catch(() => {});
    }

    updatePlayPauseUI(isPlaying) {
        const btn = document.getElementById('btnPlayPauseNav');
        if (btn) {
            btn.textContent = isPlaying ? '⏸ Pause' : '▶ Play';
            btn.style.background = isPlaying
                ? 'linear-gradient(135deg, var(--accent-orange), var(--accent-purple))'
                : 'linear-gradient(135deg, var(--accent-cyan), var(--accent-blue))';
        }
    }

    updateTimeUI() {
        if (!this.audioPlayer) return;
        const current = this.audioPlayer.currentTime || 0;
        const duration = this.audioPlayer.duration || 0;
        const curEl = document.getElementById('audioCurrentTime');
        const durEl = document.getElementById('audioTotalDuration');
        const seek = document.getElementById('seekAudioSlider');
        if (curEl) curEl.textContent = this.formatTime(current);
        if (durEl) durEl.textContent = this.formatTime(duration);
        if (seek && duration > 0) seek.value = (current / duration) * 100;
    }

    formatTime(seconds) {
        if (isNaN(seconds) || seconds < 0) return '00:00';
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    startPerformance() {
        if (!this.syncEnabled) return;
        if (this.app && this.app.setMusicPerformanceActive) this.app.setMusicPerformanceActive(true);
        this.startAnalysisLoop();
    }

    startAnalysisLoop() {
        if (this.loopRunning) return;
        this.loopRunning = true;

        if (this.isLocalOutput()) {
            this.runLocalLoop();
            return;
        }

        if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

        if (!this.sourceNode && this.audioPlayer) {
            try {
                this.sourceNode = this.audioCtx.createMediaElementSource(this.audioPlayer);
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 256;
                this.analyser.smoothingTimeConstant = 0.8;
                this.sourceNode.connect(this.analyser);
                this.analyser.connect(this.audioCtx.destination);
            } catch (e) {
                console.warn('Audio analyser error:', e);
            }
        }

        const freq = new Uint8Array(128);
        const frame = () => {
            if (!this.loopRunning) return;
            if (this.isLocalOutput()) {
                this.runLocalLoop();
                return;
            }
            if (!this.playing) {
                this.loopRunning = false;
                return;
            }
            if (this.analyser) {
                this.analyser.getByteFrequencyData(freq);
                this.processAudioFrame(freq);
            }
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    runLocalLoop() {
        if (!this.loopRunning) this.loopRunning = true;
        const frame = () => {
            if (!this.loopRunning || !this.playing) {
                this.loopRunning = false;
                return;
            }
            const now = performance.now();
            const energy = Math.max(0, Math.min(100, 52 + 30 * Math.sin(now * 0.0032) + 12 * Math.sin(now * 0.011)));
            this.processEnergy(energy, Math.sin(now * 0.022) > 0);
            requestAnimationFrame(frame);
        };
        requestAnimationFrame(frame);
    }

    processAudioFrame(freq) {
        let vocalSum = 0;
        for (let i = 10; i < 60; i++) vocalSum += freq[i];
        const vocalAvg = vocalSum / 50.0;
        const mouthActive = vocalAvg > (16 / this.sensitivity);

        let bassSum = 0;
        for (let i = 1; i <= 6; i++) bassSum += freq[i];
        const bassAvg = bassSum / 6.0;
        const energy = Math.max(0, Math.min(100, (bassAvg / 180.0) * 100 * this.sensitivity));

        this.processEnergy(energy, mouthActive);
    }

    processEnergy(energy, mouthActive) {
        const bar = document.getElementById('danceBeatEnergyBar');
        const val = document.getElementById('danceBeatEnergyVal');
        if (bar) bar.style.width = energy + '%';
        if (val) val.textContent = Math.round(energy) + '%';

        const now = performance.now();
        if (now - this.lastBeatSent > 140) {
            this.lastBeatSent = now;
            fetch('/api/parrot/beat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ energy })
            }).catch(() => {});
        }

        if (mouthActive !== this.lastMouthState) {
            this.lastMouthState = mouthActive;
            if (this.app && this.app.setMouthEnergized) this.app.setMouthEnergized(mouthActive);
        }
    }

    stopPerformance() {
        this.loopRunning = false;
        this.lastMouthState = false;
        fetch('/api/parrot/beat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ energy: 0 })
        }).catch(() => {});
        if (this.app) {
            if (this.app.setMouthEnergized) this.app.setMouthEnergized(false);
            if (this.app.setMusicPerformanceActive) this.app.setMusicPerformanceActive(false);
            if (this.app.setWings) this.app.setWings(false);
        }
        const bar = document.getElementById('danceBeatEnergyBar');
        const val = document.getElementById('danceBeatEnergyVal');
        if (bar) bar.style.width = '0%';
        if (val) val.textContent = '0%';
    }
}
