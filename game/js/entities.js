// ============================================================
// entities.js - 游戏实体系统（Lument 移植版）
// 玩家、NPC、雨水粒子
// ------------------------------------------------------------
// 与 LumentWorldNative 版的差异：
//   * 精灵不再返回 HTMLCanvasElement，而是返回引擎纹理 ID（uint32）。
//     所有 createXxxSprite() 现在返回 textureId。
//   * 精灵绘制统一改用 PixelArt.drawTextureToCanvas(textureId, ctx, x, y, w, h)，
//     该函数从 PixelArt 纹理注册表取出源画布后用 ctx.drawImage 绘制，
//     视觉效果与原版逐像素一致（关闭 imageSmoothing，像素硬边）。
//   * 阴影、光晕、渐变、雨幕等特效仍直接使用传入的 ctx（即引擎主画布
//     上下文 Lument.getContext()），保持原版坐标系与渲染逻辑。
//   * Player 额外注册到引擎 ECS（createEntity / setPosition / getPosition /
//     setCollider），使玩家位置与碰撞体对引擎侧可见，可用于引擎侧查询。
//   * 摄像机由 World.updateCamera() 调用 Lument.setCamera() 统一注册。
//   * 类接口（构造函数、方法签名）与原版完全一致，便于 game.js 直接替换。
// ============================================================

// 精灵渲染尺寸（逻辑尺寸 ×3 缩放，与 PixelArt 中 createSprite 的 scale 一致）
// 仅用于需要居中/对齐脚底的精灵；道具、建筑、地面瓦片等均为左上角对齐，
// 直接以原生尺寸绘制，无需查表。
const SPRITE_SIZE = {
    player:         { w: 42,  h: 66  },  // 14×22 ×3
    playerLument: { w: 54,  h: 102 },  // 18×34 ×3
    npcLument:    { w: 54,  h: 108 },  // 18×36 ×3
    npcNormal:      { w: 42,  h: 66  },  // 14×22 ×3
    npcFallen:      { w: 72,  h: 48  },  // 24×16 ×3
};

// ========== 玩家 ==========
class Player {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.vx = 0;
        this.vy = 0;
        this.speed = 2.2;
        this.facing = 'down';
        this.animFrame = 0;
        this.animTimer = 0;
        this.moving = false;

        this.health = 100;
        this.maxHealth = 100;
        this.rainDamageRate = 0.06;
        this.sheltered = false;
        this.healthRegenTimer = 0;

        this.buffs = {
            experience: 0,   // 阅历
            ability: 0,      // 能力
            knowledge: 0,    // 学识
            mindset: 0,      // 心态
            resume: 0,       // 履历
            endurance: 0,    // 抗压
            willpower: 0,    // 毅力
        };

        this.invulnerable = 0;
        this.flashTimer = 0;
        this.hasLument = false; // 玩家撑伞状态（加入老头后身份改变）

