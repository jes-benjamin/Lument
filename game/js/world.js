// ============================================================
// world.js - 俯视角街道世界系统（Lument 移植版）
// 管理地图、建筑、滚动、天气效果、室内场景
// ------------------------------------------------------------
// 与 LumentWorldNative 版的差异：
//   * 世界生成逻辑（建筑、道路、遮雨棚、室内装饰、天台等）保持不变。
//   * 瓦片/建筑/道具精灵现在返回引擎纹理 ID（uint32），不能直接作为
//     drawImage 的图像源。所有精灵绘制改用 PixelArt.drawTextureToCanvas()，
//     该函数从 PixelArt 纹理注册表取出源画布后用 ctx.drawImage 绘制，
//     视觉与原版逐像素一致。
//   * 地面预渲染画布 groundTiles.canvas 仍是真实 HTMLCanvasElement，其
//     9 参数 drawImage 直接保留（drawTextureToCanvas 仅支持整体绘制）。
//   * updateCamera() 除更新本地摄像机外，额外调用 Lument.setCamera()
//     将摄像机注册到引擎，使引擎侧 drawSprite/drawRect/drawPixel 等使用
//     与本场景一致的视图变换（本文件渲染仍走 ctx，二者同处一画布）。
//   * 对外接口（init/updateCamera/render/isUnderShelter/...）与原版一致。
// ============================================================

