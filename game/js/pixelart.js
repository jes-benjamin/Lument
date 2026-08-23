// ============================================================
// pixelart.js - 泰拉瑞亚风格像素美术生成系统
// 程序化生成所有像素精灵，无需外部图片资源
//
// ============================================================
// Lument 移植版
// ------------------------------------------------------------
// 与 LumentWorldNative 版的差异：
//   * 所有精灵不再返回 HTMLCanvasElement，而是返回引擎纹理 ID（uint32）。
//   * 纹理通过 Lument.createPixelArt(w, h, drawFn) 创建，
//     该 API 会提供一个 canvas 2D 上下文供我们绘制——因此原有的
//     drawPixel / createSprite 逐像素 fillRect 逻辑被完整保留，
//     像素美术的生成过程与原版完全一致，视觉输出逐像素相同。
//   * 额外维护一份 textureRegistry（textureId -> 源 canvas），供
//     drawTextureToCanvas() 把纹理绘制到仍然为原生 DOM 的
//     #portrait-canvas（对话框头像画布）上。
//   * createTextureFromData(w, h, rgbaData) 也可用于创建纹理，
//     但本实现统一采用 createPixelArt，以复用浏览器原生的颜色
//     字符串解析（#rgb / #rrggbb / rgba()），保证半透明阴影等
//     特殊颜色与原版像素级一致。
// ============================================================