        // 注册到引擎 ECS：记录玩家位置与碰撞体，供引擎侧查询/碰撞检测。
        // 不为该实体设置纹理（渲染仍由本类手动控制，避免引擎 _renderSprites 重复绘制）。
        this.entityId = Lument.createEntity();
        if (this.entityId) {
            Lument.setPosition(this.entityId, x, y);
            Lument.setCollider(this.entityId, 28, 28);
        }
    }

    update(input, world, dt) {
        // 移动 - 支持摇杆模拟输入和键盘
        let dx = 0, dy = 0;
        if (input.joystickX !== undefined && input.joystickY !== undefined && (Math.abs(input.joystickX) > 0.01 || Math.abs(input.joystickY) > 0.01)) {
            dx = input.joystickX;
            dy = input.joystickY;
        } else {
            if (input.left) dx -= 1;
            if (input.right) dx += 1;
            if (input.up) dy -= 1;
            if (input.down) dy += 1;
        }

        // 对角线移动归一化
        if (dx !== 0 && dy !== 0) {
            const len = Math.sqrt(dx * dx + dy * dy);
            dx /= len;
            dy /= len;
        }

        this.vx = dx * this.speed;
        this.vy = dy * this.speed;

        this.moving = (dx !== 0 || dy !== 0);

        // 更新朝向 - 需要一定阈值避免抖动
        if (Math.abs(dx) > 0.15 || Math.abs(dy) > 0.15) {
            if (Math.abs(dx) > Math.abs(dy)) {
                this.facing = dx > 0 ? 'right' : 'left';
            } else {
                this.facing = dy > 0 ? 'down' : 'up';
            }
        }

        // 更新位置
        this.x += this.vx;
        this.y += this.vy;

        // 边界限制
        const bounds = world.getBounds();
        this.x = Math.max(bounds.minX, Math.min(this.x, bounds.maxX));
        this.y = Math.max(bounds.minY, Math.min(this.y, bounds.maxY));

        // 通过引擎 ECS 写入/读回位置，保持 this.x/this.y 与引擎实体同步
        if (this.entityId) {
            Lument.setPosition(this.entityId, this.x, this.y);
            const pos = Lument.getPosition(this.entityId);
            this.x = pos.x;
            this.y = pos.y;
        }

        // 动画
        if (this.moving) {
            this.animTimer += dt;
            if (this.animTimer > 150) {
                this.animFrame = (this.animFrame + 1) % 4;
                this.animTimer = 0;
            }
        } else {
            this.animFrame = 0;
        }

        // 雨水伤害 / 遮雨恢复
        this.sheltered = world.isUnderShelter(this.x, this.y);
        this.underAwning = world.isUnderAwning ? world.isUnderAwning(this.x, this.y) : false;
        if (this.sheltered) {
            // 遮雨时缓慢恢复体力
            this.healthRegenTimer += dt;
            // 遮雨棚下恢复速度加倍
            const regenInterval = this.underAwning ? 200 : 500;
            const regenAmount = this.underAwning ? 1.5 : 0.5;
            if (this.healthRegenTimer > regenInterval) {
                this.health = Math.min(this.maxHealth, this.health + regenAmount);
                this.healthRegenTimer = 0;
            }
        } else if (this.invulnerable <= 0 && !this.hasLument) {
            this.healthRegenTimer = 0;
            // Buff减少雨水伤害
            const totalBuffs = Object.values(this.buffs).reduce((a, b) => a + b, 0);
            const damageReduction = Math.min(0.7, totalBuffs * 0.02);
            const damage = this.rainDamageRate * (1 - damageReduction);
            this.health -= damage;
            this.health = Math.max(0, this.health);
        }

        // 闪避无敌时间
        if (this.invulnerable > 0) {
            this.invulnerable -= dt;
            this.flashTimer += dt;
        }
    }

    render(ctx, camera) {
        const screenX = Math.round(this.x - camera.x);
        const screenY = Math.round(this.y - camera.y);

        // 闪烁效果（受伤时）
        if (this.invulnerable > 0 && Math.floor(this.flashTimer / 80) % 2 === 0) {
            return;
        }

        // 纹理 ID + 渲染尺寸（与 PixelArt 精灵定义一致）
        const texId = this.hasLument
            ? PixelArt.createPlayerLumentSprite(this.facing, this.animFrame)
            : PixelArt.createPlayerSprite(this.facing, this.animFrame);
        const dims = this.hasLument ? SPRITE_SIZE.playerLument : SPRITE_SIZE.player;
        const sw = dims.w;
        const sh = dims.h;

        // 阴影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(screenX, screenY + 2, 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // 精灵 - 通过 PixelArt 纹理注册表绘制源画布（与特效同处屏幕坐标系）
        PixelArt.drawTextureToCanvas(texId, ctx, screenX - sw / 2, screenY - sh + 4);

        // 受伤时红色覆盖
        if (!this.sheltered && this.health < 50) {
            ctx.fillStyle = `rgba(255, 0, 0, ${0.15 * (1 - this.health / 50)})`;
            ctx.fillRect(screenX - sw / 2, screenY - sh + 4, sw, sh);
        }

        // 遮雨时绿色光晕
        if (this.sheltered) {
            const isAwning = this.underAwning;
            const glowColor = isAwning ? 'rgba(120, 255, 140, 0.18)' : 'rgba(100, 255, 100, 0.1)';
            const glowRadius = isAwning ? 40 : 30;
            const gradient = ctx.createRadialGradient(
                screenX, screenY - 20, 0,
                screenX, screenY - 20, glowRadius
            );
            gradient.addColorStop(0, glowColor);
            gradient.addColorStop(1, 'rgba(100, 255, 100, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(screenX - 45, screenY - 55, 90, 70);
        }
    }

    heal(amount) {
        this.health = Math.min(this.maxHealth, this.health + amount);
    }

    addBuff(type, amount = 1) {
        if (this.buffs.hasOwnProperty(type)) {
            this.buffs[type] += amount;
        }
    }

    getTotalBuffs() {
        return Object.values(this.buffs).reduce((a, b) => a + b, 0);
    }
}

