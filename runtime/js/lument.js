// ============================================================
// lument.js - Lument Web Runtime
// JS/Canvas 实现 C ABI 全部接口，浏览器/WebView 直接运行
// 支持平台：Web / Android WebView / Desktop Electron
// ============================================================

const Lument = (function() {
    'use strict';

    // ========== 常量 ==========
    const VERSION = '1.2.0';

    const PLATFORM = {
        DESKTOP: 0, ANDROID: 1, IOS: 2, WEB: 3,
    };

    const RENDERER = {
        OPENGL: 0, OPENGLES: 1, WEBGL: 2, CANVAS2D: 3, VULKAN: 4,
    };

    const KEY = {
        NONE: 0, LEFT: 1, RIGHT: 2, UP: 3, DOWN: 4,
        ACTION: 5, CANCEL: 6, MENU: 7, MAX: 8,
    };

    // ========== UI 常量 ==========
    // Widget 类型
    const WIDGET = {
        NONE: 0, CONTAINER: 1, BUTTON: 2, LABEL: 3, INPUT: 4,
        IMAGE: 5, LIST: 6, PROGRESS: 7, CHECKBOX: 8, SLIDER: 9,
        TABBAR: 10, NAVBAR: 11,
    };

    // 布局类型
    const LAYOUT = {
        NONE: 0, VERTICAL: 1, HORIZONTAL: 2, GRID: 3, STACK: 4,
    };

    // 事件类型
    const EVENT = {
        NONE: 0, CLICK: 1, FOCUS: 2, BLUR: 3, CHANGE: 4, SCROLL: 5,
    };

    // ========== 2D 场景渲染常量 ==========
    // 光源类型
    const LIGHT = {
        POINT: 0, DIRECTIONAL: 1, SPOT: 2,
    };

    // 默认场景色彩参数
    const DEFAULT_SCENE_COLOR = {
        tint: { r: 255, g: 255, b: 255, a: 255 },
        brightness: 1.0,
        contrast: 1.0,
        saturation: 1.0,
        hueShift: 0.0,
        grayscale: 0.0,
        sepia: 0.0,
        invert: 0.0,
    };

    // 默认场景清晰度参数
    const DEFAULT_SCENE_CLARITY = {
        sharpness: 0.0,
        blurRadius: 0.0,
        bloomIntensity: 0.0,
        bloomThreshold: 0.5,
    };

    // ========== 物理模拟常量 ==========
    const BODY = {
        STATIC: 0, DYNAMIC: 1, KINEMATIC: 2,
    };
    const SHAPE = {
        AABB: 0, CIRCLE: 1,
    };

    // ========== AI 模块常量 ==========
    const AI = {
        SUCCESS: 0, FAILURE: 1, RUNNING: 2,
        NODE_ACTION: 0, NODE_CONDITION: 1, NODE_SEQUENCE: 2,
        NODE_SELECTOR: 3, NODE_PARALLEL: 4, NODE_DECORATOR: 5,
    };

    // ========== HTTP 方法常量 ==========
    const HTTP = {
        GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4,
    };

    // ========== WebSocket 事件常量 ==========
    const WS = {
        OPEN: 0, MESSAGE: 1, CLOSE: 2, ERROR: 3,
    };

    // ========== 引擎状态 ==========
    let canvas = null;
    let ctx = null;
    let running = false;
    let initialized = false;
    let config = {
        platform: PLATFORM.WEB,
        rendererType: RENDERER.CANVAS2D,
        width: 960,
        height: 540,
        targetFPS: 60,
        vsync: true,
        fullscreen: false,
        assetPath: '',
        savePath: '',
    };

    // 帧循环
    let lastFrameTime = 0;
    let deltaTime = 0;
    let stats = { fps: 0, frameTime: 0, drawCalls: 0, entityCount: 0, memoryUsed: 0 };
    let frameCount = 0;
    let fpsTimer = 0;

    // ========== 输入系统 ==========
    const inputState = {
        keys: new Array(KEY.MAX).fill(false),
        prevKeys: new Array(KEY.MAX).fill(false),
        touches: [],
        joystickX: 0,
        joystickY: 0,
    };

    // ========== 摄像机 ==========
    let camera = { x: 0, y: 0, zoom: 1 };

    // ========== ECS ==========
    let nextEntityId = 1;
    const entities = new Map();
    const MAX_ENTITIES = 4096;

    // ========== 纹理管理 ==========
    let nextTextureId = 1;
    const textures = new Map();

    // ========== 音频系统 ==========
    let nextAudioId = 1;
    const audioSources = new Map();
    let audioCtx = null;

    // ========== 场景管理 ==========
    const scenes = new Map();
    let activeSceneId = -1;
    let sceneBgColor = { r: 10, g: 10, b: 20, a: 255 };

    // ========== 存储 ==========
    const storagePrefix = 'lument_';

    // ========== UI / 应用系统状态 ==========
    let nextWidgetId = 1;          // Widget id 计数器
    const widgets = new Map();     // id -> widget 结构
    const navStack = [];           // 导航栈，存放根 Widget id
    let focusedWidgetId = 0;       // 当前聚焦的 Widget id
    let pressedWidgetId = 0;       // 当前按下的 Widget id（触摸追踪）

    // ========== 2D 场景渲染状态 ==========
    let sceneColor = Object.assign({}, DEFAULT_SCENE_COLOR);
    let sceneClarity = Object.assign({}, DEFAULT_SCENE_CLARITY);
    let vignetteState = { intensity: 0.0, radius: 0.5 };
    let fogState = { color: { r: 0, g: 0, b: 0, a: 0 }, density: 0.0, start: 0.0, end: 0.0 };
    let lightingState = { color: { r: 255, g: 255, b: 255, a: 255 }, intensity: 0.0, falloff: 2.0 };

    // 光源存储
    let nextLightId = 1;
    const lightMap = new Map();   // id -> light object

    // 渲染目标存储
    let nextRenderTargetId = 1;
    const renderTargetMap = new Map();  // id -> { canvas, ctx, w, h }
    let activeRenderTargetId = 0;
    let mainCanvas = null;        // 主画布备份
    let mainCtx = null;           // 主上下文备份

    // 离屏画布（用于后期处理快照）
    let effectCanvas = null;
    let effectCtx = null;

    // ========== 物理模拟状态 ==========
    let physicsWorld = {
        gravity: { x: 0, y: 9.8 },
        velocityIter: 8,
        positionIter: 3,
        bodies: new Map(),
        nextBodyId: 1,
        collisionCallback: null,
        collisionUserData: null,
    };

    // ========== 增强音频状态 ==========
    let audioInstances = new Map();
    let nextAudioInstanceId = 1;
    let audioListener = { x: 0, y: 0, dirX: 0, dirY: 1 };
    let masterVolume = 1.0;
    let groupVolumes = [1.0, 1.0, 1.0]; // SFX, Music, Voice

    // ========== 网络模块状态 ==========
    let nextRequestId = 1;
    let nextWsId = 1;
    const wsConnections = new Map();
    let globalHeaders = {};
    let httpTimeout = 30;
    let authToken = '';

    // ========== AI 模块状态 ==========
    const aiTrees = new Map();
    let nextTreeId = 1;
    let nextNodeId = 1;
    const aiFsms = new Map();
    let nextFsmId = 1;
    let nextFsmStateId = 1;
    const aiGrids = new Map();
    let nextGridId = 1;
    const aiBlackboards = new Map();
    let nextBbId = 1;
    const aiAgents = new Map();
    let nextAgentId = 1;

    // ============================================================
    // 核心生命周期
    // ============================================================

    function init(cfg) {
        if (initialized) return 0;
        if (cfg) Object.assign(config, cfg);

        canvas = document.getElementById('game-canvas');
        if (!canvas) {
            canvas = document.createElement('canvas');
            canvas.id = 'game-canvas';
            document.body.appendChild(canvas);
        }
        canvas.width = config.width;
        canvas.height = config.height;
        ctx = canvas.getContext('2d', { alpha: false });
        ctx.imageSmoothingEnabled = false;

        // 保存主画布引用（供渲染目标切换使用）
        mainCanvas = canvas;
        mainCtx = ctx;

        // 检测平台
        const ua = navigator.userAgent;
        if (/Android/i.test(ua)) config.platform = PLATFORM.ANDROID;
        else if (/iPhone|iPad|iPod/i.test(ua)) config.platform = PLATFORM.IOS;
        else if (/Electron/i.test(ua)) config.platform = PLATFORM.DESKTOP;
        else config.platform = PLATFORM.WEB;

        // 初始化音频上下文
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;
        }

        running = true;
        initialized = true;
        lastFrameTime = performance.now();
        return 0;
    }

    function shutdown() {
        running = false;
        initialized = false;
        stopAllAudio();
        entities.clear();
        textures.clear();
        audioSources.clear();
        scenes.clear();
        widgets.clear();
        navStack.length = 0;
        focusedWidgetId = 0;
        pressedWidgetId = 0;
        // 清理 2D 场景渲染状态
        sceneColor = Object.assign({}, DEFAULT_SCENE_COLOR);
        sceneClarity = Object.assign({}, DEFAULT_SCENE_CLARITY);
        vignetteState = { intensity: 0.0, radius: 0.5 };
        fogState = { color: { r: 0, g: 0, b: 0, a: 0 }, density: 0.0, start: 0.0, end: 0.0 };
        lightingState = { color: { r: 255, g: 255, b: 255, a: 255 }, intensity: 0.0, falloff: 2.0 };
        lightMap.clear();
        renderTargetMap.clear();
        activeRenderTargetId = 0;
        nextLightId = 1;
        nextRenderTargetId = 1;
        effectCanvas = null;
        effectCtx = null;
        // 清理物理模拟状态
        physicsWorld.bodies.clear();
        physicsWorld.nextBodyId = 1;
        physicsWorld.collisionCallback = null;
        // 清理增强音频状态
        audioInstances.clear();
        nextAudioInstanceId = 1;
        masterVolume = 1.0;
        groupVolumes = [1.0, 1.0, 1.0];
        // 清理网络状态
        for (const [id, c] of wsConnections) { try { c.ws.close(); } catch(e) {} }
        wsConnections.clear();
        globalHeaders = {};
        authToken = '';
        nextRequestId = 1;
        nextWsId = 1;
        // 清理AI状态
        aiTrees.clear();
        aiFsms.clear();
        aiGrids.clear();
        aiBlackboards.clear();
        aiAgents.clear();
        nextTreeId = 1; nextNodeId = 1;
        nextFsmId = 1; nextFsmStateId = 1;
        nextGridId = 1; nextBbId = 1; nextAgentId = 1;
        if (audioCtx) {
            audioCtx.close();
            audioCtx = null;
        }
    }

    function isRunning() { return running ? 1 : 0; }

    function beginFrame() {
        const now = performance.now();
        deltaTime = Math.min(now - lastFrameTime, 50);
        lastFrameTime = now;

        // FPS 统计
        frameCount++;
        fpsTimer += deltaTime;
        if (fpsTimer >= 500) {
            stats.fps = Math.round(frameCount * 1000 / fpsTimer);
            stats.frameTime = deltaTime;
            frameCount = 0;
            fpsTimer = 0;
        }

        stats.drawCalls = 0;
        stats.entityCount = entities.size;

        // 物理世界步进（dt 转秒）
        physicsStep(deltaTime * 0.001);

        // 音频实例更新（淡入淡出、3D距离衰减）
        updateAudioInstances(deltaTime * 0.001);

        // 清屏
        clear(sceneBgColor);
    }

    function endFrame() {
        // 输入帧末快照
        for (let i = 0; i < KEY.MAX; i++) {
            inputState.prevKeys[i] = inputState.keys[i];
        }
        // 触摸列表在帧末清空（由平台层在下一帧重新填充）
        // 保留当前帧的触摸供查询
    }

    function getDeltaTime() { return deltaTime; }

    function getStats() {
        return {
            fps: stats.fps,
            frameTime: stats.frameTime,
            drawCalls: stats.drawCalls,
            entityCount: stats.entityCount,
            memoryUsed: 0,
        };
    }

    function getPlatform() { return config.platform; }
    function getRendererType() { return config.rendererType; }

    // ============================================================
    // 渲染 API
    // ============================================================

    function clear(color) {
        ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        stats.drawCalls++;
    }

    function setCamera(x, y, zoom) {
        camera.x = x;
        camera.y = y;
        camera.zoom = zoom || 1;
    }

    function worldToScreenX(x) { return (x - camera.x) * camera.zoom; }
    function worldToScreenY(y) { return (y - camera.y) * camera.zoom; }

    function drawRect(rect, color, filled) {
        const sx = worldToScreenX(rect.x);
        const sy = worldToScreenY(rect.y);
        const sw = rect.w * camera.zoom;
        const sh = rect.h * camera.zoom;

        if (filled) {
            ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.fillRect(sx, sy, sw, sh);
        } else {
            ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.lineWidth = 1;
            ctx.strokeRect(sx, sy, sw, sh);
        }
        stats.drawCalls++;
    }

    function drawSprite(textureId, dest, src) {
        const tex = textures.get(textureId);
        if (!tex) return;
        const sx = worldToScreenX(dest.x);
        const sy = worldToScreenY(dest.y);
        const sw = dest.w * camera.zoom;
        const sh = dest.h * camera.zoom;

        if (src) {
            ctx.drawImage(tex, src.x, src.y, src.w, src.h, sx, sy, sw, sh);
        } else {
            ctx.drawImage(tex, sx, sy, sw, sh);
        }
        stats.drawCalls++;
    }

    function drawText(text, x, y, size, color) {
        const sx = worldToScreenX(x);
        const sy = worldToScreenY(y);
        ctx.font = `${size}px 'MinecraftAE', monospace`;
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
        ctx.textBaseline = 'top';
        ctx.fillText(text, sx, sy);
        stats.drawCalls++;
    }

    function drawPixel(x, y, color) {
        const sx = Math.round(worldToScreenX(x));
        const sy = Math.round(worldToScreenY(y));
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
        ctx.fillRect(sx, sy, camera.zoom, camera.zoom);
        stats.drawCalls++;
    }

    function flush() {
        // Canvas2D 即时模式，无需 flush
    }

    // --- 纹理管理 ---
    function loadTexture(path) {
        const img = new Image();
        img.src = path;
        const id = nextTextureId++;
        // 异步加载，加载完成前绘制为空
        textures.set(id, img);
        return id;
    }

    function createTextureFromData(w, h, rgbaData) {
        const offscreen = document.createElement('canvas');
        offscreen.width = w;
        offscreen.height = h;
        const octx = offscreen.getContext('2d');
        const imageData = octx.createImageData(w, h);
        for (let i = 0; i < rgbaData.length; i++) {
            imageData.data[i] = rgbaData[i];
        }
        octx.putImageData(imageData, 0, 0);
        const id = nextTextureId++;
        textures.set(id, offscreen);
        return id;
    }

    function destroyTexture(id) {
        textures.delete(id);
    }

    // ============================================================
    // 2D 场景渲染 API
    // ============================================================

    // --- 辅助：构建 CSS filter 字符串 ---
    function buildFilterString() {
        const parts = [];
        if (sceneColor.brightness !== 1.0) parts.push(`brightness(${sceneColor.brightness})`);
        if (sceneColor.contrast !== 1.0) parts.push(`contrast(${sceneColor.contrast})`);
        if (sceneColor.saturation !== 1.0) parts.push(`saturate(${sceneColor.saturation})`);
        if (sceneColor.hueShift !== 0.0) parts.push(`hue-rotate(${sceneColor.hueShift}deg)`);
        if (sceneColor.grayscale > 0.0) parts.push(`grayscale(${sceneColor.grayscale})`);
        if (sceneColor.sepia > 0.0) parts.push(`sepia(${sceneColor.sepia})`);
        if (sceneColor.invert > 0.0) parts.push(`invert(${sceneColor.invert})`);
        if (sceneClarity.blurRadius > 0.0) parts.push(`blur(${sceneClarity.blurRadius}px)`);
        return parts.length > 0 ? parts.join(' ') : 'none';
    }

    // --- 场景色彩色调控制 ---
    function setSceneTint(tint) {
        sceneColor.tint = tint;
    }

    function setSceneBrightness(brightness) {
        sceneColor.brightness = Math.max(0, Math.min(2, brightness));
    }

    function setSceneContrast(contrast) {
        sceneColor.contrast = Math.max(0, Math.min(2, contrast));
    }

    function setSceneSaturation(saturation) {
        sceneColor.saturation = Math.max(0, Math.min(2, saturation));
    }

    function setSceneHueShift(hueShift) {
        sceneColor.hueShift = ((hueShift % 360) + 360) % 360;
    }

    function setSceneGrayscale(amount) {
        sceneColor.grayscale = Math.max(0, Math.min(1, amount));
    }

    function setSceneSepia(amount) {
        sceneColor.sepia = Math.max(0, Math.min(1, amount));
    }

    function setSceneInvert(amount) {
        sceneColor.invert = Math.max(0, Math.min(1, amount));
    }

    function setSceneColor(color) {
        if (color) Object.assign(sceneColor, color);
    }

    function getSceneColor() {
        return Object.assign({}, sceneColor);
    }

    function resetSceneColor() {
        sceneColor = Object.assign({}, DEFAULT_SCENE_COLOR);
    }

    // --- 场景清晰度控制 ---
    function setSceneSharpness(sharpness) {
        sceneClarity.sharpness = Math.max(-1, Math.min(1, sharpness));
    }

    function setSceneBlur(radius) {
        sceneClarity.blurRadius = Math.max(0, radius);
    }

    function setSceneBloom(intensity, threshold) {
        sceneClarity.bloomIntensity = Math.max(0, Math.min(1, intensity));
        sceneClarity.bloomThreshold = Math.max(0, Math.min(1, threshold));
    }

    function setSceneClarity(clarity) {
        if (clarity) Object.assign(sceneClarity, clarity);
    }

    function getSceneClarity() {
        return Object.assign({}, sceneClarity);
    }

    function resetSceneClarity() {
        sceneClarity = Object.assign({}, DEFAULT_SCENE_CLARITY);
    }

    // --- 暗角与雾效 ---
    function setVignette(intensity, radius) {
        vignetteState.intensity = Math.max(0, Math.min(1, intensity));
        vignetteState.radius = Math.max(0, Math.min(1, radius));
    }

    function setFog(color, density, start, end) {
        fogState.color = color;
        fogState.density = Math.max(0, Math.min(1, density));
        fogState.start = start;
        fogState.end = end;
    }

    function resetVignette() {
        vignetteState = { intensity: 0.0, radius: 0.5 };
    }

    function resetFog() {
        fogState = { color: { r: 0, g: 0, b: 0, a: 0 }, density: 0.0, start: 0.0, end: 0.0 };
    }

    // --- 场景后期处理 ---
    function applySceneEffects() {
        const filterStr = buildFilterString();
        const hasTint = sceneColor.tint.r !== 255 || sceneColor.tint.g !== 255 ||
                        sceneColor.tint.b !== 255 || sceneColor.tint.a !== 255;
        const hasVignette = vignetteState.intensity > 0.0;
        const hasFog = fogState.density > 0.0;

        if (filterStr === 'none' && !hasTint && !hasVignette && !hasFog) return;

        // 准备离屏画布做快照
        if (!effectCanvas) {
            effectCanvas = document.createElement('canvas');
            effectCtx = effectCanvas.getContext('2d');
        }
        const w = canvas.width;
        const h = canvas.height;
        effectCanvas.width = w;
        effectCanvas.height = h;
        effectCtx.clearRect(0, 0, w, h);
        effectCtx.drawImage(canvas, 0, 0);

        // 1) 应用 CSS filter（亮度/对比度/饱和度/色相/灰度/棕褐/反色/模糊）
        ctx.save();
        if (filterStr !== 'none') {
            ctx.filter = filterStr;
        }
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(effectCanvas, 0, 0);
        ctx.filter = 'none';
        ctx.restore();

        // 2) 色调叠加（multiply 混合）
        if (hasTint) {
            ctx.save();
            ctx.globalCompositeOperation = 'multiply';
            ctx.fillStyle = `rgba(${sceneColor.tint.r},${sceneColor.tint.g},${sceneColor.tint.b},${sceneColor.tint.a / 255})`;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }

        // 3) 暗角
        if (hasVignette) {
            const cx = w / 2;
            const cy = h / 2;
            const innerR = Math.max(w, h) * vignetteState.radius * 0.3;
            const outerR = Math.max(w, h) * vignetteState.radius;
            const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
            grad.addColorStop(0, 'rgba(0,0,0,0)');
            grad.addColorStop(1, `rgba(0,0,0,${vignetteState.intensity})`);
            ctx.save();
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }

        // 4) 雾效
        if (hasFog) {
            ctx.save();
            ctx.globalAlpha = fogState.density;
            ctx.fillStyle = `rgba(${fogState.color.r},${fogState.color.g},${fogState.color.b},${fogState.color.a / 255})`;
            ctx.fillRect(0, 0, w, h);
            ctx.restore();
        }

        stats.drawCalls++;
    }

    // --- 光线渲染 ---
    function addLight(type, x, y, radius, color, intensity) {
        const id = nextLightId++;
        lightMap.set(id, {
            type: type,
            x: x, y: y,
            radius: radius,
            color: color,
            intensity: intensity,
            dirX: 0, dirY: 1,
            angle: 45,
        });
        return id;
    }

    function setLightDirection(lightId, dirX, dirY) {
        const l = lightMap.get(lightId);
        if (l) { l.dirX = dirX; l.dirY = dirY; }
    }

    function setLightAngle(lightId, angle) {
        const l = lightMap.get(lightId);
        if (l) l.angle = angle;
    }

    function setLightIntensity(lightId, intensity) {
        const l = lightMap.get(lightId);
        if (l) l.intensity = intensity;
    }

    function setLightColor(lightId, color) {
        const l = lightMap.get(lightId);
        if (l) l.color = color;
    }

    function setLightPosition(lightId, x, y) {
        const l = lightMap.get(lightId);
        if (l) { l.x = x; l.y = y; }
    }

    function removeLight(lightId) {
        lightMap.delete(lightId);
    }

    function clearLights() {
        lightMap.clear();
    }

    function getLightCount() {
        return lightMap.size;
    }

    function setAmbientLight(color, intensity) {
        lightingState.color = color;
        lightingState.intensity = Math.max(0, Math.min(1, intensity));
    }

    function setLightFalloff(falloff) {
        lightingState.falloff = Math.max(0.5, falloff);
    }

    function renderLights() {
        if (lightMap.size === 0 && lightingState.intensity <= 0.0) return;

        const w = canvas.width;
        const h = canvas.height;

        ctx.save();
        // 加法混合：光源叠加
        ctx.globalCompositeOperation = 'lighter';

        // 环境光
        if (lightingState.intensity > 0.0) {
            ctx.globalAlpha = lightingState.intensity;
            ctx.fillStyle = `rgb(${lightingState.color.r},${lightingState.color.g},${lightingState.color.b})`;
            ctx.fillRect(0, 0, w, h);
            ctx.globalAlpha = 1.0;
        }

        // 逐光源渲染
        for (const [id, light] of lightMap) {
            const sx = worldToScreenX(light.x);
            const sy = worldToScreenY(light.y);
            const r = Math.max(1, light.radius * camera.zoom);
            const a = Math.max(0, Math.min(1, light.intensity));
            const cr = light.color.r, cg = light.color.g, cb = light.color.b;

            if (light.type === LIGHT.POINT) {
                // 点光源：径向渐变
                const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
                grad.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
                grad.addColorStop(0.5, `rgba(${cr},${cg},${cb},${a * 0.5})`);
                grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                ctx.fillStyle = grad;
                ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
            } else if (light.type === LIGHT.DIRECTIONAL) {
                // 方向光：覆盖全屏的半透明色
                ctx.globalAlpha = a * 0.4;
                ctx.fillStyle = `rgb(${cr},${cg},${cb})`;
                ctx.fillRect(0, 0, w, h);
                ctx.globalAlpha = 1.0;
            } else if (light.type === LIGHT.SPOT) {
                // 聚光灯：带角度衰减的径向渐变
                const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
                grad.addColorStop(0, `rgba(${cr},${cg},${cb},${a})`);
                grad.addColorStop(0.6, `rgba(${cr},${cg},${cb},${a * 0.4})`);
                grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
                ctx.fillStyle = grad;
                ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
            }
        }

        ctx.restore();
        stats.drawCalls++;
    }

    // --- 图片接入接口 ---
    function loadImage(path, callback) {
        const img = new Image();
        const id = nextTextureId++;
        textures.set(id, img);
        img.onload = function() {
            if (callback) callback(id, img.naturalWidth, img.naturalHeight);
        };
        img.onerror = function() {
            if (callback) callback(id, 0, 0);
        };
        img.src = path;
        return id;
    }

    function drawImageTiled(texId, dest, src, offsetX, offsetY) {
        const tex = textures.get(texId);
        if (!tex) return;
        const sx = worldToScreenX(dest.x);
        const sy = worldToScreenY(dest.y);
        const sw = dest.w * camera.zoom;
        const sh = dest.h * camera.zoom;

        ctx.save();
        ctx.beginPath();
        ctx.rect(sx, sy, sw, sh);
        ctx.clip();

        const tw = ((src && src.w > 0) ? src.w : tex.naturalWidth) * camera.zoom;
        const th = ((src && src.h > 0) ? src.h : tex.naturalHeight) * camera.zoom;
        const ox = (offsetX || 0) * camera.zoom;
        const oy = (offsetY || 0) * camera.zoom;

        const startX = sx + ox - Math.floor(ox / tw) * tw;
        const startY = sy + oy - Math.floor(oy / th) * th;

        for (let y = startY - th; y < sy + sh; y += th) {
            for (let x = startX - tw; x < sx + sw; x += tw) {
                if (src) {
                    ctx.drawImage(tex, src.x, src.y, src.w, src.h, x, y, tw, th);
                } else {
                    ctx.drawImage(tex, x, y, tw, th);
                }
            }
        }
        ctx.restore();
        stats.drawCalls++;
    }

    function drawImageRotated(texId, cx, cy, angleDeg, scale, src) {
        const tex = textures.get(texId);
        if (!tex) return;
        const sx = worldToScreenX(cx);
        const sy = worldToScreenY(cy);

        const tw = ((src && src.w > 0 ? src.w : tex.naturalWidth) * camera.zoom) * scale;
        const th = ((src && src.h > 0 ? src.h : tex.naturalHeight) * camera.zoom) * scale;

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angleDeg * Math.PI / 180);

        if (src) {
            ctx.drawImage(tex, src.x, src.y, src.w, src.h, -tw / 2, -th / 2, tw, th);
        } else {
            ctx.drawImage(tex, -tw / 2, -th / 2, tw, th);
        }
        ctx.restore();
        stats.drawCalls++;
    }

    function drawImageWithColor(texId, dest, src, color) {
        const tex = textures.get(texId);
        if (!tex) return;
        const sx = worldToScreenX(dest.x);
        const sy = worldToScreenY(dest.y);
        const sw = dest.w * camera.zoom;
        const sh = dest.h * camera.zoom;

        ctx.save();
        ctx.globalAlpha = color.a / 255;
        if (src) {
            ctx.drawImage(tex, src.x, src.y, src.w, src.h, sx, sy, sw, sh);
        } else {
            ctx.drawImage(tex, sx, sy, sw, sh);
        }
        // 色调叠加
        if (color.r !== 255 || color.g !== 255 || color.b !== 255) {
            ctx.globalCompositeOperation = 'source-atop';
            ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`;
            ctx.fillRect(sx, sy, sw, sh);
        }
        ctx.restore();
        stats.drawCalls++;
    }

    function drawImageRegion(texId, dest, src, color, rotation, tiled) {
        if (tiled) {
            drawImageTiled(texId, dest, src, 0, 0);
        } else if (rotation && rotation !== 0) {
            drawImageRotated(texId, dest.x + dest.w * 0.5, dest.y + dest.h * 0.5,
                           rotation, 1.0, src);
        } else {
            drawImageWithColor(texId, dest, src, color || { r: 255, g: 255, b: 255, a: 255 });
        }
    }

    // --- 离屏渲染目标 ---
    function createRenderTarget(w, h) {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = w;
        offCanvas.height = h;
        const offCtx = offCanvas.getContext('2d');
        const id = nextRenderTargetId++;
        renderTargetMap.set(id, { canvas: offCanvas, ctx: offCtx, w: w, h: h });
        return id;
    }

    function setRenderTarget(id) {
        if (id === 0) {
            // 恢复到主画布
            if (mainCanvas) {
                canvas = mainCanvas;
                ctx = mainCtx;
            }
            activeRenderTargetId = 0;
            return;
        }
        const rt = renderTargetMap.get(id);
        if (!rt) return;
        // 切换到渲染目标画布
        canvas = rt.canvas;
        ctx = rt.ctx;
        activeRenderTargetId = id;
    }

    function drawRenderTarget(id, dest) {
        const rt = renderTargetMap.get(id);
        if (!rt) return;
        // 确保绘制到主画布
        const targetCtx = activeRenderTargetId === 0 ? ctx : mainCtx;
        const targetCanvas = activeRenderTargetId === 0 ? canvas : mainCanvas;
        const sx = worldToScreenX(dest.x);
        const sy = worldToScreenY(dest.y);
        const sw = dest.w * camera.zoom;
        const sh = dest.h * camera.zoom;
        targetCtx.drawImage(rt.canvas, sx, sy, sw, sh);
        stats.drawCalls++;
    }

    function destroyRenderTarget(id) {
        renderTargetMap.delete(id);
        if (activeRenderTargetId === id) {
            setRenderTarget(0);
        }
    }

    // ============================================================
    // 2D 物理模拟 API
    // ============================================================

    function physicsSetGravity(gx, gy) {
        physicsWorld.gravity.x = gx;
        physicsWorld.gravity.y = gy;
    }

    function physicsGetGravity() {
        return { gx: physicsWorld.gravity.x, gy: physicsWorld.gravity.y };
    }

    function physicsSetIterations(vIter, pIter) {
        physicsWorld.velocityIter = vIter;
        physicsWorld.positionIter = pIter;
    }

    function physicsStep(dt) {
        const bodies = physicsWorld.bodyArray || [];
        // 积分
        for (const [id, body] of physicsWorld.bodies) {
            if (body.type === BODY.STATIC) continue;
            if (body.type === BODY.DYNAMIC) {
                body.ax += physicsWorld.gravity.x * body.gravityScale;
                body.ay += physicsWorld.gravity.y * body.gravityScale;
            }
            // 自定义阻尼
            if (body.customDamping) {
                const factor = body.customDamping(Math.sqrt(body.vx*body.vx + body.vy*body.vy), body.mass, dt, body.dampingUserData);
                body.vx *= factor;
                body.vy *= factor;
            } else {
                const damp = Math.max(0, 1 - body.linearDamping * dt);
                body.vx *= damp;
                body.vy *= damp;
            }
            body.vx += body.ax * dt;
            body.vy += body.ay * dt;
            body.angularVel *= Math.max(0, 1 - body.angularDamping * dt);
            body.x += body.vx * dt;
            body.y += body.vy * dt;
            body.angle += body.angularVel * dt;
            body.ax = 0; body.ay = 0;
        }
        // 碰撞检测与响应
        const bodyList = Array.from(physicsWorld.bodies.values());
        const collisions = [];
        for (let i = 0; i < bodyList.length; i++) {
            for (let j = i + 1; j < bodyList.length; j++) {
                const a = bodyList[i], b = bodyList[j];
                if (a.type === BODY.STATIC && b.type === BODY.STATIC) continue;
                const col = checkBodyCollision(a, b);
                if (col) {
                    collisions.push(col);
                    resolveCollision(a, b, col);
                }
            }
        }
        // 碰撞回调
        if (physicsWorld.collisionCallback) {
            for (const col of collisions) {
                physicsWorld.collisionCallback(col, physicsWorld.collisionUserData);
            }
        }
    }

    function checkBodyCollision(a, b) {
        const sa = a.shape, sb = b.shape;
        if (sa.type === SHAPE.AABB && sb.type === SHAPE.AABB) {
            const dx = (a.x + sa.w/2) - (b.x + sb.w/2);
            const dy = (a.y + sa.h/2) - (b.y + sb.h/2);
            const ox = (sa.w + sb.w)/2 - Math.abs(dx);
            const oy = (sa.h + sb.h)/2 - Math.abs(dy);
            if (ox > 0 && oy > 0) {
                let nx = 0, ny = 0, pen = 0;
                if (ox < oy) { nx = dx < 0 ? -1 : 1; pen = ox; }
                else { ny = dy < 0 ? -1 : 1; pen = oy; }
                return { bodyA: a.id, bodyB: b.id, point: { x: (a.x+b.x)/2, y: (a.y+b.y)/2 }, normal: { x: nx, y: ny }, penetration: pen };
            }
        } else if (sa.type === SHAPE.CIRCLE && sb.type === SHAPE.CIRCLE) {
            const dx = b.x - a.x, dy = b.y - a.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const r = sa.radius + sb.radius;
            if (dist < r) {
                const nx = dist > 0 ? dx/dist : 0;
                const ny = dist > 0 ? dy/dist : 1;
                return { bodyA: a.id, bodyB: b.id, point: { x: a.x + nx*sa.radius, y: a.y + ny*sa.radius }, normal: { x: nx, y: ny }, penetration: r - dist };
            }
        } else {
            // AABB vs Circle
            const box = sa.type === SHAPE.AABB ? a : b;
            const cir = sa.type === SHAPE.CIRCLE ? a : b;
            const bs = sa.type === SHAPE.AABB ? sa : sb;
            const cs = sa.type === SHAPE.CIRCLE ? sa : sb;
            const closestX = Math.max(box.x, Math.min(cir.x, box.x + bs.w));
            const closestY = Math.max(box.y, Math.min(cir.y, box.y + bs.h));
            const dx = cir.x - closestX, dy = cir.y - closestY;
            const dist = Math.sqrt(dx*dx + dy*dy);
            if (dist < cs.radius) {
                const nx = dist > 0 ? dx/dist : 0;
                const ny = dist > 0 ? dy/dist : 1;
                const flip = sa.type === SHAPE.CIRCLE ? -1 : 1;
                return { bodyA: a.id, bodyB: b.id, point: { x: closestX, y: closestY }, normal: { x: nx*flip, y: ny*flip }, penetration: cs.radius - dist };
            }
        }
        return null;
    }

    function resolveCollision(a, b, col) {
        const totalInvMass = (a.type === BODY.STATIC ? 0 : 1/a.mass) + (b.type === BODY.STATIC ? 0 : 1/b.mass);
        if (totalInvMass === 0) return;
        const nx = col.normal.x, ny = col.normal.y;
        // 位置修正
        const correction = col.penetration / totalInvMass * 0.8;
        if (a.type !== BODY.STATIC) { a.x -= nx * correction / a.mass; a.y -= ny * correction / a.mass; }
        if (b.type !== BODY.STATIC) { b.x += nx * correction / b.mass; b.y += ny * correction / b.mass; }
        // 速度求解
        const rvx = b.vx - a.vx, rvy = b.vy - a.vy;
        const velAlongNormal = rvx * nx + rvy * ny;
        if (velAlongNormal > 0) return;
        const e = Math.min(a.restitution, b.restitution);
        let j = -(1 + e) * velAlongNormal / totalInvMass;
        const impx = j * nx, impy = j * ny;
        if (a.type !== BODY.STATIC) { a.vx -= impx / a.mass; a.vy -= impy / a.mass; }
        if (b.type !== BODY.STATIC) { b.vx += impx / b.mass; b.vy += impy / b.mass; }
        // 摩擦
        const tx = -ny, ty = nx;
        const velAlongTangent = rvx * tx + rvy * ty;
        const friction = Math.sqrt(a.friction * b.friction);
        let jt = -velAlongTangent / totalInvMass;
        jt = Math.max(-j * friction, Math.min(jt, j * friction));
        if (a.type !== BODY.STATIC) { a.vx -= jt * tx / a.mass; a.vy -= jt * ty / a.mass; }
        if (b.type !== BODY.STATIC) { b.vx += jt * tx / b.mass; b.vy += jt * ty / b.mass; }
    }

    function physicsCreateBody(def, x, y) {
        const id = physicsWorld.nextBodyId++;
        physicsWorld.bodies.set(id, {
            id: id,
            type: def.type,
            mass: def.type === BODY.STATIC ? 0 : (def.mass || 1),
            restitution: def.restitution || 0,
            friction: def.friction || 0,
            linearDamping: def.linearDamping || 0,
            angularDamping: def.angularDamping || 0,
            gravityScale: def.gravityScale !== undefined ? def.gravityScale : 1,
            shape: { type: SHAPE.AABB, w: 1, h: 1, radius: 0 },
            x: x, y: y, vx: 0, vy: 0, ax: 0, ay: 0,
            angle: 0, angularVel: 0,
            customDamping: null, dampingUserData: null,
        });
        return id;
    }

    function physicsDestroyBody(bodyId) { physicsWorld.bodies.delete(bodyId); }
    function physicsSetShape(bodyId, shape) { const b = physicsWorld.bodies.get(bodyId); if (b) b.shape = shape; }
    function physicsSetMass(bodyId, mass) { const b = physicsWorld.bodies.get(bodyId); if (b && b.type !== BODY.STATIC) b.mass = mass; }
    function physicsSetRestitution(bodyId, r) { const b = physicsWorld.bodies.get(bodyId); if (b) b.restitution = r; }
    function physicsSetFriction(bodyId, f) { const b = physicsWorld.bodies.get(bodyId); if (b) b.friction = f; }
    function physicsSetGravityScale(bodyId, s) { const b = physicsWorld.bodies.get(bodyId); if (b) b.gravityScale = s; }
    function physicsSetDamping(bodyId, linear, angular) { const b = physicsWorld.bodies.get(bodyId); if (b) { b.linearDamping = linear; b.angularDamping = angular; } }
    function physicsSetCustomDamping(bodyId, func, userData) { const b = physicsWorld.bodies.get(bodyId); if (b) { b.customDamping = func; b.dampingUserData = userData; } }
    function physicsClearCustomDamping(bodyId) { const b = physicsWorld.bodies.get(bodyId); if (b) { b.customDamping = null; b.dampingUserData = null; } }

    function physicsGetState(bodyId) { const b = physicsWorld.bodies.get(bodyId); return b ? { x:b.x, y:b.y, vx:b.vx, vy:b.vy, ax:b.ax, ay:b.ay, angle:b.angle, angularVel:b.angularVel } : null; }
    function physicsSetState(bodyId, st) { const b = physicsWorld.bodies.get(bodyId); if (b && st) { b.x=st.x; b.y=st.y; b.vx=st.vx; b.vy=st.vy; b.ax=st.ax; b.ay=st.ay; b.angle=st.angle; b.angularVel=st.angularVel; } }
    function physicsGetPosition(bodyId) { const b = physicsWorld.bodies.get(bodyId); return b ? { x:b.x, y:b.y } : null; }
    function physicsSetPosition(bodyId, x, y) { const b = physicsWorld.bodies.get(bodyId); if (b) { b.x=x; b.y=y; } }
    function physicsGetVelocity(bodyId) { const b = physicsWorld.bodies.get(bodyId); return b ? { vx:b.vx, vy:b.vy } : null; }
    function physicsSetVelocity(bodyId, vx, vy) { const b = physicsWorld.bodies.get(bodyId); if (b) { b.vx=vx; b.vy=vy; } }
    function physicsApplyForce(bodyId, fx, fy) { const b = physicsWorld.bodies.get(bodyId); if (b && b.mass > 0) { b.ax += fx/b.mass; b.ay += fy/b.mass; } }
    function physicsApplyImpulse(bodyId, ix, iy) { const b = physicsWorld.bodies.get(bodyId); if (b && b.mass > 0) { b.vx += ix/b.mass; b.vy += iy/b.mass; } }
    function physicsApplyTorque(bodyId, torque) { const b = physicsWorld.bodies.get(bodyId); if (b && b.mass > 0) b.angularVel += torque / b.mass * 0.01; }
    function physicsApplyAngularImpulse(bodyId, impulse) { const b = physicsWorld.bodies.get(bodyId); if (b && b.mass > 0) b.angularVel += impulse / b.mass; }

    function physicsCheckCollision(bodyA, bodyB) {
        const a = physicsWorld.bodies.get(bodyA), b = physicsWorld.bodies.get(bodyB);
        if (!a || !b) return null;
        return checkBodyCollision(a, b);
    }

    function physicsGetCollisions(bodyId, maxCount) {
        const result = [];
        const target = physicsWorld.bodies.get(bodyId);
        if (!target) return result;
        for (const [id, body] of physicsWorld.bodies) {
            if (id === bodyId) continue;
            const col = checkBodyCollision(target, body);
            if (col) result.push(col);
            if (result.length >= maxCount) break;
        }
        return result;
    }

    function physicsRaycast(x1, y1, x2, y2) {
        let closestT = 1.0;
        let hitBody = null;
        let hitPoint = null;
        for (const [id, body] of physicsWorld.bodies) {
            const s = body.shape;
            if (s.type === SHAPE.AABB) {
                // 射线-AABB (slab法)
                let tmin = 0, tmax = 1;
                const dx = x2 - x1, dy = y2 - y1;
                for (let axis = 0; axis < 2; axis++) {
                    const d = axis === 0 ? dx : dy;
                    const min = axis === 0 ? body.x : body.y;
                    const max = axis === 0 ? body.x + s.w : body.y + s.h;
                    if (Math.abs(d) < 1e-8) { if (min > (axis===0?x1:y1) || max < (axis===0?x1:y1)) { tmin = 1; break; } }
                    else { let t1 = (min - (axis===0?x1:y1))/d, t2 = (max - (axis===0?x1:y1))/d; if (t1>t2) [t1,t2]=[t2,t1]; tmin = Math.max(tmin,t1); tmax = Math.min(tmax,t2); }
                }
                if (tmin <= tmax && tmin < closestT) { closestT = tmin; hitBody = id; hitPoint = { x: x1+dx*tmin, y: y1+dy*tmin }; }
            } else if (s.type === SHAPE.CIRCLE) {
                const dx = x2 - x1, dy = y2 - y1;
                const fx = x1 - body.x, fy = y1 - body.y;
                const a = dx*dx + dy*dy, b2 = 2*(fx*dx + fy*dy), c = fx*fx + fy*fy - s.radius*s.radius;
                const disc = b2*b2 - 4*a*c;
                if (disc >= 0) { const t = (-b2 - Math.sqrt(disc)) / (2*a); if (t >= 0 && t < closestT) { closestT = t; hitBody = id; hitPoint = { x: x1+dx*t, y: y1+dy*t }; } }
            }
        }
        if (hitBody !== null) return { bodyId: hitBody, point: hitPoint, t: closestT };
        return null;
    }

    function physicsPointQuery(x, y) {
        for (const [id, body] of physicsWorld.bodies) {
            const s = body.shape;
            if (s.type === SHAPE.AABB) { if (x >= body.x && x <= body.x+s.w && y >= body.y && y <= body.y+s.h) return id; }
            else if (s.type === SHAPE.CIRCLE) { const dx=x-body.x, dy=y-body.y; if (dx*dx+dy*dy <= s.radius*s.radius) return id; }
        }
        return null;
    }

    function physicsOnCollision(callback, userData) { physicsWorld.collisionCallback = callback; physicsWorld.collisionUserData = userData; }
    function physicsReset() { physicsWorld.bodies.clear(); physicsWorld.collisionCallback = null; }

    // ============================================================
    // 增强音频 API
    // ============================================================

    function loadSound(path) { return loadAudio(path, false); }
    function loadMusic(path) { return loadAudio(path, true); }
    function getSupportedFormats() { return 'WAV,MP3,OGG'; }

    function playSound(id, volume, pitch, loop) {
        const src = audioSources.get(id);
        if (!src) return 0;
        const instId = nextAudioInstanceId++;
        const groupId = src.isMusic ? 1 : 0;
        audioInstances.set(instId, {
            sourceId: id, groupId: groupId,
            volume: volume, pitch: pitch || 1.0, pan: 0,
            playing: true, paused: false, loop: loop || false,
            position: 0, duration: src.duration || 0,
            fadeAmount: 1.0, fadeTarget: 1.0, fadeStart: 1.0, fadeDuration: 0, fadeElapsed: 0, fading: false,
            is3D: false, sourceX: 0, sourceY: 0, maxDist: 0,
            htmlAudio: null,
        });
        // 尝试使用HTML5 Audio播放
        if (src.url) {
            const audio = new Audio(src.url);
            audio.volume = volume * masterVolume * groupVolumes[groupId];
            audio.loop = loop || false;
            audio.playbackRate = pitch || 1.0;
            audio.play().catch(function(){});
            const inst = audioInstances.get(instId);
            inst.htmlAudio = audio;
        }
        return instId;
    }

    function stopSound(instId) {
        const inst = audioInstances.get(instId);
        if (!inst) return;
        inst.playing = false;
        if (inst.htmlAudio) { inst.htmlAudio.pause(); inst.htmlAudio = null; }
        audioInstances.delete(instId);
    }

    function pauseSound(instId) {
        const inst = audioInstances.get(instId);
        if (!inst) return;
        inst.paused = true;
        if (inst.htmlAudio) inst.htmlAudio.pause();
    }

    function resumeSound(instId) {
        const inst = audioInstances.get(instId);
        if (!inst) return;
        inst.paused = false;
        if (inst.htmlAudio) inst.htmlAudio.play().catch(function(){});
    }

    function setPitch(instId, pitch) {
        const inst = audioInstances.get(instId);
        if (inst) { inst.pitch = pitch; if (inst.htmlAudio) inst.htmlAudio.playbackRate = pitch; }
    }

    function setPan(instId, pan) {
        const inst = audioInstances.get(instId);
        if (inst) {
            inst.pan = Math.max(-1, Math.min(1, pan));
            // Web Audio API 支持 StereoPannerNode，这里简化处理
        }
    }

    function getAudioDuration(id) {
        const src = audioSources.get(id);
        return src ? (src.duration || 0) : 0;
    }

    function getAudioPosition(instId) {
        const inst = audioInstances.get(instId);
        return inst ? inst.position : 0;
    }

    function seekAudio(instId, pos) {
        const inst = audioInstances.get(instId);
        if (inst) { inst.position = pos; if (inst.htmlAudio) inst.htmlAudio.currentTime = pos; }
    }

    function fadeIn(instId, duration) {
        const inst = audioInstances.get(instId);
        if (inst) { inst.fading = true; inst.fadeOut = false; inst.fadeStart = 0; inst.fadeTarget = 1; inst.fadeAmount = 0; inst.fadeDuration = duration; inst.fadeElapsed = 0; }
    }

    function fadeOut(instId, duration) {
        const inst = audioInstances.get(instId);
        if (inst) { inst.fading = true; inst.fadeOut = true; inst.fadeStart = inst.fadeAmount; inst.fadeTarget = 0; inst.fadeDuration = duration; inst.fadeElapsed = 0; }
    }

    function setAudioListener(x, y, dirX, dirY) {
        audioListener.x = x; audioListener.y = y; audioListener.dirX = dirX; audioListener.dirY = dirY;
    }

    function playSound3d(id, x, y, maxDist, volume, loop) {
        const instId = playSound(id, volume, 1.0, loop);
        const inst = audioInstances.get(instId);
        if (inst) { inst.is3D = true; inst.sourceX = x; inst.sourceY = y; inst.maxDist = maxDist; }
        return instId;
    }

    function setMasterVolume(volume) { masterVolume = Math.max(0, Math.min(1, volume)); }
    function setGroupVolume(groupId, volume) { if (groupId >= 0 && groupId < 3) groupVolumes[groupId] = Math.max(0, Math.min(1, volume)); }
    function stopGroup(groupId) {
        for (const [id, inst] of audioInstances) {
            if (inst.groupId === groupId) stopSound(id);
        }
    }

    function updateAudioInstances(dt) {
        for (const [id, inst] of audioInstances) {
            if (inst.paused) continue;
            // 更新播放位置
            inst.position += dt * inst.pitch;
            if (!inst.loop && inst.position >= inst.duration && inst.duration > 0) {
                stopSound(id); continue;
            }
            // 淡入淡出
            if (inst.fading) {
                inst.fadeElapsed += dt;
                const t = Math.min(1, inst.fadeElapsed / inst.fadeDuration);
                inst.fadeAmount = inst.fadeStart + (inst.fadeTarget - inst.fadeStart) * t;
                if (t >= 1) { inst.fading = false; if (inst.fadeOut) { stopSound(id); continue; } }
            }
            // 3D距离衰减
            let spatialGain = 1.0;
            if (inst.is3D) {
                const dx = inst.sourceX - audioListener.x, dy = inst.sourceY - audioListener.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                spatialGain = Math.max(0, 1 - dist / inst.maxDist);
            }
            // 应用音量
            const vol = inst.volume * inst.fadeAmount * spatialGain * masterVolume * groupVolumes[inst.groupId];
            if (inst.htmlAudio) inst.htmlAudio.volume = Math.max(0, Math.min(1, vol));
        }
    }

    // ============================================================
    // 网络模块 API
    // ============================================================

    async function httpRequest(method, url, body, headers, callback, userData) {
        const reqId = nextRequestId++;
        try {
            const opts = { method: ['GET','POST','PUT','DELETE','PATCH'][method] || 'GET' };
            // 全局请求头
            const hdrs = Object.assign({}, globalHeaders);
            if (headers) { headers.split('\n').forEach(function(line) { const p = line.split(':'); if (p.length === 2) hdrs[p[0].trim()] = p[1].trim(); }); }
            if (Object.keys(hdrs).length > 0) opts.headers = hdrs;
            if (body) opts.body = body;
            if (authToken) { if (!opts.headers) opts.headers = {}; opts.headers['Authorization'] = 'Bearer ' + authToken; }
            const controller = new AbortController();
            const timeoutId = setTimeout(function() { controller.abort(); }, httpTimeout * 1000);
            opts.signal = controller.signal;
            const response = await fetch(url, opts);
            clearTimeout(timeoutId);
            const respBody = await response.text();
            const respHeaders = [];
            response.headers.forEach(function(v, k) { respHeaders.push(k + ':' + v); });
            const resp = { statusCode: response.status, body: respBody, bodyLength: respBody.length, headers: respHeaders.join('\n') };
            if (callback) callback(resp, userData);
            return reqId;
        } catch (err) {
            const resp = { statusCode: 0, body: String(err), bodyLength: 0, headers: '' };
            if (callback) callback(resp, userData);
            return reqId;
        }
    }

    function httpGet(url, callback, userData) { return httpRequest(HTTP.GET, url, null, null, callback, userData); }
    function httpPost(url, body, callback, userData) { return httpRequest(HTTP.POST, url, body, null, callback, userData); }
    function httpPut(url, body, callback, userData) { return httpRequest(HTTP.PUT, url, body, null, callback, userData); }
    function httpDelete(url, callback, userData) { return httpRequest(HTTP.DELETE, url, null, null, callback, userData); }
    function httpCancel(requestId) { /* fetch AbortController 需要额外存储，简化处理 */ }
    function httpSetHeader(key, value) { globalHeaders[key] = value; }
    function httpSetTimeout(seconds) { httpTimeout = seconds; }
    function httpSetAuthToken(token) { authToken = token; }

    function wsConnect(url, callback, userData) {
        const wsId = nextWsId++;
        try {
            const ws = new WebSocket(url);
            wsConnections.set(wsId, { ws: ws, connected: false });
            ws.onopen = function() { const c = wsConnections.get(wsId); if (c) c.connected = true; if (callback) callback(WS.OPEN, '', 0, userData); };
            ws.onmessage = function(e) { if (callback) callback(WS.MESSAGE, e.data, e.data.length, userData); };
            ws.onclose = function() { const c = wsConnections.get(wsId); if (c) c.connected = false; if (callback) callback(WS.CLOSE, '', 0, userData); wsConnections.delete(wsId); };
            ws.onerror = function() { if (callback) callback(WS.ERROR, '', 0, userData); };
            return wsId;
        } catch (e) {
            if (callback) callback(WS.ERROR, String(e), 0, userData);
            return 0;
        }
    }

    function wsSend(wsId, data, length) { const c = wsConnections.get(wsId); if (c && c.connected) c.ws.send(data); }
    function wsSendText(wsId, text) { const c = wsConnections.get(wsId); if (c && c.connected) c.ws.send(text); }
    function wsClose(wsId) { const c = wsConnections.get(wsId); if (c) { c.ws.close(); c.connected = false; wsConnections.delete(wsId); } }
    function wsIsConnected(wsId) { const c = wsConnections.get(wsId); return c ? c.connected : false; }

    function jsonParse(jsonStr, key) {
        try {
            const obj = JSON.parse(jsonStr);
            const val = obj[key];
            return val !== undefined ? String(val) : null;
        } catch (e) { return null; }
    }

    function jsonGetNumber(jsonStr, key, defVal) {
        try { const obj = JSON.parse(jsonStr); return obj[key] !== undefined ? Number(obj[key]) : defVal; }
        catch (e) { return defVal; }
    }

    function jsonGetBool(jsonStr, key, defVal) {
        try { const obj = JSON.parse(jsonStr); return obj[key] !== undefined ? Boolean(obj[key]) : defVal; }
        catch (e) { return defVal; }
    }

    function jsonBuild(pairs) {
        const obj = {};
        pairs.split('\n').forEach(function(line) {
            const idx = line.indexOf('=');
            if (idx > 0) { const k = line.substring(0, idx).trim(); const v = line.substring(idx + 1).trim(); obj[k] = v; }
        });
        return JSON.stringify(obj);
    }

    function uploadData(url, jsonData, callback, userData) {
        return httpRequest(HTTP.POST, url, jsonData, 'Content-Type:application/json', callback, userData);
    }

    function downloadData(url, callback, userData) {
        return httpRequest(HTTP.GET, url, null, null, callback, userData);
    }

    // ============================================================
    // AI 模块 API
    // ============================================================

    // --- 行为树 ---
    function aiCreateTree() {
        const id = nextTreeId++;
        aiTrees.set(id, { rootId: null, entity: 0, nodes: new Map() });
        return id;
    }

    function aiDestroyTree(treeId) { aiTrees.delete(treeId); }

    function aiCreateNode(treeId, type, func, userData) {
        const tree = aiTrees.get(treeId);
        if (!tree) return 0;
        const nodeId = nextNodeId++;
        tree.nodes.set(nodeId, { id: nodeId, type: type, func: func, userData: userData, children: [], parent: null, status: AI.FAILURE });
        if (tree.rootId === null) tree.rootId = nodeId;
        return nodeId;
    }

    function aiAddChild(parentId, childId) {
        for (const [tid, tree] of aiTrees) {
            const p = tree.nodes.get(parentId);
            const c = tree.nodes.get(childId);
            if (p && c) { p.children.push(childId); c.parent = parentId; break; }
        }
    }

    function aiSetEntity(treeId, entity) { const t = aiTrees.get(treeId); if (t) t.entity = entity; }

    function aiTickNode(tree, nodeId, dt) {
        const node = tree.nodes.get(nodeId);
        if (!node) return AI.FAILURE;
        if (node.type === AI.NODE_ACTION || node.type === AI.NODE_CONDITION) {
            node.status = node.func ? node.func(tree.entity, dt, node.userData) : AI.FAILURE;
            return node.status;
        }
        if (node.type === AI.NODE_SEQUENCE) {
            for (const childId of node.children) {
                const s = aiTickNode(tree, childId, dt);
                if (s !== AI.SUCCESS) { node.status = s; return s; }
            }
            node.status = AI.SUCCESS; return AI.SUCCESS;
        }
        if (node.type === AI.NODE_SELECTOR) {
            for (const childId of node.children) {
                const s = aiTickNode(tree, childId, dt);
                if (s !== AI.FAILURE) { node.status = s; return s; }
            }
            node.status = AI.FAILURE; return AI.FAILURE;
        }
        if (node.type === AI.NODE_PARALLEL) {
            let succ = 0, fail = 0;
            for (const childId of node.children) {
                const s = aiTickNode(tree, childId, dt);
                if (s === AI.SUCCESS) succ++; else if (s === AI.FAILURE) fail++;
            }
            node.status = succ >= node.children.length / 2 ? AI.SUCCESS : (fail >= node.children.length ? AI.FAILURE : AI.RUNNING);
            return node.status;
        }
        if (node.type === AI.NODE_DECORATOR) {
            if (node.children.length > 0) {
                const s = aiTickNode(tree, node.children[0], dt);
                node.status = s === AI.SUCCESS ? AI.FAILURE : AI.SUCCESS; // 逆变器
                return node.status;
            }
            node.status = AI.FAILURE; return AI.FAILURE;
        }
        return AI.FAILURE;
    }

    function aiTick(treeId, dt) {
        const tree = aiTrees.get(treeId);
        if (!tree || tree.rootId === null) return AI.FAILURE;
        return aiTickNode(tree, tree.rootId, dt);
    }

    // --- 有限状态机 ---
    function aiCreateFsm() {
        const id = nextFsmId++;
        aiFsms.set(id, { states: new Map(), transitions: [], currentState: 0, stateCounter: 0 });
        return id;
    }

    function aiDestroyFsm(fsmId) { aiFsms.delete(fsmId); }

    function aiFsmAddState(fsmId, name, onUpdate, userData) {
        const fsm = aiFsms.get(fsmId);
        if (!fsm) return 0;
        const stateId = ++fsm.stateCounter;
        fsm.states.set(stateId, { id: stateId, name: name, onUpdate: onUpdate, userData: userData });
        if (fsm.currentState === 0) fsm.currentState = stateId;
        return stateId;
    }

    function aiFsmAddTransition(fsmId, fromState, toState, condition, userData) {
        const fsm = aiFsms.get(fsmId);
        if (!fsm) return;
        fsm.transitions.push({ from: fromState, to: toState, condition: condition, userData: userData });
    }

    function aiFsmSetState(fsmId, stateId) { const fsm = aiFsms.get(fsmId); if (fsm) fsm.currentState = stateId; }
    function aiFsmGetState(fsmId) { const fsm = aiFsms.get(fsmId); return fsm ? fsm.currentState : 0; }
    function aiFsmGetStateName(fsmId) { const fsm = aiFsms.get(fsmId); if (!fsm) return ''; const s = fsm.states.get(fsm.currentState); return s ? s.name : ''; }

    function aiFsmTick(fsmId, dt) {
        const fsm = aiFsms.get(fsmId);
        if (!fsm) return;
        // 检查转换
        for (const trans of fsm.transitions) {
            if (trans.from === fsm.currentState && trans.condition) {
                if (trans.condition(0, dt, trans.userData) === AI.SUCCESS) { fsm.currentState = trans.to; break; }
            }
        }
        // 执行当前状态
        const state = fsm.states.get(fsm.currentState);
        if (state && state.onUpdate) state.onUpdate(0, dt, state.userData);
    }

    // --- A* 寻路 ---
    function aiCreateGrid(width, height, cellSize) {
        const id = nextGridId++;
        const blocked = new Array(width * height).fill(false);
        const cost = new Array(width * height).fill(1.0);
        aiGrids.set(id, { width: width, height: height, cellSize: cellSize, blocked: blocked, cost: cost });
        return id;
    }

    function aiDestroyGrid(gridId) { aiGrids.delete(gridId); }
    function aiGridSetBlocked(gridId, x, y, blocked) { const g = aiGrids.get(gridId); if (g && x >= 0 && x < g.width && y >= 0 && y < g.height) g.blocked[y * g.width + x] = blocked; }
    function aiGridIsBlocked(gridId, x, y) { const g = aiGrids.get(gridId); if (!g || x < 0 || x >= g.width || y < 0 || y >= g.height) return true; return g.blocked[y * g.width + x]; }
    function aiGridSetCost(gridId, x, y, cost) { const g = aiGrids.get(gridId); if (g && x >= 0 && x < g.width && y >= 0 && y < g.height) g.cost[y * g.width + x] = cost; }

    function aiFindPath(gridId, startX, startY, endX, endY, maxPathLen) {
        const g = aiGrids.get(gridId);
        if (!g) return [];
        if (startX < 0 || startX >= g.width || startY < 0 || startY >= g.height) return [];
        if (endX < 0 || endX >= g.width || endY < 0 || endY >= g.height) return [];
        if (g.blocked[endY * g.width + endX]) return [];

        const openSet = [{ x: startX, y: startY, g: 0, h: 0, f: 0, parent: null }];
        openSet[0].h = Math.abs(startX - endX) + Math.abs(startY - endY);
        openSet[0].f = openSet[0].h;
        const closedSet = new Set();
        const cameFrom = new Map();
        const gScore = new Map();
        gScore.set(startX + ',' + startY, 0);

        const dirs = [[0,1],[1,0],[0,-1],[-1,0],[1,1],[1,-1],[-1,1],[-1,-1]];

        while (openSet.length > 0) {
            // 找最小f
            openSet.sort(function(a, b) { return a.f - b.f; });
            const current = openSet.shift();
            const key = current.x + ',' + current.y;
            if (current.x === endX && current.y === endY) {
                // 回溯路径
                const path = [];
                let node = current;
                while (node) { path.unshift({ x: node.x, y: node.y }); node = node.parent; }
                return path.slice(0, maxPathLen);
            }
            closedSet.add(key);
            for (const [dx, dy] of dirs) {
                const nx = current.x + dx, ny = current.y + dy;
                if (nx < 0 || nx >= g.width || ny < 0 || ny >= g.height) continue;
                const nkey = nx + ',' + ny;
                if (closedSet.has(nkey)) continue;
                if (g.blocked[ny * g.width + nx]) continue;
                // 对角线防穿墙
                if (dx !== 0 && dy !== 0) {
                    if (g.blocked[current.y * g.width + nx] || g.blocked[ny * g.width + current.x]) continue;
                }
                const moveCost = (dx !== 0 && dy !== 0) ? 1.414 : 1.0;
                const cellCost = g.cost[ny * g.width + nx] || 1.0;
                const tentativeG = current.g + moveCost * cellCost;
                const existingG = gScore.get(nkey);
                if (existingG === undefined || tentativeG < existingG) {
                    gScore.set(nkey, tentativeG);
                    const h = Math.abs(nx - endX) + Math.abs(ny - endY);
                    openSet.push({ x: nx, y: ny, g: tentativeG, h: h, f: tentativeG + h, parent: current });
                }
            }
        }
        return [];
    }

    function aiPathLength(path, pathLen) {
        let len = 0;
        for (let i = 1; i < pathLen && i < path.length; i++) {
            const dx = path[i].x - path[i-1].x;
            const dy = path[i].y - path[i-1].y;
            len += Math.sqrt(dx*dx + dy*dy);
        }
        return len;
    }

    // --- 黑板系统 ---
    function aiCreateBlackboard() {
        const id = nextBbId++;
        aiBlackboards.set(id, new Map());
        return id;
    }

    function aiBbSetInt(bbId, key, val) { const bb = aiBlackboards.get(bbId); if (bb) bb.set(key, { type: 'int', value: val }); }
    function aiBbSetFloat(bbId, key, val) { const bb = aiBlackboards.get(bbId); if (bb) bb.set(key, { type: 'float', value: val }); }
    function aiBbSetString(bbId, key, val) { const bb = aiBlackboards.get(bbId); if (bb) bb.set(key, { type: 'string', value: val }); }
    function aiBbSetBool(bbId, key, val) { const bb = aiBlackboards.get(bbId); if (bb) bb.set(key, { type: 'bool', value: val }); }
    function aiBbGetInt(bbId, key, defVal) { const bb = aiBlackboards.get(bbId); const v = bb ? bb.get(key) : null; return v && v.type === 'int' ? v.value : defVal; }
    function aiBbGetFloat(bbId, key, defVal) { const bb = aiBlackboards.get(bbId); const v = bb ? bb.get(key) : null; return v && v.type === 'float' ? v.value : defVal; }
    function aiBbGetString(bbId, key) { const bb = aiBlackboards.get(bbId); const v = bb ? bb.get(key) : null; return v && v.type === 'string' ? v.value : null; }
    function aiBbGetBool(bbId, key, defVal) { const bb = aiBlackboards.get(bbId); const v = bb ? bb.get(key) : null; return v && v.type === 'bool' ? v.value : defVal; }
    function aiBbRemove(bbId, key) { const bb = aiBlackboards.get(bbId); if (bb) bb.delete(key); }
    function aiBbClear(bbId) { const bb = aiBlackboards.get(bbId); if (bb) bb.clear(); }

    // --- AI Agent ---
    function aiRegisterAgent(name, think, userData) {
        const id = nextAgentId++;
        aiAgents.set(id, { id: id, name: name, think: think, userData: userData, target: 0 });
        return id;
    }

    function aiUnregisterAgent(agentId) { aiAgents.delete(agentId); }
    function aiAgentSetTarget(agentId, target) { const a = aiAgents.get(agentId); if (a) a.target = target; }
    function aiAgentGetTarget(agentId) { const a = aiAgents.get(agentId); return a ? a.target : 0; }

    function aiAgentTick(agentId, dt) {
        const a = aiAgents.get(agentId);
        if (a && a.think) a.think(a.target, dt, a.userData);
    }

    function aiAgentQuery(query) {
        const result = {
            engineVersion: VERSION,
            entityCount: entities.size,
            physicsBodyCount: physicsWorld.bodies.size,
            lightCount: lightMap.size,
            agents: [],
        };
        for (const [id, agent] of aiAgents) {
            result.agents.push({ id: id, name: agent.name, target: agent.target });
        }
        return JSON.stringify(result);
    }

    // ============================================================
    // 输入 API
    // ============================================================

    function keyDown(key) {
        return inputState.keys[key] || false;
    }

    function keyPressed(key) {
        return inputState.keys[key] && !inputState.prevKeys[key];
    }

    function getTouchCount() {
        return inputState.touches.length;
    }

    function getTouch(index) {
        if (index < 0 || index >= inputState.touches.length) return { x: 0, y: 0 };
        return inputState.touches[index];
    }

    function getJoystickX() { return inputState.joystickX; }
    function getJoystickY() { return inputState.joystickY; }

    // 平台层注入输入
    function _setKey(key, down) {
        inputState.keys[key] = down;
    }

    function _setJoystick(x, y) {
        inputState.joystickX = x;
        inputState.joystickY = y;
    }

    function _setTouches(touches) {
        inputState.touches = touches;
    }

    function _clearJustPressed() {
        // 在 endFrame 中已处理
    }

    // ============================================================
    // 音频 API
    // ============================================================

    function loadAudio(path, isMusic) {
        if (!audioCtx) return 0;
        const id = nextAudioId++;
        audioSources.set(id, {
            path: path,
            isMusic: isMusic,
            buffer: null,
            source: null,
            gain: null,
            volume: 1.0,
            loaded: false,
        });

        // 异步加载
        fetch(path)
            .then(r => r.arrayBuffer())
            .then(data => audioCtx.decodeAudioData(data))
            .then(buffer => {
                const a = audioSources.get(id);
                if (a) { a.buffer = buffer; a.loaded = true; }
            })
            .catch(() => {});

        return id;
    }

    function playAudio(id, loop) {
        if (!audioCtx) return;
        const a = audioSources.get(id);
        if (!a || !a.loaded) return;

        if (a.source) {
            try { a.source.stop(); } catch (e) {}
        }

        a.source = audioCtx.createBufferSource();
        a.source.buffer = a.buffer;
        a.source.loop = loop || false;

        a.gain = audioCtx.createGain();
        a.gain.gain.value = a.volume;

        a.source.connect(a.gain);
        a.gain.connect(audioCtx.destination);
        a.source.start();
    }

    function stopAudio(id) {
        const a = audioSources.get(id);
        if (a && a.source) {
            try { a.source.stop(); } catch (e) {}
            a.source = null;
        }
    }

    function setVolume(id, volume) {
        const a = audioSources.get(id);
        if (a) {
            a.volume = volume;
            if (a.gain) a.gain.gain.value = volume;
        }
    }

    function stopAllAudio() {
        for (const [id, a] of audioSources) {
            if (a.source) {
                try { a.source.stop(); } catch (e) {}
                a.source = null;
            }
        }
    }

    // ============================================================
    // ECS API
    // ============================================================

    function createEntity() {
        if (entities.size >= MAX_ENTITIES) return 0;
        const id = nextEntityId++;
        entities.set(id, {
            id,
            x: 0, y: 0, scaleX: 1, scaleY: 1,
            textureId: 0, spriteW: 0, spriteH: 0,
            spriteColor: { r: 255, g: 255, b: 255, a: 255 },
            visible: true,
            colliderW: 0, colliderH: 0,
            script: null,
        });
        return id;
    }

    function destroyEntity(entity) {
        entities.delete(entity);
    }

    function entityAlive(entity) {
        return entities.has(entity);
    }

    function setPosition(e, x, y) {
        const ent = entities.get(e);
        if (ent) { ent.x = x; ent.y = y; }
    }

    function getPosition(e) {
        const ent = entities.get(e);
        if (!ent) return { x: 0, y: 0 };
        return { x: ent.x, y: ent.y };
    }

    function setScale(e, sx, sy) {
        const ent = entities.get(e);
        if (ent) { ent.scaleX = sx; ent.scaleY = sy; }
    }

    function setSprite(e, textureId, w, h) {
        const ent = entities.get(e);
        if (ent) {
            ent.textureId = textureId;
            ent.spriteW = w;
            ent.spriteH = h;
        }
    }

    function setSpriteColor(e, color) {
        const ent = entities.get(e);
        if (ent) ent.spriteColor = color;
    }

    function setVisible(e, visible) {
        const ent = entities.get(e);
        if (ent) ent.visible = visible;
    }

    function setCollider(e, w, h) {
        const ent = entities.get(e);
        if (ent) { ent.colliderW = w; ent.colliderH = h; }
    }

    function checkCollision(a, b) {
        const ea = entities.get(a);
        const eb = entities.get(b);
        if (!ea || !eb || !ea.colliderW || !eb.colliderW) return false;
        return Math.abs(ea.x - eb.x) < (ea.colliderW + eb.colliderW) / 2 &&
               Math.abs(ea.y - eb.y) < (ea.colliderH + eb.colliderH) / 2;
    }

    function setScript(e, onUpdate) {
        const ent = entities.get(e);
        if (ent) ent.script = onUpdate;
    }

    // 内部：更新所有脚本
    function _updateScripts(dt) {
        for (const [id, ent] of entities) {
            if (ent.script) {
                try { ent.script(id, dt); } catch (e) {}
            }
        }
    }

    // 内部：渲染所有可见精灵
    function _renderSprites() {
        for (const [id, ent] of entities) {
            if (!ent.visible || !ent.textureId) continue;
            drawSprite(ent.textureId, {
                x: ent.x - ent.spriteW / 2,
                y: ent.y - ent.spriteH / 2,
                w: ent.spriteW * ent.scaleX,
                h: ent.spriteH * ent.scaleY,
            });
        }
    }

    // ============================================================
    // 场景管理 API
    // ============================================================

    function loadScene(name) {
        const id = scenes.size;
        scenes.set(id, { name, entities: [] });
        return id;
    }

    function setActiveScene(sceneId) {
        activeSceneId = sceneId;
    }

    function getActiveScene() {
        return activeSceneId;
    }

    function sceneSetBackground(color) {
        sceneBgColor = color;
    }

    // ============================================================
    // 存储 API
    // ============================================================

    function saveData(key, data) {
        try {
            localStorage.setItem(storagePrefix + key, data);
            return 0;
        } catch (e) {
            return -1;
        }
    }

    function loadData(key) {
        try {
            return localStorage.getItem(storagePrefix + key) || null;
        } catch (e) {
            return null;
        }
    }

    function clearData(key) {
        try {
            localStorage.removeItem(storagePrefix + key);
            return 0;
        } catch (e) {
            return -1;
        }
    }

    // ============================================================
    // 工具 API
    // ============================================================

    function getTimeMs() {
        return performance.now();
    }

    let randomSeed = Date.now();
    function random() {
        randomSeed = (randomSeed * 9301 + 49297) % 233280;
        return randomSeed / 233280;
    }

    function randomRange(min, max) {
        return min + random() * (max - min);
    }

    function log(message) {
        console.log('[Lument]', message);
    }

    // ============================================================
    // 高级API：主循环
    // ============================================================

    function run(updateCallback, renderCallback) {
        function loop() {
            if (!running) return;
            beginFrame();
            // 使用 try-catch 防止更新或渲染中的异常导致游戏循环永久中断
            try {
                if (updateCallback) updateCallback(deltaTime);
                _updateScripts(deltaTime);
                if (renderCallback) renderCallback();
            } catch (e) {
                console.error('[Lument] Frame error:', e);
            }
            endFrame();
            requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
    }

    // ============================================================
    // 像素艺术辅助 API（Web独有增强）
    // ============================================================

    function createPixelArt(width, height, drawFn) {
        const offscreen = document.createElement('canvas');
        offscreen.width = width;
        offscreen.height = height;
        const octx = offscreen.getContext('2d');
        if (drawFn) drawFn(octx, width, height);
        const id = nextTextureId++;
        textures.set(id, offscreen);
        return id;
    }

    function getCanvas() { return canvas; }
    function getContext() { return ctx; }

    // ============================================================
    // UI / 应用开发 API
    // 适用于轻量应用开发：表单、列表、仪表盘、工具类App
    // ============================================================

    // --- Widget 结构工厂（与 ECS 实体一致的普通对象模式）---
    function _newWidget(type) {
        return {
            id: nextWidgetId++,
            type: type || WIDGET.NONE,
            text: '',
            placeholder: '',            // 输入框占位文本（INPUT 专用扩展）
            x: 0, y: 0, w: 0, h: 0,
            bgColor: { r: 40, g: 40, b: 50, a: 255 },
            textColor: { r: 240, g: 240, b: 240, a: 255 },
            fontSize: 16,
            visible: true,
            enabled: true,
            textureId: 0,
            parent: 0,
            children: [],
            layout: LAYOUT.NONE,
            padding: { top: 0, right: 0, bottom: 0, left: 0 },
            spacing: 0,
            gridCols: 1,
            gridRows: 1,
            alignment: 0,               // 0=start 1=center 2=end 3=stretch
            callbacks: {},
            focused: false,
        };
    }

    function _clamp(v, lo, hi) {
        return v < lo ? lo : (v > hi ? hi : v);
    }

    function _colorToCss(c) {
        const a = (c && typeof c.a === 'number') ? c.a / 255 : 1;
        return `rgba(${c.r},${c.g},${c.b},${a})`;
    }

    function _fireEvent(w, event, data) {
        if (!w) return;
        const cb = w.callbacks[event];
        if (cb) {
            try { cb(w.id, event, data || null); } catch (e) {}
        }
    }

    // 根节点：导航栈非空时只渲染栈顶屏幕，否则渲染所有 parent===0 的 Widget
    function _getRoots() {
        if (navStack.length > 0) {
            return [navStack[navStack.length - 1]];
        }
        const roots = [];
        for (const [id, w] of widgets) {
            if (w.parent === 0) roots.push(id);
        }
        return roots;
    }

    // --- Widget 生命周期 ---
    function uiCreate(type) {
        const w = _newWidget(type);
        widgets.set(w.id, w);
        return w.id;
    }

    function uiDestroy(widget) {
        const w = widgets.get(widget);
        if (!w) return;
        // 从父级 children 中移除
        if (w.parent) {
            const p = widgets.get(w.parent);
            if (p) {
                const i = p.children.indexOf(widget);
                if (i >= 0) p.children.splice(i, 1);
            }
        }
        // 递归销毁子节点
        const kids = w.children.slice();
        for (const cid of kids) uiDestroy(cid);
        if (focusedWidgetId === widget) focusedWidgetId = 0;
        if (pressedWidgetId === widget) pressedWidgetId = 0;
        // 从导航栈中移除
        const ni = navStack.indexOf(widget);
        if (ni >= 0) navStack.splice(ni, 1);
        widgets.delete(widget);
    }

    function uiClearAll() {
        widgets.clear();
        navStack.length = 0;
        focusedWidgetId = 0;
        pressedWidgetId = 0;
    }

    // --- Widget 属性 ---
    function uiSetText(widget, text) {
        const w = widgets.get(widget);
        if (w) w.text = text;
    }
    function uiGetText(widget) {
        const w = widgets.get(widget);
        return w ? w.text : '';
    }
    function uiSetPosition(widget, x, y) {
        const w = widgets.get(widget);
        if (w) { w.x = x; w.y = y; }
    }
    function uiSetSize(widget, ww, hh) {
        const w = widgets.get(widget);
        if (w) { w.w = ww; w.h = hh; }
    }
    function uiSetColor(widget, color) {
        const w = widgets.get(widget);
        if (w) w.bgColor = color;
    }
    function uiSetTextColor(widget, color) {
        const w = widgets.get(widget);
        if (w) w.textColor = color;
    }
    function uiSetFontSize(widget, size) {
        const w = widgets.get(widget);
        if (w) w.fontSize = size;
    }
    function uiSetVisible(widget, visible) {
        const w = widgets.get(widget);
        if (w) w.visible = visible;
    }
    function uiSetEnabled(widget, enabled) {
        const w = widgets.get(widget);
        if (w) w.enabled = enabled;
    }
    function uiSetImage(widget, textureId) {
        const w = widgets.get(widget);
        if (w) w.textureId = textureId;
    }

    // --- Widget 层级 ---
    function uiAddChild(parent, child) {
        const p = widgets.get(parent);
        const c = widgets.get(child);
        if (!p || !c) return;
        // 先从原父级移除
        if (c.parent) {
            const op = widgets.get(c.parent);
            if (op) {
                const i = op.children.indexOf(child);
                if (i >= 0) op.children.splice(i, 1);
            }
        }
        c.parent = parent;
        p.children.push(child);
    }
    function uiRemoveChild(parent, child) {
        const p = widgets.get(parent);
        const c = widgets.get(child);
        if (!p || !c) return;
        const i = p.children.indexOf(child);
        if (i >= 0) p.children.splice(i, 1);
        if (c.parent === parent) c.parent = 0;
    }
    function uiGetParent(widget) {
        const w = widgets.get(widget);
        return w ? w.parent : 0;
    }

    // --- 布局 ---
    function uiSetLayout(container, layout) {
        const w = widgets.get(container);
        if (w) w.layout = layout;
    }
    function uiSetPadding(container, top, right, bottom, left) {
        const w = widgets.get(container);
        if (w) w.padding = { top, right, bottom, left };
    }
    function uiSetSpacing(container, spacing) {
        const w = widgets.get(container);
        if (w) w.spacing = spacing;
    }
    function uiSetGrid(container, cols, rows) {
        const w = widgets.get(container);
        if (w) { w.gridCols = cols; w.gridRows = rows; }
    }
    function uiSetAlignment(container, align) {
        const w = widgets.get(container);
        if (w) w.alignment = align;
    }

    // --- 事件 ---
    function uiOnEvent(widget, event, callback) {
        const w = widgets.get(widget);
        if (w) w.callbacks[event] = callback;
    }

    function _setFocusedWidget(id) {
        // 失焦旧 Widget
        if (focusedWidgetId && focusedWidgetId !== id) {
            const prev = widgets.get(focusedWidgetId);
            if (prev) { prev.focused = false; _fireEvent(prev, EVENT.BLUR); }
        }
        focusedWidgetId = id;
        if (id) {
            const w = widgets.get(id);
            if (w && !w.focused) { w.focused = true; _fireEvent(w, EVENT.FOCUS); }
        }
    }
    function uiSetFocused(widget) {
        _setFocusedWidget(widget);
    }

    // --- 布局计算（递归）---
    function _layoutWidget(w) {
        if (!w || !w.visible) return;
        const kids = w.children;
        if (!kids.length) return;

        const innerX = w.x + w.padding.left;
        const innerY = w.y + w.padding.top;
        const innerW = Math.max(0, w.w - w.padding.left - w.padding.right);
        const innerH = Math.max(0, w.h - w.padding.top - w.padding.bottom);

        // TABBAR 默认按水平排列
        let layout = w.layout;
        if (w.type === WIDGET.TABBAR && layout === LAYOUT.NONE) layout = LAYOUT.HORIZONTAL;

        if (layout === LAYOUT.VERTICAL) {
            let cursor = innerY;
            for (const cid of kids) {
                const c = widgets.get(cid);
                if (!c || !c.visible) continue;
                c.y = cursor;
                _applyCrossAlign(c, innerX, innerW, true, w.alignment);
                cursor += c.h + w.spacing;
                _layoutWidget(c);
            }
        } else if (layout === LAYOUT.HORIZONTAL) {
            let cursor = innerX;
            for (const cid of kids) {
                const c = widgets.get(cid);
                if (!c || !c.visible) continue;
                c.x = cursor;
                _applyCrossAlign(c, innerY, innerH, false, w.alignment);
                cursor += c.w + w.spacing;
                _layoutWidget(c);
            }
        } else if (layout === LAYOUT.GRID) {
            const cols = Math.max(1, w.gridCols);
            const cellW = innerW / cols;
            const cellH = w.gridRows > 0 ? innerH / w.gridRows : 0;
            let idx = 0;
            for (const cid of kids) {
                const c = widgets.get(cid);
                if (!c || !c.visible) continue;
                const col = idx % cols;
                const row = Math.floor(idx / cols);
                const cx = innerX + col * cellW;
                const cy = innerY + (cellH > 0 ? row * cellH : row * (c.h + w.spacing));
                _applyCellAlign(c, cx, cy, cellW, cellH, w.alignment);
                idx++;
                _layoutWidget(c);
            }
        } else {
            // NONE / STACK：保留绝对位置，仅递归子节点
            for (const cid of kids) {
                const c = widgets.get(cid);
                if (c) _layoutWidget(c);
            }
        }
    }

    // 十字轴对齐：horizontal=true 时主轴为垂直（调整 x/宽），否则主轴为水平（调整 y/高）
    function _applyCrossAlign(c, start, extent, horizontal, align) {
        const avail = extent - (horizontal ? c.w : c.h);
        if (align === 1) {                 // center
            if (horizontal) c.x = start + avail / 2; else c.y = start + avail / 2;
        } else if (align === 2) {          // end
            if (horizontal) c.x = start + avail; else c.y = start + avail;
        } else if (align === 3) {          // stretch
            if (horizontal) { c.x = start; c.w = extent; } else { c.y = start; c.h = extent; }
        } else {                            // start
            if (horizontal) c.x = start; else c.y = start;
        }
    }

    function _applyCellAlign(c, cx, cy, cellW, cellH, align) {
        if (align === 3) {                 // stretch
            c.x = cx; c.y = cy; c.w = cellW;
            if (cellH > 0) c.h = cellH;
        } else if (align === 1) {          // center
            c.x = cx + (cellW - c.w) / 2;
            c.y = cy + (cellH > 0 ? (cellH - c.h) / 2 : 0);
        } else if (align === 2) {          // end
            c.x = cx + (cellW - c.w);
            c.y = cy + (cellH > 0 ? (cellH - c.h) : 0);
        } else {                            // start
            c.x = cx; c.y = cy;
        }
    }

    // --- 绘制辅助（屏幕坐标，UI 不受摄像机变换影响）---
    function _uiFillRect(x, y, w, h, color) {
        ctx.fillStyle = _colorToCss(color);
        ctx.fillRect(x, y, w, h);
        stats.drawCalls++;
    }
    function _uiStrokeRect(x, y, w, h, color, lw) {
        ctx.strokeStyle = _colorToCss(color);
        ctx.lineWidth = lw || 1;
        ctx.strokeRect(x, y, w, h);
        stats.drawCalls++;
    }
    function _uiRoundedRect(x, y, w, h, r, color) {
        const radius = Math.max(0, Math.min(r, w / 2, h / 2));
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.arcTo(x + w, y, x + w, y + h, radius);
        ctx.arcTo(x + w, y + h, x, y + h, radius);
        ctx.arcTo(x, y + h, x, y, radius);
        ctx.arcTo(x, y, x + w, y, radius);
        ctx.closePath();
        ctx.fillStyle = _colorToCss(color);
        ctx.fill();
        stats.drawCalls++;
    }
    function _uiText(text, x, y, size, color, align) {
        ctx.font = `${size}px 'MinecraftAE', monospace`;
        ctx.fillStyle = _colorToCss(color);
        ctx.textBaseline = 'middle';
        ctx.textAlign = align || 'left';
        ctx.fillText(text, x, y);
        ctx.textAlign = 'left';           // 还原默认，避免泄漏到其它绘制
        stats.drawCalls++;
    }

    // --- 单个 Widget 绘制 ---
    function _drawWidget(w) {
        if (!w || !w.visible) return;

        switch (w.type) {
            case WIDGET.CONTAINER:
                if (w.bgColor && w.bgColor.a !== 0) _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                break;

            case WIDGET.BUTTON: {
                const bg = w.enabled ? w.bgColor : { r: 70, g: 70, b: 80, a: 255 };
                _uiRoundedRect(w.x, w.y, w.w, w.h, 8, bg);
                if (w.text) _uiText(w.text, w.x + w.w / 2, w.y + w.h / 2, w.fontSize, w.textColor, 'center');
                if (w.focused) _uiStrokeRect(w.x, w.y, w.w, w.h, { r: 255, g: 220, b: 90, a: 255 }, 2);
                break;
            }

            case WIDGET.LABEL:
                if (w.bgColor && w.bgColor.a !== 0) _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                if (w.text) _uiText(w.text, w.x + 4, w.y + w.h / 2, w.fontSize, w.textColor, 'left');
                break;

            case WIDGET.INPUT: {
                _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                const border = w.focused ? { r: 90, g: 160, b: 240, a: 255 } : { r: 110, g: 110, b: 120, a: 255 };
                _uiStrokeRect(w.x, w.y, w.w, w.h, border, w.focused ? 2 : 1);
                const showText = w.text || '';
                const showPlaceholder = !showText && w.placeholder;
                _uiText(
                    showPlaceholder || showText,
                    w.x + 8, w.y + w.h / 2, w.fontSize,
                    showPlaceholder ? { r: 150, g: 150, b: 160, a: 255 } : w.textColor,
                    'left'
                );
                // 聚焦时绘制闪烁光标
                if (w.focused && (Math.floor(getTimeMs() / 500) % 2 === 0)) {
                    ctx.font = `${w.fontSize}px 'MinecraftAE', monospace`;
                    const caretX = w.x + 8 + (showText ? ctx.measureText(showText).width : 0);
                    ctx.fillStyle = _colorToCss(w.textColor);
                    ctx.fillRect(caretX, w.y + 6, 1, w.h - 12);
                }
                break;
            }

            case WIDGET.IMAGE:
                if (w.textureId) {
                    const tex = textures.get(w.textureId);
                    if (tex) {
                        try { ctx.drawImage(tex, w.x, w.y, w.w, w.h); stats.drawCalls++; } catch (e) {}
                    }
                } else if (w.bgColor && w.bgColor.a !== 0) {
                    _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                }
                break;

            case WIDGET.LIST:
                _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                _uiStrokeRect(w.x, w.y, w.w, w.h, { r: 90, g: 90, b: 100, a: 255 }, 1);
                break;

            case WIDGET.PROGRESS: {
                const v = _clamp(parseFloat(w.text) || 0, 0, 1);
                _uiFillRect(w.x, w.y, w.w, w.h, { r: 50, g: 50, b: 60, a: 255 });
                _uiFillRect(w.x, w.y, Math.max(0, w.w * v), w.h, w.bgColor);
                _uiStrokeRect(w.x, w.y, w.w, w.h, { r: 100, g: 100, b: 110, a: 255 }, 1);
                break;
            }

            case WIDGET.CHECKBOX: {
                const checked = (w.text === '1' || String(w.text).toLowerCase() === 'true');
                const box = Math.min(w.h, 22);
                const by = w.y + (w.h - box) / 2;
                _uiFillRect(w.x, by, box, box, w.bgColor);
                _uiStrokeRect(w.x, by, box, box, { r: 120, g: 120, b: 130, a: 255 }, 1);
                if (checked) {
                    ctx.strokeStyle = _colorToCss(w.textColor);
                    ctx.lineWidth = 2;
                    ctx.beginPath();
                    ctx.moveTo(w.x + 4, by + box / 2);
                    ctx.lineTo(w.x + box / 2 - 1, by + box - 5);
                    ctx.lineTo(w.x + box - 4, by + 5);
                    ctx.stroke();
                    stats.drawCalls++;
                }
                break;
            }

            case WIDGET.SLIDER: {
                const v = _clamp(parseFloat(w.text) || 0, 0, 1);
                const trackY = w.y + w.h / 2 - 2;
                _uiFillRect(w.x, trackY, w.w, 4, { r: 70, g: 70, b: 80, a: 255 });
                _uiFillRect(w.x, trackY, Math.max(0, w.w * v), 4, w.bgColor);
                const knobX = w.x + w.w * v;
                const knobColor = w.focused ? { r: 120, g: 170, b: 240, a: 255 } : w.textColor;
                _uiRoundedRect(knobX - 7, w.y + 2, 14, w.h - 4, 4, knobColor);
                break;
            }

            case WIDGET.TABBAR:
                _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                _uiStrokeRect(w.x, w.y, w.w, 1, { r: 90, g: 90, b: 100, a: 255 }, 1);
                break;

            case WIDGET.NAVBAR:
                _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                if (w.text) _uiText(w.text, w.x + w.w / 2, w.y + w.h / 2, w.fontSize, w.textColor, 'center');
                if (navStack.length > 1) _uiText('<', w.x + 10, w.y + w.h / 2, w.fontSize, w.textColor, 'left');
                break;

            default:
                if (w.bgColor && w.bgColor.a !== 0) _uiFillRect(w.x, w.y, w.w, w.h, w.bgColor);
                break;
        }

        // 递归绘制子节点（子节点在上层）
        for (const cid of w.children) {
            _drawWidget(widgets.get(cid));
        }
    }

    // --- 渲染所有可见 Widget ---
    function uiRender() {
        const roots = _getRoots();
        for (const rid of roots) {
            const w = widgets.get(rid);
            if (!w) continue;
            _layoutWidget(w);   // 先布局
            _drawWidget(w);     // 再绘制
        }
    }

    // --- 触摸 / 命中检测 ---
    // 按绘制顺序收集（父先于子），命中测试时倒序（子在最上层）
    function _collectDrawOrder(roots) {
        const list = [];
        const visit = (id) => {
            const w = widgets.get(id);
            if (!w) return;
            list.push(w);
            for (const cid of w.children) visit(cid);
        };
        for (const rid of roots) visit(rid);
        return list;
    }

    function _hitTest(x, y) {
        const list = _collectDrawOrder(_getRoots());
        for (let i = list.length - 1; i >= 0; i--) {
            const w = list[i];
            if (!w.visible || !w.enabled) continue;
            if (x >= w.x && x <= w.x + w.w && y >= w.y && y <= w.y + w.h) {
                return w;
            }
        }
        return null;
    }

    function _setSliderValueFromX(w, x) {
        const v = _clamp((x - w.x) / (w.w || 1), 0, 1);
        w.text = String(v);
    }

    // type: 0=down 1=move 2=up
    function uiHandleTouch(x, y, type) {
        if (type === 0) {                       // 按下
            const w = _hitTest(x, y);
            if (!w) { _setFocusedWidget(0); return false; }
            pressedWidgetId = w.id;
            // 点击输入框/滑块时聚焦，点击其它控件时失焦当前输入
            if (w.type === WIDGET.INPUT || w.type === WIDGET.SLIDER) {
                _setFocusedWidget(w.id);
            } else {
                _setFocusedWidget(0);
            }
            switch (w.type) {
                case WIDGET.BUTTON:
                    _fireEvent(w, EVENT.CLICK);
                    break;
                case WIDGET.SLIDER:
                    _setSliderValueFromX(w, x);
                    _fireEvent(w, EVENT.CHANGE, w.text);
                    break;
                case WIDGET.CHECKBOX: {
                    const checked = (w.text === '1' || String(w.text).toLowerCase() === 'true');
                    w.text = checked ? '0' : '1';
                    _fireEvent(w, EVENT.CHANGE, w.text);
                    break;
                }
                default:
                    break;
            }
            return true;
        } else if (type === 1) {                // 移动
            if (pressedWidgetId) {
                const w = widgets.get(pressedWidgetId);
                if (w && w.type === WIDGET.SLIDER) {
                    _setSliderValueFromX(w, x);
                    _fireEvent(w, EVENT.CHANGE, w.text);
                }
                return true;
            }
            return false;
        } else {                                // 抬起
            pressedWidgetId = 0;
            return false;
        }
    }

    // --- 键盘处理 ---
    function _moveFocus(key) {
        const list = _collectDrawOrder(_getRoots());
        const focusable = list.filter(w =>
            w.visible && w.enabled &&
            (w.type === WIDGET.BUTTON || w.type === WIDGET.INPUT ||
             w.type === WIDGET.CHECKBOX || w.type === WIDGET.SLIDER));
        if (!focusable.length) return false;
        let idx = focusable.findIndex(w => w.id === focusedWidgetId);
        if (idx < 0) { _setFocusedWidget(focusable[0].id); return true; }
        if (key === KEY.DOWN || key === KEY.RIGHT) idx = (idx + 1) % focusable.length;
        else idx = (idx - 1 + focusable.length) % focusable.length;
        _setFocusedWidget(focusable[idx].id);
        return true;
    }

    function uiHandleKey(key, pressed) {
        if (!pressed) return false;
        if (key === KEY.ACTION) {
            if (focusedWidgetId) {
                const w = widgets.get(focusedWidgetId);
                if (w && w.type === WIDGET.BUTTON) { _fireEvent(w, EVENT.CLICK); return true; }
            }
            return false;
        }
        if (key === KEY.CANCEL) {
            if (navStack.length > 0) { navStack.pop(); return true; }
            return false;
        }
        if (key === KEY.UP || key === KEY.DOWN || key === KEY.LEFT || key === KEY.RIGHT) {
            return _moveFocus(key);
        }
        return false;
    }

    // --- 导航 ---
    function uiNavigateTo(screen) {
        navStack.push(screen);
    }
    function uiNavigateBack() {
        if (navStack.length > 0) navStack.pop();
    }
    function uiGetCurrentScreen() {
        return navStack.length > 0 ? navStack[navStack.length - 1] : 0;
    }

    // --- 便捷创建 ---
    function uiCreateButton(text, x, y, w, h) {
        const id = uiCreate(WIDGET.BUTTON);
        const wd = widgets.get(id);
        wd.text = text; wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.bgColor = { r: 60, g: 120, b: 200, a: 255 };
        wd.textColor = { r: 255, g: 255, b: 255, a: 255 };
        return id;
    }
    function uiCreateLabel(text, x, y, w, h) {
        const id = uiCreate(WIDGET.LABEL);
        const wd = widgets.get(id);
        wd.text = text; wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.bgColor = { r: 0, g: 0, b: 0, a: 0 };
        wd.textColor = { r: 240, g: 240, b: 240, a: 255 };
        return id;
    }
    function uiCreateInput(placeholder, x, y, w, h) {
        const id = uiCreate(WIDGET.INPUT);
        const wd = widgets.get(id);
        wd.placeholder = placeholder; wd.text = '';
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.bgColor = { r: 30, g: 30, b: 40, a: 255 };
        wd.textColor = { r: 240, g: 240, b: 240, a: 255 };
        return id;
    }

    // ============================================================
    // 公开 API
    // ============================================================

    return {
        // 常量
        VERSION, PLATFORM, RENDERER, KEY,
        WIDGET, LAYOUT, EVENT, LIGHT,

        // 核心
        init, shutdown, isRunning,
        beginFrame, endFrame, getDeltaTime, getStats,
        getPlatform, getRendererType,
        run,

        // 渲染
        clear, setCamera, drawRect, drawSprite, drawText, drawPixel, flush,
        loadTexture, createTextureFromData, destroyTexture,
        createPixelArt, getCanvas, getContext,

        // 2D 场景渲染：色彩色调
        setSceneTint, setSceneBrightness, setSceneContrast, setSceneSaturation,
        setSceneHueShift, setSceneGrayscale, setSceneSepia, setSceneInvert,
        setSceneColor, getSceneColor, resetSceneColor,

        // 2D 场景渲染：清晰度
        setSceneSharpness, setSceneBlur, setSceneBloom,
        setSceneClarity, getSceneClarity, resetSceneClarity,

        // 2D 场景渲染：暗角与雾效
        setVignette, setFog, resetVignette, resetFog,

        // 2D 场景渲染：后期处理
        applySceneEffects,

        // 2D 场景渲染：光线
        addLight, setLightDirection, setLightAngle, setLightIntensity,
        setLightColor, setLightPosition, removeLight, clearLights,
        getLightCount, setAmbientLight, setLightFalloff, renderLights,

        // 2D 场景渲染：图片接入
        loadImage, drawImageTiled, drawImageRotated,
        drawImageWithColor, drawImageRegion,

        // 2D 场景渲染：离屏渲染目标
        createRenderTarget, setRenderTarget, drawRenderTarget, destroyRenderTarget,

        // 2D 物理模拟
        physicsSetGravity, physicsGetGravity, physicsSetIterations,
        physicsStep, physicsReset,
        physicsCreateBody, physicsDestroyBody,
        physicsSetShape, physicsSetMass, physicsSetRestitution,
        physicsSetFriction, physicsSetGravityScale, physicsSetDamping,
        physicsSetCustomDamping, physicsClearCustomDamping,
        physicsGetState, physicsSetState,
        physicsGetPosition, physicsSetPosition,
        physicsGetVelocity, physicsSetVelocity,
        physicsApplyForce, physicsApplyImpulse,
        physicsApplyTorque, physicsApplyAngularImpulse,
        physicsCheckCollision, physicsGetCollisions,
        physicsRaycast, physicsPointQuery,
        physicsOnCollision,
        BODY, SHAPE,

        // 增强音频
        loadSound, loadMusic, getSupportedFormats,
        playSound, stopSound, pauseSound, resumeSound,
        setPitch, setPan,
        getAudioDuration, getAudioPosition, seekAudio,
        fadeIn, fadeOut,
        setAudioListener, playSound3d,
        setMasterVolume, setGroupVolume, stopGroup,

        // 网络模块
        httpRequest, httpGet, httpPost, httpPut, httpDelete,
        httpCancel, httpSetHeader, httpSetTimeout, httpSetAuthToken,
        wsConnect, wsSend, wsSendText, wsClose, wsIsConnected,
        jsonParse, jsonGetNumber, jsonGetBool, jsonBuild,
        uploadData, downloadData,
        HTTP, WS,

        // AI 模块
        aiCreateTree, aiDestroyTree, aiCreateNode, aiAddChild,
        aiSetEntity, aiTick,
        aiCreateFsm, aiDestroyFsm,
        aiFsmAddState, aiFsmAddTransition,
        aiFsmSetState, aiFsmGetState, aiFsmTick, aiFsmGetStateName,
        aiCreateGrid, aiDestroyGrid,
        aiGridSetBlocked, aiGridIsBlocked, aiGridSetCost,
        aiFindPath, aiPathLength,
        aiCreateBlackboard,
        aiBbSetInt, aiBbSetFloat, aiBbSetString, aiBbSetBool,
        aiBbGetInt, aiBbGetFloat, aiBbGetString, aiBbGetBool,
        aiBbRemove, aiBbClear,
        aiRegisterAgent, aiUnregisterAgent,
        aiAgentSetTarget, aiAgentGetTarget,
        aiAgentTick, aiAgentQuery,
        AI,

        // 输入
        keyDown, keyPressed, getTouchCount, getTouch,
        getJoystickX, getJoystickY,
        _setKey, _setJoystick, _setTouches,

        // 音频
        loadAudio, playAudio, stopAudio, setVolume, stopAllAudio,

        // ECS
        createEntity, destroyEntity, entityAlive,
        setPosition, getPosition, setScale,
        setSprite, setSpriteColor, setVisible,
        setCollider, checkCollision, setScript,
        _updateScripts, _renderSprites,

        // 场景
        loadScene, setActiveScene, getActiveScene, sceneSetBackground,

        // 存储
        saveData, loadData, clearData,

        // 工具
        getTimeMs, random, randomRange, log,

        // UI / 应用开发
        uiCreate, uiDestroy, uiClearAll,
        uiSetText, uiGetText, uiSetPosition, uiSetSize,
        uiSetColor, uiSetTextColor, uiSetFontSize,
        uiSetVisible, uiSetEnabled, uiSetImage,
        uiAddChild, uiRemoveChild, uiGetParent,
        uiSetLayout, uiSetPadding, uiSetSpacing, uiSetGrid, uiSetAlignment,
        uiOnEvent, uiSetFocused,
        uiRender, uiHandleTouch, uiHandleKey,
        uiNavigateTo, uiNavigateBack, uiGetCurrentScreen,
        uiCreateButton, uiCreateLabel, uiCreateInput,
    };
})();
