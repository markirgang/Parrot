/**
 * 3D Gemmy animated macaw parrot stage for the Parrot control center.
 *
 * The model is built from Three.js primitives and reacts to:
 *  - L298 channel 1 forward pulses (beak) and reverse pulses (eye blink)
 *  - L298 channel 2 forward polarity (wing flap)
 *  - 2-DOF spotlight pan / tilt / MOSFET brightness
 *  - stage turntable servo angle
 */

class Parrot3DRenderer {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        if (!this.container) return;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x06110d);
        this.scene.fog = new THREE.FogExp2(0x06110d, 0.0012);

        this.camera = new THREE.PerspectiveCamera(
            42,
            this.container.clientWidth / (this.container.clientHeight || 1),
            1,
            5000
        );
        this.camera.position.set(0, 170, 470);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight || 360);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.maxPolarAngle = Math.PI / 2 + 0.05;
        this.controls.minDistance = 180;
        this.controls.maxDistance = 900;
        this.controls.target.set(0, 100, 0);

        this.mouthEnergized = false;
        this.wingsEnergized = false;
        this.eyesBlinking = false;
        this.stageAngle = 90;
        this.spotlightPan = 90;
        this.spotlightTilt = 90;
        this.spotlightIntensity = 0;
        this.currentStageRotation = 0;
        this.currentPan = 0;
        this.currentTilt = 0;
        this.currentIntensity = 0;
        this.eyeScale = 1.0;
        this.wingPhase = 0;

        this.setupEnvironment();
        this.buildStage();

        window.addEventListener('resize', () => this.onWindowResize());
    }

    setupEnvironment() {
        this.scene.add(new THREE.AmbientLight(0xd1fae5, 0.65));

        const hemi = new THREE.HemisphereLight(0x99f6e4, 0x1c1917, 0.7);
        this.scene.add(hemi);

        const key = new THREE.DirectionalLight(0xffedd5, 1.1);
        key.position.set(180, 320, 240);
        key.castShadow = true;
        key.shadow.mapSize.width = 2048;
        key.shadow.mapSize.height = 2048;
        this.scene.add(key);

        const rim = new THREE.PointLight(0x2dd4bf, 1.4, 900);
        rim.position.set(-260, 170, -160);
        this.scene.add(rim);
    }

    buildStage() {
        this.mats = {
            stage: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.55, metalness: 0.45 }),
            stageTop: new THREE.MeshStandardMaterial({ color: 0x0f766e, roughness: 0.4, metalness: 0.35 }),
            brass: new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.25, metalness: 0.8 }),
            wood: new THREE.MeshStandardMaterial({ color: 0x5b3a1e, roughness: 0.85 }),
            woodDark: new THREE.MeshStandardMaterial({ color: 0x3f2412, roughness: 0.9 }),
            red: new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.62 }),
            redDark: new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.7 }),
            blue: new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55 }),
            yellow: new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6 }),
            whiteFace: new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.65 }),
            beak: new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.35, metalness: 0.35 }),
            beakLight: new THREE.MeshStandardMaterial({ color: 0xd6d3d1, roughness: 0.4 }),
            eyeWhite: new THREE.MeshStandardMaterial({ color: 0xfefce8, roughness: 0.3 }),
            pupil: new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.1 }),
            highlight: new THREE.MeshBasicMaterial({ color: 0xffffff }),
            metal: new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.9, roughness: 0.2 }),
            bulb: new THREE.MeshStandardMaterial({
                color: 0xfff3c4,
                emissive: 0xfff3c4,
                emissiveIntensity: 0.1,
                roughness: 0.15
            })
        };

        this.stageGroup = new THREE.Group();
        this.scene.add(this.stageGroup);

        const base = new THREE.Mesh(new THREE.CylinderGeometry(155, 170, 18, 48), this.mats.stage);
        base.position.y = 9;
        base.receiveShadow = true;
        base.castShadow = true;
        this.stageGroup.add(base);

        const top = new THREE.Mesh(new THREE.CylinderGeometry(148, 148, 4, 48), this.mats.stageTop);
        top.position.y = 20;
        top.receiveShadow = true;
        this.stageGroup.add(top);

        const ring = new THREE.Mesh(new THREE.TorusGeometry(138, 2.4, 12, 64), this.mats.brass);
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 23;
        this.stageGroup.add(ring);

        const floor = new THREE.Mesh(
            new THREE.CircleGeometry(430, 64),
            new THREE.MeshStandardMaterial({ color: 0x062a22, roughness: 0.95, metalness: 0.05 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -1;
        floor.receiveShadow = true;
        this.scene.add(floor);

        const grid = new THREE.GridHelper(860, 32, 0x14b8a6, 0x134e4a);
        grid.position.y = 0;
        this.scene.add(grid);

        this.buildPerch();
        this.buildParrot();
        this.buildSpotlight();
    }

    buildPerch() {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(6, 9, 78, 16), this.mats.woodDark);
        pole.position.set(0, 60, 0);
        pole.castShadow = true;
        this.stageGroup.add(pole);

        const branch = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 150, 12), this.mats.wood);
        branch.rotation.z = Math.PI / 2;
        branch.position.set(0, 100, 0);
        branch.castShadow = true;
        this.stageGroup.add(branch);

        for (const side of [-1, 1]) {
            const fork = new THREE.Mesh(new THREE.CylinderGeometry(3, 4, 46, 10), this.mats.wood);
            fork.position.set(side * 34, 116, 6);
            fork.rotation.z = side * -0.55;
            fork.rotation.x = 0.25;
            this.stageGroup.add(fork);
        }

        const plate = new THREE.Mesh(new THREE.CylinderGeometry(34, 34, 3, 32), this.mats.brass);
        plate.position.y = 22;
        this.stageGroup.add(plate);
    }

    buildParrot() {
        this.parrotGroup = new THREE.Group();
        this.parrotGroup.position.set(0, 100, 0);
        this.stageGroup.add(this.parrotGroup);

        // Body
        this.bodyGroup = new THREE.Group();
        this.bodyGroup.position.set(0, 34, -2);
        this.parrotGroup.add(this.bodyGroup);

        const body = new THREE.Mesh(new THREE.SphereGeometry(48, 32, 24), this.mats.red);
        body.scale.set(1.0, 1.32, 0.9);
        body.castShadow = true;
        this.bodyGroup.add(body);

        const chest = new THREE.Mesh(new THREE.SphereGeometry(34, 24, 18), this.mats.redDark);
        chest.scale.set(0.95, 1.1, 0.7);
        chest.position.set(0, -6, 27);
        this.bodyGroup.add(chest);

        // Tail feathers
        this.tailGroup = new THREE.Group();
        this.tailGroup.position.set(0, -36, -14);
        this.tailGroup.rotation.x = -0.5;
        this.bodyGroup.add(this.tailGroup);

        const tailColors = [this.mats.red, this.mats.blue, this.mats.yellow];
        for (let i = 0; i < 5; i++) {
            const feather = new THREE.Mesh(new THREE.ConeGeometry(5, 92, 8), tailColors[i % tailColors.length]);
            feather.position.set((i - 2) * 5, -42, -4);
            feather.rotation.z = (i - 2) * 0.035;
            feather.rotation.x = Math.PI;
            feather.castShadow = true;
            this.tailGroup.add(feather);
        }

        // Feet
        for (const side of [-1, 1]) {
            const leg = new THREE.Mesh(new THREE.CylinderGeometry(4, 5, 24, 8), this.mats.beak);
            leg.position.set(side * 15, -34, 10);
            leg.rotation.z = side * 0.12;
            this.bodyGroup.add(leg);
            const foot = new THREE.Mesh(new THREE.SphereGeometry(7, 10, 8), this.mats.beak);
            foot.scale.set(1.2, 0.5, 1.4);
            foot.position.set(side * 15, -46, 16);
            this.bodyGroup.add(foot);
        }

        // Head
        this.headGroup = new THREE.Group();
        this.headGroup.position.set(0, 62, 12);
        this.bodyGroup.add(this.headGroup);

        const head = new THREE.Mesh(new THREE.SphereGeometry(33, 28, 22), this.mats.red);
        head.castShadow = true;
        this.headGroup.add(head);

        for (const side of [-1, 1]) {
            const patch = new THREE.Mesh(new THREE.SphereGeometry(17, 18, 14), this.mats.whiteFace);
            patch.scale.set(0.85, 1.0, 0.55);
            patch.position.set(side * 14, 4, 24);
            this.headGroup.add(patch);
        }

        // Eyes
        this.eyeGroups = [];
        for (const side of [-1, 1]) {
            const eyeGroup = new THREE.Group();
            eyeGroup.position.set(side * 13, 10, 31);

            const white = new THREE.Mesh(new THREE.SphereGeometry(5.4, 16, 16), this.mats.eyeWhite);
            eyeGroup.add(white);

            const pupil = new THREE.Mesh(new THREE.SphereGeometry(3.1, 14, 14), this.mats.pupil);
            pupil.position.z = 3.2;
            eyeGroup.add(pupil);

            const glint = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 8), this.mats.highlight);
            glint.position.set(1.2, 1.2, 5.6);
            eyeGroup.add(glint);

            this.headGroup.add(eyeGroup);
            this.eyeGroups.push(eyeGroup);
        }

        // Upper beak
        const upperBeak = new THREE.Mesh(new THREE.ConeGeometry(13, 40, 4), this.mats.beak);
        upperBeak.rotation.x = Math.PI / 2;
        upperBeak.rotation.z = Math.PI / 4;
        upperBeak.position.set(0, 2, 42);
        upperBeak.castShadow = true;
        this.headGroup.add(upperBeak);

        const beakTip = new THREE.Mesh(new THREE.ConeGeometry(6, 20, 4), this.mats.beakLight);
        beakTip.rotation.x = Math.PI / 2;
        beakTip.rotation.z = Math.PI / 4;
        beakTip.position.set(0, -3, 61);
        this.headGroup.add(beakTip);

        // Lower beak (animated by channel 1)
        this.lowerBeakGroup = new THREE.Group();
        this.lowerBeakGroup.position.set(0, -7, 30);
        this.headGroup.add(this.lowerBeakGroup);

        const lowerBeak = new THREE.Mesh(new THREE.ConeGeometry(10, 32, 4), this.mats.beak);
        lowerBeak.rotation.x = Math.PI / 2;
        lowerBeak.rotation.z = Math.PI / 4;
        lowerBeak.position.set(0, 0, 16);
        this.lowerBeakGroup.add(lowerBeak);

        // Wings
        this.wingGroups = [];
        for (const side of [-1, 1]) {
            const wing = new THREE.Group();
            wing.position.set(side * 38, 38, -2);
            this.bodyGroup.add(wing);

            const shoulder = new THREE.Mesh(new THREE.SphereGeometry(17, 18, 14), this.mats.redDark);
            shoulder.scale.set(0.9, 0.8, 0.9);
            wing.add(shoulder);

            for (let i = 0; i < 4; i++) {
                const feather = new THREE.Mesh(
                    new THREE.BoxGeometry(18, 58, 7),
                    i < 2 ? this.mats.blue : this.mats.yellow
                );
                feather.position.set(side * (8 + i * 8), -30 - i * 3, -2);
                feather.rotation.z = side * (0.08 + i * 0.1);
                feather.rotation.x = 0.12;
                feather.castShadow = true;
                wing.add(feather);
            }

            wing.rotation.z = side * 0.12;
            wing.userData.side = side;
            this.wingGroups.push(wing);
        }

        // Crest feathers for a toy-like look
        for (let i = 0; i < 3; i++) {
            const crest = new THREE.Mesh(new THREE.ConeGeometry(4, 24, 8), this.mats.yellow);
            crest.position.set((i - 1) * 8, 31, -6);
            crest.rotation.z = (i - 1) * 0.25;
            crest.rotation.x = -0.2;
            this.headGroup.add(crest);
        }
    }

    buildSpotlight() {
        this.spotlightGroup = new THREE.Group();
        this.spotlightGroup.position.set(0, 0, 100);
        this.stageGroup.add(this.spotlightGroup);

        const base = new THREE.Mesh(new THREE.CylinderGeometry(16, 20, 8, 20), this.mats.metal);
        base.position.y = 4;
        this.spotlightGroup.add(base);

        const pole = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 120, 12), this.mats.metal);
        pole.position.y = 64;
        this.spotlightGroup.add(pole);

        this.panGroup = new THREE.Group();
        this.panGroup.position.set(0, 126, 0);
        this.spotlightGroup.add(this.panGroup);

        this.tiltGroup = new THREE.Group();
        this.panGroup.add(this.tiltGroup);

        const yoke = new THREE.Mesh(new THREE.BoxGeometry(28, 14, 14), this.mats.metal);
        this.tiltGroup.add(yoke);

        const housing = new THREE.Mesh(new THREE.CylinderGeometry(15, 12, 34, 20), this.mats.metal);
        housing.rotation.x = Math.PI / 2;
        housing.position.z = -18;
        this.tiltGroup.add(housing);

        this.lens = new THREE.Mesh(new THREE.CircleGeometry(12, 24), this.mats.bulb);
        this.lens.position.z = -35.2;
        this.lens.rotation.y = Math.PI;
        this.tiltGroup.add(this.lens);

        this.beam = new THREE.Mesh(
            new THREE.CylinderGeometry(32, 2, 260, 28, 1, true),
            new THREE.MeshBasicMaterial({
                color: 0xfff3c4,
                transparent: true,
                opacity: 0.0,
                side: THREE.DoubleSide,
                depthWrite: false,
                blending: THREE.AdditiveBlending
            })
        );
        this.beam.rotation.x = -Math.PI / 2;
        this.beam.position.z = -130;
        this.tiltGroup.add(this.beam);

        this.spotLight = new THREE.SpotLight(0xfff3c4, 0, 900, Math.PI / 7, 0.45, 1.2);
        this.spotLight.position.set(0, 0, -34);
        this.tiltGroup.add(this.spotLight);

        this.spotTarget = new THREE.Object3D();
        this.spotTarget.position.set(0, 0, -360);
        this.tiltGroup.add(this.spotTarget);
        this.spotLight.target = this.spotTarget;
    }

    updatePose(bodyState, overrideState) {
        if (overrideState) {
            if ('mouth_channel1' in overrideState) {
                this.mouthEnergized = overrideState.mouth_channel1 === 'open';
            }
            if ('wings_channel2' in overrideState) {
                this.wingsEnergized = !!overrideState.wings_channel2;
            }
            if ('eyes_blinking' in overrideState) {
                this.eyesBlinking = !!overrideState.eyes_blinking;
            }
            if (overrideState.stage && overrideState.stage.angle !== undefined) {
                this.stageAngle = overrideState.stage.angle;
            }
            if (overrideState.spotlight) {
                this.spotlightPan = overrideState.spotlight.pan;
                this.spotlightTilt = overrideState.spotlight.tilt;
                this.spotlightIntensity = overrideState.spotlight.intensity;
            }
        }

        const now = performance.now();

        // Stage turntable
        const targetRotation = THREE.MathUtils.degToRad(this.stageAngle - 90);
        this.currentStageRotation += (targetRotation - this.currentStageRotation) * 0.08;
        this.stageGroup.rotation.y = this.currentStageRotation;

        // Spotlight aim
        const targetPan = THREE.MathUtils.degToRad(this.spotlightPan - 90);
        const targetTilt = THREE.MathUtils.degToRad(90 - this.spotlightTilt);
        this.currentPan += (targetPan - this.currentPan) * 0.24;
        this.currentTilt += (targetTilt - this.currentTilt) * 0.24;
        this.panGroup.rotation.y = this.currentPan;
        this.tiltGroup.rotation.x = this.currentTilt;

        // Spotlight brightness / breathing / flash
        const targetIntensity = Math.max(0, Math.min(100, this.spotlightIntensity)) / 100;
        this.currentIntensity += (targetIntensity - this.currentIntensity) * 0.45;
        const glow = this.currentIntensity;
        if (this.lens && this.lens.material) {
            this.lens.material.emissiveIntensity = 0.1 + glow * 4.0;
        }
        if (this.spotLight) {
            this.spotLight.intensity = glow * 3.2;
        }
        if (this.beam && this.beam.material) {
            this.beam.material.opacity = glow * 0.16;
        }

        // Beak pulse (L298 channel 1 forward)
        if (this.lowerBeakGroup) {
            if (this.mouthEnergized) {
                const pulse = Math.abs(Math.sin(now * 0.019)) * 0.55;
                this.lowerBeakGroup.rotation.x = pulse;
            } else {
                this.lowerBeakGroup.rotation.x += (0 - this.lowerBeakGroup.rotation.x) * 0.28;
            }
        }

        // Eye blink (L298 channel 1 reverse)
        const targetEyeScale = this.eyesBlinking ? 0.12 : 1.0;
        this.eyeScale += (targetEyeScale - this.eyeScale) * 0.5;
        if (this.eyeGroups) {
            this.eyeGroups.forEach((group) => { group.scale.y = this.eyeScale; });
        }

        // Wings (L298 channel 2 forward polarity)
        this.wingPhase += 0.011;
        const flap = this.wingsEnergized ? (0.45 + 0.45 * Math.sin(now * 0.015)) : 0.12;
        if (this.wingGroups) {
            this.wingGroups.forEach((wing) => {
                const side = wing.userData.side;
                const target = side * flap;
                wing.rotation.z += (target - wing.rotation.z) * 0.2;
            });
        }
    }

    render() {
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
    }

    onWindowResize() {
        const parent = (this.renderer && this.renderer.domElement && this.renderer.domElement.parentElement)
            ? this.renderer.domElement.parentElement : this.container;
        const targetContainer = parent || this.container;
        if (!targetContainer) return;

        const width = targetContainer.clientWidth || targetContainer.offsetWidth || 800;
        const height = targetContainer.clientHeight || targetContainer.offsetHeight || 360;

        if (width > 0 && height > 0) {
            this.container = targetContainer;
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(width, height);
        }
    }
}