// ========== NPC基类 ==========
class NPC {
    constructor(x, y, type, shirtColor = null) {
        this.x = x;
        this.y = y;
        this.type = type; // 'lument' or 'normal'
        this.vx = 0;
        this.vy = 0;
        this.speed = type === 'lument' ? 1.0 : 1.8;
        this.facing = 'down';
        this.animFrame = 0;
        this.animTimer = 0;
        this.direction = Math.random() > 0.5 ? 1 : -1;
        this.changeDirTimer = 0;
        this.lumentColor = Math.random() > 0.7 ? 'gold' : 'red';
        this.shirtColor = shirtColor || this._randomShirtColor();
        this.dialogueTriggered = false;
        this.id = Math.random().toString(36).substr(2, 9);
    }

    _randomShirtColor() {
        const colors = ['#4a3a2a', '#3a2a4a', '#2a4a3a', '#4a2a2a', '#2a3a4a', '#4a4a2a', '#3a4a4a', '#4a2a4a'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    update(world, dt) {
        this.changeDirTimer += dt;

        // 定期改变方向
        if (this.changeDirTimer > 2000 + Math.random() * 3000) {
            this.direction = -this.direction;
            this.changeDirTimer = 0;

            // 偶尔上下移动
            if (Math.random() > 0.5) {
                this.vy = (Math.random() - 0.5) * this.speed;
            } else {
                this.vy = 0;
            }
        }

        this.vx = this.direction * this.speed;

        // 更新位置
        this.x += this.vx;
        this.y += this.vy;

        // 边界检查
        const bounds = world.getBounds();
        if (this.x < bounds.minX) { this.x = bounds.minX; this.direction = 1; }
        if (this.x > bounds.maxX) { this.x = bounds.maxX; this.direction = -1; }
        if (this.y < bounds.minY) { this.y = bounds.minY; this.vy = Math.abs(this.vy); }
        if (this.y > bounds.maxY) { this.y = bounds.maxY; this.vy = -Math.abs(this.vy); }

        // 朝向
        this.facing = this.vx > 0 ? 'right' : (this.vx < 0 ? 'left' : this.facing);

        // 动画
        if (Math.abs(this.vx) > 0.1 || Math.abs(this.vy) > 0.1) {
            this.animTimer += dt;
            if (this.animTimer > 200) {
                this.animFrame = (this.animFrame + 1) % 4;
                this.animTimer = 0;
            }
        } else {
            this.animFrame = 0;
        }
    }

    render(ctx, camera) {
        const screenX = Math.round(this.x - camera.x);
        const screenY = Math.round(this.y - camera.y);

        // 跳过屏幕外的NPC
        if (screenX < -50 || screenX > ctx.canvas.width + 50) return;

        let texId;
        let dims;
        if (this.type === 'lument') {
            texId = PixelArt.createLumentNPCSprite(this.animFrame, this.lumentColor, this.shirtColor);
            dims = SPRITE_SIZE.npcLument;
        } else {
            texId = PixelArt.createNormalNPCSprite(this.animFrame, this.shirtColor);
            dims = SPRITE_SIZE.npcNormal;
        }

        const sw = dims.w;
        const sh = dims.h;

        // 阴影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.ellipse(screenX, screenY + 2, 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // 撑伞NPC头上有伞遮罩效果
        if (this.type === 'lument') {
            ctx.fillStyle = 'rgba(100, 150, 200, 0.05)';
            ctx.fillRect(screenX - 25, screenY - sh, 50, sh);
        }

        // 普通NPC身上有水滴效果
        if (this.type === 'normal') {
            ctx.fillStyle = 'rgba(100, 150, 200, 0.1)';
            ctx.fillRect(screenX - sw / 2, screenY - sh + 4, sw, sh);
        }

        PixelArt.drawTextureToCanvas(texId, ctx, screenX - sw / 2, screenY - sh + 4);
    }

    getDistanceTo(x, y) {
        return Math.sqrt((this.x - x) ** 2 + (this.y - y) ** 2);
    }
}

// ========== NPC管理器 ==========
class NPCManager {
    constructor() {
        this.npcs = [];
        this.storyNPCs = [];
    }

    init(theme, worldWidth) {
        this.npcs = [];
        this.storyNPCs = [];

        const config = {
            school: { lument: 4, normal: 3 },
            career: { lument: 5, normal: 4 },
            life: { lument: 3, normal: 5 },
            finale: { lument: 6, normal: 6 },
            school_corridor: { lument: 3, normal: 2 },
            company_office: { lument: 4, normal: 2 },
            home: { lument: 0, normal: 0 },
            rooftop: { lument: 0, normal: 0 },
        };

        const c = config[theme] || { lument: 0, normal: 0 };

        // 生成撑伞NPC
        for (let i = 0; i < c.lument; i++) {
            const x = 200 + (i * 600) + Math.random() * 200;
            const y = 360 + Math.random() * 120;
            this.npcs.push(new NPC(x, y, 'lument'));
        }

        // 生成普通NPC
        for (let i = 0; i < c.normal; i++) {
            const x = 150 + (i * 500) + Math.random() * 200;
            const y = 360 + Math.random() * 120;
            this.npcs.push(new NPC(x, y, 'normal'));
        }
    }

    update(world, dt) {
        for (const npc of this.npcs) {
            npc.update(world, dt);
        }
        for (const npc of this.storyNPCs) {
            npc.update(world, dt);
        }
    }

    render(ctx, camera) {
        // 按Y坐标排序，实现深度感
        const allNPCs = [...this.npcs, ...this.storyNPCs].sort((a, b) => a.y - b.y);
        for (const npc of allNPCs) {
            npc.render(ctx, camera);
        }
    }

    getNearestNPC(x, y, maxDist = 60) {
        let nearest = null;
        let minDist = maxDist;
        for (const npc of [...this.npcs, ...this.storyNPCs]) {
            const dist = npc.getDistanceTo(x, y);
            if (dist < minDist) {
                minDist = dist;
                nearest = npc;
            }
        }
        return nearest;
    }

    addStoryNPC(x, y, type) {
        const npc = new NPC(x, y, type);
        npc.speed = 0;
        this.storyNPCs.push(npc);
        return npc;
    }

    clear() {
        this.npcs = [];
        this.storyNPCs = [];
    }
}

// ========== 雨水粒子系统 ==========
// 说明：雨滴/水花/雨幕使用线条描边与渐变绘制，无法用 drawPixel/drawRect
// 等价表达而不改变视觉风格，因此保留直接 ctx 绘制。该 ctx 即引擎主画布上下文
// （Lument.getContext()），摄像机已由 World.updateCamera() 调用
// Lument.setCamera() 统一注册，坐标系与原版一致。
class RainSystem {
    constructor() {
        this.particles = [];
        this.splashes = [];
        this.intensity = 1.0;
        this.maxParticles = 300;
    }

    init(intensity = 1.0) {
        this.intensity = intensity;
        this.particles = [];
        this.splashes = [];
        this.maxParticles = Math.floor(300 * intensity);
    }

    update(canvasWidth, canvasHeight, camera, dt) {
        // 生成新雨滴
        const spawnCount = Math.floor(this.intensity * 8);
        for (let i = 0; i < spawnCount; i++) {
            if (this.particles.length < this.maxParticles) {
                this.particles.push({
                    x: camera.x + Math.random() * (canvasWidth + 200) - 100,
                    y: camera.y - 50,
                    vx: -1.5,
                    vy: 8 + Math.random() * 4,
                    length: 8 + Math.random() * 6,
                    alpha: 0.3 + Math.random() * 0.4,
                });
            }
        }

        // 更新雨滴
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;

            // 雨滴落地 - 生成水花
            if (p.y > camera.y + canvasHeight + 50) {
                this.particles.splice(i, 1);
                continue;
            }

            // 检查是否碰到地面（简化版：在街道高度时生成水花）
            if (p.y > 380 && p.y < 520 && Math.random() > 0.95) {
                this.splashes.push({
                    x: p.x,
                    y: p.y,
                    life: 200,
                    maxLife: 200,
                });
                this.particles.splice(i, 1);
            }
        }

        // 更新水花
        for (let i = this.splashes.length - 1; i >= 0; i--) {
            const s = this.splashes[i];
            s.life -= dt;
            if (s.life <= 0) {
                this.splashes.splice(i, 1);
            }
        }
    }

    render(ctx, camera) {
        ctx.lineCap = 'round';

        // 绘制雨滴
        for (const p of this.particles) {
            const screenX = p.x - camera.x;
            const screenY = p.y - camera.y;

            if (screenX < -10 || screenX > ctx.canvas.width + 10) continue;
            if (screenY < -10 || screenY > ctx.canvas.height + 10) continue;

            ctx.strokeStyle = `rgba(120, 170, 210, ${p.alpha})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(screenX, screenY);
            ctx.lineTo(screenX + p.vx * p.length * 0.3, screenY + p.vy * p.length * 0.3);
            ctx.stroke();
        }

        // 绘制水花
        for (const s of this.splashes) {
            const screenX = s.x - camera.x;
            const screenY = s.y - camera.y;
            const progress = 1 - (s.life / s.maxLife);
            const radius = 2 + progress * 5;
            const alpha = (1 - progress) * 0.4;

            ctx.strokeStyle = `rgba(120, 170, 210, ${alpha})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(screenX, screenY, radius, radius * 0.4, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 整体雨幕效果
        ctx.fillStyle = `rgba(40, 60, 100, ${0.03 * this.intensity})`;
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    setIntensity(intensity) {
        this.intensity = intensity;
        this.maxParticles = Math.floor(300 * intensity);
    }
}

// ========== Buff道具 ==========
class BuffItem {
    constructor(x, y, type, buffType) {
        this.x = x;
        this.y = y;
        this.type = type;     // 'book', 'medal', 'heart'
        this.buffType = buffType; // 对应Player.buffs的key
        this.collected = false;
        this.bobOffset = 0;
        this.bobTimer = 0;
    }

    update(dt) {
        this.bobTimer += dt;
        this.bobOffset = Math.sin(this.bobTimer / 300) * 3;
    }

    render(ctx, camera) {
        if (this.collected) return;
        const screenX = this.x - camera.x;
        const screenY = this.y - camera.y + this.bobOffset;

        if (screenX < -20 || screenX > ctx.canvas.width + 20) return;

        // 光晕
        const gradient = ctx.createRadialGradient(
            screenX + 15, screenY + 15, 0,
            screenX + 15, screenY + 15, 25
        );
        gradient.addColorStop(0, 'rgba(255, 220, 100, 0.2)');
        gradient.addColorStop(1, 'rgba(255, 220, 100, 0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(screenX - 10, screenY - 10, 50, 50);

        // 道具以左上角对齐、原生尺寸绘制
        const texId = PixelArt.createBuffItem(this.type);
        PixelArt.drawTextureToCanvas(texId, ctx, screenX, screenY);
    }

    checkPickup(player) {
        if (this.collected) return false;
        const dist = Math.sqrt((this.x - player.x) ** 2 + (this.y - player.y) ** 2);
        if (dist < 30) {
            this.collected = true;
            player.addBuff(this.buffType);
            if (this.type === 'heart') {
                player.heal(20);
            }
            return true;
        }
        return false;
    }
}

// ========== 故事NPC（碰触触发对话） ==========
class StoryNPC {
    constructor(x, y, npcType, encounterIndex, shirtColor = null, lumentColor = null, isFallen = false, nameTag = null) {
        this.x = x;
        this.y = y;
        this.npcType = npcType; // 'lument' 或 'normal'
        this.encounterIndex = encounterIndex;
        this.triggered = false;
        this.animFrame = 0;
        this.animTimer = 0;
        this.bobOffset = 0;
        this.bobTimer = Math.random() * 1000;
        this.indicatorAlpha = 0;
        this.shirtColor = shirtColor || this._randomShirtColor();
        this.lumentColor = lumentColor || (npcType === 'lument' ? (Math.random() > 0.5 ? 'gold' : 'red') : null);
        this.id = Math.random().toString(36).substr(2, 9);
        // 散开动画支持（霸凌场景）
        this.scatterTargetX = null;
        this.scatterTargetY = null;
        this.scattering = false;
        this.scatterSpeed = 4.0;
        this.removed = false;
        this.isDecoration = false; // 装饰NPC（如霸凌者），不触发对话
        this.homeX = x; // 原始位置（散开后可回到）
        this.homeY = y;
        // 倒地状态（老头专用）
        this.isFallen = isFallen;
        this.fallenTimer = 0;
        this.fallenBlink = false;
        // 名字标签
        this.nameTag = nameTag;
    }

    _randomShirtColor() {
        const colors = ['#4a3a2a', '#3a2a4a', '#2a4a3a', '#4a2a2a', '#2a3a4a', '#4a4a2a', '#3a4a4a', '#4a2a4a'];
        return colors[Math.floor(Math.random() * colors.length)];
    }

    update(player, dt) {
        if (this.removed) return;

        // 散开动画
        if (this.scattering && this.scatterTargetX !== null) {
            const dx = this.scatterTargetX - this.x;
            const dy = this.scatterTargetY - this.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < 10) {
                this.removed = true;
                return;
            }
            this.x += (dx / dist) * this.scatterSpeed;
            this.y += (dy / dist) * this.scatterSpeed;
            this.animTimer += dt;
            if (this.animTimer > 120) {
                this.animFrame = (this.animFrame + 1) % 4;
                this.animTimer = 0;
            }
            return;
        }

        if (this.triggered) return;

        // 倒地NPC：闪烁动画，不走动
        if (this.isFallen) {
            this.fallenTimer += dt;
            if (this.fallenTimer > 600) {
                this.fallenBlink = !this.fallenBlink;
                this.fallenTimer = 0;
            }
            // 仍然显示"!"指示器
            const dist = Math.sqrt((this.x - player.x) ** 2 + (this.y - player.y) ** 2);
            if (dist < 140) {
                this.indicatorAlpha = Math.min(1, this.indicatorAlpha + dt / 300);
            } else {
                this.indicatorAlpha = Math.max(0, this.indicatorAlpha - dt / 300);
            }
            return;
        }

        this.bobTimer += dt;
        this.bobOffset = Math.sin(this.bobTimer / 500) * 1.5;

        // 轻微待机动画
        this.animTimer += dt;
        if (this.animTimer > 600) {
            this.animFrame = (this.animFrame + 1) % 2;
            this.animTimer = 0;
        }

        // 根据距离显示/隐藏"!"指示器（仅非装饰NPC）
        if (!this.isDecoration) {
            const dist = Math.sqrt((this.x - player.x) ** 2 + (this.y - player.y) ** 2);
            if (dist < 120) {
                this.indicatorAlpha = Math.min(1, this.indicatorAlpha + dt / 300);
            } else {
                this.indicatorAlpha = Math.max(0, this.indicatorAlpha - dt / 300);
            }
        }
    }

    // 碰撞检测：使用简单距离判定（与原版一致），也可改用 Lument.checkCollision
    checkCollision(player) {
        if (this.triggered || this.removed || this.isDecoration) return false;
        const dist = Math.sqrt((this.x - player.x) ** 2 + (this.y - player.y) ** 2);
        return dist < 40;
    }

    // 触发散开（霸凌者逃跑）
    scatter() {
        this.scattering = true;
        // 随机选择散开方向（远离中心点）
        const angle = Math.random() * Math.PI * 2;
        const dist = 300 + Math.random() * 200;
        this.scatterTargetX = this.x + Math.cos(angle) * dist;
        this.scatterTargetY = this.y + Math.sin(angle) * dist;
    }

    render(ctx, camera) {
        if (this.triggered || this.removed) return;

        const screenX = Math.round(this.x - camera.x);
        const screenY = Math.round(this.y - camera.y + (this.isFallen ? 0 : this.bobOffset));

        if (screenX < -60 || screenX > ctx.canvas.width + 60) return;

        let texId;
        let dims;
        if (this.isFallen) {
            texId = PixelArt.createFallenNPCSprite();
            dims = SPRITE_SIZE.npcFallen;
        } else if (this.npcType === 'lument') {
            texId = PixelArt.createLumentNPCSprite(this.animFrame, this.lumentColor, this.shirtColor);
            dims = SPRITE_SIZE.npcLument;
        } else {
            texId = PixelArt.createNormalNPCSprite(this.animFrame, this.shirtColor);
            dims = SPRITE_SIZE.npcNormal;
        }

        const sw = dims.w;
        const sh = dims.h;

        // 阴影
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.beginPath();
        ctx.ellipse(screenX, screenY + 2, 12, 4, 0, 0, Math.PI * 2);
        ctx.fill();

        // 撑伞NPC的伞遮罩效果
        if (!this.isFallen && this.npcType === 'lument') {
            ctx.fillStyle = 'rgba(100, 150, 200, 0.05)';
            ctx.fillRect(screenX - 25, screenY - sh, 50, sh);
        }

        // 倒地NPC闪烁效果
        if (this.isFallen && this.fallenBlink) {
            ctx.globalAlpha = 0.6;
        }

        PixelArt.drawTextureToCanvas(texId, ctx, screenX - sw / 2, screenY - sh + 4);

        // 恢复透明度
        if (this.isFallen) {
            ctx.globalAlpha = 1;
        }

        // "!" 指示器（仅非装饰NPC且非散开状态）
        if (!this.isDecoration && !this.scattering && this.indicatorAlpha > 0.1) {
            const indBobY = Math.sin(this.bobTimer / 200) * 3;
            // 光晕背景
            ctx.fillStyle = `rgba(255, 220, 80, ${this.indicatorAlpha * 0.25})`;
            ctx.beginPath();
            ctx.arc(screenX, screenY - sh + 2 + indBobY, 9, 0, Math.PI * 2);
            ctx.fill();
            // "!" 符号
            ctx.fillStyle = `rgba(255, 230, 100, ${this.indicatorAlpha})`;
            ctx.font = 'bold 18px MinecraftAE, monospace';
            ctx.textAlign = 'center';
            ctx.fillText('!', screenX, screenY - sh + 5 + indBobY);
        }

        // 名字标签（NPC头顶）
        if (this.nameTag && !this.isDecoration && !this.scattering) {
            const nameY = screenY - sh - 10 + (this.isFallen ? 0 : this.bobOffset);
            ctx.font = '11px MinecraftAE, monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            // 名字背景框
            const textWidth = ctx.measureText(this.nameTag).width;
            ctx.fillStyle = 'rgba(10, 15, 25, 0.75)';
            ctx.fillRect(screenX - textWidth / 2 - 5, nameY - 8, textWidth + 10, 16);
            // 名字边框
            ctx.strokeStyle = 'rgba(80, 100, 130, 0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(screenX - textWidth / 2 - 5, nameY - 8, textWidth + 10, 16);
            // 名字文字
            const nameColor = this.npcType === 'lument' ? '#dcc88a' : '#aabbcc';
            ctx.fillStyle = nameColor;
            ctx.fillText(this.nameTag, screenX, nameY);
        }
    }
}
