import * as THREE from '../vendor/three/three.module.r180.min.js';
import {GLTFLoader} from '../vendor/three/GLTFLoader.js';
import {RoomEnvironment} from '../vendor/three/RoomEnvironment.js';

const host = document.querySelector('[data-bottle-canvas]');
const stage = document.querySelector('[data-bottle-stage]');
const sequence = document.querySelector('[data-bottle-sequence]');
const reduceMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionOverride = new URLSearchParams(window.location.search).get('motion');
const isLocalPreview = window.location.hostname === 'localhost' || window.location.hostname.endsWith('.local');

const clamp01 = value => Math.min(1, Math.max(0, value));
const shouldReduceMotion = () => reduceMotionQuery.matches && !isLocalPreview && motionOverride !== 'full';
const scrollSubscribers = new Set();
let currentScrollProgress = 0;
let progressFrame = 0;

const readSequenceProgress = () => {
    const bounds = sequence.getBoundingClientRect();
    const scrollDistance = Math.max(1, bounds.height - window.innerHeight);
    return clamp01(-bounds.top / scrollDistance);
};

const updateScrollProgress = () => {
    progressFrame = 0;
    currentScrollProgress = readSequenceProgress();
    const sequenceHeight = sequence.getBoundingClientRect().height;
    const scrollDistance = Math.max(0, sequenceHeight - window.innerHeight);
    const baseRevealMargin = Math.min(140, window.innerHeight * 0.14);
    const revealDistance = Math.max(0, stage.offsetHeight - window.innerHeight + baseRevealMargin);
    const parallaxOffset = shouldReduceMotion()
        ? 0
        : currentScrollProgress * Math.max(0, scrollDistance - revealDistance);

    stage.dataset.scrollProgress = currentScrollProgress.toFixed(4);
    stage.dataset.motionMode = shouldReduceMotion() ? 'reduced' : 'full';
    stage.style.setProperty('--ms-bottle-parallax-y', `${parallaxOffset.toFixed(2)}px`);
    scrollSubscribers.forEach(callback => callback(currentScrollProgress));
};

const scheduleScrollProgress = () => {
    if (!progressFrame) {
        progressFrame = window.requestAnimationFrame(updateScrollProgress);
    }
};

if (host && stage && sequence && host.dataset.modelUrl) {
    window.addEventListener('scroll', scheduleScrollProgress, {passive: true});
    window.addEventListener('resize', scheduleScrollProgress, {passive: true});
    updateScrollProgress();
    initializeBottle();
}