const World = (function() {

    const TILE_SIZE = 48;

    let worldConfig = {
        width: 3200,
        groundY: 400,
        sidewalkTopY: 320,
        sidewalkBottomY: 480,
        buildingTopY: 80,
        buildingBottomY: 340,
    };

    let camera = { x: 0, y: 0 };
    let buildings = [];
    let props = [];
    let groundTiles = {};
    let currentTheme = 'school';
    let currentSceneType = 'outdoor';
    let indoorDecorations = [];

    // 初始化世界
    function init(theme) {
        currentTheme = theme;
        buildings = [];
        props = [];
        indoorDecorations = [];
        groundTiles = {};
        camera = { x: 0, y: 0 };
        // 重置世界配置到默认值
        worldConfig.width = 3200;
        worldConfig.groundY = 400;
        worldConfig.sidewalkTopY = 320;
        worldConfig.sidewalkBottomY = 480;

        // 判断场景类型
        if (theme === 'rooftop') {
            currentSceneType = 'outdoor'; // 天台是室外（有雨）
            generateRooftopScene();
        } else if (theme === 'school_corridor' || theme === 'company_office' || theme === 'home') {
            currentSceneType = 'indoor';
            generateIndoorScene(theme);
        } else {
            currentSceneType = 'outdoor';
            generateBuildings(theme);
            generateProps(theme);
        }
        generateGroundTiles();
    }

    // ========== 室内场景生成 ==========
    function generateIndoorScene(theme) {
        indoorDecorations = [];

        if (theme === 'school_corridor') {
            // 学校走廊：储物柜、教室门、窗户
            let x = 120;
            while (x < worldConfig.width - 100) {
                // 在楼梯位置留出更大空隙（避免重叠）
                if (x >= 1800 && x < 2150) { x += 200; continue; }
                // 上墙储物柜
                indoorDecorations.push({ type: 'locker', x: x, y: 250, side: 'top' });
                indoorDecorations.push({ type: 'locker', x: x + 40, y: 250, side: 'top' });
                // 教室门
                indoorDecorations.push({ type: 'door', x: x + 100, y: 250, side: 'top' });
                // 下墙窗户
                indoorDecorations.push({ type: 'window', x: x + 20, y: 520, side: 'bottom' });
                indoorDecorations.push({ type: 'window', x: x + 80, y: 520, side: 'bottom' });
                x += 200;
            }
            // 天台楼梯入口（放在留出的空隙中央，不与其他物体重叠）
            indoorDecorations.push({ type: 'staircase', x: 1930, y: 230, side: 'top', interactive: true });

            worldConfig.width = x;
        } else if (theme === 'company_office') {
            // 公司办公室：办公桌、电脑、隔间
            // 扩展世界宽度以容纳更多剧情遭遇点
            worldConfig.width = 4200;
            let x = 120;
            while (x < worldConfig.width - 100) {
                // 上排工位
                indoorDecorations.push({ type: 'desk', x: x, y: 280, side: 'top' });
                indoorDecorations.push({ type: 'computer', x: x + 6, y: 275, side: 'top' });
                indoorDecorations.push({ type: 'cubicle', x: x - 10, y: 270, side: 'top' });

                // 下排工位
                indoorDecorations.push({ type: 'desk', x: x, y: 500, side: 'bottom' });
                indoorDecorations.push({ type: 'computer', x: x + 6, y: 495, side: 'bottom' });
                indoorDecorations.push({ type: 'cubicle', x: x - 10, y: 490, side: 'bottom' });

                // 窗户
                if (x % 240 === 120) {
                    indoorDecorations.push({ type: 'window', x: x + 40, y: 200, side: 'top' });
                }
                x += 180;
            }
            worldConfig.width = x;
        } else if (theme === 'home') {
            // 家：床、书架、窗户、厨房台面
            // 较短的世界
            worldConfig.width = 2000;

            // 床
            indoorDecorations.push({ type: 'bed', x: 150, y: 290, side: 'top' });
            // 书架
            indoorDecorations.push({ type: 'bookshelf', x: 300, y: 270, side: 'top' });
            // 窗户
            indoorDecorations.push({ type: 'window', x: 500, y: 200, side: 'top' });
            indoorDecorations.push({ type: 'window', x: 700, y: 200, side: 'top' });
            // 书桌
            indoorDecorations.push({ type: 'desk', x: 900, y: 290, side: 'top' });
            indoorDecorations.push({ type: 'computer', x: 906, y: 285, side: 'top' });
            // 厨房台面
            indoorDecorations.push({ type: 'kitchen_counter', x: 1200, y: 520, side: 'bottom' });
            indoorDecorations.push({ type: 'kitchen_counter', x: 1280, y: 520, side: 'bottom' });
            // 另一个窗户
            indoorDecorations.push({ type: 'window', x: 1500, y: 200, side: 'top' });
            // 书架
            indoorDecorations.push({ type: 'bookshelf', x: 1700, y: 270, side: 'top' });
        }
    }

    // ========== 天台场景生成 ==========
    function generateRooftopScene() {
        worldConfig.width = 1100;
        worldConfig.groundY = 400;

        // 栏杆（在天台右端边缘，形成连续围栏）
        const railingX = 920;
        props.push({ type: 'railing', x: railingX, y: 260, w: 12 });
        props.push({ type: 'railing', x: railingX + 36, y: 260, w: 12 });
        props.push({ type: 'railing', x: railingX + 72, y: 260, w: 12 });
        props.push({ type: 'railing', x: railingX + 108, y: 260, w: 12 });

        // 通风设备
        indoorDecorations.push({ type: 'vent_unit', x: 200, y: 360 });
        indoorDecorations.push({ type: 'vent_unit', x: 480, y: 320 });
        indoorDecorations.push({ type: 'vent_unit', x: 700, y: 380 });
    }

    // ========== 室外建筑生成（整齐排列在道路两侧） ==========
    function generateBuildings(theme) {
        const SCALE = 3; // 精灵缩放比例
        const themes = {
            school:  { sizes: [[22, 26], [22, 26], [22, 26]] },
            career:  { sizes: [[26, 34], [26, 34], [26, 34]] },
            life:    { sizes: [[20, 24], [20, 24], [20, 24]] },
            finale:  { sizes: [[30, 42], [30, 42], [30, 42]] },
        };

        const config = themes[theme] || themes.school;
        let xPos = 80;
        const spacing = 280; // 固定间距，建筑紧凑排列
        let buildingIdx = 0;

        while (xPos < 3200) {
            const sizeIdx = buildingIdx % config.sizes.length;
            const [bw, bh] = config.sizes[sizeIdx];
            const pixelH = bh * SCALE; // 建筑实际像素高度

            // 上方建筑：底部对齐上人行道边缘
            buildings.push({
                x: xPos,
                y: worldConfig.sidewalkTopY - pixelH, // 底部贴着人行道
                w: bw,
                h: bh,
                theme: theme,
                side: 'top'
            });

            // 下方建筑：顶部对齐下人行道边缘（与上方建筑x对齐，不偏移）
            buildings.push({
                x: xPos,
                y: worldConfig.sidewalkBottomY, // 顶部贴着下人行道
                w: bw,
                h: bh,
                theme: theme,
                side: 'bottom'
            });

            xPos += spacing;
            buildingIdx++;
        }

        worldConfig.width = xPos + 200;
    }

    // 生成道具（路灯、树、遮雨棚）
    function generateProps(theme) {
        // 路灯 - 均匀排列在道路两侧，与建筑对齐
        for (let x = 80; x < worldConfig.width; x += 280) {
            props.push({ type: 'lamp', x: x + 100, y: worldConfig.sidewalkTopY - 8 });
            props.push({ type: 'lamp', x: x + 100, y: worldConfig.sidewalkBottomY + 8 });
        }

        // 树 - 在建筑之间均匀放置
        for (let x = 80; x < worldConfig.width; x += 280) {
            if (theme === 'school' || theme === 'life') {
                props.push({ type: 'tree', x: x + 50, y: worldConfig.sidewalkTopY - 5 });
                props.push({ type: 'tree', x: x + 50, y: worldConfig.sidewalkBottomY + 5 });
            }
        }

        // 遮雨棚 - 在建筑门口放置，与建筑对齐，具有恢复HP的特殊效果
        const colors = ['red', 'blue', 'green', 'gray'];
        let colorIdx = 0;
        for (let x = 80; x < worldConfig.width; x += 280) {
            // 上方遮雨棚（加大尺寸）
            props.push({
                type: 'awning',
                x: x + 20,
                y: worldConfig.sidewalkTopY - 5,
                w: 130,
                color: colors[colorIdx % colors.length],
                shelter: true,
                specialBuff: true  // 遮雨棚特殊buff标记
            });
            // 下方遮雨棚（与上方对齐）
            props.push({
                type: 'awning',
                x: x + 20,
                y: worldConfig.sidewalkBottomY + 5,
                w: 130,
                color: colors[(colorIdx + 1) % colors.length],
                shelter: true,
                specialBuff: true
            });
            colorIdx++;
        }
    }

    // 生成地面瓦片
    function generateGroundTiles() {
        const groundCanvas = document.createElement('canvas');
        groundCanvas.width = worldConfig.width;
        groundCanvas.height = worldConfig.groundY + 200;
        const gctx = groundCanvas.getContext('2d');
        gctx.imageSmoothingEnabled = false;

        if (currentSceneType === 'indoor') {
            generateIndoorGround(gctx);
        } else if (currentTheme === 'rooftop') {
            generateRooftopGround(gctx);
        } else {
            generateOutdoorGround(gctx);
        }

        groundTiles.canvas = groundCanvas;
    }

    // ========== 室外地面 ==========
    function generateOutdoorGround(gctx) {
        // 天空背景渐变 - 昏暗压抑
        const skyGrad = gctx.createLinearGradient(0, 0, 0, worldConfig.sidewalkTopY);
        skyGrad.addColorStop(0, '#080810');
        skyGrad.addColorStop(0.5, '#0e0e1a');
        skyGrad.addColorStop(1, '#14141e');
        gctx.fillStyle = skyGrad;
        gctx.fillRect(0, 0, worldConfig.width, worldConfig.sidewalkTopY);

        // 上方人行道
        const sidewalkTileTop = PixelArt.createGroundTile('sidewalk');
        for (let x = 0; x < worldConfig.width; x += TILE_SIZE) {
            for (let y = worldConfig.sidewalkTopY; y < worldConfig.groundY; y += TILE_SIZE) {
                PixelArt.drawTextureToCanvas(sidewalkTileTop, gctx, x, y, TILE_SIZE, TILE_SIZE);
            }
        }

        // 道路
        const roadTile = PixelArt.createGroundTile('road');
        for (let x = 0; x < worldConfig.width; x += TILE_SIZE) {
            for (let y = worldConfig.groundY; y < worldConfig.sidewalkBottomY; y += TILE_SIZE) {
                PixelArt.drawTextureToCanvas(roadTile, gctx, x, y, TILE_SIZE, TILE_SIZE);
            }
        }

        // 道路中线
        gctx.fillStyle = '#3a3a2e';
        for (let x = 0; x < worldConfig.width; x += 40) {
            gctx.fillRect(x, worldConfig.groundY + 40, 20, 4);
        }

        // 下方人行道
        const sidewalkTileBot = PixelArt.createGroundTile('sidewalk');
        for (let x = 0; x < worldConfig.width; x += TILE_SIZE) {
            for (let y = worldConfig.sidewalkBottomY; y < worldConfig.groundY + 200; y += TILE_SIZE) {
                PixelArt.drawTextureToCanvas(sidewalkTileBot, gctx, x, y, TILE_SIZE, TILE_SIZE);
            }
        }
    }

    // ========== 室内地面 ==========
    function generateIndoorGround(gctx) {
        let floorType, wallType;
        if (currentTheme === 'school_corridor') {
            floorType = 'corridor';
            wallType = 'corridor';
        } else if (currentTheme === 'company_office') {
            floorType = 'office';
            wallType = 'office';
        } else {
            floorType = 'home';
            wallType = 'home';
        }

        // 上墙区域
        const wallTile = PixelArt.createWallTile(wallType);
        for (let x = 0; x < worldConfig.width; x += TILE_SIZE) {
            for (let y = 0; y < 250; y += TILE_SIZE) {
                PixelArt.drawTextureToCanvas(wallTile, gctx, x, y, TILE_SIZE, TILE_SIZE);
            }
        }

        // 地板区域
        const floorTile = PixelArt.createInteriorFloorTile(floorType);
        for (let x = 0; x < worldConfig.width; x += TILE_SIZE) {
            for (let y = 250; y < worldConfig.groundY + 150; y += TILE_SIZE) {
                PixelArt.drawTextureToCanvas(floorTile, gctx, x, y, TILE_SIZE, TILE_SIZE);
            }
        }

        // 下墙区域
        for (let x = 0; x < worldConfig.width; x += TILE_SIZE) {
            for (let y = worldConfig.groundY + 150; y < worldConfig.groundY + 200; y += TILE_SIZE) {
                PixelArt.drawTextureToCanvas(wallTile, gctx, x, y, TILE_SIZE, TILE_SIZE);
            }
        }

        // 踢脚线
        gctx.fillStyle = currentTheme === 'home' ? '#1a1408' : '#1a1a24';
        gctx.fillRect(0, 248, worldConfig.width, 4);
        gctx.fillRect(0, worldConfig.groundY + 148, worldConfig.width, 4);
    }

    // ========== 天台地面 ==========
    function generateRooftopGround(gctx) {
        // 天空背景（暗沉暴风雨）
        const skyGrad = gctx.createLinearGradient(0, 0, 0, 260);
        skyGrad.addColorStop(0, '#050508');
        skyGrad.addColorStop(0.6, '#0a0a12');
        skyGrad.addColorStop(1, '#0e0e16');
        gctx.fillStyle = skyGrad;
        gctx.fillRect(0, 0, worldConfig.width, 260);

        // 远处城市轮廓（暗色剪影）
        gctx.fillStyle = 'rgba(8, 8, 16, 0.8)';
        for (let i = 0; i < 15; i++) {
            const bx = i * 80;
            const bh = 30 + (i * 23) % 50;
            gctx.fillRect(bx, 260 - bh, 60, bh);
        }

        // 天台混凝土地面
        const floorTile = PixelArt.createRooftopFloorTile();
        for (let x = 0; x < worldConfig.width; x += TILE_SIZE) {
            for (let y = 260; y < worldConfig.groundY + 180; y += TILE_SIZE) {
                PixelArt.drawTextureToCanvas(floorTile, gctx, x, y, TILE_SIZE, TILE_SIZE);
            }
        }

        // 天台边缘矮墙（底部）
        gctx.fillStyle = '#1a1a1e';
        gctx.fillRect(0, worldConfig.groundY + 160, worldConfig.width, 20);
        gctx.fillStyle = '#0a0a0e';
        gctx.fillRect(0, worldConfig.groundY + 178, worldConfig.width, 4);

        // 天台后方矮墙（顶部，女儿墙）
        gctx.fillStyle = '#2a2a2e';
        gctx.fillRect(0, 256, worldConfig.width, 8);
        gctx.fillStyle = '#1a1a1e';
        gctx.fillRect(0, 262, worldConfig.width, 4);
    }

    // 更新相机
    function updateCamera(playerX, playerY, canvasWidth, canvasHeight) {
        const targetX = playerX - canvasWidth / 2;
        const targetY = playerY - canvasHeight / 2;

        camera.x += (targetX - camera.x) * 0.1;
        camera.y += (targetY - camera.y) * 0.1;

        camera.x = Math.max(0, Math.min(camera.x, worldConfig.width - canvasWidth));

        const minY = -50;
        const maxY = worldConfig.groundY + 100 - canvasHeight;
        camera.y = Math.max(minY, Math.min(camera.y, maxY > minY ? maxY : minY));

        // 将摄像机注册到引擎，使引擎侧渲染 API（drawSprite/drawRect/drawPixel）
        // 使用与本场景一致的视图变换（缩放固定为 1，与原版像素一一对应）。
        Lument.setCamera(camera.x, camera.y, 1);
    }

    // 渲染世界
    function render(ctx, canvasWidth, canvasHeight) {
        ctx.imageSmoothingEnabled = false;

        // 1. 绘制地面和背景（预渲染）- groundTiles.canvas 是真实画布，可直接 drawImage
        if (groundTiles.canvas) {
            ctx.drawImage(
                groundTiles.canvas,
                camera.x, camera.y,
                canvasWidth, canvasHeight,
                0, 0,
                canvasWidth, canvasHeight
            );
        }

        if (currentSceneType === 'indoor') {
            renderIndoor(ctx, canvasWidth, canvasHeight);
        } else if (currentTheme === 'rooftop') {
            renderRooftop(ctx, canvasWidth, canvasHeight);
        } else {
            renderOutdoor(ctx, canvasWidth, canvasHeight);
        }
    }

    // ========== 天台渲染 ==========
    function renderRooftop(ctx, canvasWidth, canvasHeight) {
        // 远处城市建筑（视差效果）
        const parallaxX = camera.x * 0.4;
        ctx.fillStyle = 'rgba(6, 6, 12, 0.6)';
        for (let i = 0; i < 25; i++) {
            const bx = (i * 100 - parallaxX) % (worldConfig.width + 400) - 200;
            const bh = 40 + (i * 29) % 70;
            ctx.fillRect(bx, 180 - bh, 70, bh);
        }
        // 远处建筑窗户微光
        ctx.fillStyle = 'rgba(30, 40, 60, 0.15)';
        for (let i = 0; i < 25; i++) {
            const bx = (i * 100 - parallaxX) % (worldConfig.width + 400) - 200;
            const bh = 40 + (i * 29) % 70;
            for (let wy = 180 - bh + 8; wy < 178; wy += 12) {
                ctx.fillRect(bx + 8, wy, 4, 4);
                ctx.fillRect(bx + 30, wy, 4, 4);
                ctx.fillRect(bx + 52, wy, 4, 4);
            }
        }

        // 渲染通风设备
        for (const dec of indoorDecorations) {
            const screenX = dec.x - camera.x;
            const screenY = dec.y - camera.y;

            if (screenX < -100 || screenX > canvasWidth + 100) continue;

            if (dec.type === 'vent_unit') {
                const sprite = PixelArt.createVentUnitSprite();
                PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
            }
        }

        // 渲染栏杆
        for (const prop of props) {
            const screenX = prop.x - camera.x;
            const screenY = prop.y - camera.y;

            if (screenX < -100 || screenX > canvasWidth + 100) continue;

            if (prop.type === 'railing') {
                const sprite = PixelArt.createRailingSprite();
                PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
            }
        }

        // 天台整体昏暗遮罩
        ctx.fillStyle = 'rgba(5, 5, 10, 0.25)';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    // ========== 室外渲染 ==========
    function renderOutdoor(ctx, canvasWidth, canvasHeight) {
        // 远处建筑（视差效果）
        const parallaxX = camera.x * 0.6;
        ctx.fillStyle = 'rgba(8, 8, 16, 0.7)';
        for (let i = 0; i < 20; i++) {
            const bx = (i * 200 - parallaxX) % (worldConfig.width + 400) - 200;
            const bh = 60 + (i * 37) % 80;
            ctx.fillRect(bx, worldConfig.buildingTopY - bh - 100, 120, bh);
        }

        // 建筑物 - 按side和x排序渲染
        for (const building of buildings) {
            const screenX = building.x - camera.x;
            const screenY = building.y - camera.y;

            if (screenX + building.w * 3 < -50 || screenX > canvasWidth + 50) continue;

            const sprite = PixelArt.createBuilding(building.w, building.h, building.theme);
            PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
        }

        // 道具
        for (const prop of props) {
            const screenX = prop.x - camera.x;
            const screenY = prop.y - camera.y;

            if (screenX < -100 || screenX > canvasWidth + 100) continue;

            if (prop.type === 'lamp') {
                const sprite = PixelArt.createStreetLamp();
                PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);

                const gradient = ctx.createRadialGradient(
                    screenX + 9, screenY + 9, 0,
                    screenX + 9, screenY + 9, 60
                );
                gradient.addColorStop(0, 'rgba(255, 220, 100, 0.12)');
                gradient.addColorStop(1, 'rgba(255, 220, 100, 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(screenX - 50, screenY - 40, 120, 100);
            } else if (prop.type === 'tree') {
                const sprite = PixelArt.createTreeSprite();
                PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
            } else if (prop.type === 'awning') {
                const sprite = PixelArt.createAwning(prop.color);
                PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY, prop.w, 18);
            }
        }
    }

    // ========== 室内渲染 ==========
    function renderIndoor(ctx, canvasWidth, canvasHeight) {
        // 室内吊灯（均匀分布）
        for (let x = 60; x < worldConfig.width; x += 120) {
            const screenX = x - camera.x;
            if (screenX < -30 || screenX > canvasWidth + 30) continue;

            const sprite = PixelArt.createStreetLampInterior();
            PixelArt.drawTextureToCanvas(sprite, ctx, screenX, 10 - camera.y);

            // 灯光效果
            const gradient = ctx.createRadialGradient(
                screenX + 18, 12 - camera.y, 0,
                screenX + 18, 12 - camera.y, 80
            );
            gradient.addColorStop(0, 'rgba(180, 170, 120, 0.08)');
            gradient.addColorStop(1, 'rgba(180, 170, 120, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(screenX - 60, -20 - camera.y, 160, 120);
        }

        // 渲染室内装饰
        for (const dec of indoorDecorations) {
            const screenX = dec.x - camera.x;
            const screenY = dec.y - camera.y;

            if (screenX < -100 || screenX > canvasWidth + 100) continue;

            let sprite;
            switch (dec.type) {
                case 'locker':
                    sprite = PixelArt.createLockerSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'door':
                    sprite = PixelArt.createClassroomDoor();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'desk':
                    sprite = PixelArt.createDeskSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'computer':
                    sprite = PixelArt.createComputerSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'bed':
                    sprite = PixelArt.createBedSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'window':
                    sprite = PixelArt.createWindowSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    // 窗外微光
                    const wGradient = ctx.createRadialGradient(
                        screenX + 30, screenY + 36, 0,
                        screenX + 30, screenY + 36, 40
                    );
                    wGradient.addColorStop(0, 'rgba(60, 80, 120, 0.06)');
                    wGradient.addColorStop(1, 'rgba(60, 80, 120, 0)');
                    ctx.fillStyle = wGradient;
                    ctx.fillRect(screenX - 10, screenY - 10, 80, 80);
                    break;
                case 'bookshelf':
                    sprite = PixelArt.createBookshelfSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'cubicle':
                    sprite = PixelArt.createCubicleSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'kitchen_counter':
                    sprite = PixelArt.createKitchenCounter();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    break;
                case 'staircase':
                    sprite = PixelArt.createStaircaseSprite();
                    PixelArt.drawTextureToCanvas(sprite, ctx, screenX, screenY);
                    // 楼梯口光效提示
                    const stairGradient = ctx.createRadialGradient(
                        screenX + 24, screenY + 48, 0,
                        screenX + 24, screenY + 48, 70
                    );
                    stairGradient.addColorStop(0, 'rgba(200, 180, 100, 0.12)');
                    stairGradient.addColorStop(1, 'rgba(200, 180, 100, 0)');
                    ctx.fillStyle = stairGradient;
                    ctx.fillRect(screenX - 25, screenY - 15, 100, 130);
                    break;
            }
        }

        // 室内整体昏暗遮罩
        ctx.fillStyle = 'rgba(5, 5, 10, 0.3)';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    // 检查玩家是否在遮雨处
    function isUnderShelter(playerX, playerY) {
        // 室内场景永远遮雨
        if (currentSceneType === 'indoor') return true;

        for (const prop of props) {
            if (prop.type === 'awning' && prop.shelter) {
                if (playerX >= prop.x && playerX <= prop.x + prop.w) {
                    // 上方遮雨棚：玩家在上人行道区域
                    if (prop.y < worldConfig.groundY &&
                        playerY >= worldConfig.sidewalkTopY - 10 &&
                        playerY <= worldConfig.groundY) {
                        return true;
                    }
                    // 下方遮雨棚：玩家在下人行道区域
                    if (prop.y > worldConfig.groundY &&
                        playerY >= worldConfig.sidewalkBottomY - 10 &&
                        playerY <= worldConfig.groundY + 150) {
                        return true;
                    }
                }
            }
        }
        // 路灯下也算轻微遮雨
        for (const prop of props) {
            if (prop.type === 'lamp') {
                if (Math.abs(playerX - prop.x) < 25 &&
                    Math.abs(playerY - prop.y) < 40) {
                    return true;
                }
            }
        }
        return false;
    }

    // 检查玩家是否在遮雨棚下（特殊恢复HP）
    function isUnderAwning(playerX, playerY) {
        if (currentSceneType === 'indoor') return false;
        for (const prop of props) {
            if (prop.type === 'awning' && prop.specialBuff) {
                if (playerX >= prop.x && playerX <= prop.x + prop.w) {
                    // 上方遮雨棚：玩家在上人行道区域
                    if (prop.y < worldConfig.groundY &&
                        playerY >= worldConfig.sidewalkTopY - 10 &&
                        playerY <= worldConfig.groundY) {
                        return true;
                    }
                    // 下方遮雨棚：玩家在下人行道区域
                    if (prop.y > worldConfig.groundY &&
                        playerY >= worldConfig.sidewalkBottomY - 10 &&
                        playerY <= worldConfig.groundY + 150) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function isIndoor() {
        return currentSceneType === 'indoor';
    }

    function isOnRoad(x, y) {
        return y >= worldConfig.groundY && y <= worldConfig.sidewalkBottomY;
    }

    function isOnTopSidewalk(x, y) {
        return y >= worldConfig.sidewalkTopY && y < worldConfig.groundY;
    }

    function isOnBottomSidewalk(x, y) {
        return y >= worldConfig.sidewalkBottomY && y <= worldConfig.groundY + 150;
    }

    function getBounds() {
        if (currentSceneType === 'indoor') {
            return {
                minX: 30,
                maxX: worldConfig.width - 30,
                minY: 280,
                maxY: worldConfig.groundY + 140,
                width: worldConfig.width,
            };
        }
        if (currentTheme === 'rooftop') {
            return {
                minX: 30,
                maxX: 910, // 不能越过栏杆
                minY: 290,
                maxY: worldConfig.groundY + 100,
                width: worldConfig.width,
            };
        }
        return {
            minX: 30,
            maxX: worldConfig.width - 30,
            minY: worldConfig.sidewalkTopY,
            maxY: worldConfig.groundY + 150,
            width: worldConfig.width,
        };
    }

    function getCamera() {
        return camera;
    }

    function getConfig() {
        return worldConfig;
    }

    function getTheme() {
        return currentTheme;
    }

    return {
        init,
        updateCamera,
        render,
        isUnderShelter,
        isUnderAwning,
        isIndoor,
        isOnRoad,
        isOnTopSidewalk,
        isOnBottomSidewalk,
        getBounds,
        getCamera,
        getConfig,
        getTheme,
        TILE_SIZE,
    };
})();
