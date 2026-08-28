// ============================================================
// lument.js - Lument Web Runtime
// JS/Canvas 实现 C ABI 全部接口，浏览器/WebView 直接运行
// 支持平台：Web / Android WebView / Desktop Electron
// ============================================================

const Lument = (function() {
    'use strict';

    // ========== 常量 ==========
    const VERSION = '1.3.0';

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
        DROPDOWN: 12, TOGGLE: 13, SCROLLVIEW: 14, TOOLTIP: 15,
        DIVIDER: 16, SPINNER: 17, ICON: 18,
    };

    // 布局类型
    const LAYOUT = {
        NONE: 0, VERTICAL: 1, HORIZONTAL: 2, GRID: 3, STACK: 4,
        FLOW: 5,
    };

    // 自动尺寸模式
    const AUTOSIZE = {
        OFF: 0, WIDTH: 1, HEIGHT: 2, BOTH: 3,
    };

    // 物理引擎宽相类型
    const BROADPHASE = {
        GRID: 0, QUADTREE: 1, BRUTE: 2,
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
        // v1.3 空间分区
        broadphase: 0,           // 0=grid 1=quadtree 2=brute
        gridCellSize: 0,         // 0=auto
        lastPairCount: 0,
    };

    // ========== 增强音频状态 ==========
    let audioInstances = new Map();
    let nextAudioInstanceId = 1;
    let audioListener = { x: 0, y: 0, dirX: 0, dirY: 1 };
    let masterVolume = 1.0;
    let groupVolumes = [1.0, 1.0, 1.0]; // SFX(0), Music(1), Voice(2)
    // LumentGAL: 单实例 BGM 管理（确保同时只存在 1 个 BGM，支持循环 + 平滑交叉淡入淡出）
    let galAudio = {
        bgm: { instId: 0, srcId: 0, fading: false, crossMs: 0, crossElapsed: 0, nextSrcId: 0, nextLoop: true, nextVol: 0.7, stopPending: false },
        se:  { queue: [], maxSimul: 16 },
        voice: { instId: 0 },
        listeners: { onBgmEnd: null, onVoiceEnd: null },
        // 可选 WebAudio 合成音源（无外部文件时用于 demo / 占位）
        synths: new Map(), // name -> {node, gain, playing}
    };
    function galResumeAudioCtx(){
        // iOS/Chrome 自动播放策略：首次用户手势后 AudioContext 必须 resume()
        try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch(e){}
    }
    if (typeof window !== 'undefined' && window.addEventListener){
        const once = () => { galResumeAudioCtx(); try { window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); } catch(e){} };
        window.addEventListener('pointerdown', once, { passive: true });
        window.addEventListener('keydown', once, { passive: true });
    }

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

        // ---------- Node / 无 DOM 环境兼容（no-op stub，不抛异常）----------
        if (typeof document === 'undefined' || typeof window === 'undefined') {
            running = true;
            initialized = true;
            lastFrameTime = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
            canvas = null; ctx = null; mainCanvas = null; mainCtx = null;
            effectCanvas = null; effectCtx = null;
            audioCtx = null;
            config.platform = PLATFORM.WEB;
            return 0;
        }
        try {
            canvas = document.getElementById('game-canvas');
            if (!canvas) {
                canvas = document.createElement('canvas');
                canvas.id = 'game-canvas';
                try { document.body && document.body.appendChild(canvas); } catch(_e){}
            }
            canvas.width = config.width;
            canvas.height = config.height;
            ctx = canvas.getContext('2d', { alpha: false });
            if (ctx) ctx.imageSmoothingEnabled = false;
        } catch(e) {
            canvas = null; ctx = null;
        }

        // 保存主画布引用（供渲染目标切换使用）
        mainCanvas = canvas;
        mainCtx = ctx;

        // 检测平台
        try {
            const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
            if (/Android/i.test(ua)) config.platform = PLATFORM.ANDROID;
            else if (/iPhone|iPad|iPod/i.test(ua)) config.platform = PLATFORM.IOS;
            else if (/Electron/i.test(ua)) config.platform = PLATFORM.DESKTOP;
            else config.platform = PLATFORM.WEB;
        } catch(e) { config.platform = PLATFORM.WEB; }

        // 初始化音频上下文
        try {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) {
            audioCtx = null;
        }

        running = true;
        initialized = true;
        lastFrameTime = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
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

    // ====== v1.3 渲染图元 ======
    function drawCircle(cx, cy, radius, color, filled) {
        const sx = worldToScreenX(cx);
        const sy = worldToScreenY(cy);
        const r = Math.max(0.5, radius * camera.zoom);
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        if (filled) {
            ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.fill();
        } else {
            ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        stats.drawCalls++;
    }

    function drawLine(x1, y1, x2, y2, thickness, color) {
        const t = thickness > 0 ? thickness : 1;
        ctx.beginPath();
        ctx.moveTo(worldToScreenX(x1), worldToScreenY(y1));
        ctx.lineTo(worldToScreenX(x2), worldToScreenY(y2));
        ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
        ctx.lineWidth = t * camera.zoom;
        ctx.stroke();
        stats.drawCalls++;
    }

    function drawTriangle(x1, y1, x2, y2, x3, y3, color, filled) {
        ctx.beginPath();
        ctx.moveTo(worldToScreenX(x1), worldToScreenY(y1));
        ctx.lineTo(worldToScreenX(x2), worldToScreenY(y2));
        ctx.lineTo(worldToScreenX(x3), worldToScreenY(y3));
        ctx.closePath();
        if (filled) {
            ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.fill();
        } else {
            ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        stats.drawCalls++;
    }

    function drawPolygon(points, color, filled) {
        if (!points || points.length < 3) return;
        ctx.beginPath();
        ctx.moveTo(worldToScreenX(points[0].x), worldToScreenY(points[0].y));
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(worldToScreenX(points[i].x), worldToScreenY(points[i].y));
        }
        ctx.closePath();
        if (filled) {
            ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.fill();
        } else {
            ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        stats.drawCalls++;
    }

    function drawEllipse(cx, cy, rx, ry, color, filled) {
        const sx = worldToScreenX(cx);
        const sy = worldToScreenY(cy);
        ctx.beginPath();
        ctx.ellipse(sx, sy, Math.max(0.5, rx * camera.zoom),
                    Math.max(0.5, ry * camera.zoom), 0, 0, Math.PI * 2);
        if (filled) {
            ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.fill();
        } else {
            ctx.strokeStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
            ctx.lineWidth = 1;
            ctx.stroke();
        }
        stats.drawCalls++;
    }

    function drawPoint(x, y, size, color) {
        const s = size > 0 ? size : 1;
        ctx.fillStyle = `rgba(${color.r},${color.g},${color.b},${color.a / 255})`;
        ctx.fillRect(worldToScreenX(x) - s / 2, worldToScreenY(y) - s / 2,
                     s * camera.zoom, s * camera.zoom);
        stats.drawCalls++;
    }

    // ====== v1.3 手动批处理 ======
    let batchActive = false;
    let batchTexture = null;
    const batchQuads = [];

    function beginBatch(textureId) {
        batchActive = true;
        batchTexture = textureId ? textures.get(textureId) : null;
        batchQuads.length = 0;
    }

    function batchQuad(dest, color) {
        if (!batchActive) return;
        batchQuads.push({
            x: dest.x, y: dest.y, w: dest.w, h: dest.h,
            color: color || { r: 255, g: 255, b: 255, a: 255 }
        });
    }

    function batchTriangle(x1, y1, x2, y2, x3, y3, color) {
        if (!batchActive) return;
        batchQuads.push({
            triangle: true,
            x1, y1, x2, y2, x3, y3,
            color: color || { r: 255, g: 255, b: 255, a: 255 }
        });
    }

    function endBatch() {
        if (!batchActive) return;
        batchActive = false;
        for (const q of batchQuads) {
            if (q.triangle) {
                drawTriangle(q.x1, q.y1, q.x2, q.y2, q.x3, q.y3, q.color, true);
            } else if (batchTexture) {
                ctx.drawImage(batchTexture,
                    worldToScreenX(q.x), worldToScreenY(q.y),
                    q.w * camera.zoom, q.h * camera.zoom);
                stats.drawCalls++;
            } else {
                drawRect({ x: q.x, y: q.y, w: q.w, h: q.h }, q.color, true);
            }
        }
        batchQuads.length = 0;
        batchTexture = null;
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
    function getSupportedFormats() { return 'WAV,MP3,OGG,AAC,FLAC'; }

    function playSound(id, volume, pitch, loop) {
        const src = audioSources.get(id);
        if (!src) return 0;
        if (!audioCtx) return 0;
        galResumeAudioCtx();
        // 优先使用 WebAudio buffer
        let instId = playBufferSource(id, volume, pitch, loop, src.isMusic ? 1 : 0);
        if (instId > 0) return instId;
        // fallback: HTML5 Audio
        const groupId = src.isMusic ? 1 : 0;
        instId = nextAudioInstanceId++;
        audioInstances.set(instId, {
            sourceId: id, groupId: groupId,
            volume: volume, pitch: pitch || 1.0, pan: 0,
            playing: true, paused: false, loop: loop || false,
            position: 0, duration: src.duration || 0,
            fadeAmount: 1.0, fadeTarget: 1.0, fadeStart: 1.0, fadeDuration: 0, fadeElapsed: 0, fading: false, fadeOut: false,
            is3D: false, sourceX: 0, sourceY: 0, maxDist: 0,
            htmlAudio: null,
        });
        if (src.path && src.path.indexOf('data:') !== 0 && src.path.indexOf('blob:') !== 0) {
            try {
                const audio = new Audio(src.path);
                audio.preload = 'auto';
                audio.volume = Math.max(0, Math.min(1, (volume == null ? 1 : volume))) * masterVolume * groupVolumes[groupId];
                audio.loop = loop || false;
                audio.playbackRate = pitch || 1.0;
                const p = audio.play();
                if (p && typeof p.catch === 'function') p.catch(function(){});
                const inst = audioInstances.get(instId);
                inst.htmlAudio = audio;
            } catch(e){}
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
        const dtSec = Math.min(0.05, dt || 0.016);
        for (const [id, inst] of audioInstances) {
            if (inst.paused) continue;
            // 更新播放位置
            inst.position += dtSec * (inst.pitch || 1);
            if (!inst.loop && isFinite(inst.duration) && inst.duration > 0 && inst.position >= inst.duration) {
                stopSound(id); continue;
            }
            // 淡入淡出
            if (inst.fading) {
                inst.fadeElapsed += dtSec;
                const dur = Math.max(0.001, inst.fadeDuration || 0);
                const t = Math.min(1, inst.fadeElapsed / dur);
                inst.fadeAmount = inst.fadeStart + (inst.fadeTarget - inst.fadeStart) * t;
                if (t >= 1) {
                    inst.fading = false;
                    if (inst.fadeOut) { stopSound(id); continue; }
                }
            }
            // 3D距离衰减
            let spatialGain = 1.0;
            if (inst.is3D) {
                const dx = inst.sourceX - audioListener.x, dy = inst.sourceY - audioListener.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                spatialGain = Math.max(0, 1 - dist / Math.max(1, inst.maxDist));
            }
            // 应用音量（同时写入 WebAudio gain 与 HTMLAudio volume）
            const vol = Math.max(0, Math.min(1, (inst.volume == null ? 1 : inst.volume) * (inst.fadeAmount == null ? 1 : inst.fadeAmount) * spatialGain * masterVolume * groupVolumes[inst.groupId|0]));
            if (inst._gain) { try { inst._gain.gain.value = vol; } catch(e){} }
            if (inst.htmlAudio) { try { inst.htmlAudio.volume = vol; } catch(e){} }
        }

        // GAL BGM 交叉淡入淡出 / 停止调度
        const bgm = galAudio.bgm;
        if (bgm.fading){
            bgm.crossElapsed += dtSec * 1000;
            const t = Math.min(1, bgm.crossElapsed / Math.max(1, bgm.crossMs));
            const eased = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
            // 旧的淡出
            const oldInst = audioInstances.get(bgm.instId);
            if (oldInst) {
                const fadeAmt = 1 - eased;
                if (oldInst._gain) try { oldInst._gain.gain.value = Math.max(0, Math.min(1, (oldInst.volume||1) * fadeAmt * masterVolume * groupVolumes[oldInst.groupId|0])); } catch(e){}
                if (oldInst.htmlAudio) try { oldInst.htmlAudio.volume = Math.max(0, Math.min(1, (oldInst.volume||1) * fadeAmt * masterVolume * groupVolumes[oldInst.groupId|0])); } catch(e){}
                if (t >= 1) { stopSound(bgm.instId); bgm.instId = 0; bgm.srcId = 0; }
            }
            // 新的淡入
            if (bgm.nextSrcId && t <= 1){
                if (!audioInstances.has(bgm._nextInstId || 0)){
                    const playNew = () => {
                        const nextVol = (bgm.nextVol == null ? 0.7 : bgm.nextVol);
                        const id = playBufferSource(bgm.nextSrcId, nextVol, 1, !!bgm.nextLoop, 1);
                        if (id) {
                            bgm._nextInstId = id;
                            const ni = audioInstances.get(id);
                            if (ni){
                                // 初始为 0 音量，在 update 里淡入
                                if (ni._gain) try { ni._gain.gain.value = 0.0001; } catch(e){}
                                if (ni.htmlAudio) try { ni.htmlAudio.volume = 0.0001; } catch(e){}
                            }
                        }
                    };
                    // 若 nextSrcId 资源尚未 ready，则异步等待并播放
                    const s = audioSources.get(bgm.nextSrcId);
                    if (s && s.loaded) playNew();
                    else audioOnReady(bgm.nextSrcId, playNew, playNew);
                }
                const ni = audioInstances.get(bgm._nextInstId || 0);
                if (ni){
                    const nextVol = (bgm.nextVol == null ? 0.7 : bgm.nextVol);
                    const fadeAmt = eased;
                    const v = Math.max(0, Math.min(1, nextVol * fadeAmt * masterVolume * groupVolumes[1]));
                    if (ni._gain) try { ni._gain.gain.value = v; } catch(e){}
                    if (ni.htmlAudio) try { ni.htmlAudio.volume = v; } catch(e){}
                    if (t >= 1){
                        bgm.instId = bgm._nextInstId || 0;
                        bgm.srcId  = bgm.nextSrcId;
                        bgm._nextInstId = 0;
                        bgm.nextSrcId = 0;
                    }
                }
            } else if (bgm.stopPending){
                // 仅淡出：无 nextSrcId
                if (t >= 1) bgm.stopPending = false;
            }
            if (t >= 1){ bgm.fading = false; bgm.crossElapsed = 0; bgm.crossMs = 0; }
        }

        // SE 队列：最多同时播放 maxSimul 条，超出节流（丢弃最旧未实际播放的）
        const se = galAudio.se;
        if (se.queue.length){
            const playing = new Set();
            for (const [, inst] of audioInstances) if (inst.groupId === 0) playing.add(inst._srcQueuedId);
            const remain = [];
            for (let i = 0; i < se.queue.length; i++){
                const item = se.queue[i];
                if (playing.size >= se.maxSimul) { remain.push(item); continue; }
                const instId = playSound(item.srcId, item.vol, 1, false);
                if (instId) {
                    const inst = audioInstances.get(instId);
                    if (inst) inst._srcQueuedId = item.srcId + '_' + i + '_' + (Math.random()|0);
                    playing.add(item);
                }
            }
            se.queue.length = 0;
            for (const r of remain) se.queue.push(r);
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
        const srcObj = {
            path: path,
            isMusic: !!isMusic,
            buffer: null,
            source: null,
            gain: null,
            volume: 1.0,
            loaded: false,
            error: false,
            loading: true,
            duration: 0,
            onReady: null,
            onError: null,
        };
        audioSources.set(id, srcObj);

        const finalizeNoop = () => {
            srcObj.loading = false;
            srcObj.loaded  = true;  // 即使失败，也作为空资源标记为 ready，避免上层一直等待
            srcObj.duration = 0;
            srcObj.error = true;
            if (srcObj.onError) try { srcObj.onError(); } catch(e){}
        };

        if (!path || typeof path !== 'string' || !path.length) {
            finalizeNoop();
            return id;
        }
        // 合成音源前缀："synth://pad-C-120"  （未来可扩展）
        if (path.indexOf('synth://') === 0){
            srcObj.loading = false; srcObj.loaded = true; srcObj.duration = Infinity;
            return id;
        }

        const tryDecode = (arrayBuf) => {
            try {
                if (typeof audioCtx.decodeAudioData.length === 'function' /* not used */) {}
                // 现代异步：返回 Promise；旧版回调风格
                const done = (buf) => {
                    if (!buf) { finalizeNoop(); return; }
                    srcObj.buffer = buf;
                    srcObj.duration = buf.duration || 0;
                    srcObj.loaded = true;
                    srcObj.loading = false;
                    if (srcObj.onReady) try { srcObj.onReady(); } catch(e){}
                };
                const fail = () => finalizeNoop();
                let p;
                try { p = audioCtx.decodeAudioData(arrayBuf.slice(0), done, fail); }
                catch (e2) { finalizeNoop(); return; }
                if (p && typeof p.then === 'function') p.then(done, fail);
            } catch (e) { finalizeNoop(); }
        };

        const finalizeDataUri = (dataUri) => {
            try {
                const comma = dataUri.indexOf(',');
                const base64 = comma >= 0 ? dataUri.slice(comma + 1) : dataUri;
                const bin = atob(base64);
                const u8 = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                tryDecode(u8.buffer);
            } catch(e){ finalizeNoop(); }
        };

        // data: URIs
        if (path.indexOf('data:') === 0){ finalizeDataUri(path); return id; }

        // Blob/ObjectURL
        if (path.indexOf('blob:') === 0){
            try {
                fetch(path).then(r => r.arrayBuffer()).then(tryDecode).catch(finalizeNoop);
            } catch(e){ finalizeNoop(); }
            return id;
        }

        // 网络路径
        if (typeof fetch !== 'undefined'){
            fetch(path, { method: 'GET', credentials: 'same-origin' })
                .then(r => {
                    if (!r || !r.ok) { finalizeNoop(); return null; }
                    return r.arrayBuffer();
                })
                .then(buf => { if (buf) tryDecode(buf); })
                .catch(finalizeNoop);
        } else {
            finalizeNoop();
        }
        return id;
    }

    function audioOnReady(id, cb, cbErr){
        const s = audioSources.get(id);
        if (!s) return;
        if (s.loaded) { (s.error && cbErr ? cbErr : cb) && (s.error && cbErr ? cbErr() : cb()); return; }
        const prevA = s.onReady, prevB = s.onError;
        s.onReady = prevA ? (() => { prevA(); cb && cb(); }) : cb;
        s.onError = prevB ? (() => { prevB(); cbErr && cbErr(); }) : cbErr;
    }

    // WebAudio 直接播放（避免额外的 HTMLAudio 标签开销；推荐用于 BGM/SE）
    function playBufferSource(id, volume, pitch, loop, groupId){
        const src = audioSources.get(id);
        if (!src) return 0;
        if (!src.loaded || !audioCtx) return 0;
        // 合成音源：不做 buffer source 播放，由 galAudio 合成器负责
        if (src.path && src.path.indexOf('synth://') === 0) return 0;
        if (!src.buffer) return 0;

        const instId = nextAudioInstanceId++;
        try {
            const buffer = src.buffer;
            const bs = audioCtx.createBufferSource();
            bs.buffer = buffer;
            bs.loop = !!loop;
            if (pitch && pitch !== 1) { bs.playbackRate.value = pitch; }
            const gain = audioCtx.createGain();
            const finalGroup = groupId != null ? groupId : (src.isMusic ? 1 : 0);
            const g = Math.max(0, Math.min(1, (+volume == null ? 1 : +volume))) * masterVolume * groupVolumes[finalGroup];
            gain.gain.value = g;
            bs.connect(gain).connect(audioCtx.destination);
            try { bs.start(0); } catch(e){ return 0; }
            const duration = buffer.duration || 0;
            audioInstances.set(instId, {
                sourceId: id, groupId: finalGroup,
                volume: +volume == null ? 1 : +volume,
                pitch: pitch || 1, pan: 0,
                playing: true, paused: false, loop: !!loop,
                position: 0, duration: duration,
                fadeAmount: 1, fadeStart: 1, fadeTarget: 1, fadeDuration: 0, fadeElapsed: 0, fading: false, fadeOut: false,
                is3D: false, sourceX: 0, sourceY: 0, maxDist: 0,
                htmlAudio: null,
                _bs: bs, _gain: gain, _startAt: audioCtx.currentTime,
            });
            // 播放结束（非 loop）自动回收
            if (!loop && isFinite(duration) && duration > 0){
                const cleanupAfter = Math.max(0.01, duration / Math.max(0.0001, Math.abs(pitch||1)));
                bs.onended = () => {
                    // 双保险：实例仍在且 playing 则回收
                    const inst = audioInstances.get(instId);
                    if (inst) { inst.playing = false; audioInstances.delete(instId); }
                };
                // 兜底定时器（避免部分浏览器 onended 不触发）
                setTimeout(() => {
                    if (audioInstances.has(instId)){
                        const inst = audioInstances.get(instId);
                        if (inst && inst.playing && !inst.loop && audioCtx.currentTime - inst._startAt >= cleanupAfter + 0.1){
                            inst.playing = false;
                            try { inst._bs && inst._bs.stop && inst._bs.stop(); } catch(e){}
                            audioInstances.delete(instId);
                        }
                    }
                }, (cleanupAfter + 0.2) * 1000);
            }
            return instId;
        } catch(e){ return 0; }
    }

    function playAudio(id, loop) {
        if (!audioCtx) return 0;
        return playBufferSource(id, 1, 1, loop, audioSources.get(id) && audioSources.get(id).isMusic ? 1 : 0) || 0;
    }

    function stopAudio(instId) {
        const inst = audioInstances.get(instId);
        if (!inst) return;
        try { if (inst._bs && inst._bs.stop) inst._bs.stop(); } catch(e){}
        if (inst.htmlAudio) { try { inst.htmlAudio.pause(); } catch(e){} inst.htmlAudio = null; }
        inst.playing = false;
        audioInstances.delete(instId);
    }

    function setVolume(id, volume) {
        // 二义性：id 可能是 sourceId 也可能是 instanceId
        // 先当做 instId 处理
        const inst = audioInstances.get(id);
        if (inst){
            inst.volume = +volume || 0;
            if (inst._gain){ try { inst._gain.gain.value = Math.max(0, Math.min(1, inst.volume)) * masterVolume * groupVolumes[inst.groupId]; } catch(e){} }
            if (inst.htmlAudio){ try { inst.htmlAudio.volume = Math.max(0, Math.min(1, inst.volume)) * masterVolume * groupVolumes[inst.groupId]; } catch(e){} }
            return;
        }
        const a = audioSources.get(id);
        if (a){
            a.volume = +volume || 0;
            if (a.gain) try { a.gain.gain.value = a.volume; } catch(e){}
        }
    }

    function stopAllAudio() {
        for (const [id, inst] of audioInstances) {
            try { if (inst._bs && inst._bs.stop) inst._bs.stop(); } catch(e){}
            try { if (inst.htmlAudio) inst.htmlAudio.pause(); } catch(e){}
        }
        audioInstances.clear();
        // 旧版 audioSources.source 清理（兼容）
        for (const [, a] of audioSources) {
            if (a.source) try { a.source.stop(); } catch(e){}
            a.source = null;
        }
        // 停止所有合成音源
        if (galAudio.synths.size){
            for (const [, s] of galAudio.synths){
                try { if (s.node && s.node.stop) s.node.stop(); } catch(e){}
            }
            galAudio.synths.clear();
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

    // ====== v1.3 新增控件 ======
    function uiCreateDropdown(x, y, w, h) {
        const id = uiCreate(WIDGET.DROPDOWN);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.options = []; wd.selected = 0; wd.dropdownOpen = false;
        wd.bgColor = { r: 30, g: 30, b: 40, a: 255 };
        wd.textColor = { r: 240, g: 240, b: 240, a: 255 };
        return id;
    }
    function uiCreateToggle(initial, x, y, w, h) {
        const id = uiCreate(WIDGET.TOGGLE);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.checked = !!initial;
        wd.bgColor = { r: 60, g: 90, b: 160, a: 255 };
        wd.textColor = { r: 255, g: 255, b: 255, a: 255 };
        return id;
    }
    function uiCreateScrollview(x, y, w, h) {
        const id = uiCreate(WIDGET.SCROLLVIEW);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.contentW = w; wd.contentH = h;
        wd.scrollX = 0; wd.scrollY = 0;
        wd.bgColor = { r: 30, g: 30, b: 40, a: 255 };
        return id;
    }
    function uiCreateTooltip(text, x, y) {
        const id = uiCreate(WIDGET.TOOLTIP);
        const wd = widgets.get(id);
        wd.text = text; wd.x = x; wd.y = y;
        wd.autoSize = AUTOSIZE.BOTH;
        wd.bgColor = { r: 40, g: 40, b: 50, a: 230 };
        wd.textColor = { r: 240, g: 240, b: 240, a: 255 };
        return id;
    }
    function uiCreateProgress(x, y, w, h) {
        const id = uiCreate(WIDGET.PROGRESS);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.value = 0;
        wd.bgColor = { r: 90, g: 90, b: 110, a: 255 };
        return id;
    }
    function uiCreateSlider(min, max, value, x, y, w, h) {
        const id = uiCreate(WIDGET.SLIDER);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.minVal = min; wd.maxVal = max; wd.value = value;
        wd.bgColor = { r: 90, g: 90, b: 110, a: 255 };
        return id;
    }
    function uiCreateCheckbox(initial, x, y, w, h) {
        const id = uiCreate(WIDGET.CHECKBOX);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.checked = !!initial;
        wd.bgColor = { r: 30, g: 30, b: 40, a: 255 };
        return id;
    }
    function uiCreateDivider(x, y, w, h) {
        const id = uiCreate(WIDGET.DIVIDER);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = w; wd.h = h;
        wd.bgColor = { r: 120, g: 120, b: 130, a: 255 };
        return id;
    }
    function uiCreateSpinner(x, y, size) {
        const id = uiCreate(WIDGET.SPINNER);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = size; wd.h = size;
        wd.animTime = 0;
        wd.bgColor = { r: 0, g: 0, b: 0, a: 0 };
        wd.textColor = { r: 100, g: 200, b: 255, a: 255 };
        return id;
    }
    function uiCreateIcon(textureId, x, y, size) {
        const id = uiCreate(WIDGET.ICON);
        const wd = widgets.get(id);
        wd.x = x; wd.y = y; wd.w = size; wd.h = size;
        wd.textureId = textureId;
        return id;
    }

    // ====== v1.3 控件状态接口 ======
    function uiSetValue(widget, value) {
        const wd = widgets.get(widget); if (!wd) return;
        if (wd.type === WIDGET.SLIDER) {
            wd.value = Math.max(wd.minVal, Math.min(wd.maxVal, value));
        } else if (wd.type === WIDGET.PROGRESS) {
            wd.value = Math.max(0, Math.min(1, value));
        } else { wd.value = value; }
    }
    function uiGetValue(widget) {
        const wd = widgets.get(widget); return wd ? wd.value : 0;
    }
    function uiSetMinMax(widget, min, max) {
        const wd = widgets.get(widget); if (!wd) return;
        wd.minVal = min; wd.maxVal = max;
    }
    function uiSetOptions(widget, options) {
        const wd = widgets.get(widget); if (!wd) return;
        wd.options = options ? options.slice() : [];
        if (wd.selected >= wd.options.length) wd.selected = wd.options.length - 1;
        if (wd.selected < 0) wd.selected = 0;
    }
    function uiGetSelected(widget) {
        const wd = widgets.get(widget); return wd ? (wd.selected || 0) : 0;
    }
    function uiSetSelected(widget, index) {
        const wd = widgets.get(widget); if (!wd) return;
        if (index >= 0 && wd.options && index < wd.options.length) wd.selected = index;
    }
    function uiSetChecked(widget, checked) {
        const wd = widgets.get(widget); if (!wd) return;
        wd.checked = !!checked;
    }
    function uiGetChecked(widget) {
        const wd = widgets.get(widget); return wd ? !!wd.checked : false;
    }
    function uiSetScroll(widget, offsetX, offsetY) {
        const wd = widgets.get(widget); if (!wd) return;
        if (wd.contentW > wd.w) {
            offsetX = Math.max(0, Math.min(offsetX, wd.contentW - wd.w));
        } else offsetX = 0;
        if (wd.contentH > wd.h) {
            offsetY = Math.max(0, Math.min(offsetY, wd.contentH - wd.h));
        } else offsetY = 0;
        wd.scrollX = offsetX; wd.scrollY = offsetY;
    }
    function uiGetScroll(widget) {
        const wd = widgets.get(widget);
        if (!wd) return { x: 0, y: 0 };
        return { x: wd.scrollX || 0, y: wd.scrollY || 0 };
    }
    function uiSetContentSize(scrollview, w, h) {
        const wd = widgets.get(scrollview); if (!wd) return;
        wd.contentW = w; wd.contentH = h;
    }

    // ====== v1.3 主题系统 ======
    let currentTheme = {
        background: { r: 18, g: 18, b: 24, a: 255 },
        surface:    { r: 30, g: 30, b: 38, a: 255 },
        primary:    { r: 60, g: 90, b: 160, a: 255 },
        secondary:  { r: 90, g: 90, b: 110, a: 255 },
        text:       { r: 235, g: 235, b: 235, a: 255 },
        textMuted:  { r: 130, g: 130, b: 140, a: 255 },
        border:     { r: 120, g: 120, b: 130, a: 255 },
        accent:     { r: 100, g: 200, b: 255, a: 255 },
        danger:     { r: 220, g: 70, b: 70, a: 255 },
        success:    { r: 80, g: 180, b: 100, a: 255 },
    };
    function uiSetTheme(theme) {
        if (!theme) return;
        Object.assign(currentTheme, theme);
    }
    function uiGetTheme() { return Object.assign({}, currentTheme); }
    function uiResetTheme() {
        currentTheme = {
            background: { r: 18, g: 18, b: 24, a: 255 },
            surface:    { r: 30, g: 30, b: 38, a: 255 },
            primary:    { r: 60, g: 90, b: 160, a: 255 },
            secondary:  { r: 90, g: 90, b: 110, a: 255 },
            text:       { r: 235, g: 235, b: 235, a: 255 },
            textMuted:  { r: 130, g: 130, b: 140, a: 255 },
            border:     { r: 120, g: 120, b: 130, a: 255 },
            accent:     { r: 100, g: 200, b: 255, a: 255 },
            danger:     { r: 220, g: 70, b: 70, a: 255 },
            success:    { r: 80, g: 180, b: 100, a: 255 },
        };
    }
    function uiSetAutoSize(widget, mode) {
        const wd = widgets.get(widget); if (!wd) return;
        wd.autoSize = mode;
    }
    function uiMeasureText(text, fontSize) {
        // 基于内置位图字体估算：每字符宽度 = 6px * (fontSize/7)
        const w = (text ? text.length : 0) * 6 * (fontSize / 7);
        return { w: w, h: fontSize };
    }
    function uiSetMargin(widget, top, right, bottom, left) {
        const wd = widgets.get(widget); if (!wd) return;
        wd.marginTop = top; wd.marginRight = right;
        wd.marginBottom = bottom; wd.marginLeft = left;
    }

    // ====== v1.3 声明式 UI 构建 ======
    function uiBuildFromJson(json) {
        let obj;
        try { obj = JSON.parse(json); } catch (e) { return 0; }
        return buildWidgetNode(obj);
    }
    function buildWidgetNode(node) {
        if (!node || typeof node !== 'object') return 0;
        const typeMap = {
            'container': WIDGET.CONTAINER, 'button': WIDGET.BUTTON,
            'label': WIDGET.LABEL, 'input': WIDGET.INPUT,
            'image': WIDGET.IMAGE, 'list': WIDGET.LIST,
            'progress': WIDGET.PROGRESS, 'checkbox': WIDGET.CHECKBOX,
            'slider': WIDGET.SLIDER, 'tabbar': WIDGET.TABBAR,
            'navbar': WIDGET.NAVBAR, 'dropdown': WIDGET.DROPDOWN,
            'toggle': WIDGET.TOGGLE, 'scrollview': WIDGET.SCROLLVIEW,
            'tooltip': WIDGET.TOOLTIP, 'divider': WIDGET.DIVIDER,
            'spinner': WIDGET.SPINNER, 'icon': WIDGET.ICON,
        };
        const layoutMap = {
            'none': LAYOUT.NONE, 'vertical': LAYOUT.VERTICAL,
            'horizontal': LAYOUT.HORIZONTAL, 'grid': LAYOUT.GRID,
            'stack': LAYOUT.STACK, 'flow': LAYOUT.FLOW,
        };
        const wt = typeMap[node.type] || WIDGET.CONTAINER;
        const id = uiCreate(wt);
        const wd = widgets.get(id);
        if (!wd) return 0;
        if (node.text) wd.text = node.text;
        if (node.name) wd.name = node.name;
        if ('x' in node) wd.x = node.x;
        if ('y' in node) wd.y = node.y;
        if ('w' in node) wd.w = node.w;
        if ('h' in node) wd.h = node.h;
        if (node.fontSize) wd.fontSize = node.fontSize;
        if ('visible' in node) wd.visible = node.visible;
        if ('enabled' in node) wd.enabled = node.enabled;
        if (node.layout) wd.layout = layoutMap[node.layout] || LAYOUT.NONE;
        if ('spacing' in node) wd.spacing = node.spacing;
        if ('alignment' in node) wd.alignment = node.alignment;
        if (node.padding && node.padding.length >= 4) {
            wd.padTop = node.padding[0]; wd.padRight = node.padding[1];
            wd.padBottom = node.padding[2]; wd.padLeft = node.padding[3];
        }
        if (node.gridCols) wd.gridCols = node.gridCols;
        if (node.gridRows) wd.gridRows = node.gridRows;
        if ('checked' in node) wd.checked = node.checked;
        if ('value' in node) wd.value = node.value;
        if ('min' in node) wd.minVal = node.min;
        if ('max' in node) wd.maxVal = node.max;
        if ('selected' in node) wd.selected = node.selected;
        if (node.options) wd.options = node.options.slice();
        if (node.children && Array.isArray(node.children)) {
            for (const childNode of node.children) {
                const childId = buildWidgetNode(childNode);
                if (childId) uiAddChild(id, childId);
            }
        }
        return id;
    }
    function uiDumpTree(root) {
        const wd = widgets.get(root);
        if (!wd) return 'null';
        function rec(h, depth) {
            const cw = widgets.get(h); if (!cw) return '';
            let s = '  '.repeat(depth) + '{"type":' + JSON.stringify(cw.type) +
                    ',"x":' + cw.x + ',"y":' + cw.y +
                    ',"w":' + cw.w + ',"h":' + cw.h;
            if (cw.text) s += ',"text":' + JSON.stringify(cw.text);
            if (cw.checked) s += ',"checked":true';
            if (cw.children && cw.children.length > 0) {
                s += ',"children":[\n';
                for (let i = 0; i < cw.children.length; i++) {
                    s += rec(cw.children[i], depth + 1);
                    if (i < cw.children.length - 1) s += ',';
                    s += '\n';
                }
                s += '  '.repeat(depth) + ']';
            }
            s += '}';
            return s;
        }
        return rec(root, 0);
    }
    function uiFindById(name) {
        for (const [id, wd] of widgets) {
            if (wd.name === name) return id;
        }
        return 0;
    }

    // ====== v1.3 物理引擎空间分区与调试 ======
    function physicsSetBroadphase(type) {
        physicsWorld.broadphase = type;
    }
    function physicsSetGridCellSize(size) {
        physicsWorld.gridCellSize = size;
    }
    function physicsGetPairCount() {
        return physicsWorld.lastPairCount;
    }
    function physicsDebugDraw(options) {
        const opt = options || {};
        const shapeCol = opt.shapeColor || { r: 80, g: 200, b: 120, a: 255 };
        const contactCol = opt.contactColor || { r: 240, g: 90, b: 90, a: 255 };
        const gridCol = opt.gridColor || { r: 60, g: 90, b: 140, a: 120 };
        // 绘制网格（如果使用 grid broadphase）
        if (physicsWorld.broadphase === 0 && opt.showGrid !== false) {
            let cs = physicsWorld.gridCellSize;
            if (!cs || cs <= 0) {
                // 自动计算
                let maxSize = 0;
                for (const [id, b] of physicsWorld.bodies) {
                    if (b.shape === 0) maxSize = Math.max(maxSize, b.radius * 2);
                    else maxSize = Math.max(maxSize, Math.max(b.w, b.h));
                }
                cs = maxSize > 0 ? maxSize : 64;
            }
            const viewW = canvas.width / camera.zoom;
            const viewH = canvas.height / camera.zoom;
            const startX = Math.floor(camera.x / cs) * cs;
            const startY = Math.floor(camera.y / cs) * cs;
            for (let x = startX; x < camera.x + viewW; x += cs) {
                drawLine(x, camera.y, x, camera.y + viewH, 1, gridCol);
            }
            for (let y = startY; y < camera.y + viewH; y += cs) {
                drawLine(camera.x, y, camera.x + viewW, y, 1, gridCol);
            }
        }
        // 绘制所有 body 的 AABB/形状
        for (const [id, b] of physicsWorld.bodies) {
            if (b.shape === 0) { // circle
                drawCircle(b.x, b.y, b.radius, shapeCol, false);
            } else { // box
                drawRect({ x: b.x - b.w / 2, y: b.y - b.h / 2, w: b.w, h: b.h }, shapeCol, false);
            }
        }
        // 绘制碰撞接触点
        if (opt.showContacts !== false) {
            const cols = physicsGetCollisions(0, 999);
            if (cols && cols.length) {
                for (const c of cols) {
                    if (c.point) drawCircle(c.point.x, c.point.y, 3, contactCol, true);
                }
            }
        }
    }

    // ============================================================
    // 视觉小说 / GAL 引擎 (LumentGAL 分支)
    // ============================================================
    const GAL_CMD = {
        SAY:1, NARRATE:2, SHOW:3, HIDE:4, BG:5, CG:6, CG_CLEAR:7,
        BGM:8, BGM_STOP:9, SE:10, VOICE:11, CHOOSE:12, LABEL:13, JUMP:14,
        IF:15, SET:16, WAIT:17, SHAKE:18, EFFECT:19, CALL:20, RETURN:21,
        LIVE2D:22, END:23, TITLE:24, SAVE:25, LOAD:26, AUTOSPEED:27
    };
    const GAL_SLOT = { LEFT:0, CENTER:1, RIGHT:2, CUSTOM:3 };
    const GAL_TWEEN = { NONE:0, FADE:1, SLIDE_L:2, SLIDE_R:3, SLIDE_U:4, SLIDE_D:5, ZOOM:6, DISSOLVE:7, CUT:8 };

    const gal = {
        inited: false,
        running: false,
        scripts: Object.create(null), // name -> {lines:[], labels:{}}
        scriptIdSeq: 1,
        curScript: null,
        curLine: 0,
        stack: [],              // call 栈
        vars: Object.create(null),
        skip: false,
        skipReadOnly: false,    // true = skip 只跳过已读
        auto: false,
        autoDelayMs: 2500,
        waitingClick: false,
        waitingTimerMs: 0,
        waitingTimerElapsed: 0,
        choices: null,          // [{label,text}] or null
        history: [],            // [{name,text,voice}]
        dialogVisible: true,
        dialog: null,           // {name, text, shownChars, timer, speed}
        bg: { image:null, color:{r:30,g:30,b:40,a:255}, tween: GAL_TWEEN.FADE, tweenT:1, tweenDur:500, from:null, to:null },
        cg: null,               // {image, tween, tweenT, tweenDur, fromAlpha, toAlpha}
        sprites: new Map(),     // id -> {id, image, expr, slot,x,y,scale,alpha,z,destAlpha,tween,tweenT,tweenDur,fromX,fromY,fromAlpha,toX,toY,toAlpha,live2dId}
        spriteIdSeq: 1,
        audio: { bgm:null, bgmFadeT:0, bgmFadeDur:500, bgmFromVol:0, bgmToVol:0, bgmTargetStop:false, voice:null, se:[] },
        saveSlotKey: 'LUMENT_GAL_SAVE_v1',
        prefKey: 'LUMENT_GAL_PREF_v1',
        pref: {
            textSpeed: 5,   // 1..10 -> ms = 110 - speed*10
            auto: false,
            skip: false,
            skipReadOnly: false,
            volSE: 1.0, volBGM: 1.0, volVoice: 1.0
        },
        style: null,
        listeners: { onVarChange: null, onRead: null },
        onEnd: null,
        onTitle: null,
        onVarChange: null,
        onRead: null,
        readSet: Object.create(null),   // 已读签名：scriptName_lineNo_textSig -> true
        shake: { intensity:0, t:0, dur:500, ox:0, oy:0 },
        fade: { r:0,g:0,b:0,a:0, t:0, dur:500, fromA:0, toA:0 }
    };

    function galDefaultStyle(){
        const w = (canvas && canvas.width) || 1280;
        const h = (canvas && canvas.height) || 720;
        return {
            x: 40, y: h - 250, w: w - 80, h: 210,
            bgColor:{r:10,g:14,b:30,a:215},
            borderColor:{r:120,g:160,b:255,a:90},
            borderWidth: 1.5, radius: 16, padding: 22,
            nameColor:{r:20,g:40,b:80,a:240},
            nameTextColor:{r:235,g:240,b:255,a:255},
            textColor:{r:230,g:232,b:250,a:255},
            nameFontSize: 20, textFontSize: 22, lineHeight: 1.7,
            fontFace: '', showNameBox: true, showAdvanceHint: true,
            typewriterSpeed: 5, autoWrap: true, maxLines: 4
        };
    }

    function galSavePref(){
        try { localStorage.setItem(gal.prefKey, JSON.stringify(gal.pref)); } catch(e){}
    }
    function galLoadPref(){
        try {
            const s = localStorage.getItem(gal.prefKey);
            if (s){
                const p = JSON.parse(s);
                Object.assign(gal.pref, p);
                if (typeof gal.pref.skipReadOnly === 'boolean') gal.skipReadOnly = gal.pref.skipReadOnly;
            }
        } catch(e){}
    }

    function galParseScript(name, src){
        const lines = src.split(/\r?\n/);
        const script = { id: gal.scriptIdSeq++, name, lines: [], labels: Object.create(null) };
        for (let i = 0; i < lines.length; i++){
            let line = lines[i];
            // 去掉注释 # 或 //
            const cm = line.match(/^\s*(#|\/\/)/);
            if (cm) continue;
            line = line.replace(/\t/g, ' ').trim();
            if (!line) continue;
            // 命令以 @ 开头，否则作为说话/旁白行（冒号前为名字）
            let cmd = null;
            if (line.startsWith('@')){
                const rest = line.slice(1).trim();
                const parts = tokenizeLine(rest);
                const kw = parts[0];
                switch(kw){
                    case 'say': {
                        const nm = parts[1] || '';
                        const tx = parts.slice(2).join(' ');
                        cmd = { type: GAL_CMD.SAY, name: nm, text: tx };
                        break;
                    }
                    case 'narrate': cmd = { type: GAL_CMD.NARRATE, text: parts.slice(1).join(' ') }; break;
                    case 'show': {
                        const sprite = parts[1] || '';
                        const slotStr = parts[2] || 'CENTER';
                        const expr = parts[3] || '';
                        const alpha = parts[4] ? parseFloat(parts[4]) : 1;
                        const twStr = parts[5] || 'FADE';
                        const dur = parts[6] ? parseInt(parts[6]) : 500;
                        cmd = { type: GAL_CMD.SHOW, sprite, slot: slotByName(slotStr), expression:expr, alpha, tween: tweenByName(twStr), duration: dur };
                        break;
                    }
                    case 'hide': {
                        const sprite = parts[1] || '';
                        const twStr = parts[2] || 'FADE';
                        const dur = parts[3] ? parseInt(parts[3]) : 500;
                        cmd = { type: GAL_CMD.HIDE, sprite, tween: tweenByName(twStr), duration: dur };
                        break;
                    }
                    case 'bg': {
                        const img = parts[1] || '';
                        const twStr = parts[2] || 'FADE';
                        const dur = parts[3] ? parseInt(parts[3]) : 800;
                        cmd = { type: GAL_CMD.BG, image: img, tween: tweenByName(twStr), duration: dur };
                        break;
                    }
                    case 'cg': {
                        const img = parts[1] || '';
                        const twStr = parts[2] || 'FADE';
                        const dur = parts[3] ? parseInt(parts[3]) : 800;
                        cmd = { type: GAL_CMD.CG, image: img, tween: tweenByName(twStr), duration: dur };
                        break;
                    }
                    case 'cg_clear': {
                        const twStr = parts[1] || 'FADE';
                        const dur = parts[2] ? parseInt(parts[2]) : 500;
                        cmd = { type: GAL_CMD.CG_CLEAR, tween: tweenByName(twStr), duration: dur };
                        break;
                    }
                    case 'bgm': {
                        const audio = parts[1] || '';
                        const loop = parts[2] ? parts[2] === 'true' : true;
                        const vol = parts[3] ? parseFloat(parts[3]) : 0.7;
                        const fade = parts[4] ? parseInt(parts[4]) : 800;
                        cmd = { type: GAL_CMD.BGM, audio, loop, volume: vol, fadeMs: fade };
                        break;
                    }
                    case 'bgm_stop': {
                        const fade = parts[1] ? parseInt(parts[1]) : 800;
                        cmd = { type: GAL_CMD.BGM_STOP, fadeMs: fade };
                        break;
                    }
                    case 'se': {
                        const audio = parts[1] || '';
                        const vol = parts[2] ? parseFloat(parts[2]) : 1.0;
                        cmd = { type: GAL_CMD.SE, audio, volume: vol };
                        break;
                    }
                    case 'voice': {
                        const audio = parts[1] || '';
                        const vol = parts[2] ? parseFloat(parts[2]) : 1.0;
                        const sp = parts[3] || '';
                        cmd = { type: GAL_CMD.VOICE, audio, volume: vol, speaker: sp };
                        break;
                    }
                    case 'choose': {
                        const pairs = (parts[1] || '').split(';');
                        const opts = [];
                        for (const p of pairs){
                            const [label, text] = p.split('|');
                            if (label && text) opts.push({ label, text });
                        }
                        cmd = { type: GAL_CMD.CHOOSE, options: opts };
                        break;
                    }
                    case 'label': {
                        const lb = parts[1] || '';
                        script.labels[lb] = script.lines.length;
                        cmd = { type: GAL_CMD.LABEL, label: lb };
                        break;
                    }
                    case 'jump': cmd = { type: GAL_CMD.JUMP, label: parts[1] || '' }; break;
                    case 'if': {
                        const cond = parts[1] || '';
                        const m = cond.match(/^([^=<>!]+)(==|!=|>=|<=|>|<)(.+)$/);
                        const label = parts[2] || '';
                        cmd = { type: GAL_CMD.IF, variable: m?m[1]:cond, op: m?m[2]:'==', value: m?m[3]:'true', label };
                        break;
                    }
                    case 'set': {
                        const v = parts[1] || '';
                        const op = ['+=','-=','*=','/=','%=','=','+=','-='].indexOf(parts[2]) >= 0 ? parts[2] : '=';
                        const val = parts[3] !== undefined ? parts.slice(3).join(' ') : parts[2];
                        cmd = { type: GAL_CMD.SET, variable: v, op, value: val };
                        break;
                    }
                    case 'wait': {
                        const arg = (parts[1] || 'click').toLowerCase();
                        if (arg === 'click' || arg === 'tap') cmd = { type: GAL_CMD.WAIT, click: true };
                        else cmd = { type: GAL_CMD.WAIT, ms: parseInt(arg) || 0 };
                        break;
                    }
                    case 'shake': cmd = { type: GAL_CMD.SHAKE, intensity: parseFloat(parts[1])||6, ms: parseInt(parts[2])||400 }; break;
                    case 'effect': {
                        cmd = { type: GAL_CMD.EFFECT, name: parts[1]||'', duration: parseInt(parts[2])||1000, args: parts.slice(3) };
                        break;
                    }
                    case 'call': cmd = { type: GAL_CMD.CALL, script: parts[1]||'', entry: parts[2]||null }; break;
                    case 'return': cmd = { type: GAL_CMD.RETURN }; break;
                    case 'live2d': {
                        const id = parts[1]||'';
                        const op = parts[2]||'';
                        const arg = parts[3]||'';
                        cmd = { type: GAL_CMD.LIVE2D, id, op, arg };
                        break;
                    }
                    case 'end': cmd = { type: GAL_CMD.END }; break;
                    case 'title': cmd = { type: GAL_CMD.TITLE }; break;
                    // —— 别名（与文档速查表一致）——
                    case 'showcg': {
                        const img = parts[1] || '';
                        const twStr = parts[2] || 'FADE';
                        const dur = parts[3] ? parseInt(parts[3]) : 800;
                        cmd = { type: GAL_CMD.CG, image: img, tween: tweenByName(twStr), duration: dur };
                        break;
                    }
                    case 'hidecg': {
                        const twStr = parts[1] || 'FADE';
                        const dur = parts[2] ? parseInt(parts[2]) : 500;
                        cmd = { type: GAL_CMD.CG_CLEAR, tween: tweenByName(twStr), duration: dur };
                        break;
                    }
                    case 'ret': cmd = { type: GAL_CMD.RETURN }; break;
                    case 'autospeed': {
                        const ms = Math.max(100, parseInt(parts[1]) || 2500);
                        cmd = { type: GAL_CMD.AUTOSPEED, ms };
                        break;
                    }
                    case 'save': {
                        let slot = 99;
                        if (parts[1] !== undefined){
                            const n = parseInt(parts[1]);
                            if (!isNaN(n)) slot = n|0;
                        }
                        const title = (slot === parseInt(parts[1])) ? parts.slice(2).join(' ') : parts.slice(1).join(' ');
                        cmd = { type: GAL_CMD.SAVE, slot, title: title || 'Auto Save' };
                        break;
                    }
                    case 'load': {
                        let slot = 99;
                        if (parts[1] !== undefined){
                            const n = parseInt(parts[1]);
                            if (!isNaN(n)) slot = n|0;
                        }
                        cmd = { type: GAL_CMD.LOAD, slot };
                        break;
                    }
                    default: break;
                }
            } else {
                // 台词行:  "Name: Text"  或 "Text"（旁白）
                const col = line.indexOf(':');
                if (col > 0){
                    const nm = line.slice(0, col).trim();
                    const tx = line.slice(col + 1).trim();
                    cmd = { type: GAL_CMD.SAY, name: nm, text: tx };
                } else {
                    cmd = { type: GAL_CMD.NARRATE, text: line };
                }
            }
            if (cmd) script.lines.push(cmd);
        }
        return script;
    }

    function tokenizeLine(s){
        // 按空格拆分，但保留引号整体
        const out = [];
        let i = 0, cur = '', quote = null;
        while (i < s.length){
            const c = s[i];
            if (quote){
                if (c === quote){ quote = null; i++; continue; }
                cur += c; i++; continue;
            }
            if (c === '"' || c === "'"){ quote = c; i++; continue; }
            if (c === ' ' || c === '\t'){
                if (cur) { out.push(cur); cur = ''; }
                while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
                continue;
            }
            cur += c; i++;
        }
        if (cur) out.push(cur);
        return out;
    }
    function slotByName(s){
        switch ((s||'').toUpperCase()){
            case 'LEFT': case 'L': return GAL_SLOT.LEFT;
            case 'CENTER': case 'C': case 'CENTRE': return GAL_SLOT.CENTER;
            case 'RIGHT': case 'R': return GAL_SLOT.RIGHT;
            case 'CUSTOM': case 'X': default: return GAL_SLOT.CUSTOM;
        }
    }
    function tweenByName(s){
        switch ((s||'').toUpperCase()){
            case 'NONE': case '0': return GAL_TWEEN.NONE;
            case 'FADE': default: return GAL_TWEEN.FADE;
            case 'SLIDE_L': case 'SLIDE_LEFT': return GAL_TWEEN.SLIDE_L;
            case 'SLIDE_R': case 'SLIDE_RIGHT': return GAL_TWEEN.SLIDE_R;
            case 'SLIDE_U': case 'SLIDE_UP': return GAL_TWEEN.SLIDE_U;
            case 'SLIDE_D': case 'SLIDE_DOWN': return GAL_TWEEN.SLIDE_D;
            case 'ZOOM': return GAL_TWEEN.ZOOM;
            case 'DISSOLVE': return GAL_TWEEN.DISSOLVE;
            case 'CUT': case 'INSTANT': return GAL_TWEEN.CUT;
        }
    }

    function galEvalVariable(v, fallback){
        if (v === undefined || v === null) return fallback;
        if (v in gal.vars) return gal.vars[v];
        // 字面量支持
        if (v === 'true') return true;
        if (v === 'false') return false;
        if (v === 'null') return null;
        if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
        const s = String(v);
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
        return fallback === undefined ? v : fallback;
    }
    function galCompare(a, op, b){
        switch(op){
            case '==': return a == b;
            case '!=': return a != b;
            case '>':  return a >  b;
            case '<':  return a <  b;
            case '>=': return a >= b;
            case '<=': return a <= b;
        }
        return false;
    }

    function galSetVar(k, v){ const old = gal.vars[k]; gal.vars[k] = v; fireVarChange(k, old, v); }
    function galSetVarInt(k, v){ const old = gal.vars[k]; gal.vars[k] = Number(v)|0; fireVarChange(k, old, gal.vars[k]); }
    function galSetVarFloat(k, v){ const old = gal.vars[k]; gal.vars[k] = Number(v); fireVarChange(k, old, gal.vars[k]); }
    function galSetVarBool(k, v){ const old = gal.vars[k]; gal.vars[k] = !!v; fireVarChange(k, old, gal.vars[k]); }
    function fireVarChange(k, oldVal, newVal){
        if (oldVal === newVal) return;
        try {
            if (gal.listeners && gal.listeners.onVarChange) gal.listeners.onVarChange(k, oldVal, newVal);
            if (gal.onVarChange && gal.onVarChange !== gal.listeners.onVarChange) gal.onVarChange(k, oldVal, newVal);
        } catch(_e){}
    }
    function galGetVar(k, def){ return (k in gal.vars) ? gal.vars[k] : def; }
    function galGetVarInt(k, def){ const v = galGetVar(k, def); return v === undefined ? def : Number(v)|0; }
    function galGetVarFloat(k, def){ const v = galGetVar(k, def); return v === undefined ? def : Number(v); }
    function galGetVarBool(k, def){ const v = galGetVar(k, null); return v === null ? !!def : !!v; }

    function galInit(styleOpt){
        if (gal.inited) return;
        gal.inited = true;
        gal.style = Object.assign(galDefaultStyle(), styleOpt || {});
        galLoadPref();
        if (gal.pref.textSpeed) gal.style.typewriterSpeed = gal.pref.textSpeed;
        if (gal.pref.auto) gal.auto = true;
        if (gal.pref.skip) gal.skip = true;
        if (typeof gal.pref.skipReadOnly === 'boolean') gal.skipReadOnly = gal.pref.skipReadOnly;
    }
    function galShutdown(){
        gal.inited = false; gal.running = false;
        gal.scripts = Object.create(null); gal.curScript = null;
        gal.sprites.clear();
        gal.history.length = 0;
        gal.cg = null;
        if (gal.audio.bgm){ try { stopAudio(gal.audio.bgm); } catch(e){} gal.audio.bgm = null; }
        if (gal.audio.voice){ try { stopAudio(gal.audio.voice); } catch(e){} gal.audio.voice = null; }
        // 清理订阅者，防止重复绑定内存泄漏
        gal.listeners.onVarChange = null;
        gal.onVarChange = null;
        gal.onRead = null;
        gal.onEnd = null;
        gal.onTitle = null;
        // 清理合成音源
        try {
            if (galAudio && galAudio.synths){
                for (const [k, s] of galAudio.synths){
                    try { if (s.gain && s.gain.gain) s.gain.gain.value = 0; } catch(_e){}
                    try { if (s.node && s.node.stop) s.node.stop(); } catch(_e){}
                }
                galAudio.synths.clear();
            }
        } catch(_e){}
    }
    function galLoadScript(name, source){
        const s = galParseScript(name, source || '');
        gal.scripts[name] = s;
        gal.scripts[s.id] = s;
        return s.id;
    }
    function galStart(scriptId, entryLabel){
        const sc = typeof scriptId === 'number'
            ? (gal.scripts[scriptId] || null)
            : (gal.scripts[scriptId] || null);
        if (!sc) return;
        if (!gal.inited) galInit();
        gal.curScript = sc;
        if (entryLabel && entryLabel in sc.labels){
            const idx = sc.labels[entryLabel];
            gal.curLine = (typeof idx === 'number' && idx >= 0 && idx < sc.lines.length) ? idx : 0;
        } else {
            gal.curLine = 0;
        }
        gal.stack = [];
        gal.vars = Object.create(null);
        gal.history.length = 0;
        gal.running = true;
        gal.waitingClick = false;
        gal.waitingTimerMs = 0;
        gal.choices = null;
        galAdvanceNextLine();
    }
    function galStop(){ gal.running = false; }
    function galIsRunning(){ return gal.running; }

    function galAdvance(){
        if (!gal.running) return;
        // 打字机进行中 -> 瞬间显示
        if (gal.dialog && gal.dialog.shownChars < (gal.dialog.text || '').length){
            gal.dialog.shownChars = (gal.dialog.text || '').length;
            gal.dialog.timer = 0;
            return;
        }
        if (gal.waitingClick){
            gal.waitingClick = false;
            galAdvanceNextLine();
        }
    }
    function galSkip(enable){ gal.skip = !!enable; gal.pref.skip = !!enable; galSavePref(); }
    function galSetSkipReadOnly(enable){
        gal.skipReadOnly = !!enable;
        gal.pref.skipReadOnly = !!enable;
        galSavePref();
    }
    function galGetSkipReadOnly(){ return !!gal.skipReadOnly; }
    function galAuto(enable){ gal.auto = !!enable; gal.pref.auto = !!enable; galSavePref(); }
    function galSetAutoDelay(ms){ gal.autoDelayMs = ms; }

    function galStartLine(cmd){
        switch (cmd.type){
            case GAL_CMD.SAY:
            case GAL_CMD.NARRATE: {
                const name = cmd.type === GAL_CMD.NARRATE ? '' : (cmd.name || '');
                const text = interpolateVars(cmd.text || '');
                // 已读签名：scriptName + 行号前一行 + 文本内容简易哈希
                const sName = gal.curScript ? gal.curScript.name : '_';
                const lineNo = gal.curLine - 1; // galAdvanceNextLine 已经 ++
                let sig = 5381;
                for (let i = 0; i < text.length; i++) sig = ((sig << 5) + sig) ^ text.charCodeAt(i);
                const readKey = sName + '_' + lineNo + '_' + (sig|0);
                const wasRead = !!gal.readSet[readKey];
                gal.readSet[readKey] = true;
                // 缓存到 dialog 便于 skip 判断和 onRead 回调
                gal._curReadKey = readKey;
                gal._curWasRead = wasRead;
                try {
                    if (!wasRead && (gal.onRead || gal.listeners.onRead)){
                        if (gal.onRead) gal.onRead(name, text);
                        if (gal.listeners.onRead) gal.listeners.onRead(name, text);
                    }
                } catch(_e){}
                if (name) gal.history.push({ name, text, voice: (gal._lastVoice||null), read: wasRead });
                else gal.history.push({ name: '', text, voice: (gal._lastVoice||null), read: wasRead });
                gal._lastVoice = null;
                const speedMs = Math.max(2, 110 - gal.style.typewriterSpeed*10);
                gal.dialog = { name, text, shownChars: 0, timer: 0, speedMs, _readKey: readKey, _wasRead: wasRead };
                gal.waitingClick = true;
                // 如果开启 skip 只读，且当前是未读对白 -> 不进入 skip 推进（打断 galAdvanceNextLine 循环）
                // 此处 yield 后在 galUpdate 里再做具体判断
                return true; // yield
            }
            case GAL_CMD.SHOW: {
                const sp = findSpriteByName(cmd.sprite);
                if (sp){
                    applySpriteShow(sp, cmd.slot, cmd.expression, cmd.alpha, cmd.tween, cmd.duration);
                }
                return false;
            }
            case GAL_CMD.HIDE: {
                const sp = findSpriteByName(cmd.sprite);
                if (sp) applySpriteHide(sp, cmd.tween, cmd.duration);
                return false;
            }
            case GAL_CMD.BG: {
                const dur = cmd.duration || 500;
                gal.bg.tween = cmd.tween; gal.bg.tweenDur = dur; gal.bg.tweenT = 0;
                gal.bg.from = gal.bg.image || ('#' + rgbHex(gal.bg.color));
                gal.bg.to = cmd.image;
                if (cmd.image && cmd.image.startsWith('#')){
                    const c = parseColor(cmd.image); gal.bg.color = c;
                }
                gal.bg.image = cmd.image;
                return false;
            }
            case GAL_CMD.CG: {
                if (!gal.cg) gal.cg = { image:null, alpha:0, destAlpha:1, tween: cmd.tween, tweenT:0, tweenDur: cmd.duration||500, fromA:0, toA:1 };
                gal.cg.image = cmd.image; gal.cg.fromA = 0; gal.cg.toA = 1; gal.cg.tweenT = 0; gal.cg.tweenDur = cmd.duration||500;
                return false;
            }
            case GAL_CMD.CG_CLEAR: {
                if (gal.cg){ gal.cg.fromA = 1; gal.cg.toA = 0; gal.cg.tweenT = 0; gal.cg.tweenDur = cmd.duration||500; gal.cg.tween = cmd.tween; }
                return false;
            }
            case GAL_CMD.BGM: {
                galPlayBgm(cmd.audio, cmd.loop, cmd.volume, cmd.fadeMs || 800);
                return false;
            }
            case GAL_CMD.BGM_STOP: {
                galStopBgm(cmd.fadeMs || 800);
                return false;
            }
            case GAL_CMD.SE: {
                galPlaySe(cmd.audio, cmd.volume);
                return false;
            }
            case GAL_CMD.VOICE: {
                galPlayVoice(cmd.audio, cmd.volume, cmd.speaker || '');
                return false;
            }
            case GAL_CMD.CHOOSE: {
                gal.choices = cmd.options ? cmd.options.slice() : [];
                gal.waitingClick = true;
                return true;
            }
            case GAL_CMD.LABEL: return false;
            case GAL_CMD.JUMP: {
                const idx = gal.curScript.labels[cmd.label];
                if (typeof idx === 'number' && idx >= 0 && idx < gal.curScript.lines.length) gal.curLine = idx;
                return false;
            }
            case GAL_CMD.IF: {
                const a = galEvalVariable(cmd.variable);
                let b = cmd.value;
                if (b && (b in gal.vars)) b = gal.vars[b];
                else b = galEvalVariable(b, b);
                if (galCompare(a, cmd.op, b)){
                    const idx = gal.curScript.labels[cmd.label];
                    if (typeof idx === 'number' && idx >= 0 && idx < gal.curScript.lines.length) gal.curLine = idx;
                }
                return false;
            }
            case GAL_CMD.SET: {
                const prev = gal.vars[cmd.variable];
                let val = cmd.value;
                if (val in gal.vars) val = gal.vars[val];
                else val = galEvalVariable(val, val);
                let next = val;
                if (cmd.op === '=' || !cmd.op){ next = val; }
                else if (cmd.op === '+='){ next = (+prev||0) + (+val||0); }
                else if (cmd.op === '-='){ next = (+prev||0) - (+val||0); }
                else if (cmd.op === '*='){ next = (+prev||0) * (+val||0); }
                else if (cmd.op === '/='){ next = (+prev||0) / (+val||1); }
                else if (cmd.op === '%='){ next = (+prev||0) % (+val||1); }
                gal.vars[cmd.variable] = next;
                // 变量变更事件
                if (gal.listeners && gal.listeners.onVarChange){
                    try { gal.listeners.onVarChange(cmd.variable, prev, next); } catch(_e){}
                }
                if (gal.onVarChange){ try { gal.onVarChange(cmd.variable, prev, next); } catch(_e){} }
                return false;
            }
            case GAL_CMD.WAIT: {
                if (cmd.click) { gal.waitingClick = true; return true; }
                gal.waitingTimerMs = cmd.ms || 0; gal.waitingTimerElapsed = 0;
                return gal.waitingTimerMs > 0 ? true : false;
            }
            case GAL_CMD.SHAKE: {
                gal.shake.intensity = cmd.intensity;
                gal.shake.dur = cmd.ms; gal.shake.t = 0;
                return false;
            }
            case GAL_CMD.EFFECT: {
                if (cmd.name === 'fade_to_black') { gal.fade = { r:0,g:0,b:0,a:1, fromA:0, toA:1, t:0, dur:cmd.duration }; }
                else if (cmd.name === 'fade_from_black') { gal.fade = { r:0,g:0,b:0,a:1, fromA:1, toA:0, t:0, dur:cmd.duration }; }
                else if (cmd.name === 'flash'){ gal.fade = { r:255,g:255,b:255,a:1, fromA:0.9, toA:0, t:0, dur:cmd.duration }; }
                return false;
            }
            case GAL_CMD.CALL: {
                const target = gal.scripts[cmd.script];
                if (target){
                    gal.stack.push({ script: gal.curScript, line: Math.min(gal.curScript.lines.length, Math.max(0, gal.curLine + 1)) });
                    gal.curScript = target;
                    gal.curLine = (cmd.entry && target.labels[cmd.entry] != null) ? target.labels[cmd.entry] : 0;
                    return false;
                }
                return false;
            }
            case GAL_CMD.RETURN: {
                if (gal.stack.length){
                    const f = gal.stack.pop();
                    gal.curScript = f.script; gal.curLine = f.line;
                    return false;
                }
                gal.running = false; if (gal.onEnd) gal.onEnd();
                return true;
            }
            case GAL_CMD.LIVE2D: {
                const mId = live2dByNameOrId(cmd.id);
                if (mId == null) return false;
                if (cmd.op === 'motion' || cmd.op === 'm'){
                    const args = (cmd.arg || 'Idle:0').split(':');
                    live2dStartMotion(mId, args[0] || 'Idle', parseInt(args[1]||'0')|0, 2);
                } else if (cmd.op === 'expression' || cmd.op === 'expr'){
                    live2dSetExpression(mId, cmd.arg);
                } else if (cmd.op === 'param'){
                    const parts = (cmd.arg || '').split(':');
                    live2dSetParam(mId, parts[0]||'', parseFloat(parts[1]||'0'));
                } else if (cmd.op === 'show'){
                    live2dSetVisible(mId, true);
                } else if (cmd.op === 'hide'){
                    live2dSetVisible(mId, false);
                }
                return false;
            }
            case GAL_CMD.TITLE: {
                gal.running = false;
                if (gal.onTitle) gal.onTitle();
                return true;
            }
            case GAL_CMD.AUTOSPEED: {
                gal.autoDelayMs = Math.max(100, cmd.ms|0);
                galSetAutoDelay(gal.autoDelayMs);
                return false;
            }
            case GAL_CMD.SAVE: {
                try { galSave(cmd.slot|0, cmd.title || 'Auto Save'); } catch(_e){}
                return false;
            }
            case GAL_CMD.LOAD: {
                let ok = false;
                try {
                    gal._loadDepth = (gal._loadDepth|0) + 1;
                    if (gal._loadDepth <= 8) {
                        ok = !!galLoad(cmd.slot|0);
                    } else {
                        ok = false;
                    }
                } catch(_e){ ok = false; } finally {
                    gal._loadDepth = Math.max(0, (gal._loadDepth|0) - 1);
                }
                // 加载成功后立刻 yield，避免后续行继续执行（curLine 已被 restore 覆盖）
                if (ok) return true;
                return false;
            }
            case GAL_CMD.END:
            default:
                gal.running = false;
                if (gal.onEnd) gal.onEnd();
                return true;
        }
    }

    function galAdvanceNextLine(){
        if (!gal.running || !gal.curScript) return;
        // 边界夹紧：防止 curLine 越界
        gal.curLine = Math.max(0, Math.min(gal.curScript.lines.length, gal.curLine|0));
        while (gal.curLine < gal.curScript.lines.length){
            const cmd = gal.curScript.lines[gal.curLine++];
            if (!cmd) continue; // 防御性跳过空命令
            const yieldControl = galStartLine(cmd);
            if (yieldControl) return;
        }
        gal.running = false;
        if (gal.onEnd) gal.onEnd();
    }

    function interpolateVars(txt){
        return String(txt).replace(/\{([^{}]+)\}/g, (_, k) => {
            if (k in gal.vars) return String(gal.vars[k]);
            if (k === 'DATE') return new Date().toISOString().slice(0,10);
            if (k === 'TIME') return new Date().toTimeString().slice(0,8);
            return _;
        });
    }

    // ---- 立绘 ----
    function findSpriteByName(nameOrId){
        if (typeof nameOrId === 'number' || /^\d+$/.test(nameOrId)){
            return gal.sprites.get(+nameOrId) || null;
        }
        for (const [,sp] of gal.sprites){ if (sp.name === nameOrId) return sp; }
        return null;
    }
    function galCreateSprite(image, slot, zOrder){
        const id = gal.spriteIdSeq++;
        const canvasW = (canvas && canvas.width) || 1280;
        const canvasH = (canvas && canvas.height) || 720;
        const pos = slotXY(slot, canvasW, canvasH);
        const sp = {
            id, name: image && typeof image === 'string' ? image : ('s'+id),
            image: image && typeof image === 'string' ? image : null,
            expression: '', slot,
            x: pos.x, y: pos.y, scale: 1, alpha: 0,
            z: zOrder || 0,
            destAlpha: 0,
            tween: GAL_TWEEN.NONE, tweenT: 1, tweenDur: 0,
            fromX: 0, fromY: 0, fromAlpha: 0,
            toX: 0, toY: 0, toAlpha: 0,
            exprMap: {},
            live2dId: null
        };
        gal.sprites.set(id, sp);
        return id;
    }
    function galDestroySprite(id){ gal.sprites.delete(id); }
    function slotXY(slot, w, h){
        switch (slot){
            case GAL_SLOT.LEFT:   return { x: w*0.25, y: h*0.58 };
            case GAL_SLOT.RIGHT:  return { x: w*0.75, y: h*0.58 };
            case GAL_SLOT.CENTER:
            default:              return { x: w*0.50, y: h*0.58 };
        }
    }
    function applySpriteShow(sp, slot, expression, alpha, tween, duration){
        if (expression != null) sp.expression = expression;
        if (slot != null && slot !== GAL_SLOT.CUSTOM) sp.slot = slot;
        const canvasW = (canvas && canvas.width) || 1280;
        const canvasH = (canvas && canvas.height) || 720;
        const pos = (slot === GAL_SLOT.CUSTOM || sp.slot === GAL_SLOT.CUSTOM) ? {x:sp.x, y:sp.y} : slotXY(sp.slot, canvasW, canvasH);
        sp.fromX = sp.x; sp.fromY = sp.y; sp.fromAlpha = sp.alpha;
        sp.toX = pos.x; sp.toY = pos.y; sp.toAlpha = (alpha != null) ? alpha : 1;
        sp.tween = tween || GAL_TWEEN.FADE;
        sp.tweenDur = duration || 500;
        sp.tweenT = 0;
    }
    function applySpriteHide(sp, tween, duration){
        sp.fromX = sp.x; sp.fromY = sp.y; sp.fromAlpha = sp.alpha;
        sp.toX = sp.x; sp.toY = sp.y; sp.toAlpha = 0;
        sp.tween = tween || GAL_TWEEN.FADE;
        sp.tweenDur = duration || 500;
        sp.tweenT = 0;
    }
    function galShowSprite(id, slot, expr, alpha, tween, duration){
        const sp = findSpriteByName(id);
        if (!sp) return;
        applySpriteShow(sp, slot, expr, alpha, tween, duration);
    }
    function galHideSprite(id, tween, duration){
        const sp = findSpriteByName(id);
        if (!sp) return;
        applySpriteHide(sp, tween, duration);
    }
    function galSetSpritePosition(id, x, y){ const sp = findSpriteByName(id); if (sp){ sp.x = x; sp.y = y; sp.slot = GAL_SLOT.CUSTOM; } }
    function galSetSpriteScale(id, s){ const sp = findSpriteByName(id); if (sp) sp.scale = s; }
    function galSetSpriteExpression(id, e){ const sp = findSpriteByName(id); if (sp) sp.expression = e; }

    function galSetBackground(imageOrColor, tween, duration){
        const dur = duration || 500;
        gal.bg.tween = tween || GAL_TWEEN.FADE; gal.bg.tweenDur = dur; gal.bg.tweenT = 0;
        gal.bg.from = gal.bg.image || ('#' + rgbHex(gal.bg.color));
        gal.bg.to = imageOrColor;
        if (imageOrColor && imageOrColor.startsWith('#')) gal.bg.color = parseColor(imageOrColor);
        gal.bg.image = imageOrColor;
    }
    function galShowCG(image, tween, duration){
        if (!gal.cg) gal.cg = { image:null, alpha:0, fromA:0, toA:1, tween: tween, tweenT:0, tweenDur: duration||500 };
        gal.cg.image = image; gal.cg.fromA = 0; gal.cg.toA = 1; gal.cg.tweenT = 0; gal.cg.tweenDur = duration||500;
    }
    function galHideCG(tween, duration){
        if (!gal.cg) return;
        gal.cg.fromA = gal.cg.alpha; gal.cg.toA = 0; gal.cg.tweenT = 0; gal.cg.tweenDur = duration||500;
    }

    function galSetDialogStyle(style){ Object.assign(gal.style, style||{}); }
    function galShowDialog(v){ gal.dialogVisible = !!v; }
    function galIsDialogVisible(){ return gal.dialogVisible; }
    function galSay(name, text){
        if (!gal.inited) galInit();
        const speedMs = Math.max(2, 110 - gal.style.typewriterSpeed*10);
        gal.dialog = { name: name||'', text: text||'', shownChars: 0, timer: 0, speedMs };
        gal.history.push({ name: name||'', text: text||'', voice: null });
        gal.waitingClick = true;
    }
    function galGetHistoryCount(){ return gal.history.length; }
    function galGetHistoryEntry(idx){
        const e = gal.history[idx]; if (!e) return null;
        return { name: e.name||'', text: e.text||'', voice: e.voice||'', read: !!e.read };
    }
    function galClearHistory(){ gal.history.length = 0; }
    function galGetHistoryPageCount(pageSize){
        const n = Math.max(1, pageSize|0 || 50);
        return Math.max(0, Math.ceil(gal.history.length / n));
    }
    function galGetHistoryPage(pageIndex, pageSize){
        const n = Math.max(1, pageSize|0 || 50);
        const p = Math.max(0, pageIndex|0);
        const start = p * n;
        if (start >= gal.history.length) return [];
        const out = [];
        for (let i = start; i < Math.min(gal.history.length, start+n); i++){
            const e = gal.history[i];
            out.push({ index:i, name: e.name||'', text: e.text||'', voice: e.voice||'', read: !!e.read });
        }
        return out;
    }
    function galSetOnVarChange(fn){
        if (typeof fn === 'function') gal.listeners.onVarChange = fn;
        else gal.listeners.onVarChange = null;
        gal.onVarChange = gal.listeners.onVarChange;
    }
    function galRemoveOnVarChange(){
        gal.listeners.onVarChange = null;
        gal.onVarChange = null;
    }
    function galSetOnRead(fn){
        if (typeof fn === 'function') gal.listeners.onRead = fn;
        else gal.listeners.onRead = null;
        gal.onRead = gal.listeners.onRead;
    }
    function galIsCurrentLineRead(){
        if (gal.dialog && typeof gal.dialog._wasRead === 'boolean') return gal.dialog._wasRead;
        return !!gal._curWasRead;
    }
    // ---------- 合成音源（无需外部音频文件，WebAudio 合成占位 BGM / SE）----------
    function galStartSynthBgm(name, type, volume){
        if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
        try {
            let ctx = null;
            try { ctx = getAudioContext ? getAudioContext() : null; } catch(_e){}
            if (!ctx) {
                if (typeof AudioContext !== 'undefined') ctx = new AudioContext();
                else if (typeof window !== 'undefined' && window.webkitAudioContext) ctx = new window.webkitAudioContext();
            }
            if (!ctx) return null;
            if (!galAudio.synths) galAudio.synths = new Map();
            galStopSynthBgm(name);
            const vol = Math.max(0, Math.min(1, +volume || 0.35));
            const master = ctx.createGain();
            master.gain.value = 0;
            master.connect(ctx.destination);
            const realType = (['sine','triangle','square','sawtooth'].indexOf(String(type||'').toLowerCase()) >= 0) ? String(type).toLowerCase() : 'sine';
            // 简单 2 振荡器合成：基调音 + 第五度 组合，构成简单"和弦式"循环 BGM
            const melody = [261.63, 329.63, 392.0, 349.23, 440.0, 392.0, 329.63, 293.66];
            const bass   = [130.81, 164.81, 196.0, 174.61, 220.0, 196.0, 164.81, 146.83];
            const o1 = ctx.createOscillator();
            const o2 = ctx.createOscillator();
            o1.type = realType;
            o2.type = realType === 'sawtooth' ? 'triangle' : 'sine';
            const g1 = ctx.createGain(); g1.gain.value = 0.55 * vol;
            const g2 = ctx.createGain(); g2.gain.value = 0.35 * vol;
            o1.connect(g1).connect(master);
            o2.connect(g2).connect(master);
            // LFO 做轻微音量呼吸
            const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15;
            const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.12 * vol;
            lfo.connect(lfoGain).connect(master.gain);
            o1.start(0); o2.start(0); lfo.start(0);
            let step = 0;
            const stepDur = 0.9; // 秒
            const updateNote = () => {
                if (!galAudio.synths || galAudio.synths.get(name) !== handle) return;
                const t = ctx.currentTime;
                const i = step % melody.length;
                o1.frequency.setValueAtTime(melody[i], t);
                o2.frequency.setValueAtTime(bass[i], t);
                step++;
                handle._nextTimer = setTimeout(updateNote, stepDur * 1000);
            };
            const handle = { ctx, master, osc: [o1, o2], lfo, name, vol, _nextTimer: null };
            galAudio.synths.set(name, handle);
            // 淡入
            try { master.gain.cancelScheduledValues(ctx.currentTime); } catch(_e){}
            master.gain.setValueAtTime(0, ctx.currentTime);
            master.gain.linearRampToValueAtTime(vol, ctx.currentTime + 1.2);
            updateNote();
            return name;
        } catch(e){
            return null;
        }
    }
    function galStopSynthBgm(name, fadeMs){
        try {
            if (!galAudio.synths) return;
            const h = galAudio.synths.get(name);
            if (!h) return;
            const fade = Math.max(0, +fadeMs || 800);
            const ctx = h.ctx;
            if (ctx && h.master && h.master.gain){
                try { h.master.gain.cancelScheduledValues(ctx.currentTime); } catch(_e){}
                try { h.master.gain.setValueAtTime(h.master.gain.value, ctx.currentTime); } catch(_e){}
                try { h.master.gain.linearRampToValueAtTime(0, ctx.currentTime + fade/1000); } catch(_e){}
            }
            if (h._nextTimer){ clearTimeout(h._nextTimer); h._nextTimer = null; }
            const stopDelay = (fade < 1) ? 0 : fade + 50;
            setTimeout(() => {
                try { if (h.osc && h.osc.length) for (const o of h.osc){ try { o.stop(); } catch(_e){} } } catch(_e){}
                try { if (h.lfo){ try { h.lfo.stop(); } catch(_e){} } } catch(_e){}
                try { h.master.disconnect(); } catch(_e){}
                try { galAudio.synths.delete(name); } catch(_e){}
            }, stopDelay);
        } catch(_e){}
    }
    function galSynthSeClick(volume){
        if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
        try {
            let ctx = null;
            try { ctx = getAudioContext ? getAudioContext() : null; } catch(_e){}
            if (!ctx) {
                if (typeof AudioContext !== 'undefined') ctx = new AudioContext();
                else if (typeof window !== 'undefined' && window.webkitAudioContext) ctx = new window.webkitAudioContext();
            }
            if (!ctx) return null;
            const vol = Math.max(0, Math.min(1, (+volume != null) ? +volume : 0.25));
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            const t0 = ctx.currentTime;
            osc.frequency.setValueAtTime(1200, t0);
            osc.frequency.exponentialRampToValueAtTime(520, t0 + 0.08);
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(vol, t0 + 0.005);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
            osc.connect(gain).connect(ctx.destination);
            osc.start(t0);
            osc.stop(t0 + 0.14);
            return true;
        } catch(e){ return null; }
    }
    function galSynthSeConfirm(volume){
        if (typeof window === 'undefined' || typeof AudioContext === 'undefined') return null;
        try {
            let ctx = null;
            try { ctx = getAudioContext ? getAudioContext() : null; } catch(_e){}
            if (!ctx) {
                if (typeof AudioContext !== 'undefined') ctx = new AudioContext();
                else if (typeof window !== 'undefined' && window.webkitAudioContext) ctx = new window.webkitAudioContext();
            }
            if (!ctx) return null;
            const vol = Math.max(0, Math.min(1, (+volume != null) ? +volume : 0.3));
            const notes = [659.25, 783.99, 1046.50];
            const t0 = ctx.currentTime;
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0, t0);
            gain.gain.linearRampToValueAtTime(vol, t0 + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
            gain.connect(ctx.destination);
            for (let i = 0; i < notes.length; i++){
                const osc = ctx.createOscillator();
                osc.type = i === 2 ? 'sine' : 'triangle';
                osc.frequency.setValueAtTime(notes[i], t0 + i*0.055);
                const og = ctx.createGain();
                og.gain.value = i === 0 ? 0.5 : (i === 1 ? 0.4 : 0.35);
                osc.connect(og).connect(gain);
                osc.start(t0 + i*0.055);
                osc.stop(t0 + 0.30);
            }
            return true;
        } catch(e){ return null; }
    }

    function galSelectChoice(index){
        if (!gal.choices || !gal.choices[index]) return;
        const c = gal.choices[index];
        gal.choices = null;
        gal.waitingClick = false;
        if (c.label && gal.curScript){
            const idx = gal.curScript.labels[c.label];
            if (idx != null) gal.curLine = idx;
        }
        galAdvanceNextLine();
    }
    function galChoose(labelOrIndex){
        if (!gal.choices || !gal.choices.length) return;
        let idx = -1;
        if (typeof labelOrIndex === 'number'){
            idx = labelOrIndex|0;
        } else {
            idx = gal.choices.findIndex(c => c.label === labelOrIndex);
            if (idx < 0){
                // 兼容按文本匹配
                idx = gal.choices.findIndex(c => c.text === labelOrIndex);
            }
        }
        if (idx >= 0) galSelectChoice(idx);
    }
    function galGetChoiceCount(){ return gal.choices ? gal.choices.length : 0; }
    function galGetChoiceText(i){ return gal.choices && gal.choices[i] ? gal.choices[i].text : ''; }
    function galGetChoices(){ return gal.choices ? gal.choices.map(c => ({ label:c.label, text:c.text })) : null; }
    function galGotoLabel(label){
        if (!gal.curScript) return;
        const idx = gal.curScript.labels[label];
        if (typeof idx === 'number' && idx >= 0 && idx < gal.curScript.lines.length) gal.curLine = idx;
    }

    function galSaveStateSnapshot(){
        return {
            scriptName: gal.curScript ? gal.curScript.name : null,
            line: gal.curLine,
            vars: JSON.parse(JSON.stringify(gal.vars)),
            history: gal.history.slice(),
            bg: JSON.parse(JSON.stringify(gal.bg)),
            sprites: Array.from(gal.sprites.values()).map(s => ({
                id:s.id, name:s.name, image:s.image, expression:s.expression,
                slot:s.slot, x:s.x, y:s.y, scale:s.scale, alpha:s.alpha, z:s.z,
                live2dId: s.live2dId
            })),
            cg: gal.cg ? JSON.parse(JSON.stringify(gal.cg)) : null,
            prefs: JSON.parse(JSON.stringify(gal.pref))
        };
    }
    function galRestoreStateSnapshot(ss){
        if (!ss) return false;
        if (ss.scriptName && gal.scripts[ss.scriptName]){
            gal.curScript = gal.scripts[ss.scriptName];
        }
        if (gal.curScript){
            const maxL = gal.curScript.lines.length;
            gal.curLine = Math.max(0, Math.min(maxL, (ss.line|0) || 0));
        } else {
            gal.curLine = 0;
        }
        gal.vars = ss.vars || {};
        gal.history = ss.history || [];
        Object.assign(gal.bg, ss.bg || {});
        gal.sprites.clear();
        (ss.sprites||[]).forEach(s => gal.sprites.set(s.id, s));
        gal.cg = ss.cg || null;
        Object.assign(gal.pref, ss.prefs || {});
        gal.style.typewriterSpeed = gal.pref.textSpeed || 5;
        gal.auto = !!gal.pref.auto;
        gal.skip = !!gal.pref.skip;
        gal.choices = null;
        gal.waitingClick = false;
        gal.dialog = null;
        gal.running = true;
        galAdvanceNextLine();
        return true;
    }
    function galSave(slot, title){
        try {
            const ss = galSaveStateSnapshot();
            const info = {
                slot, used: true,
                title: title || (gal.curScript ? gal.curScript.name : ''),
                summary: gal.history.length ? gal.history[gal.history.length-1].text.slice(0, 80) : '',
                timestamp: new Date().toISOString(),
                lineNo: gal.curLine || 0,
                scriptName: gal.curScript ? gal.curScript.name : '',
                bgmVolume: gal.pref.volBGM, seVolume: gal.pref.volSE, voiceVolume: gal.pref.volVoice,
                textSpeed: gal.pref.textSpeed, autoMode: !!gal.pref.auto,
                snapshot: ss
            };
            const key = gal.saveSlotKey + '_' + slot;
            localStorage.setItem(key, JSON.stringify(info));
            return true;
        } catch(e){ return false; }
    }
    function galLoad(slot){
        try {
            const key = gal.saveSlotKey + '_' + slot;
            const raw = localStorage.getItem(key);
            if (!raw) return false;
            const info = JSON.parse(raw);
            if (!info.snapshot) return false;
            if (!gal.inited) galInit();
            return galRestoreStateSnapshot(info.snapshot);
        } catch(e){ return false; }
    }
    function galDeleteSave(slot){ try { localStorage.removeItem(gal.saveSlotKey + '_' + slot); return true; } catch(e){ return false; } }
    function galGetSaveInfo(slot){
        try {
            const key = gal.saveSlotKey + '_' + slot;
            const raw = localStorage.getItem(key);
            if (!raw) return { slot, used:false };
            const i = JSON.parse(raw);
            return {
                slot, used: !!i.used,
                title: i.title || '', summary: i.summary || '',
                timestamp: i.timestamp || '',
                lineNo: i.lineNo||0, scriptName: i.scriptName||'',
                bgmVolume: i.bgmVolume, seVolume: i.seVolume, voiceVolume: i.voiceVolume,
                textSpeed: i.textSpeed, autoMode: !!i.autoMode
            };
        } catch(e){ return { slot, used:false }; }
    }
    function galQuickSave(){ return galSave(99, 'Quick Save'); }
    function galQuickLoad(){ return galLoad(99); }

    function galShake(intensity, ms){ gal.shake.intensity = intensity||6; gal.shake.dur = ms||400; gal.shake.t = 0; }
    function galFadeTo(color, ms){ gal.fade = { r:color.r,g:color.g,b:color.b,a:1, fromA:0, toA:1, t:0, dur:ms||500 }; }
    function galFadeFrom(color, ms){ gal.fade = { r:color.r||0, g:color.g||0, b:color.b||0, a:1, fromA:1, toA:0, t:0, dur:ms||500 }; }

    function galPlayBgm(audio, loop, volume, fadeMs){
        try {
            galResumeAudioCtx();
            const fade = Math.max(0, fadeMs|0) || 0;
            // 支持 number srcId / numeric string srcId / string path
            let srcId = 0;
            if (typeof audio === 'number') srcId = audio;
            else if (/^\d+$/.test(String(audio))) srcId = +audio;
            else if (typeof audio === 'string' && audio.length) srcId = loadMusic(audio) || 0;  // Music group
            if (!srcId) return;
            const vol = (volume == null ? 0.7 : (+volume || 0));
            // 同曲只更新音量
            const bgm = galAudio.bgm;
            if (bgm.instId && bgm.srcId === srcId && !bgm.fading){
                const inst = audioInstances.get(bgm.instId);
                if (inst){
                    inst.volume = vol;
                    const vv = Math.max(0, Math.min(1, vol * masterVolume * groupVolumes[1]));
                    if (inst._gain) try { inst._gain.gain.value = vv; } catch(e){}
                    if (inst.htmlAudio) try { inst.htmlAudio.volume = vv; } catch(e){}
                }
                return;
            }
            bgm.nextSrcId = srcId;
            bgm.nextLoop  = (loop == null ? true : !!loop);
            bgm.nextVol   = vol;
            bgm.crossMs   = Math.max(1, fade);
            bgm.crossElapsed = 0;
            bgm.fading    = true;
            bgm.stopPending = false;
            bgm._nextInstId = 0;
        } catch(e){}
    }
    function galStopBgm(fadeMs){
        const bgm = galAudio.bgm;
        if (!bgm.instId && !bgm.fading) return;
        try {
            const fade = Math.max(1, (fadeMs|0) || 300);
            bgm.nextSrcId = 0;
            bgm._nextInstId = 0;
            bgm.crossMs = fade;
            bgm.crossElapsed = 0;
            bgm.fading = true;
            bgm.stopPending = true;
        } catch(e){}
    }
    function galPlaySe(audio, volume){
        try {
            galResumeAudioCtx();
            let srcId = 0;
            if (typeof audio === 'number') srcId = audio;
            else if (/^\d+$/.test(String(audio))) srcId = +audio;
            else if (typeof audio === 'string' && audio.length) srcId = loadSound(audio)||0;
            if (!srcId) return;
            const vol = (volume == null ? 1 : (+volume || 0)) * (gal.pref.volSE ?? 1);
            const se = galAudio.se;
            se.queue.push({ srcId, vol });
            while (se.queue.length > se.maxSimul*2) se.queue.shift();
        } catch(e){}
    }
    function galPlayVoice(audio, volume, speaker){
        try {
            galResumeAudioCtx();
            if (gal.audio.voice){ try { stopSound(gal.audio.voice); } catch(e){} gal.audio.voice = null; }
            let srcId = 0;
            if (typeof audio === 'number') srcId = audio;
            else if (/^\d+$/.test(String(audio))) srcId = +audio;
            else if (typeof audio === 'string' && audio.length) srcId = loadAudio(audio, false) || 0;
            if (!srcId) { gal._lastVoice = audio; return; }
            const vol = (volume == null ? 1 : (+volume || 0)) * (gal.pref.volVoice ?? 1);
            const play = () => {
                const id = playBufferSource(srcId, vol, 1, false, 2); // Voice group
                if (id){
                    gal.audio.voice = id;
                    const inst = audioInstances.get(id);
                    if (inst){
                        const durMs = Math.max(150, ((inst.duration||2) * 1000) + 200);
                        setTimeout(function checkEnd(){
                            if (!audioInstances.has(id)){
                                gal.audio.voice = null;
                                if (galAudio.listeners.onVoiceEnd) try { galAudio.listeners.onVoiceEnd(audio, speaker||''); } catch(_e){}
                                return;
                            }
                            setTimeout(checkEnd, 120);
                        }, durMs);
                    }
                }
            };
            const s = audioSources.get(srcId);
            if (s && s.loaded) play();
            else audioOnReady(srcId, play, play);
            gal._lastVoice = audio;
        } catch(e){ gal._lastVoice = audio; }
    }
    function galStopVoice(){ if (gal.audio.voice){ try { stopSound(gal.audio.voice); } catch(e){} gal.audio.voice = null; } }

    function galSetPrefTextSpeed(v){
        const n = Math.max(1, Math.min(10, v|0));
        gal.pref.textSpeed = n; gal.style.typewriterSpeed = n; galSavePref();
    }
    function galGetPrefTextSpeed(){ return gal.pref.textSpeed; }
    function galSetPrefAuto(v){ gal.auto = !!v; gal.pref.auto = !!v; galSavePref(); }
    function galGetPrefAuto(){ return !!gal.pref.auto; }
    function galSetPrefSkip(v){ gal.skip = !!v; gal.pref.skip = !!v; galSavePref(); }
    function galGetPrefSkip(){ return !!gal.pref.skip; }
    function galSetPrefVolume(group, value){
        const g = group|0; const v = Math.max(0, Math.min(1, +value));
        if (g === 0) gal.pref.volSE = v;
        else if (g === 1) gal.pref.volBGM = v;
        else if (g === 2) gal.pref.volVoice = v;
        galSavePref();
    }
    function galGetPrefVolume(group){
        if (group === 0) return gal.pref.volSE;
        if (group === 1) return gal.pref.volBGM;
        if (group === 2) return gal.pref.volVoice;
        return 1;
    }

    // 辅助：颜色工具
    function parseColor(s){
        if (typeof s !== 'string') return {r:0,g:0,b:0,a:255};
        if (s.startsWith('#')){
            let hex = s.slice(1);
            if (hex.length === 3) hex = hex.split('').map(c => c+c).join('');
            if (hex.length === 6) return { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16), a: 255 };
            if (hex.length === 8) return { r: parseInt(hex.slice(0,2),16), g: parseInt(hex.slice(2,4),16), b: parseInt(hex.slice(4,6),16), a: parseInt(hex.slice(6,8),16) };
        }
        return {r:0,g:0,b:0,a:255};
    }
    function rgbHex(c){
        const r = (c.r).toString(16).padStart(2,'0');
        const g = (c.g).toString(16).padStart(2,'0');
        const b = (c.b).toString(16).padStart(2,'0');
        return r+g+b;
    }

    // GAL Update & Render
    function galUpdate(dtMs){
        if (!gal.inited) return;
        const dt = +dtMs || 16;
        // 打字机推进
        if (gal.dialog){
            const d = gal.dialog;
            // 打字机速度：skip 模式但当前未读 & skipReadOnly=true 时不减慢
            const readOnly = !!gal.skipReadOnly && !!(d._wasRead === false ? false : (d._wasRead || (gal._curWasRead===true)));
            const skipEffective = gal.skip && (!gal.skipReadOnly || (gal._curWasRead || (d._wasRead === true)));
            const sp = skipEffective ? 0 : d.speedMs;
            if (sp <= 0 || !gal.waitingClick){
                d.shownChars = (d.text||'').length;
            } else {
                d.timer += dt;
                while (d.timer >= sp && d.shownChars < (d.text||'').length){
                    d.shownChars++;
                    d.timer -= sp;
                }
            }
            if (gal.auto && !gal.skip && gal.waitingClick && d.shownChars >= (d.text||'').length){
                if (!gal._autoTimer) gal._autoTimer = 0;
                gal._autoTimer += dt;
                if (gal._autoTimer >= gal.autoDelayMs){
                    gal._autoTimer = 0;
                    galAdvance();
                }
            } else if (skipEffective && gal.waitingClick && d.shownChars >= (d.text||'').length){
                galAdvance();
            }
        } else {
            gal._autoTimer = 0;
        }
        // Wait timer
        if (gal.waitingTimerMs > 0){
            gal.waitingTimerElapsed += dt;
            if (gal.waitingTimerElapsed >= gal.waitingTimerMs){
                gal.waitingTimerMs = 0; gal.waitingTimerElapsed = 0;
                galAdvanceNextLine();
            }
        }
        // 立绘过渡
        for (const [,sp] of gal.sprites){
            if (sp.tweenT < 1){
                sp.tweenT = Math.min(1, sp.tweenT + dt/Math.max(1, sp.tweenDur));
                const e = easeOutCubic(sp.tweenT);
                sp.x = sp.fromX + (sp.toX - sp.fromX) * e;
                sp.y = sp.fromY + (sp.toY - sp.fromY) * e;
                sp.alpha = sp.fromAlpha + (sp.toAlpha - sp.fromAlpha) * e;
            }
        }
        // CG
        if (gal.cg && gal.cg.tweenT < 1){
            gal.cg.tweenT = Math.min(1, gal.cg.tweenT + dt/Math.max(1, gal.cg.tweenDur));
            const e = easeOutCubic(gal.cg.tweenT);
            gal.cg.alpha = gal.cg.fromA + (gal.cg.toA - gal.cg.fromA) * e;
            if (gal.cg.tweenT >= 1 && gal.cg.toA === 0) gal.cg = null;
        }
        // Shake
        if (gal.shake.dur > 0 && gal.shake.t < gal.shake.dur){
            gal.shake.t += dt;
            const p = 1 - Math.min(1, gal.shake.t / gal.shake.dur);
            gal.shake.ox = (Math.random()*2-1) * gal.shake.intensity * p;
            gal.shake.oy = (Math.random()*2-1) * gal.shake.intensity * p;
        } else { gal.shake.ox = 0; gal.shake.oy = 0; }
        // Fade
        if (gal.fade.dur > 0 && gal.fade.t < gal.fade.dur){
            gal.fade.t += dt;
            const p = Math.min(1, gal.fade.t / gal.fade.dur);
            gal.fade.a = gal.fade.fromA + (gal.fade.toA - gal.fade.fromA) * easeOutCubic(p);
        }
        // Live2D
        if (live2d.inited) live2dUpdate(dt);
    }
    function easeOutCubic(t){ return 1 - Math.pow(1 - t, 3); }

    function galRender(){
        if (!gal.inited) return;
        if (!ctx || !canvas) return;
        const ox = gal.shake.ox || 0, oy = gal.shake.oy || 0;
        ctx.save();
        ctx.translate(ox, oy);
        // 背景
        if (gal.bg.image){
            if (gal.bg.image.startsWith('#')){
                const c = parseColor(gal.bg.image);
                ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${(c.a||255)/255})`;
                ctx.fillRect(-ox, -oy, canvas.width, canvas.height);
            } else {
                const tex = textures.get(findTextureIdByName(gal.bg.image));
                if (tex){
                    ctx.drawImage(tex, 0, 0, canvas.width, canvas.height);
                } else {
                    ctx.fillStyle = '#101428'; ctx.fillRect(0,0,canvas.width, canvas.height);
                }
            }
        } else {
            const c = gal.bg.color || {r:30,g:30,b:40,a:255};
            ctx.fillStyle = `rgba(${c.r},${c.g},${c.b},${(c.a||255)/255})`;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        // 立绘按 z 排序 + live2d 叠加
        const list = [];
        for (const [,sp] of gal.sprites) list.push(sp);
        list.sort((a,b) => (a.z|0) - (b.z|0));
        for (const sp of list){
            if (sp.alpha <= 0.001) continue;
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, sp.alpha));
            if (sp.live2dId != null){
                // 委托给 Live2D 渲染该具体模型
                live2dRenderModel(sp.live2dId, sp.x, sp.y, sp.scale);
            } else if (sp.image){
                const tex = textures.get(findTextureIdByName(sp.image));
                if (tex){
                    const iw = tex.naturalWidth || tex.width || 256;
                    const ih = tex.naturalHeight || tex.height || 256;
                    const sc = sp.scale || 1;
                    const dw = iw * sc, dh = ih * sc;
                    ctx.drawImage(tex, sp.x - dw/2, sp.y - dh, dw, dh);
                } else {
                    ctx.fillStyle = '#444';
                    ctx.fillRect(sp.x - 80, sp.y - 200, 160, 200);
                    ctx.fillStyle = '#eee'; ctx.font = '14px sans-serif'; ctx.textAlign = 'center';
                    ctx.fillText('Sprite: ' + sp.name, sp.x, sp.y - 100);
                }
            }
            ctx.restore();
        }
        // CG
        if (gal.cg && gal.cg.alpha > 0.001){
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, gal.cg.alpha));
            if (gal.cg.image){
                const tex = textures.get(findTextureIdByName(gal.cg.image));
                if (tex) ctx.drawImage(tex, 0, 0, canvas.width, canvas.height);
                else { ctx.fillStyle = '#000'; ctx.fillRect(0,0,canvas.width, canvas.height); }
            }
            ctx.restore();
        }
        ctx.restore();

        // Live2D 全局兜底渲染（非挂载到 sprite 的独立模型）
        if (live2d.inited) live2dRender();

        // 对话框
        if (gal.dialogVisible){
            drawGalDialog();
        }
        // 选项 UI
        if (gal.choices && gal.choices.length){
            drawGalChoices();
        }
        // 全局 fade
        if (gal.fade && gal.fade.a > 0.001){
            ctx.fillStyle = `rgba(${gal.fade.r|0},${gal.fade.g|0},${gal.fade.b|0},${Math.max(0,Math.min(1, gal.fade.a))})`;
            ctx.fillRect(0,0,canvas.width, canvas.height);
        }
    }

    function drawGalDialog(){
        const s = gal.style; if (!s) return;
        const x = s.x, y = s.y, w = s.w, h = s.h;
        // 对话框背景
        roundRect(x, y, w, h, s.radius);
        ctx.fillStyle = `rgba(${s.bgColor.r},${s.bgColor.g},${s.bgColor.b},${(s.bgColor.a||255)/255})`;
        ctx.fill();
        if (s.borderWidth > 0){
            ctx.lineWidth = s.borderWidth;
            ctx.strokeStyle = `rgba(${s.borderColor.r},${s.borderColor.g},${s.borderColor.b},${(s.borderColor.a||255)/255})`;
            ctx.stroke();
        }
        // 名字框
        if (s.showNameBox && gal.dialog && gal.dialog.name){
            const name = gal.dialog.name;
            const fontStr = `${s.nameFontSize}px ${s.fontFace || "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"}`;
            ctx.font = fontStr;
            const nameW = Math.ceil(ctx.measureText(name).width) + 28;
            const nameH = s.nameFontSize + 14;
            const nx = x + 14, ny = y - nameH + 6;
            roundRect(nx, ny, nameW, nameH, s.radius * 0.6);
            ctx.fillStyle = `rgba(${s.nameColor.r},${s.nameColor.g},${s.nameColor.b},${(s.nameColor.a||255)/255})`;
            ctx.fill();
            if (s.borderWidth > 0){
                ctx.lineWidth = s.borderWidth;
                ctx.strokeStyle = `rgba(${s.borderColor.r},${s.borderColor.g},${s.borderColor.b},${(s.borderColor.a||255)/255})`;
                ctx.stroke();
            }
            ctx.fillStyle = `rgba(${s.nameTextColor.r},${s.nameTextColor.g},${s.nameTextColor.b},${(s.nameTextColor.a||255)/255})`;
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(name, nx + 14, ny + nameH/2 + 1);
        }
        // 文本内容
        if (gal.dialog){
            const pad = s.padding;
            const tx = x + pad, ty = y + pad + (s.showNameBox && gal.dialog.name ? 8 : 0);
            const tw = w - pad*2;
            const th = h - pad*2;
            const shown = (gal.dialog.text || '').slice(0, gal.dialog.shownChars);
            const fontStr = `${s.textFontSize}px ${s.fontFace || "'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif"}`;
            ctx.font = fontStr;
            ctx.fillStyle = `rgba(${s.textColor.r},${s.textColor.g},${s.textColor.b},${(s.textColor.a||255)/255})`;
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';
            const lh = Math.max(1.2, s.lineHeight) * s.textFontSize;
            const lines = wrapLines(shown, tw, fontStr);
            for (let i = 0; i < lines.length; i++){
                ctx.fillText(lines[i], tx, ty + i*lh);
            }
            // 点击提示 ▼
            if (s.showAdvanceHint && gal.waitingClick && gal.dialog.shownChars >= (gal.dialog.text||'').length){
                if (!gal._hintT) gal._hintT = 0;
                gal._hintT += 16;
                const phase = (Math.sin(gal._hintT/250) + 1) / 2;
                ctx.globalAlpha = 0.4 + 0.6*phase;
                ctx.fillStyle = `rgba(${s.textColor.r},${s.textColor.g},${s.textColor.b},${(s.textColor.a||255)/255})`;
                ctx.font = `${s.textFontSize}px sans-serif`;
                ctx.textBaseline = 'alphabetic';
                ctx.fillText('▼', x + w - 32, y + h - 18 + (1-phase)*4);
                ctx.globalAlpha = 1;
                ctx.textBaseline = 'top';
            }
        }
    }
    function drawGalChoices(){
        const opts = gal.choices || [];
        if (!opts.length) return;
        const W = Math.min(720, canvas.width - 80);
        const btnH = 54;
        const gap = 14;
        const totalH = btnH * opts.length + gap * (opts.length - 1);
        let y = canvas.height/2 - totalH/2 - 80;
        const x = canvas.width/2 - W/2;
        for (let i = 0; i < opts.length; i++){
            roundRect(x, y, W, btnH, 14);
            ctx.fillStyle = 'rgba(12,18,40,0.92)'; ctx.fill();
            ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(120,160,255,0.45)'; ctx.stroke();
            ctx.fillStyle = '#eaf0ff';
            ctx.font = 'bold 20px "Outfit","InstrumentSans","PingFang SC",sans-serif';
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(`${i+1}. ${opts[i].text}`, canvas.width/2, y + btnH/2);
            // 绘制热区索引：给 galHandleClick 判断用（渲染时存在临时数据）
            opts[i]._rect = { x, y, w: W, h: btnH };
            y += btnH + gap;
        }
    }
    function roundRect(x,y,w,h,r){
        const rr = Math.min(r, w/2, h/2);
        ctx.beginPath();
        ctx.moveTo(x+rr, y);
        ctx.lineTo(x+w-rr, y);
        ctx.quadraticCurveTo(x+w, y, x+w, y+rr);
        ctx.lineTo(x+w, y+h-rr);
        ctx.quadraticCurveTo(x+w, y+h, x+w-rr, y+h);
        ctx.lineTo(x+rr, y+h);
        ctx.quadraticCurveTo(x, y+h, x, y+h-rr);
        ctx.lineTo(x, y+rr);
        ctx.quadraticCurveTo(x, y, x+rr, y);
        ctx.closePath();
    }
    function wrapLines(text, maxW, font){
        ctx.font = font;
        // 按字符逐个拆（中文逐个，英文按词）
        const out = [];
        let cur = '';
        const chars = Array.from(text || '');
        let i = 0;
        while (i < chars.length){
            const ch = chars[i++];
            if (ch === '\n'){ out.push(cur); cur = ''; continue; }
            const test = cur + ch;
            if (ctx.measureText(test).width > maxW){
                if (!cur){ out.push(ch); continue; }
                out.push(cur); cur = ch;
            } else cur = test;
        }
        if (cur) out.push(cur);
        return out;
    }
    // 外部点击/触摸转发到选项/对话框推进
    function galHandleClick(sx, sy){
        // 选项命中
        if (gal.choices && gal.choices.length){
            for (let i = 0; i < gal.choices.length; i++){
                const r = gal.choices[i]._rect;
                if (r && sx >= r.x && sx <= r.x+r.w && sy >= r.y && sy <= r.y+r.h){
                    galSelectChoice(i); return true;
                }
            }
            return false;
        }
        galAdvance(); return true;
    }
    function findTextureIdByName(name){
        if (!name) return 0;
        if (/^\d+$/.test(name)) return +name;
        // 遍历 textures reverse
        let found = 0;
        for (const [id, t] of textures.entries()){
            if (t && (t.name === name || (t.src && t.src === name))) found = id;
        }
        if (!found){
            // lazy load
            try {
                const id = loadTexture(name);
                if (id) return id;
            } catch(e){}
        }
        return found || 0;
    }

    // ============================================================
    // Live2D 集成  (LumentGAL 分支)
    // 使用简易 Canvas2D 回退（若无 Cubism SDK）并在检测到 Cubism Core / pixi-live2d 时启用。
    // 为保持开箱即用，模型若未配置 SDK 时会自动回退到精灵占位渲染 +
    // 有限的参数/动作/表情模拟（参数化绘制）。
    // ============================================================
    const live2d = {
        inited: false,
        corePath: null,
        models: [],
        modelMap: new Map(),     // id -> model (O(1) 查找)
        nameMap: new Map(),      // name -> id (O(1) 名字查找)
        idSeq: 1,
        mouse: { x:-9999, y:-9999 },
        tick: 0,
        lastTick: 0,
    };

    function live2dInit(corePath){
        if (live2d.inited) return;
        live2d.inited = true;
        live2d.corePath = corePath || null;
        if (typeof window === 'undefined') return;
        // 监听全局鼠标（为自动 eye/head 跟踪）— 去重绑定：把 handler 挂到 live2d，多次 Init 不重复绑
        if (live2d._onMm || live2d._onMl) return;
        live2d._onMm = (e) => {
            if (!canvas) return;
            const r = canvas.getBoundingClientRect();
            const w = r.width || canvas.width, h = r.height || canvas.height;
            const cw = canvas.width, ch = canvas.height;
            live2d.mouse.x = (e.clientX - r.left) * (cw / Math.max(1,w));
            live2d.mouse.y = (e.clientY - r.top)  * (ch / Math.max(1,h));
        };
        live2d._onMl = () => { live2d.mouse.x = -9999; live2d.mouse.y = -9999; };
        const tryBind = () => {
            if (!canvas) return false;
            canvas.addEventListener('mousemove', live2d._onMm, { passive:true });
            canvas.addEventListener('mouseleave', live2d._onMl, { passive:true });
            return true;
        };
        if (!tryBind()){
            // canvas 可能在 init 之后创建：设置一次性 poll（避免重复绑定）
            let tries = 0;
            const poll = () => {
                if (tryBind() || (++tries) > 120) return;
                setTimeout(poll, 250);
            };
            setTimeout(poll, 250);
        }
    }
    function live2dShutdown(){
        // 解除 canvas 绑定
        if (typeof window !== 'undefined' && canvas && live2d._onMm){
            try { canvas.removeEventListener('mousemove', live2d._onMm); } catch(e){}
            try { canvas.removeEventListener('mouseleave', live2d._onMl); } catch(e){}
            live2d._onMm = null; live2d._onMl = null;
        }
        for (const m of live2d.models){
            live2dDispose(m);
        }
        live2d.models.length = 0;
        live2d.modelMap.clear();
        live2d.inited = false;
    }
    function live2dByNameOrId(x){
        if (x == null) return null;
        if (typeof x === 'number' || /^\d+$/.test(x)){
            const id = +x;
            return live2d.modelMap.has(id) ? id : null;
        }
        // 按名字查找 (O(1))
        const id = live2d.nameMap.get(x);
        return id != null ? id : null;
    }

    function live2dLoadModel(model3JsonPath){
        const id = live2d.idSeq++;
        const m = {
            id, name: model3JsonPath || ('model_' + id),
            path: model3JsonPath || null,
            tf: { x: (canvas && canvas.width ? canvas.width*0.5 : 640), y: (canvas && canvas.height ? canvas.height*0.7 : 500), scale: 1, rotation: 0, opacity: 1, width: 0, height: 0, flipX: false },
            zLayer: 0,
            visible: true,
            ready: false,
            motions: Object.create(null),
            expressions: [],
            currentMotion: null,
            motionPriority: 0,
            motionQueue: [],
            currentExpression: null,
            expressionName: '',
            params: Object.create(null),
            auto: { eye: true, head: true, blink: true, mouth: false },
            blinkTimer: 0, blinkState: 0, blinkVal: 1,
            hitAreas: [],
            data: null,
            anim: { breath: 0, tiltX: 0, tiltY: 0, eyeX: 0, eyeY: 0, mouth: 0 },
            // ===== 离屏缓存 + 脏值签名 =====
            _cache: {
                canvas: null,   // 离屏画布
                ctx: null,
                w: 0, h: 0,
                lastSig: 0,     // 上次签名
                dirty: true,    // 脏标记
                // 节流：每 ~60ms 才允许重新签一次名（约 16fps 重绘上限，其余帧直接 blit 缓存）
                lastRenderMs: 0,
                minIntervalMs: 60,
            }
        };
        // 默认参数
        m.params['ParamAngleX'] = 0;
        m.params['ParamAngleY'] = 0;
        m.params['ParamBodyAngleX'] = 0;
        m.params['ParamEyeLOpen'] = 1;
        m.params['ParamEyeROpen'] = 1;
        m.params['ParamMouthOpenY'] = 0;
        m.params['ParamMouthForm']  = 0;
        m.params['ParamBreath'] = 0;
        live2d.models.push(m);
        live2d.modelMap.set(id, m);
        live2d.nameMap.set(m.name, id);
        // 尝试异步加载 JSON（若网络可用，失败则保留占位回退渲染）
        if (typeof fetch !== 'undefined' && model3JsonPath){
            const base = model3JsonPath.slice(0, model3JsonPath.lastIndexOf('/') + 1);
            fetch(model3JsonPath).then(r => r.ok ? r.json() : null).then(data => {
                if (!data) return;
                m.data = data;
                if (data.FileReferences){
                    const fr = data.FileReferences;
                    if (fr.Motions){
                        for (const k of Object.keys(fr.Motions)){
                            m.motions[k] = (fr.Motions[k]||[]).map((x,i)=>({name:`${k}_${i}`, file: base + (x.File||''), duration: 1500 + (Math.random()*1000|0)}));
                        }
                    }
                    if (Array.isArray(fr.Expressions)){
                        m.expressions = fr.Expressions.map((e,i)=>({
                            name: e.Name || ('expr_'+i),
                            file: base + (e.File || '')
                        }));
                    }
                    if (Array.isArray(fr.HitAreas)){
                        m.hitAreas = fr.HitAreas.map(h => ({ id: h.Id, name: h.Name }));
                    }
                }
                m.ready = true;
                m._cache.dirty = true;
            }).catch(()=>{ m.ready = true; });
        } else {
            m.motions['Idle'] = [{name:'Idle_0', duration:2000}];
            m.motions['TapBody'] = [{name:'TapBody_0', duration:900}];
            m.motions['Flick_Head'] = [{name:'Flick_Head_0', duration:700}];
            m.expressions = [{name:'neutral'},{name:'happy'},{name:'sad'},{name:'angry'},{name:'surprise'}];
            m.ready = true;
        }
        return id;
    }
    function live2dReleaseModel(id){
        const m = live2d.modelMap.get(id);
        if (!m) return;
        live2dDispose(m);
        const idx = live2d.models.indexOf(m);
        if (idx >= 0) live2d.models.splice(idx, 1);
        live2d.modelMap.delete(id);
        if (m.name) live2d.nameMap.delete(m.name);
    }
    function live2dDispose(m){
        // 释放离屏缓存
        if (m._cache){ m._cache.canvas = null; m._cache.ctx = null; }
    }
    function live2dIsReady(id){
        const m = live2d.modelMap.get(id);
        return !!(m && m.ready);
    }

    function live2dSetTransform(id, tf){
        const m = live2d.modelMap.get(id);
        if (!m || !tf) return;
        let changed = false;
        for (const k of ['x','y','scale','rotation','opacity','width','height','flipX']){
            if (tf[k] != null && m.tf[k] !== tf[k]){ m.tf[k] = tf[k]; changed = true; }
        }
        if (changed && m._cache) m._cache.dirty = true;
    }
    function live2dGetTransform(id){
        const m = live2d.modelMap.get(id);
        if (!m) return null;
        return Object.assign({}, m.tf);
    }
    function live2dSetLayer(id, z){ const m = live2d.modelMap.get(id); if (m){ m.zLayer = z|0; } }
    function live2dSetVisible(id, v){ const m = live2d.modelMap.get(id); if (m){ m.visible = !!v; if (m._cache) m._cache.dirty = true; } }

    function live2dGetMotionGroupCount(id, group){
        const m = live2d.modelMap.get(id);
        if (!m || !m.motions[group]) return 0;
        return m.motions[group].length;
    }
    function live2dStartMotion(id, group, index, priority){
        const m = live2d.modelMap.get(id);
        if (!m) return -1;
        if (priority != null && priority < (m.motionPriority||0)) return -1;
        const list = m.motions[group] || [];
        if (!list.length) return -1;
        const i = Math.min(list.length-1, Math.max(0, (index|0) % list.length));
        const motion = list[i];
        m.currentMotion = { ...motion, elapsed: 0, group };
        m.motionPriority = priority || 1;
        if (m._cache) m._cache.dirty = true;
        return i;
    }
    function live2dIsMotionPlaying(id){
        const m = live2d.modelMap.get(id);
        return !!(m && m.currentMotion && m.currentMotion.elapsed < m.currentMotion.duration);
    }
    function live2dStopMotion(id){ const m = live2d.modelMap.get(id); if (m){ m.currentMotion = null; m.motionPriority = 0; if (m._cache) m._cache.dirty = true; } }

    function live2dGetExpressionCount(id){
        const m = live2d.modelMap.get(id);
        return m ? m.expressions.length : 0;
    }
    function live2dGetExpressionName(id, i){
        const m = live2d.modelMap.get(id);
        return (m && m.expressions[i]) ? m.expressions[i].name : null;
    }
    function live2dSetExpression(id, name){
        const m = live2d.modelMap.get(id);
        if (!m) return;
        const e = m.expressions.find(x => x.name === name);
        if (!e) return;
        m.expressionName = name;
        m.params['ParamMouthForm'] = {
            neutral:0, happy:0.4, sad:-0.3, angry:-0.5, surprise:0.1
        }[name] || 0;
        m.params['ParamEyeLOpen'] = {
            neutral:1, happy:0.95, sad:0.6, angry:0.4, surprise:1.1
        }[name] || 1;
        m.params['ParamEyeROpen'] = m.params['ParamEyeLOpen'];
        m._expressionOverride = true;
        if (m._cache) m._cache.dirty = true;
    }
    function live2dSetExpressionRandom(id){
        const m = live2d.modelMap.get(id);
        if (!m || !m.expressions.length) return;
        const e = m.expressions[(Math.random()*m.expressions.length)|0].name;
        live2dSetExpression(id, e);
    }
    function live2dSetParam(id, paramId, value){
        const m = live2d.modelMap.get(id);
        if (!m) return;
        if (m.params[paramId] !== value){
            m.params[paramId] = value;
            if (m._cache) m._cache.dirty = true;
        }
    }
    function live2dGetParam(id, paramId, defVal){
        const m = live2d.modelMap.get(id);
        if (!m) return defVal;
        return (paramId in m.params) ? m.params[paramId] : defVal;
    }
    function live2dParamAdd(id, paramId, delta){
        const m = live2d.modelMap.get(id);
        if (!m) return;
        const nv = (m.params[paramId]||0) + (+delta||0);
        if (m.params[paramId] !== nv){ m.params[paramId] = nv; if (m._cache) m._cache.dirty = true; }
    }
    function live2dParamMult(id, paramId, factor){
        const m = live2d.modelMap.get(id);
        if (!m) return;
        const nv = (m.params[paramId]||0) * (+factor||1);
        if (m.params[paramId] !== nv){ m.params[paramId] = nv; if (m._cache) m._cache.dirty = true; }
    }

    function live2dSetEyeTarget(id, x, y){ const m = live2d.modelMap.get(id); if (m){ m._eyeTx = x; m._eyeTy = y; m.auto.eye = false; } }
    function live2dSetHeadTarget(id, x, y){ const m = live2d.modelMap.get(id); if (m){ m._headTx = x; m._headTy = y; m.auto.head = false; } }
    function live2dEnableAutoEye(id, v){ const m = live2d.modelMap.get(id); if (m){ m.auto.eye = !!v; if (v){ delete m._eyeTx; delete m._eyeTy; } } }
    function live2dEnableAutoHead(id, v){ const m = live2d.modelMap.get(id); if (m){ m.auto.head = !!v; if (v){ delete m._headTx; delete m._headTy; } } }
    function live2dEnableAutoBlink(id, v){ const m = live2d.modelMap.get(id); if (m) m.auto.blink = !!v; }
    function live2dEnableAutoMouth(id, v){ const m = live2d.modelMap.get(id); if (m) m.auto.mouth = !!v; }

    function live2dHitTest(id, sx, sy){
        const m = live2d.modelMap.get(id);
        if (!m || !m.tf) return null;
        const dx = sx - m.tf.x, dy = sy - (m.tf.y - (m.tf.height || 400) * 0.5 * (m.tf.scale||1));
        const scale = (m.tf.scale || 1) * 250;
        if (Math.abs(dx) < scale*0.5 && Math.abs(dy) < (m.tf.height||400)*(m.tf.scale||1)*0.5){
            if (m.hitAreas && m.hitAreas.length){
                const hit = m.hitAreas.find(a => /Head|Face/i.test(a.name || a.id));
                if (hit) return hit.name || hit.id;
                const h2 = m.hitAreas.find(a => /Body/i.test(a.name || a.id));
                if (h2) return h2.name || h2.id;
                return m.hitAreas[0].name || m.hitAreas[0].id || 'Body';
            }
            if (Math.abs(dy) < scale*0.7 && Math.abs(dx) < scale*0.35) return 'Head';
            return 'Body';
        }
        return null;
    }

    function galAttachLive2d(modelId, slot, zOrder){
        const m = live2d.modelMap.get(modelId);
        if (!m) return -1;
        const id = galCreateSprite(`live2d:${modelId}`, slot, zOrder || 0);
        const sp = gal.sprites.get(id);
        if (sp){
            sp.live2dId = modelId;
            sp.alpha = 0; sp.destAlpha = 1;
            sp.toAlpha = 1; sp.fromAlpha = 0;
            sp.tween = GAL_TWEEN.FADE; sp.tweenDur = 500; sp.tweenT = 0;
        }
        return id;
    }

    // 计算当前模型签名（32-bit DJB2-ish hash），用于快速判断是否真的需要重绘离屏缓存
    function live2dModelSig(m){
        const p = m.params;
        let h = 5381;
        h = ((h << 5) + h) ^ ((m.expressionName || '').length + (m.currentMotion ? (m.currentMotion.elapsed/60|0) : -1));
        h = ((h << 5) + h) ^ Math.round((p['ParamAngleX']||0) * 10);
        h = ((h << 5) + h) ^ Math.round((p['ParamAngleY']||0) * 10);
        h = ((h << 5) + h) ^ Math.round((p['ParamBodyAngleX']||0) * 10);
        h = ((h << 5) + h) ^ Math.round((p['ParamEyeLOpen']||0) * 100);
        h = ((h << 5) + h) ^ Math.round((p['ParamEyeROpen']||0) * 100);
        h = ((h << 5) + h) ^ Math.round((p['ParamMouthOpenY']||0) * 100);
        h = ((h << 5) + h) ^ Math.round((p['ParamMouthForm']||0) * 100);
        h = ((h << 5) + h) ^ Math.round((p['ParamBreath']||0) * 20);
        return h|0;
    }

    function live2dUpdate(dtMs){
        const dt = (+dtMs||16) / 1000;
        live2d.tick += dt;
        const nowMs = (+dtMs||16); // 相对增量，这里用累计 tick 也可
        for (const m of live2d.models){
            let dirtyThisFrame = false;
            // Motion 计时
            if (m.currentMotion){
                m.currentMotion.elapsed += (+dtMs||16);
                if (m.currentMotion.elapsed >= m.currentMotion.duration){
                    m.currentMotion = null;
                    m.motionPriority = 0;
                } else {
                    const e = m.currentMotion.elapsed / m.currentMotion.duration;
                    if (m.currentMotion.group === 'TapBody' || /Tap|Flick|Shake/.test(m.currentMotion.group||'')){
                        m.params['ParamAngleX'] = Math.sin(e * Math.PI * 2) * 20;
                    } else {
                        m.params['ParamBodyAngleX'] = Math.sin(e * Math.PI) * 3;
                    }
                }
                dirtyThisFrame = true;
            }
            // 呼吸
            m.anim.breath += dt;
            const nb = (Math.sin(m.anim.breath*1.8) + 1) * 0.5;
            if (Math.abs(nb - (m.params['ParamBreath']||0)) > 0.02){
                m.params['ParamBreath'] = nb;
                dirtyThisFrame = true;
            } else {
                m.params['ParamBreath'] = nb;
            }
            // 自动 eye track
            if (m.auto.eye){
                const dx = (live2d.mouse.x >= -1000) ? (live2d.mouse.x - m.tf.x) : 0;
                const dy = (live2d.mouse.y >= -1000) ? (live2d.mouse.y - (m.tf.y - 150*(m.tf.scale||1))) : 0;
                const maxD = 300;
                const nax = (m.currentMotion && (m.currentMotion.group === 'TapBody' || /Flick|Shake/.test(m.currentMotion.group||'')))
                    ? (m.params['ParamAngleX']||0) : Math.max(-30, Math.min(30, (dx/maxD)*30));
                const nay = Math.max(-15, Math.min(15, (dy/maxD)*15));
                if (Math.abs(nax - (m.params['ParamAngleX']||0)) > 0.2 || Math.abs(nay - (m.params['ParamAngleY']||0)) > 0.2){
                    m.params['ParamAngleX'] = nax;
                    m.params['ParamAngleY'] = nay;
                    dirtyThisFrame = true;
                } else {
                    m.params['ParamAngleX'] = nax;
                    m.params['ParamAngleY'] = nay;
                }
            }
            // 自动眨眼
            if (m.auto.blink){
                m.blinkTimer -= dtMs;
                if (m.blinkTimer <= 0){
                    if (m.blinkState === 0){ m.blinkState = 1; m.blinkTimer = 120; }
                    else if (m.blinkState === 1){ m.blinkState = 2; m.blinkTimer = 80; }
                    else { m.blinkState = 0; m.blinkTimer = 2000 + (Math.random()*3000|0); }
                    dirtyThisFrame = true;
                }
                const e = (m.blinkState === 0) ? 1 : (m.blinkState === 1 ? (1 - (m.blinkTimer/120)) : (m.blinkTimer/80));
                if (!m._expressionOverride){
                    const oeL = m.params['ParamEyeLOpen'];
                    const oeR = m.params['ParamEyeROpen'];
                    if (Math.abs(e - (oeL||0)) > 0.01 || Math.abs(e - (oeR||0)) > 0.01) dirtyThisFrame = true;
                    m.params['ParamEyeLOpen'] = e;
                    m.params['ParamEyeROpen'] = e;
                }
            }
            // 自动 mouth
            if (m.auto.mouth){
                const cur = m.params['ParamMouthOpenY']||0;
                let next = cur * 0.9;
                if (gal.audio && gal.audio.voice){ next = 0.3 + 0.3*Math.random(); }
                if (Math.abs(next - cur) > 0.01) dirtyThisFrame = true;
                m.params['ParamMouthOpenY'] = next;
            }
            // 同步脏标记（节流：只有离屏允许重绘的时间窗口才写 dirty）
            if (dirtyThisFrame && m._cache) m._cache.dirty = true;
        }
    }

    function live2dRender(){
        const list = live2d.models.filter(m => m.visible && !isAttached(m));
        list.sort((a,b) => (a.zLayer|0) - (b.zLayer|0));
        for (const m of list){
            live2dRenderModel(m.id, m.tf.x, m.tf.y, m.tf.scale || 1);
        }
    }
    function isAttached(m){
        for (const [,sp] of gal.sprites){ if (sp.live2dId === m.id) return true; }
        return false;
    }
    function live2dRenderModel(id, cx, cy, scale){
        const m = live2d.modelMap.get(id);
        if (!m || !m.tf || (m.tf.opacity != null && m.tf.opacity <= 0.001)) return;

        // ============ 离屏缓存初始化 ============
        const CACHE_W = 400;
        const CACHE_H = 560;
        const CX = 200; // 离屏中的角色原点
        const CY = 320;
        const c = m._cache;
        if (!c.canvas || c.w !== CACHE_W || c.h !== CACHE_H){
            try {
                const off = typeof document !== 'undefined' ? document.createElement('canvas') : null;
                if (off){
                    off.width = CACHE_W; off.height = CACHE_H;
                    const octx = off.getContext('2d');
                    c.canvas = off; c.ctx = octx; c.w = CACHE_W; c.h = CACHE_H;
                    c.dirty = true;
                }
            } catch(_e){ c.canvas = null; }
        }

        // ============ 缓存重绘判定：签名 + 脏标记 + 节流 ============
        let nowTs = 0;
        try { nowTs = (performance && typeof performance.now === 'function') ? performance.now() : Date.now(); } catch(_e){ nowTs = Date.now(); }
        let needRender = !!c.dirty;
        const sig = live2dModelSig(m);
        if (sig !== c.lastSig){ needRender = true; }
        const canRender = !c.canvas || (nowTs - (c.lastRenderMs||0)) >= (c.minIntervalMs || 0);
        if (needRender && canRender && c.canvas && c.ctx){
            // 切换到离屏上下文
            const prevCtx = ctx;
            ctx = c.ctx;
            ctx.setTransform(1,0,0,1,0,0);
            ctx.clearRect(0, 0, CACHE_W, CACHE_H);
            ctx.save();
            ctx.translate(CX, CY);
            drawLive2DPlaceholder(m);
            ctx.restore();
            ctx = prevCtx;
            c.dirty = false;
            c.lastSig = sig;
            c.lastRenderMs = nowTs;
        }

        // ============ 主画布 blit / 直接绘制兜底 ============
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, m.tf.opacity ?? 1));
        ctx.translate(cx, cy);
        ctx.rotate((m.tf.rotation || 0) * Math.PI / 180);
        const s = (scale || 1) * (m.tf.scale || 1);
        if (m.tf.flipX) ctx.scale(-s, s); else ctx.scale(s, s);
        const ax = m.params['ParamAngleX'] || 0;
        const ay = m.params['ParamAngleY'] || 0;
        const bx = m.params['ParamBodyAngleX'] || 0;
        ctx.translate((ax + bx*0.5) * 0.7, ay * 0.3);
        if (c.canvas){
            // blit 离屏缓存（注意：缓存内已经 translate 过 CX/CY，这里绘制时把缓存中心对齐到当前 transform 原点，同时要把角色的"脚"对齐到 cy）
            ctx.drawImage(c.canvas, -CX, -CY);
        } else {
            // 兜底：无 canvas 支持时直接绘制（Node/无DOM环境）
            drawLive2DPlaceholder(m);
        }
        ctx.restore();
    }
    // 占位绘制：参数化可爱角色轮廓（无需外部模型文件也能可视化 Live2D API 效果）
    // 当模型 JSON 未加载或失败时始终可用。
    function drawLive2DPlaceholder(m){
        // 身体 & 头（参数响应）
        const breath = m.params['ParamBreath'] || 0;
        const eyeL = Math.max(0, Math.min(1.1, m.params['ParamEyeLOpen'] ?? 1));
        const eyeR = Math.max(0, Math.min(1.1, m.params['ParamEyeROpen'] ?? 1));
        const mouth = Math.max(0, Math.min(1, m.params['ParamMouthOpenY'] ?? 0));
        const mouthForm = m.params['ParamMouthForm'] || 0;
        // 身体
        ctx.fillStyle = '#f6d3c6';
        ctx.beginPath();
        ctx.moveTo(-110, 260);
        ctx.quadraticCurveTo(-120, 150 + breath*3, -80, 110 + breath*3);
        ctx.lineTo(80, 110 + breath*3);
        ctx.quadraticCurveTo(120, 150 + breath*3, 110, 260);
        ctx.closePath(); ctx.fill();
        // 衣服
        const grad = ctx.createLinearGradient(0, 100, 0, 260);
        grad.addColorStop(0, '#a6c8ff'); grad.addColorStop(1, '#4a64b0');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(-82, 120 + breath*2);
        ctx.lineTo(82, 120 + breath*2);
        ctx.quadraticCurveTo(105, 170, 95, 260);
        ctx.lineTo(-95, 260);
        ctx.quadraticCurveTo(-105, 170, -82, 120 + breath*2);
        ctx.closePath(); ctx.fill();
        // 头
        ctx.fillStyle = '#f8e0d0';
        ctx.beginPath();
        ctx.ellipse(0, -10, 95, 110 + breath*1.5, 0, 0, Math.PI*2);
        ctx.fill();
        // 头发 (后)
        ctx.fillStyle = '#3d2a1a';
        ctx.beginPath();
        ctx.moveTo(-95, -20);
        ctx.quadraticCurveTo(-120, -80, -70, -110);
        ctx.quadraticCurveTo(0, -135, 70, -110);
        ctx.quadraticCurveTo(120, -80, 95, -20);
        ctx.quadraticCurveTo(110, 40, 95, 90);
        ctx.quadraticCurveTo(0, 60, -95, 90);
        ctx.quadraticCurveTo(-110, 40, -95, -20);
        ctx.closePath(); ctx.fill();
        // 刘海
        ctx.fillStyle = '#4c3420';
        ctx.beginPath();
        ctx.moveTo(-90, -30);
        ctx.quadraticCurveTo(-80, -110, 0, -100);
        ctx.quadraticCurveTo(80, -110, 90, -30);
        ctx.quadraticCurveTo(60, -60, 0, -70);
        ctx.quadraticCurveTo(-60, -60, -90, -30);
        ctx.closePath(); ctx.fill();
        // 腮红
        ctx.fillStyle = 'rgba(240,150,170,0.55)';
        ctx.beginPath(); ctx.ellipse(-48, 24, 16, 8, 0, 0, Math.PI*2); ctx.fill();
        ctx.beginPath(); ctx.ellipse( 48, 24, 16, 8, 0, 0, Math.PI*2); ctx.fill();
        // 眼睛
        const eyeY = -4;
        drawEye(-36, eyeY, 26, 38, eyeL, '#2a4a7a');
        drawEye( 36, eyeY, 26, 38, eyeR, '#2a4a7a');
        // 眉毛
        ctx.strokeStyle = '#3d2a1a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        const brow = (m.expressionName === 'angry') ? -6 : (m.expressionName === 'surprise' ? 7 : 0);
        ctx.beginPath(); ctx.moveTo(-52, -36 + brow); ctx.lineTo(-20, -34 + brow - (m.expressionName==='angry'?8:0)); ctx.stroke();
        ctx.beginPath(); ctx.moveTo( 20, -34 + brow - (m.expressionName==='angry'?8:0)); ctx.lineTo( 52, -36 + brow); ctx.stroke();
        // 嘴
        ctx.strokeStyle = '#a55060'; ctx.fillStyle = '#c2546a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        if (mouth > 0.02){
            ctx.ellipse(0, 48, 12 + mouth*10, 6 + mouth*14 + mouthForm*3, 0, 0, Math.PI*2);
            ctx.fill();
        } else {
            const curve = mouthForm * 6;
            ctx.moveTo(-12, 48 - curve);
            ctx.quadraticCurveTo(0, 54 + curve*0.5, 12, 48 - curve);
            ctx.stroke();
        }
        // 当前动作 / 表情徽标
        if (m.currentMotion || m.expressionName){
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            roundRectIn(-86, -146, 172, 20, 6); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = '11px "JetBrainsMono",monospace'; ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const tag = [
                m.currentMotion ? 'M:' + m.currentMotion.group : null,
                m.expressionName ? 'E:' + m.expressionName : null
            ].filter(Boolean).join('  ');
            ctx.fillText(tag || 'Live2D Placeholder', 0, -136);
        }
    }
    function drawEye(ex, ey, w, h, open, irisCol){
        const o = Math.max(0.001, open);
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.ellipse(ex, ey, w, h*o, 0, 0, Math.PI*2); ctx.fill();
        // iris
        ctx.fillStyle = irisCol || '#2a4a7a';
        ctx.beginPath(); ctx.ellipse(ex, ey + h*o*0.1, w*0.6, h*o*0.85, 0, 0, Math.PI*2); ctx.fill();
        // pupil
        ctx.fillStyle = '#0b0f1c';
        ctx.beginPath(); ctx.ellipse(ex, ey + h*o*0.1, w*0.28, h*o*0.5, 0, 0, Math.PI*2); ctx.fill();
        // 高光
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(ex - w*0.25, ey - h*o*0.3, w*0.16, 0, Math.PI*2); ctx.fill();
        // 眼线
        ctx.strokeStyle = '#1a1520'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.ellipse(ex, ey, w, h*o, 0, 0, Math.PI*2); ctx.stroke();
    }
    function roundRectIn(x,y,w,h,r){
        const rr = Math.min(r, w/2, h/2);
        ctx.beginPath();
        ctx.moveTo(x+rr,y);
        ctx.lineTo(x+w-rr,y);
        ctx.quadraticCurveTo(x+w,y,x+w,y+rr);
        ctx.lineTo(x+w,y+h-rr);
        ctx.quadraticCurveTo(x+w,y+h,x+w-rr,y+h);
        ctx.lineTo(x+rr,y+h);
        ctx.quadraticCurveTo(x,y+h,x,y+h-rr);
        ctx.lineTo(x,y+rr);
        ctx.quadraticCurveTo(x,y,x+rr,y);
        ctx.closePath();
    }

    // ============================================================
    // 公开 API
    // ============================================================

    return {
        // 常量
        VERSION, PLATFORM, RENDERER, KEY,
        WIDGET, LAYOUT, EVENT, LIGHT,
        AUTOSIZE, BROADPHASE,

        // 核心
        init, shutdown, isRunning,
        beginFrame, endFrame, getDeltaTime, getStats,
        getPlatform, getRendererType,
        run,

        // 渲染
        clear, setCamera, drawRect, drawSprite, drawText, drawPixel, flush,
        loadTexture, createTextureFromData, destroyTexture,
        createPixelArt, getCanvas, getContext,

        // v1.3 渲染图元
        drawCircle, drawLine, drawTriangle, drawPolygon, drawEllipse, drawPoint,
        // v1.3 手动批处理
        beginBatch, batchQuad, batchTriangle, endBatch,

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
        // v1.3 物理空间分区与调试
        physicsSetBroadphase, physicsSetGridCellSize,
        physicsDebugDraw, physicsGetPairCount,
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
        // v1.3 新增控件
        uiCreateDropdown, uiCreateToggle, uiCreateScrollview,
        uiCreateTooltip, uiCreateProgress, uiCreateSlider,
        uiCreateCheckbox, uiCreateDivider, uiCreateSpinner, uiCreateIcon,
        // v1.3 控件状态接口
        uiSetValue, uiGetValue, uiSetMinMax,
        uiSetOptions, uiGetSelected, uiSetSelected,
        uiSetChecked, uiGetChecked,
        uiSetScroll, uiGetScroll, uiSetContentSize,
        // v1.3 自动化系统
        uiSetTheme, uiGetTheme, uiResetTheme,
        uiSetAutoSize, uiMeasureText, uiSetMargin,
        uiBuildFromJson, uiDumpTree, uiFindById,

        // ============================================================
        // LumentGAL: 视觉小说 / GAL 子系统  (LumentGAL 分支)
        // ============================================================
        GAL_CMD, GAL_SLOT, GAL_TWEEN,
        // 生命周期
        galInit, galShutdown, galIsRunning,
        // 剧本
        galParseScript, galLoadScript, galStart, galStop,
        galAdvance, galSkip, galAuto, galSetAutoDelay,
        galSetSkipReadOnly, galGetSkipReadOnly,
        galGotoLabel, galSelectChoice, galChoose, galGetChoiceCount, galGetChoiceText, galGetChoices,
        // 对话框
        galSetDialogStyle, galShowDialog, galIsDialogVisible, galSay,
        galGetHistoryCount, galGetHistoryEntry, galClearHistory,
        galGetHistoryPageCount, galGetHistoryPage,
        galHandleClick,
        // 立绘 / 背景 / CG
        galCreateSprite, galDestroySprite,
        galShowSprite, galHideSprite,
        galSetSpritePosition, galSetSpriteScale, galSetSpriteExpression,
        galSetBackground, galShowCG, galHideCG,
        // 存档 / 读档
        galSave, galLoad, galDeleteSave, galGetSaveInfo,
        galQuickSave, galQuickLoad,
        // 音频
        galPlayBgm, galStopBgm, galPlaySe, galPlayVoice, galStopVoice,
        galStartSynthBgm, galStopSynthBgm, galSynthSeClick, galSynthSeConfirm,
        // 偏好设置
        galSetPrefTextSpeed, galGetPrefTextSpeed,
        galSetPrefAuto, galGetPrefAuto,
        galSetPrefSkip, galGetPrefSkip,
        galSetPrefVolume, galGetPrefVolume,
        // 演出
        galShake, galFadeTo, galFadeFrom,
        // 变量
        galSetVar, galSetVarInt, galSetVarFloat, galSetVarBool,
        galGetVar, galGetVarInt, galGetVarFloat, galGetVarBool,
        // 回调
        set galOnEnd(fn){ gal.onEnd = fn; }, get galOnEnd(){ return gal.onEnd; },
        set galOnTitle(fn){ gal.onTitle = fn; }, get galOnTitle(){ return gal.onTitle; },
        galSetOnVarChange, galRemoveOnVarChange, galSetOnRead, galIsCurrentLineRead,
        // 每帧：update / render
        galUpdate, galRender,

        // ============================================================
        // LumentGAL: Live2D 子系统 (LumentGAL 分支)
        // ============================================================
        live2dInit, live2dShutdown,
        live2dLoadModel, live2dReleaseModel, live2dIsReady,
        live2dSetTransform, live2dGetTransform,
        live2dSetLayer, live2dSetVisible,
        live2dGetMotionGroupCount, live2dStartMotion,
        live2dIsMotionPlaying, live2dStopMotion,
        live2dGetExpressionCount, live2dGetExpressionName,
        live2dSetExpression, live2dSetExpressionRandom,
        live2dSetParam, live2dGetParam, live2dParamAdd, live2dParamMult,
        live2dSetEyeTarget, live2dSetHeadTarget,
        live2dEnableAutoEye, live2dEnableAutoHead,
        live2dEnableAutoBlink, live2dEnableAutoMouth,
        live2dHitTest, galAttachLive2d,
        live2dUpdate, live2dRender,
    };
})();

// 模块导出（支持 CommonJS / ES Module / 浏览器全局）
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Lument;
}
if (typeof globalThis !== 'undefined') {
    globalThis.Lument = Lument;
}