function initializeBottle() {
    stage.dataset.modelStatus = 'initializing';

    let renderer;
    try {
        renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'high-performance'
        });
    } catch (error) {
        stage.dataset.modelStatus = 'webgl-error';
        console.warn('La botella 3D conservará su imagen de respaldo.', error);
        return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(23, 1, 0.1, 100);
    const bottleRoot = new THREE.Group();
    const lookAt = new THREE.Vector3(0, 0, 0);
    const motion = {
        rotationY: 0,
        rotationZ: 0,
        positionX: 0,
        positionY: 0,
        cameraOffset: 0,
        keyX: -4.2,
        rimIntensity: 2.5,
        blend: 0
    };
    const totalScrollRotation = Math.PI * 4;
    const rotationState = {
        angle: currentScrollProgress * totalScrollRotation,
        target: currentScrollProgress * totalScrollRotation,
        velocity: 0,
        lastProgress: currentScrollProgress,
        lastInputTime: 0,
        lastFrameTime: 0
    };

    let model = null;
    let modelCenter = null;
    let modelHeight = 1;
    let isMobile = false;
    let isActive = true;
    let modelReady = false;
    let firstFrameRendered = false;
    let renderFrame = 0;
    const mobileQuery = window.matchMedia('(max-width: 760px)');

    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.replaceChildren(renderer.domElement);
    stage.dataset.modelStatus = 'loading';

    const room = new RoomEnvironment();
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const environmentTarget = pmremGenerator.fromScene(room, 0.04);
    scene.environment = environmentTarget.texture;
    room.dispose();
    pmremGenerator.dispose();

    const ambient = new THREE.HemisphereLight(0xfff3dc, 0x172334, 0.72);
    const key = new THREE.DirectionalLight(0xffdfb0, 3.7);
    const fill = new THREE.DirectionalLight(0xb9d8ff, 1.35);
    const rim = new THREE.DirectionalLight(0xffb766, 2.5);
    key.position.set(-4.2, 5.2, 6.4);
    fill.position.set(4.5, 1.8, 4.0);
    rim.position.set(3.6, 2.2, -4.8);
    scene.add(ambient, key, fill, rim, bottleRoot);

    const setReady = ready => {
        stage.dataset.modelReady = ready ? 'true' : 'false';
    };

    const configureRenderer = () => {
        const pixelRatioLimit = isMobile ? 1.4 : 2;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, pixelRatioLimit));
        renderer.transmissionResolutionScale = isMobile ? 0.72 : 1;
        camera.fov = isMobile ? 27 : 23;
        camera.position.set(0, 0.08, isMobile ? 11.8 : 11.2);
        camera.updateProjectionMatrix();
    };

    const fitModel = () => {
        if (!model || !modelCenter) return;
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        const fallback = stage.querySelector('.ms-bottle-stage__fallback');
        const naturalWidth = fallback?.naturalWidth || 1122;
        const naturalHeight = fallback?.naturalHeight || 1402;
        const fittedImageHeight = Math.min(height, width * naturalHeight / naturalWidth);
        const imageCoverage = fittedImageHeight / height;
        const cameraHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * camera.position.z;
        const targetHeight = cameraHeight * imageCoverage;
        const scale = targetHeight / Math.max(modelHeight, 0.001);
        model.scale.setScalar(scale);
        model.position.copy(modelCenter).multiplyScalar(-scale);
    };

    const updateInertialRotation = timestamp => {
        if (shouldReduceMotion()) {
            rotationState.angle = 0;
            rotationState.target = 0;
            rotationState.velocity = 0;
            rotationState.lastFrameTime = timestamp;
            motion.rotationY = 0;
            motion.rotationZ = 0;
            return false;
        }

        if (!rotationState.lastFrameTime) {
            rotationState.lastFrameTime = timestamp;
        }

        const deltaTime = Math.min(0.05, Math.max(0.001, (timestamp - rotationState.lastFrameTime) / 1000));
        const receivingInput = timestamp - rotationState.lastInputTime < 140;

        rotationState.lastFrameTime = timestamp;

        if (receivingInput) {
            const angleError = rotationState.target - rotationState.angle;
            rotationState.velocity += angleError * 16 * deltaTime;
            rotationState.velocity *= Math.exp(-3.2 * deltaTime);
        } else {
            rotationState.velocity *= Math.exp(-1.15 * deltaTime);
        }

        rotationState.velocity = THREE.MathUtils.clamp(rotationState.velocity, -10, 10);
        if (!receivingInput && Math.abs(rotationState.velocity) < 0.012) {
            rotationState.velocity = 0;
        }

        rotationState.angle += rotationState.velocity * deltaTime;
        motion.rotationY = rotationState.angle;
        motion.rotationZ = 0;

        stage.dataset.rotationY = motion.rotationY.toFixed(4);
        stage.dataset.angularVelocity = rotationState.velocity.toFixed(4);

        return receivingInput || Math.abs(rotationState.velocity) > 0;
    };

    const applyMotion = () => {
        bottleRoot.rotation.set(0, motion.rotationY, motion.rotationZ);
        bottleRoot.position.set(motion.positionX, motion.positionY, 0);
        camera.position.z = (isMobile ? 11.8 : 11.2) + motion.cameraOffset;
        camera.lookAt(lookAt);
        key.position.x = motion.keyX;
        rim.intensity = motion.rimIntensity;
        stage.style.setProperty('--ms-model-blend', motion.blend.toFixed(4));
    };

    const render = timestamp => {
        renderFrame = 0;
        if (!modelReady || !isActive || document.hidden) return;

        const rotationIsMoving = updateInertialRotation(timestamp);
        applyMotion();
        renderer.render(scene, camera);

        if (!firstFrameRendered) {
            firstFrameRendered = true;
            setReady(true);
            stage.dataset.modelStatus = 'ready';
        }

        if (rotationIsMoving) {
            requestRender();
        }
    };

    const requestRender = () => {
        if (!renderFrame && modelReady && isActive && !document.hidden) {
            renderFrame = window.requestAnimationFrame(render);
        }
    };

    const resize = () => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize(width, height, false);
        fitModel();
        requestRender();
    };

    const tuneMaterials = object => {
        const anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);

        object.traverse(child => {
            if (!child.isMesh || !child.material) return;
            const materials = Array.isArray(child.material) ? child.material : [child.material];

            materials.forEach(material => {
                const name = `${child.name} ${material.name}`.toLowerCase();
                material.envMapIntensity = 1.15;

                if (material.map) {
                    material.map.anisotropy = anisotropy;
                    material.map.needsUpdate = true;
                }

                if (name.includes('glass')) {
                    material.transmission = 1;
                    material.opacity = 1;
                    material.transparent = false;
                    material.metalness = 0;
                    material.roughness = isMobile ? 0.09 : 0.055;
                    material.ior = 1.46;
                    material.thickness = 0.09;
                    material.attenuationDistance = 4.5;
                    material.attenuationColor = new THREE.Color(0xfff4df);
                    material.clearcoat = 0.8;
                    material.clearcoatRoughness = 0.06;
                    material.side = THREE.FrontSide;
                } else if (name.includes('liquid')) {
                    material.transmission = 0.92;
                    material.opacity = 1;
                    material.transparent = false;
                    material.metalness = 0;
                    material.roughness = isMobile ? 0.16 : 0.1;
                    material.ior = 1.333;
                    material.thickness = 0.16;
                    material.attenuationDistance = 2.8;
                    material.attenuationColor = new THREE.Color(0xe7a84f);
                    material.side = THREE.FrontSide;
                } else if (name.includes('label')) {
                    material.roughness = 0.62;
                    material.metalness = 0;
                    material.envMapIntensity = 0.25;
                    material.side = THREE.FrontSide;
                } else if (name.includes('cork') || name.includes('paper')) {
                    material.envMapIntensity = 0.4;
                }

                material.needsUpdate = true;
            });
        });
    };

    const smoothstep = (start, end, value) => {
        const normalized = clamp01((value - start) / Math.max(0.0001, end - start));
        return normalized * normalized * (3 - 2 * normalized);
    };

    const updateScrollMotion = progress => {
        const bounds = sequence.getBoundingClientRect();
        const reduceMotion = shouldReduceMotion();
        const travelProgress = reduceMotion ? 0 : clamp01((progress - 0.025) / 0.975);

        stage.dataset.motionMode = reduceMotion ? 'reduced' : 'full';
        isActive = bounds.bottom > 0 && bounds.top < window.innerHeight;
        motion.positionX = 0;
        // El recorrido vertical ocurre en la capa CSS. Mantener el modelo centrado
        // evita que la base cruce el límite rectangular del canvas WebGL.
        motion.positionY = 0;
        motion.cameraOffset = 0;
        motion.keyX = THREE.MathUtils.lerp(-4.2, 4.4, travelProgress);
        motion.rimIntensity = THREE.MathUtils.lerp(2.5, isMobile ? 3.0 : 3.8, travelProgress);
        motion.blend = reduceMotion ? 0 : smoothstep(0.002, 0.025, progress);

        if (reduceMotion) {
            rotationState.angle = 0;
            rotationState.target = 0;
            rotationState.velocity = 0;
            rotationState.lastProgress = progress;
            motion.rotationY = 0;
            motion.rotationZ = 0;
        } else {
            const now = performance.now();
            const progressDelta = progress - rotationState.lastProgress;

            if (Math.abs(progressDelta) > 0.00001) {
                const elapsed = rotationState.lastInputTime
                    ? THREE.MathUtils.clamp((now - rotationState.lastInputTime) / 1000, 1 / 120, 0.16)
                    : 0.16;
                const angleDelta = progressDelta * totalScrollRotation;
                const sampledVelocity = THREE.MathUtils.clamp(angleDelta / elapsed, -10, 10);

                rotationState.target = progress * totalScrollRotation;
                rotationState.velocity = THREE.MathUtils.lerp(rotationState.velocity, sampledVelocity, 0.38);
                rotationState.angle += angleDelta * 0.12;
                rotationState.lastInputTime = now;
            }

            rotationState.lastProgress = progress;
        }

        stage.style.setProperty('--ms-model-blend', modelReady ? motion.blend.toFixed(4) : '0');
        requestRender();
    };

    const applyMediaPreferences = () => {
        isMobile = mobileQuery.matches;
        configureRenderer();
        if (model) tuneMaterials(model);
        resize();
        updateScrollMotion(currentScrollProgress);
    };

    scrollSubscribers.add(updateScrollMotion);
    mobileQuery.addEventListener?.('change', applyMediaPreferences);
    reduceMotionQuery.addEventListener?.('change', applyMediaPreferences);
    applyMediaPreferences();

    const resizeObserver = 'ResizeObserver' in window ? new ResizeObserver(resize) : null;
    if (resizeObserver) {
        resizeObserver.observe(host);
    } else {
        window.addEventListener('resize', resize);
    }
    stage.querySelector('.ms-bottle-stage__fallback')?.addEventListener('load', () => {
        fitModel();
        requestRender();
    }, {once: true});

    renderer.domElement.addEventListener('webglcontextlost', event => {
        event.preventDefault();
        setReady(false);
        stage.dataset.modelStatus = 'context-lost';
    });
    renderer.domElement.addEventListener('webglcontextrestored', () => {
        firstFrameRendered = false;
        stage.dataset.modelStatus = 'restoring';
        requestRender();
    });
    document.addEventListener('visibilitychange', requestRender);

    new GLTFLoader().load(
        host.dataset.modelUrl,
        gltf => {
            model = gltf.scene;
            tuneMaterials(model);

            const bounds = new THREE.Box3().setFromObject(model);
            const size = bounds.getSize(new THREE.Vector3());
            const overallCenter = bounds.getCenter(new THREE.Vector3());
            const glass = model.getObjectByName('Glass');

            modelCenter = overallCenter;
            if (glass) {
                const glassCenter = new THREE.Box3().setFromObject(glass).getCenter(new THREE.Vector3());
                modelCenter.x = glassCenter.x;
                modelCenter.z = glassCenter.z;
            }
            modelHeight = size.y;
            fitModel();
            bottleRoot.add(model);

            modelReady = true;
            stage.dataset.modelStatus = 'loaded';
            resize();
            updateScrollMotion(currentScrollProgress);
            requestRender();
        },
        undefined,
        error => {
            setReady(false);
            stage.dataset.modelStatus = 'model-error';
            console.warn('No fue posible cargar la botella 3D.', error);
        }
    );
}