const PixelArt = (function() {

    // 调色板 - 泰拉瑞亚风格（昏暗压抑版）
    const PALETTE = {
        // 玩家
        skin: '#b89878', skinShade: '#90705a', skinDark: '#704838',
        hair: '#2a1a08', hairLight: '#3a2810',
        shirt: '#2a4a6a', shirtShade: '#1a3a5a', shirtDark: '#0a2a3a',
        pants: '#1a1a28', pantsShade: '#0a0a18',
        shoes: '#0a0a0a',
        // 雨伞NPC
        lument: '#5a1a3a', lumentShade: '#3a0a2a', lumentLight: '#7a2a4a',
        lumentGold: '#8a7030', lumentGoldDark: '#5a5020',
        // 建筑物
        brick: '#4a3a2e', brickShade: '#2a1e14', brickLight: '#5a4a3e',
        window: '#1a2a38', windowLight: '#2a4a58', windowDark: '#0a1a24',
        roof: '#3a2418', roofShade: '#1a1408',
        door: '#2a1e10', doorShade: '#1a0e06',
        // 街道
        ground: '#1e1e22', groundShade: '#121216', groundLight: '#2a2a2e',
        sidewalk: '#2e2e32', sidewalkShade: '#1e1e22',
        roadLine: '#4a4a3e',
        // 自然
        tree: '#1a3a1a', treeShade: '#0a2a0a', treeLight: '#2a4a2a',
        trunk: '#2e2410', trunkShade: '#1a1408',
        grass: '#1a3a18', grassDark: '#0a2a08',
        // 雨
        rain: '#3a5a7a', rainLight: '#4a6a8a', rainDark: '#2a4a5a',
        // 特效
        splash: '#4a6a8a', glow: '#5a6a8a',
        // 天空
        skyDark: '#080810', skyMid: '#0e0e1a', skyLight: '#14141e',
        // UI
        uiBg: '#050508', uiBorder: '#2a3a4a', uiText: '#8899aa',
    };

    // 精灵缓存（现在缓存的是引擎纹理 ID，而非 canvas）
    // 纹理 ID 为 >=1 的 uint32，故 falsy 判断仍可用于缓存未命中检测。
    const cache = {};

    // 纹理源画布注册表：textureId -> 源 HTMLCanvasElement
    // createPixelArt 内部会创建一个离屏 canvas 并把它的 2D 上下文交给我们；
    // 通过 ctx.canvas 即可拿到该 canvas 引用，登记后供
    // drawTextureToCanvas() 在原生 DOM 画布（如头像画布）上绘制。
    const textureRegistry = new Map();

    // 颜色调整工具（hex颜色加亮/变暗）
    function adjustColor(hex, amount) {
        const h = hex.replace('#', '');
        let r = parseInt(h.substr(0, 2), 16);
        let g = parseInt(h.substr(2, 2), 16);
        let b = parseInt(h.substr(4, 2), 16);
        r = Math.max(0, Math.min(255, r + amount));
        g = Math.max(0, Math.min(255, g + amount));
        b = Math.max(0, Math.min(255, b + amount));
        return '#' + r.toString(16).padStart(2, '0') + g.toString(16).padStart(2, '0') + b.toString(16).padStart(2, '0');
    }

    // 绘制像素到canvas
    function drawPixel(ctx, x, y, color, scale = 1) {
        ctx.fillStyle = color;
        ctx.fillRect(x * scale, y * scale, scale, scale);
    }

    // 从像素数组生成引擎纹理
    // ------------------------------------------------------------
    // 逻辑与原版完全一致：每个逻辑像素绘制为 scale×scale 的色块。
    // 唯一区别：不再返回 canvas，而是调用 Lument.createPixelArt
    // 创建引擎纹理并返回纹理 ID（uint32）。
    // createPixelArt 会新建一个 width×height 的离屏 canvas 并把它的 2D
    // 上下文作为第一个参数传给 drawFn；我们在此回调里完成与原版相同的
    // 逐像素绘制，并通过 ctx.canvas 捕获源画布登记到 textureRegistry。
    function createSprite(width, height, pixels, scale = 3) {
        const texW = width * scale;
        const texH = height * scale;

        // 捕获 createPixelArt 内部创建的源 canvas
        let sourceCanvas = null;

        const textureId = Lument.createPixelArt(texW, texH, function(ctx, w, h) {
            // 拿到引擎内部为该纹理创建的离屏 canvas 引用
            sourceCanvas = ctx.canvas;
            ctx.imageSmoothingEnabled = false;

            // 以下逐像素绘制与原版逐字一致
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < width; x++) {
                    const idx = y * width + x;
                    const c = pixels[idx];
                    if (c && c !== '0' && c !== '.') {
                        drawPixel(ctx, x, y, c, scale);
                    }
                }
            }
        });

        // 登记源画布，使头像等原生 DOM 画布仍可绘制该纹理
        if (sourceCanvas) {
            textureRegistry.set(textureId, sourceCanvas);
        }
        return textureId;
    }

    // 把引擎纹理绘制到原生 DOM 画布上（如对话框头像 #portrait-canvas）
    // ------------------------------------------------------------
    // 参数：
    //   textureId - createSprite / createPortrait 等返回的纹理 ID
    //   ctx       - 目标 DOM 画布的 2D 上下文
    //   x, y      - 目标左上角坐标
    //   w, h      - 目标宽高（可选；缺省时按源画布原始尺寸绘制）
    // 说明：头像画布在 UI 层仍为原生 DOM canvas，无法走引擎 drawSprite
    // （后者只能绘制到引擎主画布并受摄像机变换影响），因此这里直接用
    // drawImage 把登记的源画布画上去，imageSmoothingEnabled 关闭以保持
    // 像素硬边，与原版 ctx.drawImage(canvas, ...) 的视觉效果完全一致。
    function drawTextureToCanvas(textureId, ctx, x, y, w, h) {
        const src = textureRegistry.get(textureId);
        if (!src) return;
        ctx.imageSmoothingEnabled = false;
        if (w !== undefined && h !== undefined) {
            ctx.drawImage(src, x, y, w, h);
        } else {
            ctx.drawImage(src, x, y);
        }
    }

    // ========== 玩家精灵 (16x24) ==========
    function createPlayerSprite(facing = 'down', frame = 0) {
        const key = `player_${facing}_${frame}`;
        if (cache[key]) return cache[key];

        const W = 14, H = 22;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const f = frame % 4; // 0,1,2,3 = standing, left-step, standing, right-step
        const legOffset = f === 1 ? -1 : (f === 3 ? 1 : 0);

        // 头部 (y: 0-6)
        // 头发
        for (let x = 3; x <= 10; x++) p[x] = c.hair;
        for (let x = 2; x <= 11; x++) p[W + x] = c.hair;
        // 脸
        for (let y = 2; y <= 5; y++) {
            for (let x = 3; x <= 10; x++) {
                p[y * W + x] = c.skin;
            }
        }
        // 头发两侧
        p[2 * W + 2] = c.hair; p[2 * W + 11] = c.hair;
        p[3 * W + 2] = c.hair; p[3 * W + 11] = c.hair;

        // 眼睛
        if (facing === 'down' || facing === 'up') {
            p[4 * W + 5] = c.hair;
            p[4 * W + 8] = c.hair;
        } else if (facing === 'left') {
            p[4 * W + 4] = c.hair;
            p[4 * W + 5] = c.hair;
        } else {
            p[4 * W + 8] = c.hair;
            p[4 * W + 9] = c.hair;
        }

        // 阴影
        for (let x = 4; x <= 9; x++) p[5 * W + x] = c.skinShade;

        // 脖子
        p[6 * W + 5] = c.skinShade;
        p[6 * W + 6] = c.skinShade;
        p[6 * W + 7] = c.skinShade;
        p[6 * W + 8] = c.skinShade;

        // 身体/衣服 (y: 7-13)
        for (let y = 7; y <= 13; y++) {
            for (let x = 3; x <= 10; x++) {
                p[y * W + x] = c.shirt;
            }
        }
        // 衣服阴影
        for (let y = 9; y <= 13; y++) {
            p[y * W + 3] = c.shirtShade;
            p[y * W + 10] = c.shirtShade;
        }
        // 衣领
        p[7 * W + 5] = c.shirtShade;
        p[7 * W + 6] = c.shirtDark;
        p[7 * W + 7] = c.shirtDark;
        p[7 * W + 8] = c.shirtShade;

        // 手臂
        p[8 * W + 2] = c.shirt;
        p[9 * W + 2] = c.shirt;
        p[10 * W + 2] = c.skin;
        p[8 * W + 11] = c.shirt;
        p[9 * W + 11] = c.shirt;
        p[10 * W + 11] = c.skin;

        // 腿/裤子 (y: 14-18)
        const leftLegX = 4, rightLegX = 7;
        for (let y = 14; y <= 18; y++) {
            p[y * W + leftLegX] = c.pants;
            p[y * W + leftLegX + 1] = c.pants;
            p[y * W + leftLegX + 2] = c.pantsShade;
            p[y * W + rightLegX] = c.pants;
            p[y * W + rightLegX + 1] = c.pants;
            p[y * W + rightLegX + 2] = c.pantsShade;
        }

        // 走路动画 - 腿部偏移
        if (legOffset !== 0) {
            const offsetLeg = legOffset < 0 ? leftLegX : rightLegX;
            const otherLeg = legOffset < 0 ? rightLegX : leftLegX;
            // 一条腿前迈
            for (let y = 17; y <= 18; y++) {
                if (p[y * W + offsetLeg]) {
                    p[y * W + offsetLeg + legOffset] = p[y * W + offsetLeg];
                    p[y * W + offsetLeg] = null;
                    p[y * W + offsetLeg + 1 + legOffset] = p[y * W + offsetLeg + 1];
                    p[y * W + offsetLeg + 1] = null;
                }
            }
        }

        // 鞋子
        p[19 * W + leftLegX] = c.shoes;
        p[19 * W + leftLegX + 1] = c.shoes;
        p[19 * W + leftLegX + 2] = c.shoes;
        p[19 * W + rightLegX] = c.shoes;
        p[19 * W + rightLegX + 1] = c.shoes;
        p[19 * W + rightLegX + 2] = c.shoes;

        // 走路时鞋子偏移
        if (legOffset !== 0) {
            const offsetLeg = legOffset < 0 ? leftLegX : rightLegX;
            p[19 * W + offsetLeg + legOffset] = c.shoes;
            p[19 * W + offsetLeg + 1 + legOffset] = c.shoes;
            p[19 * W + offsetLeg + 2 + legOffset] = c.shoes;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 玩家撑伞精灵 (18x34, 玩家身份改变后撑伞) ==========
    function createPlayerLumentSprite(facing = 'down', frame = 0) {
        const key = `player_lument_${facing}_${frame}`;
        if (cache[key]) return cache[key];

        const W = 18, H = 34;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const f = frame % 4;
        const legOffset = f === 1 ? -1 : (f === 3 ? 1 : 0);

        // ========== 雨伞 (y: 0-8) - 在头顶上方 ==========
        const umbColor = c.lument;
        const umbShade = c.lumentShade;
        const umbLight = c.lumentLight;
        const lumentShape = [
            [8, 0],
            [7, 1], [8, 1], [9, 1],
            [6, 2], [7, 2], [8, 2], [9, 2], [10, 2],
            [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3],
            [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4],
            [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [13, 5],
            [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
        ];
        for (const [x, y] of lumentShape) {
            p[y * W + x] = umbColor;
        }
        p[4 * W + 5] = umbLight;
        p[4 * W + 6] = umbLight;
        p[5 * W + 4] = umbLight;
        p[5 * W + 5] = umbLight;
        p[5 * W + 11] = umbShade;
        p[5 * W + 12] = umbShade;
        p[6 * W + 12] = umbShade;
        p[6 * W + 13] = umbShade;
        for (let x = 3; x <= 14; x++) p[7 * W + x] = umbShade;

        // 伞柄
        p[8 * W + 8] = '#5a3a1a';
        p[9 * W + 8] = '#5a3a1a';

        // ========== 玩家身体 (y: 11-33) ==========
        // 头部 (y: 11-17)
        for (let x = 5; x <= 12; x++) p[11 * W + x] = c.hair;
        for (let x = 4; x <= 13; x++) p[12 * W + x] = c.hair;
        for (let y = 13; y <= 16; y++) {
            for (let x = 5; x <= 12; x++) p[y * W + x] = c.skin;
        }
        p[13 * W + 4] = c.hair; p[13 * W + 13] = c.hair;
        p[14 * W + 4] = c.hair; p[14 * W + 13] = c.hair;

        // 眼睛
        if (facing === 'down' || facing === 'up') {
            p[15 * W + 7] = c.hair;
            p[15 * W + 10] = c.hair;
        } else if (facing === 'left') {
            p[15 * W + 6] = c.hair;
            p[15 * W + 7] = c.hair;
        } else {
            p[15 * W + 10] = c.hair;
            p[15 * W + 11] = c.hair;
        }

        for (let x = 5; x <= 12; x++) p[16 * W + x] = c.skinShade;

        // 脖子
        p[17 * W + 7] = c.skinShade;
        p[17 * W + 8] = c.skinShade;
        p[17 * W + 9] = c.skinShade;
        p[17 * W + 10] = c.skinShade;

        // 身体/衣服 (y: 18-25)
        for (let y = 18; y <= 25; y++) {
            for (let x = 5; x <= 12; x++) p[y * W + x] = c.shirt;
        }
        for (let y = 20; y <= 25; y++) {
            p[y * W + 5] = c.shirtShade;
            p[y * W + 12] = c.shirtShade;
        }
        // 衣领
        p[18 * W + 7] = c.shirtShade;
        p[18 * W + 8] = c.shirtDark;
        p[18 * W + 9] = c.shirtDark;
        p[18 * W + 10] = c.shirtShade;

        // 手臂
        p[19 * W + 4] = c.shirt;
        p[20 * W + 4] = c.shirt;
        p[21 * W + 4] = c.skin;
        p[19 * W + 13] = c.shirt;
        p[20 * W + 13] = c.shirt;
        p[21 * W + 13] = c.skin;

        // 腿/裤子 (y: 26-30)
        const leftLegX = 6, rightLegX = 9;
        for (let y = 26; y <= 30; y++) {
            p[y * W + leftLegX] = c.pants;
            p[y * W + leftLegX + 1] = c.pants;
            p[y * W + leftLegX + 2] = c.pantsShade;
            p[y * W + rightLegX] = c.pants;
            p[y * W + rightLegX + 1] = c.pants;
            p[y * W + rightLegX + 2] = c.pantsShade;
        }

        if (legOffset !== 0) {
            const offsetLeg = legOffset < 0 ? leftLegX : rightLegX;
            for (let y = 29; y <= 30; y++) {
                if (p[y * W + offsetLeg]) {
                    p[y * W + offsetLeg + legOffset] = p[y * W + offsetLeg];
                    p[y * W + offsetLeg] = null;
                    p[y * W + offsetLeg + 1 + legOffset] = p[y * W + offsetLeg + 1];
                    p[y * W + offsetLeg + 1] = null;
                }
            }
        }

        // 鞋子 (y: 31-32)
        p[31 * W + leftLegX] = c.shoes;
        p[31 * W + leftLegX + 1] = c.shoes;
        p[31 * W + leftLegX + 2] = c.shoes;
        p[31 * W + rightLegX] = c.shoes;
        p[31 * W + rightLegX + 1] = c.shoes;
        p[31 * W + rightLegX + 2] = c.shoes;
        p[32 * W + leftLegX] = c.shoes;
        p[32 * W + leftLegX + 1] = c.shoes;
        p[32 * W + rightLegX] = c.shoes;
        p[32 * W + rightLegX + 1] = c.shoes;

        if (legOffset !== 0) {
            const offsetLeg = legOffset < 0 ? leftLegX : rightLegX;
            p[32 * W + offsetLeg + legOffset] = c.shoes;
            p[32 * W + offsetLeg + 1 + legOffset] = c.shoes;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 撑伞NPC精灵 (18x36, 含伞) ==========
    function createLumentNPCSprite(frame = 0, lumentColor = 'red', shirtColor = null) {
        const sColor = shirtColor || (lumentColor === 'gold' ? '#4a3a2a' : '#3a2a4a');
        const key = `npc_lument_${frame}_${lumentColor}_${sColor}`;
        if (cache[key]) return cache[key];

        const W = 18, H = 36;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const umbColor = lumentColor === 'gold' ? c.lumentGold : c.lument;
        const umbShade = lumentColor === 'gold' ? c.lumentGoldDark : c.lumentShade;
        const umbLight = lumentColor === 'gold' ? '#eac070' : c.lumentLight;

        // ========== 雨伞 (y: 0-8) - 在头顶上方 ==========
        // 伞顶弧形 - 更宽更高
        const lumentShape = [
            [8, 0],
            [7, 1], [8, 1], [9, 1],
            [6, 2], [7, 2], [8, 2], [9, 2], [10, 2],
            [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3], [11, 3],
            [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4], [11, 4], [12, 4],
            [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5], [11, 5], [12, 5], [13, 5],
            [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6],
        ];
        for (const [x, y] of lumentShape) {
            p[y * W + x] = umbColor;
        }
        // 伞高光
        p[4 * W + 5] = umbLight;
        p[4 * W + 6] = umbLight;
        p[5 * W + 4] = umbLight;
        p[5 * W + 5] = umbLight;
        p[6 * W + 4] = umbLight;
        // 伞阴影
        p[5 * W + 11] = umbShade;
        p[5 * W + 12] = umbShade;
        p[6 * W + 12] = umbShade;
        p[6 * W + 13] = umbShade;
        p[6 * W + 14] = umbShade;
        // 伞底边
        for (let x = 3; x <= 14; x++) p[7 * W + x] = umbShade;

        // 伞柄 (y: 8-10) - 连接伞和身体
        p[8 * W + 8] = '#5a3a1a';
        p[9 * W + 8] = '#5a3a1a';

        // ========== NPC身体 (y: 11-33) ==========
        // 头 (y: 11-16)
        for (let x = 6; x <= 11; x++) p[11 * W + x] = c.hair;
        for (let x = 5; x <= 12; x++) p[12 * W + x] = c.hair;
        for (let y = 13; y <= 16; y++) {
            for (let x = 6; x <= 11; x++) p[y * W + x] = c.skin;
        }
        p[13 * W + 5] = c.hair; p[13 * W + 12] = c.hair;
        p[14 * W + 5] = c.hair; p[14 * W + 12] = c.hair;
        // 眼
        p[15 * W + 7] = c.hair;
        p[15 * W + 10] = c.hair;
        // 脸阴影
        for (let x = 6; x <= 11; x++) p[16 * W + x] = c.skinShade;

        // 身体 (y: 17-25)
        const bodyColor = sColor;
        const bodyShade = adjustColor(sColor, -30);
        for (let y = 17; y <= 25; y++) {
            for (let x = 5; x <= 12; x++) p[y * W + x] = bodyColor;
        }
        for (let y = 19; y <= 25; y++) {
            p[y * W + 5] = bodyShade;
            p[y * W + 12] = bodyShade;
        }
        // 领带
        for (let y = 18; y <= 22; y++) {
            p[y * W + 8] = '#8a2a2a';
            p[y * W + 9] = '#8a2a2a';
        }

        // 腿 (y: 26-31)
        const f = frame % 4;
        const legOffset = f === 1 ? -1 : (f === 3 ? 1 : 0);
        for (let y = 26; y <= 31; y++) {
            p[y * W + 6] = c.pants;
            p[y * W + 7] = c.pants;
            p[y * W + 9] = c.pants;
            p[y * W + 10] = c.pants;
        }
        // 鞋 (y: 32-33)
        p[32 * W + 6] = c.shoes;
        p[32 * W + 7] = c.shoes;
        p[32 * W + 9] = c.shoes;
        p[32 * W + 10] = c.shoes;
        p[33 * W + 6] = c.shoes;
        p[33 * W + 7] = c.shoes;
        p[33 * W + 9] = c.shoes;
        p[33 * W + 10] = c.shoes;

        if (legOffset !== 0) {
            const legX = legOffset < 0 ? 6 : 9;
            p[33 * W + legX + legOffset] = c.shoes;
            p[33 * W + legX + 1 + legOffset] = c.shoes;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 普通NPC精灵 (14x22, 淋雨姿态) ==========
    function createNormalNPCSprite(frame = 0, shirtColor = null) {
        const sColor = shirtColor || '#4a4a3a';
        const key = `npc_normal_${frame}_${sColor}`;
        if (cache[key]) return cache[key];

        const W = 14, H = 22;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const f = frame % 4;
        const legOffset = f === 1 ? -1 : (f === 3 ? 1 : 0);

        // 头 - 戴帽子或头巾
        const hatColor = '#3a3a4a';
        for (let x = 3; x <= 10; x++) p[x] = hatColor;
        for (let x = 2; x <= 11; x++) p[W + x] = hatColor;
        // 脸
        for (let y = 2; y <= 5; y++) {
            for (let x = 3; x <= 10; x++) p[y * W + x] = c.skin;
        }
        p[2 * W + 2] = hatColor; p[2 * W + 11] = hatColor;
        p[3 * W + 2] = hatColor; p[3 * W + 11] = hatColor;
        // 眼 - 悲伤表情
        p[4 * W + 5] = c.hair;
        p[4 * W + 8] = c.hair;

        // 身体 - 使用传入的衣服颜色
        const oldShirt = sColor;
        const oldShirtShade = adjustColor(sColor, -30);
        for (let y = 7; y <= 13; y++) {
            for (let x = 3; x <= 10; x++) p[y * W + x] = oldShirt;
        }
        for (let y = 9; y <= 13; y++) {
            p[y * W + 3] = oldShirtShade;
            p[y * W + 10] = oldShirtShade;
        }
        // 手臂 - 抱紧自己（冷/湿）
        p[8 * W + 2] = oldShirt;
        p[9 * W + 2] = oldShirt;
        p[10 * W + 2] = c.skin;
        p[8 * W + 11] = oldShirt;
        p[9 * W + 11] = oldShirt;
        p[10 * W + 11] = c.skin;

        // 腿
        for (let y = 14; y <= 18; y++) {
            p[y * W + 4] = c.pants;
            p[y * W + 5] = c.pants;
            p[y * W + 7] = c.pants;
            p[y * W + 8] = c.pants;
        }
        // 鞋
        p[19 * W + 4] = c.shoes;
        p[19 * W + 5] = c.shoes;
        p[19 * W + 7] = c.shoes;
        p[19 * W + 8] = c.shoes;

        if (legOffset !== 0) {
            const legX = legOffset < 0 ? 4 : 7;
            p[19 * W + legX + legOffset] = c.shoes;
            p[19 * W + legX + 1 + legOffset] = c.shoes;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 倒地NPC精灵（老头专用） ==========
    function createFallenNPCSprite() {
        const key = 'npc_fallen';
        if (cache[key]) return cache[key];

        const W = 24, H = 16;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        // 地面阴影
        for (let x = 2; x <= 21; x++) {
            p[14 * W + x] = 'rgba(0,0,0,0.35)';
            p[15 * W + x] = 'rgba(0,0,0,0.2)';
        }

        // 身体颜色（老旧大衣）
        const coat = '#4a3a2a';
        const coatShade = '#2a1a0a';
        const pants = '#2a2a3a';
        const shoes = '#1a1a1a';
        const skin = c.skin;
        const hair = c.hair;

        // 头部（左侧，倒在地上）
        for (let x = 3; x <= 8; x++) p[4 * W + x] = hair;
        for (let x = 2; x <= 9; x++) p[5 * W + x] = hair;
        for (let y = 6; y <= 9; y++) {
            for (let x = 3; x <= 8; x++) p[y * W + x] = skin;
        }
        p[6 * W + 2] = hair; p[6 * W + 9] = hair;
        p[7 * W + 2] = hair; p[7 * W + 9] = hair;
        // 眼睛（闭着）
        p[7 * W + 4] = c.hair; p[7 * W + 7] = c.hair;
        // 嘴巴（痛苦表情）
        p[8 * W + 5] = '#8a4a4a'; p[8 * W + 6] = '#8a4a4a';

        // 身体（横躺，大衣展开）
        for (let y = 8; y <= 12; y++) {
            for (let x = 8; x <= 18; x++) p[y * W + x] = coat;
        }
        // 大衣阴影
        for (let y = 10; y <= 12; y++) {
            p[y * W + 8] = coatShade;
        }
        for (let x = 8; x <= 18; x++) p[12 * W + x] = coatShade;

        // 手臂（伸出求救）
        for (let y = 7; y <= 9; y++) {
            p[y * W + 10] = coat;
            p[y * W + 11] = coat;
        }
        p[6 * W + 10] = skin;  // 手
        p[6 * W + 11] = skin;
        p[7 * W + 12] = skin;  // 手指
        p[7 * W + 13] = skin;

        // 腿（弯曲）
        for (let y = 10; y <= 13; y++) {
            p[y * W + 16] = pants;
            p[y * W + 17] = pants;
        }
        // 鞋子
        p[13 * W + 15] = shoes;
        p[13 * W + 16] = shoes;

        // 散落的物品（拐杖）
        p[10 * W + 20] = '#3a2a1a';
        p[10 * W + 21] = '#3a2a1a';
        p[11 * W + 21] = '#3a2a1a';
        p[11 * W + 22] = '#3a2a1a';

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 建筑物精灵 ==========
    function createBuilding(width, height, theme = 'school') {
        const key = `building_${width}_${height}_${theme}`;
        if (cache[key]) return cache[key];

        const W = width, H = height;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        let wallColor, wallShade, roofColor, windowColor;

        switch (theme) {
            case 'school':
                wallColor = '#4a3e34'; wallShade = '#2e2620'; roofColor = '#2a1a10';
                windowColor = '#1a2a38'; break;
            case 'career':
                wallColor = '#2e3a44'; wallShade = '#1a242e'; roofColor = '#1a1a24';
                windowColor = '#1a3040'; break;
            case 'life':
                wallColor = '#3e342a'; wallShade = '#242018'; roofColor = '#3a1e10';
                windowColor = '#1a2a38'; break;
            case 'finale':
                wallColor = '#1e1e2a'; wallShade = '#0e0e18'; roofColor = '#080810';
                windowColor = '#2a3a4a'; break;
        }

        // 屋顶 (y: 0-2)
        for (let x = 0; x < W; x++) {
            p[x] = roofColor;
            p[W + x] = roofColor;
        }
        // 屋顶细节
        for (let x = 0; x < W; x += 4) {
            p[x] = c.brickShade;
            p[W + x] = c.brickShade;
        }

        // 墙面
        for (let y = 2; y < H; y++) {
            for (let x = 0; x < W; x++) {
                p[y * W + x] = wallColor;
            }
        }

        // 砖块纹理
        for (let y = 3; y < H; y += 4) {
            for (let x = 0; x < W; x++) {
                if (y < H) p[y * W + x] = wallShade;
            }
            // 错位砖块线
            const offset = (y / 4) % 2 === 0 ? 0 : 4;
            for (let x = offset; x < W; x += 8) {
                if (y - 1 >= 2 && y - 1 < H) p[(y - 1) * W + x] = wallShade;
            }
        }

        // 窗户 - 规则排列
        const winW = 4, winH = 5;
        const winSpacingX = 8, winSpacingY = 10;
        const winStartY = 5;

        for (let wy = winStartY; wy + winH < H - 3; wy += winSpacingY) {
            for (let wx = 3; wx + winW < W - 2; wx += winSpacingX) {
                // 窗框
                for (let y = wy; y < wy + winH; y++) {
                    for (let x = wx; x < wx + winW; x++) {
                        if (y >= 2 && y < H && x < W)
                            p[y * W + x] = windowColor;
                    }
                }
                // 窗户高光
                p[wy * W + wx] = c.windowLight;
                p[wy * W + wx + 1] = c.windowLight;
                p[(wy + 1) * W + wx] = c.windowLight;
                // 窗户暗角
                p[(wy + winH - 1) * W + wx + winW - 1] = c.windowDark;
                p[(wy + winH - 1) * W + wx + winW - 2] = c.windowDark;
                // 窗户分格
                p[(wy + 2) * W + wx + 1] = wallColor;
                p[(wy + 2) * W + wx + 2] = wallColor;
            }
        }

        // 门
        const doorW = 5, doorH = 8;
        const doorX = Math.floor(W / 2) - 2;
        const doorY = H - doorH - 1;
        for (let y = doorY; y < doorY + doorH; y++) {
            for (let x = doorX; x < doorX + doorW; x++) {
                if (y >= 0 && y < H && x >= 0 && x < W)
                    p[y * W + x] = c.door;
            }
        }
        // 门框
        for (let y = doorY; y < doorY + doorH; y++) {
            p[y * W + doorX] = c.doorShade;
            p[y * W + doorX + doorW - 1] = c.doorShade;
        }
        p[doorY * W + doorX] = c.doorShade;
        for (let x = doorX; x < doorX + doorW; x++) p[doorY * W + x] = c.doorShade;
        // 门把手
        p[(doorY + 4) * W + doorX + 3] = '#caa050';

        // 底部阴影
        for (let x = 0; x < W; x++) {
            p[(H - 1) * W + x] = c.brickShade;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 地面瓦片 ==========
    function createGroundTile(type = 'road') {
        const key = `ground_${type}`;
        if (cache[key]) return cache[key];

        const W = 16, H = 16;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        let baseColor, shadeColor, lightColor;

        if (type === 'road') {
            baseColor = c.ground; shadeColor = c.groundShade; lightColor = c.groundLight;
        } else if (type === 'sidewalk') {
            baseColor = c.sidewalk; shadeColor = c.sidewalkShade; lightColor = '#6a6a6a';
        } else {
            baseColor = c.grass; shadeColor = c.grassDark; lightColor = '#4a6a3a';
        }

        // 基础填充
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                p[y * W + x] = baseColor;
            }
        }

        // 随机纹理
        const seed = type.charCodeAt(0);
        for (let i = 0; i < 12; i++) {
            const x = (seed * (i + 1) * 7) % W;
            const y = (seed * (i + 1) * 13) % H;
            p[y * W + x] = i % 3 === 0 ? shadeColor : lightColor;
        }

        if (type === 'sidewalk') {
            // 砖块缝隙
            for (let y = 0; y < H; y++) p[y * W + 7] = shadeColor;
            for (let y = 0; y < H; y++) p[y * W + 8] = shadeColor;
            for (let x = 0; x < W; x++) p[7 * W + x] = shadeColor;
            for (let x = 0; x < W; x++) p[8 * W + x] = shadeColor;
        }

        if (type === 'road') {
            // 道路标线
            for (let x = 6; x <= 9; x++) p[7 * W + x] = c.roadLine;
            for (let x = 6; x <= 9; x++) p[8 * W + x] = c.roadLine;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 树木 ==========
    function createTreeSprite(size = 'medium') {
        const key = `tree_${size}`;
        if (cache[key]) return cache[key];

        const W = 12, H = 20;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        // 树干
        for (let y = 14; y < H; y++) {
            p[y * W + 5] = c.trunk;
            p[y * W + 6] = c.trunk;
            p[y * W + 7] = c.trunkShade;
        }

        // 树冠 - 圆形
        const treeShape = [
            [4, 0], [5, 0], [6, 0], [7, 0],
            [3, 1], [4, 1], [5, 1], [6, 1], [7, 1], [8, 1],
            [2, 2], [3, 2], [4, 2], [5, 2], [6, 2], [7, 2], [8, 2], [9, 2],
            [1, 3], [2, 3], [3, 3], [4, 3], [5, 3], [6, 3], [7, 3], [8, 3], [9, 3], [10, 3],
            [1, 4], [2, 4], [3, 4], [4, 4], [5, 4], [6, 4], [7, 4], [8, 4], [9, 4], [10, 4],
            [1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [7, 5], [8, 5], [9, 5], [10, 5],
            [2, 6], [3, 6], [4, 6], [5, 6], [6, 6], [7, 6], [8, 6], [9, 6],
            [2, 7], [3, 7], [4, 7], [5, 7], [6, 7], [7, 7], [8, 7], [9, 7],
            [3, 8], [4, 8], [5, 8], [6, 8], [7, 8], [8, 8],
            [4, 9], [5, 9], [6, 9], [7, 9],
            [4, 10], [5, 10], [6, 10], [7, 10],
            [5, 11], [6, 11],
            [5, 12], [6, 12],
            [5, 13], [6, 13],
        ];

        for (const [x, y] of treeShape) {
            p[y * W + x] = c.tree;
        }

        // 高光
        p[2 * W + 3] = c.treeLight;
        p[3 * W + 2] = c.treeLight;
        p[4 * W + 2] = c.treeLight;
        p[3 * W + 4] = c.treeLight;
        p[4 * W + 4] = c.treeLight;

        // 阴影
        p[6 * W + 8] = c.treeShade;
        p[7 * W + 9] = c.treeShade;
        p[8 * W + 8] = c.treeShade;
        p[5 * W + 9] = c.treeShade;
        p[6 * W + 9] = c.treeShade;

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 路灯 ==========
    function createStreetLamp() {
        const key = 'streetlamp';
        if (cache[key]) return cache[key];

        const W = 6, H = 24;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        // 灯杆
        for (let y = 2; y < H; y++) {
            p[y * W + 2] = '#3a3a3a';
            p[y * W + 3] = '#3a3a3a';
        }
        // 灯顶
        p[0] = '#5a5a5a'; p[1] = '#5a5a5a'; p[2] = '#5a5a5a'; p[3] = '#5a5a5a'; p[4] = '#5a5a5a';
        p[W] = '#4a4a4a'; p[W + 4] = '#4a4a4a';
        // 灯光
        p[W + 1] = '#ffcc44';
        p[W + 2] = '#ffee88';
        p[W + 3] = '#ffcc44';
        p[2 * W + 1] = '#aa8822';
        p[2 * W + 2] = '#ccaa33';
        p[2 * W + 3] = '#aa8822';
        // 底座
        p[(H - 1) * W + 1] = '#2a2a2a';
        p[(H - 1) * W + 2] = '#2a2a2a';
        p[(H - 1) * W + 3] = '#2a2a2a';
        p[(H - 1) * W + 4] = '#2a2a2a';

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 遮雨棚 ==========
    function createAwning(color = 'red') {
        const key = `awning_${color}`;
        if (cache[key]) return cache[key];

        const W = 20, H = 6;
        const p = new Array(W * H).fill(null);

        const colors = color === 'red' ?
            ['#8a2a4a', '#6a1a3a', '#aa3a5a'] :
            color === 'blue' ?
            ['#2a4a8a', '#1a3a7a', '#3a6aaa'] :
            ['#2a7a4a', '#1a5a3a', '#3a8a5a'];

        // 条纹遮雨棚
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                p[y * W + x] = (Math.floor(x / 3) % 2 === 0) ? colors[0] : colors[2];
            }
        }
        // 底部边缘
        for (let x = 0; x < W; x++) {
            p[(H - 1) * W + x] = colors[1];
        }
        // 支撑杆
        p[0] = '#3a3a3a';
        p[(W - 1)] = '#3a3a3a';

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 人物头像（对话框用） ==========
    // 返回引擎纹理 ID；用 drawTextureToCanvas(texId, ctx, ...) 绘制到
    // 原生 #portrait-canvas 头像画布上。
    function createPortrait(character) {
        const key = `portrait_${character}`;
        if (cache[key]) return cache[key];

        const W = 32, H = 32;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        if (character === 'player') {
            // 玩家头像
            // 头发
            for (let x = 8; x <= 23; x++) p[x] = c.hair;
            for (let x = 6; x <= 25; x++) p[W + x] = c.hair;
            for (let x = 5; x <= 26; x++) p[2 * W + x] = c.hair;
            // 脸
            for (let y = 3; y <= 18; y++) {
                for (let x = 7; x <= 24; x++) {
                    p[y * W + x] = c.skin;
                }
            }
            // 头发两侧
            for (let y = 3; y <= 8; y++) {
                p[y * W + 6] = c.hair;
                p[y * W + 25] = c.hair;
            }
            // 眼睛
            p[10 * W + 11] = c.hair;
            p[10 * W + 12] = c.hair;
            p[10 * W + 19] = c.hair;
            p[10 * W + 20] = c.hair;
            // 眉毛
            p[8 * W + 10] = c.hair;
            p[8 * W + 11] = c.hair;
            p[8 * W + 12] = c.hair;
            p[8 * W + 19] = c.hair;
            p[8 * W + 20] = c.hair;
            p[8 * W + 21] = c.hair;
            // 鼻子
            p[13 * W + 15] = c.skinShade;
            p[14 * W + 15] = c.skinShade;
            p[14 * W + 16] = c.skinShade;
            // 嘴 - 微微苦笑
            p[16 * W + 13] = c.skinDark;
            p[16 * W + 14] = c.skinDark;
            p[16 * W + 15] = c.skinDark;
            p[16 * W + 16] = c.skinDark;
            p[16 * W + 17] = c.skinDark;
            // 脸颊阴影
            for (let x = 7; x <= 9; x++) p[15 * W + x] = c.skinShade;
            for (let x = 22; x <= 24; x++) p[15 * W + x] = c.skinShade;
            // 衣领
            for (let x = 8; x <= 23; x++) p[19 * W + x] = c.shirt;
            for (let x = 6; x <= 25; x++) {
                p[20 * W + x] = c.shirt;
                p[21 * W + x] = c.shirt;
                p[22 * W + x] = c.shirtShade;
                p[23 * W + x] = c.shirtShade;
            }
            for (let y = 24; y < H; y++) {
                for (let x = 4; x <= 27; x++) p[y * W + x] = c.shirtShade;
            }
        } else if (character === 'lument_npc') {
            // 撑伞NPC - 傲慢表情
            // 头发（梳整齐的）
            for (let x = 8; x <= 23; x++) p[x] = '#1a1a1a';
            for (let x = 6; x <= 25; x++) p[W + x] = '#1a1a1a';
            for (let x = 5; x <= 26; x++) p[2 * W + x] = '#1a1a1a';
            // 脸
            for (let y = 3; y <= 18; y++) {
                for (let x = 7; x <= 24; x++) p[y * W + x] = c.skin;
            }
            // 眼睛 - 向下看（俯视）
            p[10 * W + 12] = '#1a1a1a';
            p[10 * W + 19] = '#1a1a1a';
            // 眉毛 - 上扬（傲慢）
            p[8 * W + 11] = '#1a1a1a';
            p[8 * W + 12] = '#1a1a1a';
            p[9 * W + 10] = '#1a1a1a';
            p[8 * W + 20] = '#1a1a1a';
            p[8 * W + 21] = '#1a1a1a';
            p[9 * W + 22] = '#1a1a1a';
            // 嘴 - 嘲讽微笑
            p[16 * W + 13] = c.skinDark;
            p[16 * W + 14] = c.skinDark;
            p[16 * W + 15] = c.skinDark;
            p[16 * W + 16] = c.skinDark;
            p[16 * W + 17] = c.skinDark;
            p[17 * W + 14] = c.skinDark;
            p[17 * W + 15] = c.skinDark;
            p[17 * W + 16] = c.skinDark;
            // 西装
            for (let x = 6; x <= 25; x++) {
                p[20 * W + x] = '#2a2a3a';
                p[21 * W + x] = '#2a2a3a';
                p[22 * W + x] = '#1a1a2a';
                p[23 * W + x] = '#1a1a2a';
            }
            for (let y = 24; y < H; y++) {
                for (let x = 4; x <= 27; x++) p[y * W + x] = '#1a1a2a';
            }
            // 领带
            for (let y = 20; y < H; y++) {
                p[y * W + 15] = '#8a2a2a';
                p[y * W + 16] = '#8a2a2a';
            }
        } else if (character === 'teacher') {
            // 老师
            for (let x = 8; x <= 23; x++) p[x] = '#5a3a1a';
            for (let x = 6; x <= 25; x++) p[W + x] = '#5a3a1a';
            for (let x = 5; x <= 26; x++) p[2 * W + x] = '#5a3a1a';
            for (let y = 3; y <= 18; y++) {
                for (let x = 7; x <= 24; x++) p[y * W + x] = c.skin;
            }
            // 眼镜
            for (let x = 10; x <= 14; x++) p[10 * W + x] = '#1a1a1a';
            for (let x = 17; x <= 21; x++) p[10 * W + x] = '#1a1a1a';
            p[10 * W + 11] = c.skin;
            p[10 * W + 12] = c.skin;
            p[10 * W + 13] = c.skin;
            p[10 * W + 18] = c.skin;
            p[10 * W + 19] = c.skin;
            p[10 * W + 20] = c.skin;
            p[10 * W + 15] = '#1a1a1a';
            p[10 * W + 16] = '#1a1a1a';
            // 嘴 - 严肃
            p[16 * W + 12] = c.skinDark;
            p[16 * W + 13] = c.skinDark;
            p[16 * W + 14] = c.skinDark;
            p[16 * W + 15] = c.skinDark;
            p[16 * W + 16] = c.skinDark;
            p[16 * W + 17] = c.skinDark;
            p[16 * W + 18] = c.skinDark;
            // 西装
            for (let x = 6; x <= 25; x++) {
                p[20 * W + x] = '#3a3a2a';
                p[21 * W + x] = '#3a3a2a';
            }
            for (let y = 22; y < H; y++) {
                for (let x = 4; x <= 27; x++) p[y * W + x] = '#2a2a1a';
            }
        } else if (character === 'narrator' || character === 'system') {
            // 旁白/系统 - 深色背景+文字符号
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    p[y * W + x] = '#0a0a1a';
                }
            }
            // 问号图案
            const qMark = [
                [11,5],[12,5],[13,5],[14,5],[15,5],[16,5],
                [17,6],[18,7],[18,8],[17,9],[16,10],[15,11],[14,12],
                [14,14],[14,15],
                [14,18],[14,19]
            ];
            for (const [x, y] of qMark) {
                p[y * W + x] = '#4a5a7a';
            }
        } else if (character === 'boss') {
            // 老板
            for (let x = 7; x <= 24; x++) p[x] = '#1a1a1a';
            for (let x = 5; x <= 26; x++) p[W + x] = '#1a1a1a';
            for (let x = 4; x <= 27; x++) p[2 * W + x] = '#1a1a1a';
            for (let y = 3; y <= 18; y++) {
                for (let x = 7; x <= 24; x++) p[y * W + x] = c.skin;
            }
            // 秃顶高光
            for (let x = 12; x <= 19; x++) p[3 * W + x] = c.skinShade;
            // 眼睛 - 锐利
            p[9 * W + 11] = '#1a1a1a';
            p[9 * W + 12] = '#1a1a1a';
            p[9 * W + 19] = '#1a1a1a';
            p[9 * W + 20] = '#1a1a1a';
            p[10 * W + 11] = '#1a1a1a';
            p[10 * W + 12] = '#1a1a1a';
            p[10 * W + 19] = '#1a1a1a';
            p[10 * W + 20] = '#1a1a1a';
            // 眉毛 - 皱眉
            for (let x = 10; x <= 14; x++) p[7 * W + x] = '#1a1a1a';
            for (let x = 17; x <= 21; x++) p[7 * W + x] = '#1a1a1a';
            p[8 * W + 10] = '#1a1a1a';
            p[8 * W + 21] = '#1a1a1a';
            // 嘴 - 冷笑
            p[16 * W + 12] = c.skinDark;
            p[16 * W + 13] = c.skinDark;
            p[16 * W + 14] = c.skinDark;
            p[16 * W + 15] = c.skinDark;
            p[16 * W + 16] = c.skinDark;
            p[16 * W + 17] = c.skinDark;
            p[16 * W + 18] = c.skinDark;
            // 西装
            for (let x = 5; x <= 26; x++) {
                p[20 * W + x] = '#1a1a1a';
                p[21 * W + x] = '#1a1a1a';
            }
            for (let y = 22; y < H; y++) {
                for (let x = 3; x <= 28; x++) p[y * W + x] = '#0a0a0a';
            }
            // 金领带
            for (let y = 20; y < H; y++) {
                p[y * W + 15] = '#caa050';
                p[y * W + 16] = '#caa050';
            }
        } else {
            // 默认/路人NPC
            for (let x = 8; x <= 23; x++) p[x] = '#3a3a4a';
            for (let x = 6; x <= 25; x++) p[W + x] = '#3a3a4a';
            for (let x = 5; x <= 26; x++) p[2 * W + x] = '#3a3a4a';
            for (let y = 3; y <= 18; y++) {
                for (let x = 7; x <= 24; x++) p[y * W + x] = c.skin;
            }
            p[10 * W + 12] = c.hair;
            p[10 * W + 19] = c.hair;
            p[16 * W + 13] = c.skinDark;
            p[16 * W + 14] = c.skinDark;
            p[16 * W + 15] = c.skinDark;
            p[16 * W + 16] = c.skinDark;
            p[16 * W + 17] = c.skinDark;
            for (let x = 6; x <= 25; x++) {
                p[20 * W + x] = '#4a4a3a';
                p[21 * W + x] = '#4a4a3a';
            }
            for (let y = 22; y < H; y++) {
                for (let x = 4; x <= 27; x++) p[y * W + x] = '#3a3a2a';
            }
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== Buff道具精灵 ==========
    function createBuffItem(type) {
        const key = `buff_${type}`;
        if (cache[key]) return cache[key];

        const W = 10, H = 10;
        const p = new Array(W * H).fill(null);

        if (type === 'book') {
            // 书本
            const c = '#8a4a2a';
            for (let y = 1; y <= 8; y++) {
                for (let x = 1; x <= 8; x++) {
                    p[y * W + x] = c;
                }
            }
            for (let y = 1; y <= 8; y++) p[y * W + 1] = '#6a3a1a';
            for (let x = 1; x <= 8; x++) p[W + x] = '#aa6a4a';
            p[2 * W + 3] = '#eee';
            p[2 * W + 4] = '#eee';
            p[2 * W + 5] = '#eee';
            p[2 * W + 6] = '#eee';
        } else if (type === 'medal') {
            // 奖章
            for (let y = 2; y <= 6; y++) {
                for (let x = 2; x <= 7; x++) {
                    p[y * W + x] = '#caa050';
                }
            }
            p[3 * W + 3] = '#eac070';
            p[3 * W + 4] = '#eac070';
            p[4 * W + 3] = '#eac070';
            p[8 * W + 4] = '#8a7030';
            p[9 * W + 4] = '#8a7030';
            p[8 * W + 5] = '#8a7030';
            p[9 * W + 5] = '#8a7030';
        } else if (type === 'heart') {
            // 心
            p[2 * W + 3] = '#cc4444';
            p[2 * W + 4] = '#cc4444';
            p[2 * W + 5] = '#cc4444';
            p[2 * W + 6] = '#cc4444';
            p[3 * W + 2] = '#cc4444';
            p[3 * W + 3] = '#ff6666';
            p[3 * W + 4] = '#ff6666';
            p[3 * W + 5] = '#ff6666';
            p[3 * W + 6] = '#ff6666';
            p[3 * W + 7] = '#cc4444';
            p[4 * W + 2] = '#cc4444';
            p[4 * W + 3] = '#ff6666';
            p[4 * W + 4] = '#ff6666';
            p[4 * W + 5] = '#ff6666';
            p[4 * W + 6] = '#ff6666';
            p[4 * W + 7] = '#cc4444';
            p[5 * W + 3] = '#cc4444';
            p[5 * W + 4] = '#ff6666';
            p[5 * W + 5] = '#ff6666';
            p[5 * W + 6] = '#cc4444';
            p[6 * W + 4] = '#cc4444';
            p[6 * W + 5] = '#cc4444';
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 储物柜（学校走廊） ==========
    function createLockerSprite() {
        const key = 'locker';
        if (cache[key]) return cache[key];

        const W = 12, H = 32;
        const p = new Array(W * H).fill(null);

        const body = '#2a2a3e';
        const shade = '#1a1a2e';
        const light = '#3a3a4e';
        const handle = '#6a6a7e';

        // 主体填充
        for (let y = 1; y < H - 1; y++) {
            for (let x = 1; x < W - 1; x++) {
                p[y * W + x] = body;
            }
        }
        // 两侧及顶底边框
        for (let y = 0; y < H; y++) {
            p[y * W] = shade;
            p[y * W + W - 1] = shade;
        }
        for (let x = 0; x < W; x++) {
            p[x] = shade;
            p[(H - 1) * W + x] = shade;
        }

        // 三个柜门
        const doors = [1, 12, 23];
        for (const startY of doors) {
            // 门分隔线
            for (let x = 1; x < W - 1; x++) {
                p[startY * W + x] = shade;
            }
            // 通风口
            for (let x = 3; x <= 8; x++) {
                p[(startY + 2) * W + x] = shade;
                p[(startY + 3) * W + x] = shade;
            }
            // 门把手
            const hy = startY + 6;
            p[hy * W + 9] = handle;
            p[hy * W + 10] = handle;
            p[(hy + 1) * W + 9] = handle;
            p[(hy + 1) * W + 10] = handle;
            // 左侧高光
            p[(startY + 1) * W + 1] = light;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 教室门 ==========
    function createClassroomDoor() {
        const key = 'classroom_door';
        if (cache[key]) return cache[key];

        const W = 14, H = 32;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const wood = c.door;            // #2a1e10
        const woodShade = c.doorShade;  // #1a0e06
        const woodLight = '#3a2e20';
        const glass = c.window;         // #1a2a38
        const glassLight = c.windowLight; // #2a4a58
        const handle = '#caa050';

        // 门主体
        for (let y = 0; y < H; y++) {
            for (let x = 1; x < W - 1; x++) {
                p[y * W + x] = wood;
            }
        }
        // 门框
        for (let y = 0; y < H; y++) {
            p[y * W] = woodShade;
            p[y * W + W - 1] = woodShade;
        }
        for (let x = 0; x < W; x++) {
            p[x] = woodShade;
            p[(H - 1) * W + x] = woodShade;
        }

        // 窗户（上部）
        const winX = 3, winY = 4, winW = 8, winH = 6;
        for (let y = winY; y < winY + winH; y++) {
            for (let x = winX; x < winX + winW; x++) {
                p[y * W + x] = glass;
            }
        }
        // 窗户高光
        p[winY * W + winX] = glassLight;
        p[winY * W + winX + 1] = glassLight;
        p[(winY + 1) * W + winX] = glassLight;
        // 窗户十字框
        for (let y = winY; y < winY + winH; y++) {
            p[y * W + winX + 3] = woodShade;
            p[y * W + winX + 4] = woodShade;
        }
        for (let x = winX; x < winX + winW; x++) {
            p[(winY + 3) * W + x] = woodShade;
        }

        // 门板嵌板（中部）
        for (let x = 2; x < W - 2; x++) {
            p[15 * W + x] = woodShade;
            p[22 * W + x] = woodShade;
        }
        for (let y = 16; y < 22; y++) {
            p[y * W + 2] = woodShade;
            p[y * W + W - 3] = woodShade;
        }
        p[17 * W + 3] = woodLight;

        // 门把手
        p[24 * W + 10] = handle;
        p[24 * W + 11] = handle;
        p[25 * W + 10] = handle;
        p[25 * W + 11] = handle;

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 办公桌 ==========
    function createDeskSprite() {
        const key = 'desk';
        if (cache[key]) return cache[key];

        const W = 24, H = 18;
        const p = new Array(W * H).fill(null);

        const top = '#3a3a2e';
        const shade = '#2a2a1e';
        const light = '#4a4a4e';
        const legShade = '#1a1a12';

        // 桌面顶部边缘
        for (let x = 0; x < W; x++) {
            p[2 * W + x] = shade;
        }
        // 桌面
        for (let y = 3; y <= 5; y++) {
            for (let x = 0; x < W; x++) {
                p[y * W + x] = top;
            }
        }
        // 桌面高光
        for (let x = 1; x < W - 1; x++) {
            p[3 * W + x] = light;
        }
        // 桌面底部阴影
        for (let x = 0; x < W; x++) {
            p[6 * W + x] = shade;
        }

        // 桌腿
        for (let y = 7; y < H; y++) {
            p[y * W + 1] = shade;
            p[y * W + 2] = legShade;
            p[y * W + W - 3] = legShade;
            p[y * W + W - 2] = shade;
        }

        // 桌下横档
        for (let x = 2; x < W - 2; x++) {
            p[13 * W + x] = shade;
            p[14 * W + x] = legShade;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 电脑显示器 ==========
    function createComputerSprite() {
        const key = 'computer';
        if (cache[key]) return cache[key];

        const W = 16, H = 14;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const body = '#2a2a3e';
        const bodyShade = '#1a1a2e';
        const screen = '#1a1a2e';
        const glow = c.windowLight;   // #2a4a58
        const glowLight = '#3a5a68';
        const stand = '#1a1a2e';

        // 显示器边框
        for (let y = 0; y <= 8; y++) {
            for (let x = 2; x <= 13; x++) {
                p[y * W + x] = body;
            }
        }
        // 边框阴影
        for (let y = 0; y <= 8; y++) {
            p[y * W + 2] = bodyShade;
            p[y * W + 13] = bodyShade;
        }
        for (let x = 2; x <= 13; x++) {
            p[8 * W + x] = bodyShade;
        }

        // 屏幕
        for (let y = 1; y <= 7; y++) {
            for (let x = 3; x <= 12; x++) {
                p[y * W + x] = screen;
            }
        }
        // 屏幕蓝光
        for (let y = 2; y <= 6; y++) {
            for (let x = 4; x <= 11; x++) {
                p[y * W + x] = glow;
            }
        }
        // 屏幕高光
        p[2 * W + 4] = glowLight;
        p[2 * W + 5] = glowLight;
        p[3 * W + 4] = glowLight;
        // 屏幕暗角
        p[7 * W + 11] = screen;
        p[6 * W + 11] = screen;

        // 底座颈
        for (let x = 6; x <= 9; x++) {
            p[9 * W + x] = stand;
            p[10 * W + x] = stand;
        }
        // 底座
        for (let x = 4; x <= 11; x++) {
            p[11 * W + x] = bodyShade;
        }
        for (let x = 5; x <= 10; x++) {
            p[12 * W + x] = stand;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 单人床 ==========
    function createBedSprite() {
        const key = 'bed';
        if (cache[key]) return cache[key];

        const W = 28, H = 20;
        const p = new Array(W * H).fill(null);

        const frame = '#2a2a3e';
        const frameShade = '#1a1a2e';
        const blanket = '#3a3a4e';
        const blanketShade = '#2e2e3e';
        const pillow = '#4a4a5e';
        const pillowShade = '#3a3a4e';

        // 床头板（左侧）
        for (let y = 1; y < H - 2; y++) {
            p[y * W] = frameShade;
            p[y * W + 1] = frame;
            p[y * W + 2] = frame;
            p[y * W + 3] = frameShade;
        }
        // 床头板顶
        for (let x = 0; x <= 3; x++) p[1 * W + x] = frameShade;
        p[2] = frameShade;
        p[3] = frameShade;

        // 床尾板（右侧）
        for (let y = 4; y < H - 2; y++) {
            p[y * W + W - 1] = frameShade;
            p[y * W + W - 2] = frame;
        }

        // 床垫/毯子
        for (let y = 5; y <= 14; y++) {
            for (let x = 4; x < W - 2; x++) {
                p[y * W + x] = blanket;
            }
        }
        // 毯子右侧阴影
        for (let y = 5; y <= 14; y++) {
            p[y * W + W - 3] = blanketShade;
        }
        // 毯子褶皱
        for (let x = 6; x < W - 3; x += 5) {
            p[12 * W + x] = blanketShade;
            p[13 * W + x + 1] = blanketShade;
        }

        // 枕头（床头端）
        for (let y = 5; y <= 9; y++) {
            for (let x = 5; x <= 10; x++) {
                p[y * W + x] = pillow;
            }
        }
        // 枕头阴影
        for (let x = 5; x <= 10; x++) {
            p[9 * W + x] = pillowShade;
        }
        p[5 * W + 5] = pillowShade;
        p[6 * W + 5] = pillowShade;

        // 床框底部
        for (let x = 0; x < W; x++) {
            p[(H - 1) * W + x] = frameShade;
            p[(H - 2) * W + x] = frame;
        }
        // 床腿
        p[(H - 3) * W + 1] = frameShade;
        p[(H - 3) * W + W - 2] = frameShade;

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 室内窗户 ==========
    function createWindowSprite() {
        const key = 'window';
        if (cache[key]) return cache[key];

        const W = 20, H = 24;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const frame = '#1a1a2e';
        const glass = c.window;        // #1a2a38
        const glassDark = c.windowDark; // #0a1a24
        const rain = c.rainDark;       // #2a4a5a

        // 外框
        for (let y = 0; y < H; y++) {
            p[y * W] = frame;
            p[y * W + 1] = frame;
            p[y * W + W - 1] = frame;
            p[y * W + W - 2] = frame;
        }
        for (let x = 0; x < W; x++) {
            p[x] = frame;
            p[W + x] = frame;
            p[(H - 1) * W + x] = frame;
            p[(H - 2) * W + x] = frame;
        }

        // 玻璃
        for (let y = 2; y < H - 2; y++) {
            for (let x = 2; x < W - 2; x++) {
                p[y * W + x] = glass;
            }
        }

        // 十字窗框
        for (let y = 2; y < H - 2; y++) {
            p[y * W + 9] = frame;
            p[y * W + 10] = frame;
        }
        for (let x = 2; x < W - 2; x++) {
            p[11 * W + x] = frame;
            p[12 * W + x] = frame;
        }

        // 雨痕
        const rainDrops = [
            [3, 4], [8, 4], [13, 5],
            [4, 6], [15, 6],
            [5, 8], [11, 9], [16, 8],
            [3, 14], [8, 15], [14, 14], [17, 16],
            [5, 17], [10, 18], [15, 17],
        ];
        for (const [x, y] of rainDrops) {
            if (y >= 2 && y < H - 2 && x >= 2 && x < W - 2) {
                if (x === 9 || x === 10 || y === 11 || y === 12) continue;
                p[y * W + x] = rain;
            }
        }

        // 玻璃暗角
        p[(H - 3) * W + W - 3] = glassDark;
        p[(H - 3) * W + W - 4] = glassDark;

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 书架 ==========
    function createBookshelfSprite() {
        const key = 'bookshelf';
        if (cache[key]) return cache[key];

        const W = 20, H = 32;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const wood = c.door;            // #2a1e10
        const woodShade = c.doorShade;  // #1a0e06
        const woodLight = '#3a2e20';

        const bookColors = ['#4a2a2a', '#2a3a4a', '#3a4a2a', '#4a3a4a', '#2a4a3a', '#4a4a2a', '#3a2a4a'];

        // 外框
        for (let y = 0; y < H; y++) {
            p[y * W] = woodShade;
            p[y * W + 1] = wood;
            p[y * W + W - 1] = woodShade;
            p[y * W + W - 2] = wood;
        }
        for (let x = 0; x < W; x++) {
            p[x] = woodShade;
            p[W + x] = wood;
            p[(H - 1) * W + x] = woodShade;
            p[(H - 2) * W + x] = wood;
        }

        // 背板
        for (let y = 2; y < H - 2; y++) {
            for (let x = 2; x < W - 2; x++) {
                p[y * W + x] = woodShade;
            }
        }

        // 隔板
        const shelfYs = [8, 15, 22];
        for (const sy of shelfYs) {
            for (let x = 1; x < W - 1; x++) {
                p[sy * W + x] = wood;
                p[(sy + 1) * W + x] = woodShade;
            }
        }

        // 书本（4层）
        const sections = [[2, 7], [9, 14], [16, 21], [23, 28]];
        let seed = 1;
        for (const [startY, endY] of sections) {
            let x = 2;
            while (x < W - 3) {
                const bookW = 1 + (seed % 3);
                const color = bookColors[seed % bookColors.length];
                for (let y = startY; y <= endY; y++) {
                    for (let bx = 0; bx < bookW; bx++) {
                        if (x + bx < W - 2) {
                            p[y * W + x + bx] = color;
                        }
                    }
                }
                if (x < W - 2) p[startY * W + x] = woodLight;
                x += bookW;
                if (seed % 4 === 0) x += 1;
                seed++;
            }
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 室内地板瓦片 ==========
    function createInteriorFloorTile(type = 'corridor') {
        const key = `interior_floor_${type}`;
        if (cache[key]) return cache[key];

        const W = 16, H = 16;
        const p = new Array(W * H).fill(null);

        if (type === 'corridor') {
            const baseColor = '#2a2a2e';
            const shadeColor = '#1e1e22';
            const lineColor = '#0e0e12';
            // 棋盘格
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    const checker = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
                    p[y * W + x] = checker === 0 ? baseColor : shadeColor;
                }
            }
            // 格缝
            for (let y = 0; y < H; y++) {
                p[y * W + 7] = lineColor;
                p[y * W + 8] = lineColor;
            }
            for (let x = 0; x < W; x++) {
                p[7 * W + x] = lineColor;
                p[8 * W + x] = lineColor;
            }
        } else if (type === 'office') {
            const baseColor = '#2a2a3e';
            const shadeColor = '#252535';
            // 地毯底色
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    p[y * W + x] = baseColor;
                }
            }
            // 随机纹理
            const seed = 7;
            for (let i = 0; i < 24; i++) {
                const x = (seed * (i + 1) * 5) % W;
                const y = (seed * (i + 1) * 11) % H;
                p[y * W + x] = shadeColor;
            }
            // 地毯格线
            for (let y = 0; y < H; y++) p[y * W + 7] = shadeColor;
            for (let x = 0; x < W; x++) p[7 * W + x] = shadeColor;
        } else {
            // home - 木地板
            const baseColor = '#2e2410';
            const shadeColor = '#1e1808';
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    p[y * W + x] = baseColor;
                }
            }
            // 木板缝
            for (let x = 0; x < W; x++) {
                p[3 * W + x] = shadeColor;
                p[4 * W + x] = shadeColor;
                p[11 * W + x] = shadeColor;
                p[12 * W + x] = shadeColor;
            }
            // 木纹
            const seed = 5;
            for (let i = 0; i < 18; i++) {
                const x = (seed * (i + 1) * 7) % W;
                const y = (seed * (i + 1) * 3) % H;
                if (p[y * W + x] === baseColor) p[y * W + x] = shadeColor;
            }
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 墙壁瓦片 ==========
    function createWallTile(type = 'corridor') {
        const key = `wall_${type}`;
        if (cache[key]) return cache[key];

        const W = 16, H = 16;
        const p = new Array(W * H).fill(null);

        let baseColor, shadeColor;
        if (type === 'corridor') {
            baseColor = '#3a3a3e';
            shadeColor = '#2e2e32';
        } else if (type === 'office') {
            baseColor = '#3a3a4e';
            shadeColor = '#2e2e42';
        } else {
            baseColor = '#3a2e24';
            shadeColor = '#2e2418';
        }

        // 基础填充
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                p[y * W + x] = baseColor;
            }
        }
        // 墙面纹理
        const seed = type.charCodeAt(0);
        for (let i = 0; i < 12; i++) {
            const x = (seed * (i + 1) * 7) % W;
            const y = (seed * (i + 1) * 13) % H;
            p[y * W + x] = shadeColor;
        }
        // 护墙板线
        for (let y = 0; y < H; y++) {
            p[y * W + 7] = shadeColor;
        }
        for (let x = 0; x < W; x++) {
            p[7 * W + x] = shadeColor;
            p[8 * W + x] = shadeColor;
        }
        // 顶底阴影
        for (let x = 0; x < W; x++) {
            p[x] = shadeColor;
            p[(H - 1) * W + x] = shadeColor;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 办公室隔间 ==========
    function createCubicleSprite() {
        const key = 'cubicle';
        if (cache[key]) return cache[key];

        const W = 32, H = 24;
        const p = new Array(W * H).fill(null);

        const fabric = '#2a2a3e';
        const fabricShade = '#1e1e2e';
        const fabricLight = '#3a3a4e';
        const trim = '#1a1a2a';

        // 隔板主体
        for (let y = 2; y < H - 4; y++) {
            for (let x = 0; x < W; x++) {
                p[y * W + x] = fabric;
            }
        }
        // 顶部装饰条
        for (let x = 0; x < W; x++) {
            p[2 * W + x] = trim;
            p[3 * W + x] = fabricShade;
        }
        // 底部装饰条
        for (let x = 0; x < W; x++) {
            p[(H - 5) * W + x] = fabricShade;
            p[(H - 4) * W + x] = trim;
        }
        // 底座
        for (let x = 0; x < W; x++) {
            p[(H - 2) * W + x] = trim;
            p[(H - 1) * W + x] = '#0a0a1a';
        }

        // 织物竖纹
        for (let x = 2; x < W; x += 4) {
            for (let y = 4; y < H - 5; y++) {
                p[y * W + x] = fabricShade;
            }
        }
        for (let x = 4; x < W; x += 6) {
            for (let y = 4; y < H - 5; y++) {
                if (p[y * W + x] === fabric) p[y * W + x] = fabricLight;
            }
        }
        // 顶部高光
        for (let x = 1; x < W - 1; x += 3) {
            p[4 * W + x] = fabricLight;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 厨房台面 ==========
    function createKitchenCounter() {
        const key = 'kitchen_counter';
        if (cache[key]) return cache[key];

        const W = 24, H = 18;
        const p = new Array(W * H).fill(null);

        const body = '#2a2a2e';
        const bodyShade = '#1a1a1e';
        const top = '#3a3a3e';
        const topShade = '#2a2a2e';
        const handle = '#5a5a5e';

        // 台面
        for (let x = 0; x < W; x++) {
            p[2 * W + x] = topShade;
            p[3 * W + x] = top;
            p[4 * W + x] = topShade;
        }
        // 台面高光
        for (let x = 1; x < W - 1; x++) {
            p[3 * W + x] = '#4a4a4e';
        }

        // 柜体
        for (let y = 5; y < H - 2; y++) {
            for (let x = 0; x < W; x++) {
                p[y * W + x] = body;
            }
        }
        // 柜体两侧阴影
        for (let y = 5; y < H - 2; y++) {
            p[y * W] = bodyShade;
            p[y * W + W - 1] = bodyShade;
        }

        // 柜门分隔
        for (let y = 5; y < H - 2; y++) {
            p[y * W + 11] = bodyShade;
            p[y * W + 12] = bodyShade;
        }
        // 柜门横线
        for (let x = 1; x < W - 1; x++) {
            p[10 * W + x] = bodyShade;
        }

        // 柜门把手
        p[7 * W + 9] = handle;
        p[7 * W + 10] = handle;
        p[7 * W + 13] = handle;
        p[7 * W + 14] = handle;

        // 底部阴影
        for (let x = 0; x < W; x++) {
            p[(H - 2) * W + x] = bodyShade;
            p[(H - 1) * W + x] = '#0a0a0e';
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 楼梯入口（通往天台）- 重新设计 ==========
    function createStaircaseSprite() {
        const key = 'staircase';
        if (cache[key]) return cache[key];

        const W = 16, H = 32;
        const p = new Array(W * H).fill(null);

        // 配色
        const signBg = '#3a2e1a';
        const signBorder = '#1a1208';
        const signLight = '#5a4a2e';
        const signText = '#e8c860';
        const frame = '#3a2818';
        const frameDark = '#1a0e06';
        const frameLight = '#4a3828';
        const interior = '#06060a';
        const step = '#3a3a3e';
        const stepLight = '#5a5a5e';
        const stepDark = '#1a1a1e';
        const ground = '#1a1a1e';

        // ===== 指示牌挂杆 (y: 0) =====
        p[7] = frameDark;

        // ===== 指示牌 (y: 1-6) =====
        for (let y = 1; y <= 6; y++) {
            for (let x = 3; x <= 12; x++) p[y * W + x] = signBg;
        }
        // 牌子边框
        for (let x = 3; x <= 12; x++) { p[W + x] = signBorder; p[6 * W + x] = signBorder; }
        for (let y = 1; y <= 6; y++) { p[y * W + 3] = signBorder; p[y * W + 12] = signBorder; }
        // 高光
        p[2 * W + 4] = signLight; p[3 * W + 4] = signLight;

        // "天台" 像素文字 (y: 2-5)
        // "天" (x: 5-7)
        p[2 * W + 5] = signText; p[2 * W + 6] = signText; p[2 * W + 7] = signText;
        p[3 * W + 6] = signText;
        p[4 * W + 5] = signText; p[4 * W + 6] = signText; p[4 * W + 7] = signText;
        p[5 * W + 6] = signText;
        // "台" (x: 8-10)
        p[2 * W + 9] = signText;
        p[3 * W + 8] = signText; p[3 * W + 9] = signText; p[3 * W + 10] = signText;
        p[4 * W + 9] = signText;
        p[5 * W + 8] = signText; p[5 * W + 9] = signText; p[5 * W + 10] = signText;

        // ===== 门楣 (y: 7-8) =====
        for (let x = 2; x <= 13; x++) {
            p[7 * W + x] = frameLight;
            p[8 * W + x] = frameDark;
        }
        p[7 * W + 2] = frameDark; p[7 * W + 13] = frameDark;

        // ===== 门框两侧 (y: 9-25) =====
        for (let y = 9; y <= 25; y++) {
            p[y * W + 2] = frame;
            p[y * W + 3] = frameDark;
            p[y * W + 12] = frameDark;
            p[y * W + 13] = frame;
        }

        // ===== 门内黑暗 =====
        for (let y = 9; y <= 23; y++) {
            for (let x = 4; x <= 11; x++) p[y * W + x] = interior;
        }

        // ===== 门内可见台阶（透视，由窄到宽） =====
        // 第四级（最高最窄）
        for (let x = 7; x <= 8; x++) {
            p[14 * W + x] = step;
            p[15 * W + x] = stepDark;
        }
        p[14 * W + 7] = stepLight;

        // 第三级
        for (let x = 6; x <= 9; x++) {
            p[16 * W + x] = step;
            p[17 * W + x] = stepDark;
        }
        p[16 * W + 6] = stepLight;

        // 第二级
        for (let x = 5; x <= 10; x++) {
            p[18 * W + x] = step;
            p[19 * W + x] = stepDark;
        }
        p[18 * W + 5] = stepLight;

        // 第一级（最低最宽）
        for (let x = 4; x <= 11; x++) {
            p[20 * W + x] = step;
            p[21 * W + x] = stepDark;
        }
        p[20 * W + 4] = stepLight;

        // 门槛
        for (let x = 4; x <= 11; x++) {
            p[22 * W + x] = stepDark;
        }

        // ===== 底座 (y: 23-25) =====
        for (let x = 2; x <= 13; x++) {
            p[23 * W + x] = frameDark;
            p[24 * W + x] = ground;
            p[25 * W + x] = '#0a0a0e';
        }

        // ===== 地面阴影 (y: 26-31) =====
        for (let x = 1; x <= 14; x++) p[26 * W + x] = '#08080c';
        for (let x = 2; x <= 13; x++) p[27 * W + x] = '#06060a';
        for (let x = 3; x <= 12; x++) p[28 * W + x] = '#040408';
        for (let x = 5; x <= 10; x++) p[29 * W + x] = '#020204';

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 天台地面瓦片（打磨版） ==========
    function createRooftopFloorTile() {
        const key = 'rooftop_floor';
        if (cache[key]) return cache[key];

        const W = 16, H = 16;
        const p = new Array(W * H).fill(null);

        const base = '#242426';
        const speckle = '#2c2c2e';
        const speckleDark = '#1e1e20';
        const crack = '#161616';
        const crackLight = '#202020';
        const puddle = '#182030';
        const puddleLight = '#1e2838';
        const stain = '#2a2a24';

        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) p[y * W + x] = base;
        }
        // 纹理斑点（明暗交替）
        const speckles = [[2,3],[5,7],[9,2],[12,9],[3,12],[7,14],[13,4],[1,8],[6,5],[11,11]];
        for (const [x, y] of speckles) p[y * W + x] = speckle;
        const specklesDark = [[4,2],[8,6],[11,3],[14,10],[2,11],[6,13],[10,14],[0,5],[5,9],[12,1]];
        for (const [x, y] of specklesDark) p[y * W + x] = speckleDark;
        // 水渍/污渍
        p[3 * W + 10] = stain; p[3 * W + 11] = stain; p[4 * W + 10] = stain;
        p[8 * W + 1] = stain; p[8 * W + 2] = stain;
        // 裂缝（更自然）
        p[5 * W + 4] = crack; p[6 * W + 4] = crack; p[6 * W + 5] = crackLight;
        p[7 * W + 5] = crack; p[8 * W + 5] = crack; p[8 * W + 6] = crackLight;
        p[9 * W + 6] = crack; p[10 * W + 7] = crack; p[11 * W + 7] = crackLight;
        // 水洼（带反光）
        p[12 * W + 10] = puddle; p[12 * W + 11] = puddle; p[12 * W + 12] = puddleLight;
        p[13 * W + 9] = puddle; p[13 * W + 10] = puddle; p[13 * W + 11] = puddle; p[13 * W + 12] = puddleLight;
        p[14 * W + 10] = puddle; p[14 * W + 11] = puddle;

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 天台栏杆（打磨版） ==========
    function createRailingSprite() {
        const key = 'railing';
        if (cache[key]) return cache[key];

        const W = 12, H = 44;
        const p = new Array(W * H).fill(null);

        const post = '#4a4a52';
        const postDark = '#2a2a32';
        const postLight = '#6a6a72';
        const bar = '#3a3a42';
        const barDark = '#1a1a22';
        const barLight = '#4a4a52';
        const cap = '#5a5a62';
        const rust = '#3a2e22';

        // ===== 顶部扶手 (y: 0-3) =====
        for (let y = 0; y <= 3; y++) {
            for (let x = 1; x <= 10; x++) p[y * W + x] = cap;
        }
        // 扶手高光
        for (let x = 1; x <= 10; x++) p[W + x] = postLight;
        // 扶手阴影
        for (let x = 1; x <= 10; x++) p[3 * W + x] = postDark;
        // 扶手两端
        for (let y = 0; y <= 3; y++) {
            p[y * W] = postDark; p[y * W + 11] = postDark;
        }

        // ===== 竖杆 (3根) =====
        const barX = [2, 5, 9];
        for (const bx of barX) {
            for (let y = 4; y < H - 4; y++) {
                p[y * W + bx] = post;
                p[y * W + bx + 1] = postDark;
            }
            // 高光
            for (let y = 5; y < H - 5; y += 4) {
                p[y * W + bx] = postLight;
            }
        }

        // ===== 横栏（上） y: 8-9 =====
        for (let x = 1; x <= 10; x++) {
            p[8 * W + x] = bar;
            p[9 * W + x] = barDark;
        }
        p[8 * W + 1] = barLight; p[8 * W + 2] = barLight;

        // ===== 横栏（中） y: 20-21 =====
        for (let x = 1; x <= 10; x++) {
            p[20 * W + x] = bar;
            p[21 * W + x] = barDark;
        }
        p[20 * W + 1] = barLight; p[20 * W + 2] = barLight;

        // ===== 横栏（下） y: 32-33 =====
        for (let x = 1; x <= 10; x++) {
            p[32 * W + x] = bar;
            p[33 * W + x] = barDark;
        }
        p[32 * W + 1] = barLight; p[32 * W + 2] = barLight;

        // ===== 锈迹 =====
        p[15 * W + 5] = rust; p[16 * W + 5] = rust;
        p[27 * W + 2] = rust; p[28 * W + 2] = rust;
        p[10 * W + 9] = rust;

        // ===== 底座 (y: 38-43) =====
        for (let x = 0; x < W; x++) {
            p[38 * W + x] = postDark;
            p[39 * W + x] = '#1a1a1e';
        }
        for (let x = 1; x <= 10; x++) {
            p[40 * W + x] = '#0e0e12';
            p[41 * W + x] = '#0a0a0e';
        }
        for (let x = 2; x <= 9; x++) {
            p[42 * W + x] = '#08080c';
            p[43 * W + x] = '#040408';
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 天台通风设备（打磨版） ==========
    function createVentUnitSprite() {
        const key = 'vent_unit';
        if (cache[key]) return cache[key];

        const W = 20, H = 18;
        const p = new Array(W * H).fill(null);

        const body = '#2e2e36';
        const bodyDark = '#1a1a22';
        const bodyLight = '#3a3a44';
        const vent = '#16161e';
        const ventLine = '#08080e';
        const ventLight = '#222230';
        const pipe = '#3a3a44';
        const pipeDark = '#1a1a24';
        const rust = '#3a2e22';

        // ===== 顶部管道 (y: 0-2) =====
        for (let x = 7; x <= 12; x++) {
            p[x] = pipe;
            p[W + x] = pipeDark;
        }
        // 管道法兰
        for (let x = 6; x <= 13; x++) {
            p[2 * W + x] = pipe;
        }
        p[2 * W + 6] = pipeDark; p[2 * W + 13] = pipeDark;

        // ===== 主体 (y: 3-15) =====
        for (let y = 3; y < H - 2; y++) {
            for (let x = 1; x < W - 1; x++) p[y * W + x] = body;
        }
        // 顶部边缘
        for (let x = 0; x < W; x++) p[3 * W + x] = bodyLight;
        // 两侧
        for (let y = 3; y < H; y++) { p[y * W] = bodyDark; p[y * W + W - 1] = bodyDark; }
        // 底部
        for (let x = 0; x < W; x++) p[(H - 2) * W + x] = bodyDark;
        for (let x = 0; x < W; x++) p[(H - 1) * W + x] = '#0a0a0e';

        // ===== 通风口 (y: 6-12) =====
        for (let y = 6; y <= 12; y++) {
            for (let x = 4; x <= 15; x++) p[y * W + x] = vent;
        }
        // 百叶（斜向）
        for (let y = 6; y <= 12; y += 2) {
            for (let x = 4; x <= 15; x++) p[y * W + x] = ventLine;
        }
        // 百叶高光
        for (let y = 7; y <= 11; y += 2) {
            p[y * W + 4] = ventLight;
            p[y * W + 15] = ventLight;
        }
        // 角落螺丝
        p[5 * W + 3] = bodyLight; p[5 * W + 16] = bodyLight;
        p[13 * W + 3] = bodyLight; p[13 * W + 16] = bodyLight;

        // ===== 锈迹 =====
        p[4 * W + 2] = rust; p[4 * W + 17] = rust;
        p[14 * W + 5] = rust; p[14 * W + 14] = rust;
        p[8 * W + 2] = rust;

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    // ========== 室内吊灯 ==========
    function createStreetLampInterior() {
        const key = 'ceiling_light';
        if (cache[key]) return cache[key];

        const W = 12, H = 8;
        const p = new Array(W * H).fill(null);
        const c = PALETTE;

        const fixture = '#3a3a3a';
        const fixtureShade = '#2a2a2a';
        const glow = c.roadLine;       // #4a4a3e
        const glowLight = '#6a6a5e';
        const mount = '#1a1a1a';

        // 安装座
        for (let x = 4; x <= 7; x++) {
            p[x] = mount;
        }
        p[W + 4] = mount;
        p[W + 7] = mount;

        // 灯具外壳
        for (let x = 1; x < W - 1; x++) {
            p[2 * W + x] = fixtureShade;
        }
        for (let x = 2; x < W - 2; x++) {
            p[3 * W + x] = fixture;
        }

        // 灯光
        for (let x = 2; x < W - 2; x++) {
            p[4 * W + x] = glow;
            p[5 * W + x] = glow;
        }
        // 灯光高光
        for (let x = 4; x <= 7; x++) {
            p[4 * W + x] = glowLight;
        }
        p[5 * W + 5] = glowLight;
        p[5 * W + 6] = glowLight;

        // 底部边缘
        for (let x = 1; x < W - 1; x++) {
            p[6 * W + x] = fixtureShade;
        }
        // 底部光晕
        for (let x = 3; x < W - 3; x++) {
            p[7 * W + x] = glow;
        }

        const sprite = createSprite(W, H, p, 3);
        cache[key] = sprite;
        return sprite;
    }

    return {
        PALETTE,
        // 引擎纹理绘制到原生 DOM 画布（如头像 #portrait-canvas）
        drawTextureToCanvas,
        createPlayerSprite,
        createPlayerLumentSprite,
        createLumentNPCSprite,
        createNormalNPCSprite,
        createFallenNPCSprite,
        createBuilding,
        createGroundTile,
        createTreeSprite,
        createStreetLamp,
        createAwning,
        createPortrait,
        createBuffItem,
        createLockerSprite,
        createClassroomDoor,
        createDeskSprite,
        createComputerSprite,
        createBedSprite,
        createWindowSprite,
        createBookshelfSprite,
        createInteriorFloorTile,
        createWallTile,
        createCubicleSprite,
        createKitchenCounter,
        createStreetLampInterior,
        createStaircaseSprite,
        createRooftopFloorTile,
        createRailingSprite,
        createVentUnitSprite,
    };
})();
