# Lument Engine v1.2.0 开发者文档

> 跨平台 2D 游戏引擎 — C ABI 核心 + Web Runtime
> 新增模块：图形渲染增强、2D物理模拟、增强音频系统、网络模块、AI模块

## 目录

1. [引擎概览](#1-引擎概览)
2. [2D 物理模拟](#2-2d-物理模拟)
3. [增强音频系统](#3-增强音频系统)
4. [网络模块](#4-网络模块)
5. [AI 模块](#5-ai-模块)
6. [快速上手示例](#6-快速上手示例)

---

## 1. 引擎概览

### 版本信息

| 项目 | 值 |
|------|-----|
| 版本号 | 1.2.0 |
| C ABI | `lument.h` |
| Web Runtime | `lument.js` |
| 构建系统 | CMake |
| 支持平台 | Web / Android / Desktop (Linux/Windows/macOS) |

### 模块总览

| 模块 | C++ 源文件 | 状态 |
|------|-----------|------|
| 核心引擎 | `lument_core.cpp` | 已有 |
| 渲染系统 | `lument_renderer.cpp` | 已有 + 2D场景渲染增强(v1.1) |
| ECS 实体系统 | `lument_ecs.cpp` | 已有 |
| UI 系统 | `lument_ui.cpp` | 已有 |
| 音频系统 | `lument_audio.cpp` | 已有 + 增强音频(v1.2) |
| **2D物理模拟** | `lument_physics.cpp` | **新增(v1.2)** |
| **网络模块** | `lument_network.cpp` | **新增(v1.2)** |
| **AI 模块** | `lument_ai.cpp` | **新增(v1.2)** |

---

## 2. 2D 物理模拟

### 2.1 物理世界

```javascript
// 设置重力（默认 0, 9.8）
Lument.physicsSetGravity(0, 500);  // 像素/秒²

// 设置迭代次数（影响精度与性能）
Lument.physicsSetIterations(8, 3);

// 重置物理世界
Lument.physicsReset();
```

### 2.2 创建物理体

```javascript
// 创建动态体
const bodyId = Lument.physicsCreateBody({
    type: Lument.BODY.DYNAMIC,    // 静态/动态/运动学
    mass: 1.0,
    restitution: 0.5,             // 弹性 0~1
    friction: 0.3,                // 摩擦 0~1
    linearDamping: 0.1,           // 线性阻尼
    angularDamping: 0.1,          // 角阻尼
    gravityScale: 1.0,            // 重力缩放
}, 100, 200);  // 初始位置

// 设置碰撞形状
Lument.physicsSetShape(bodyId, { type: Lument.SHAPE.AABB, w: 32, h: 32 });
// 或圆形
Lument.physicsSetShape(bodyId, { type: Lument.SHAPE.CIRCLE, radius: 16 });

// 创建静态地面
const groundId = Lument.physicsCreateBody({
    type: Lument.BODY.STATIC,
    mass: 0,
    friction: 0.5,
}, 0, 500);
Lument.physicsSetShape(groundId, { type: Lument.SHAPE.AABB, w: 480, h: 40 });
```

### 2.3 自定义阻尼函数

```javascript
// 自定义阻尼：速度越快阻尼越大
Lument.physicsSetCustomDamping(bodyId, function(velocity, mass, dt, userData) {
    // 返回速度缩放系数 0~1
    const drag = 0.01;
    return Math.max(0, 1 - drag * velocity * dt);
}, null);

// 清除自定义阻尼
Lument.physicsClearCustomDamping(bodyId);
```

### 2.4 施加力与冲量

```javascript
// 施加力（持续力，影响加速度）
Lument.physicsApplyForce(bodyId, 0, -500);  // 向上的力

// 施加冲量（瞬时速度变化）
Lument.physicsApplyImpulse(bodyId, 100, -200);  // 跳跃

// 施加扭矩
Lument.physicsApplyTorque(bodyId, 50);

// 直接设置速度
Lument.physicsSetVelocity(bodyId, 100, 0);
```

### 2.5 碰撞检测

```javascript
// 两个体之间的碰撞检测
const collision = Lument.physicsCheckCollision(bodyA, bodyB);
if (collision) {
    console.log('碰撞点:', collision.point);
    console.log('法线:', collision.normal);
    console.log('穿透深度:', collision.penetration);
}

// 获取某体的所有碰撞
const collisions = Lument.physicsGetCollisions(bodyId, 10);

// 射线检测
const hit = Lument.physicsRaycast(0, 0, 480, 540);
if (hit) {
    console.log('命中体:', hit.bodyId, '位置:', hit.point);
}

// 点查询
const bodyAtPoint = Lument.physicsPointQuery(x, y);

// 碰撞回调
Lument.physicsOnCollision(function(collision, userData) {
    console.log('碰撞:', collision.bodyA, collision.bodyB);
}, null);
```

### 2.6 获取物理体状态

```javascript
const pos = Lument.physicsGetPosition(bodyId);
const vel = Lument.physicsGetVelocity(bodyId);
const state = Lument.physicsGetState(bodyId);
// state: { x, y, vx, vy, ax, ay, angle, angularVel }
```

---

## 3. 增强音频系统

### 3.1 加载音频

```javascript
// 加载音效（自动识别格式：WAV/MP3/OGG）
const sfxId = Lument.loadSound('assets/jump.mp3');

// 加载背景音乐
const bgmId = Lument.loadMusic('assets/bgm.ogg');

// 查看支持的格式
console.log(Lument.getSupportedFormats());  // "WAV,MP3,OGG"
```

### 3.2 播放控制

```javascript
// 播放音效（返回实例ID）
const instId = Lument.playSound(sfxId, 0.8, 1.0, false);
// 参数：音源ID, 音量, 音调(1.0=正常), 是否循环

// 控制播放
Lument.pauseSound(instId);
Lument.resumeSound(instId);
Lument.stopSound(instId);

// 调整参数
Lument.setPitch(instId, 1.5);   // 音调
Lument.setPan(instId, -0.5);    // 声道平衡 -1(左)~1(右)

// 播放进度
const duration = Lument.getAudioDuration(sfxId);  // 秒
const position = Lument.getAudioPosition(instId);  // 秒
Lument.seekAudio(instId, 5.0);  // 跳转

// 淡入淡出
Lument.fadeIn(instId, 2.0);   // 2秒淡入
Lument.fadeOut(instId, 1.5);  // 1.5秒淡出
```

### 3.3 3D 空间音频

```javascript
// 设置听者位置和朝向
Lument.setAudioListener(240, 270, 0, -1);

// 播放3D音效（距离越远音量越小）
const instId = Lument.playSound3d(
    explosionId,  // 音源ID
    100, 200,     // 声源位置
    300,          // 最大听觉距离
    0.8,          // 基础音量
    false         // 是否循环
);
```

### 3.4 音频分组

```javascript
// 主音量
Lument.setMasterVolume(0.8);

// 分组音量 (0=SFX, 1=Music, 2=Voice)
Lument.setGroupVolume(0, 0.5);  // 音效组
Lument.setGroupVolume(1, 0.7);  // 音乐组

// 停止某组所有音频
Lument.stopGroup(1);  // 停止所有音乐
```

---

## 4. 网络模块

### 4.1 HTTP 请求

```javascript
// GET 请求
Lument.httpGet('https://api.example.com/user', function(resp, userData) {
    console.log('状态码:', resp.statusCode);
    console.log('响应:', resp.body);
}, null);

// POST 请求
Lument.httpPost('https://api.example.com/login',
    JSON.stringify({ username: 'player1', password: '123' }),
    function(resp, userData) {
        if (resp.statusCode === 200) {
            const token = Lument.jsonParse(resp.body, 'token');
            Lument.httpSetAuthToken(token);
        }
    }, null);

// PUT / DELETE
Lument.httpPut(url, body, callback, null);
Lument.httpDelete(url, callback, null);

// 通用请求
Lument.httpRequest(
    Lument.HTTP.POST,
    url,
    body,
    'Content-Type:application/json\nAuthorization:Bearer token',
    callback, null
);
```

### 4.2 请求配置

```javascript
// 全局请求头
Lument.httpSetHeader('Content-Type', 'application/json');
Lument.httpSetHeader('X-Game-Version', '1.0');

// 超时设置
Lument.httpSetTimeout(15);  // 秒

// 认证Token（自动添加 Authorization: Bearer xxx 头）
Lument.httpSetAuthToken('eyJhbGciOi...');
```

### 4.3 WebSocket

```javascript
// 连接WebSocket
const wsId = Lument.wsConnect('wss://api.example.com/ws', function(event, data, length, userData) {
    switch (event) {
        case Lument.WS.OPEN:
            console.log('连接已建立');
            break;
        case Lument.WS.MESSAGE:
            console.log('收到消息:', data);
            break;
        case Lument.WS.CLOSE:
            console.log('连接已关闭');
            break;
        case Lument.WS.ERROR:
            console.log('连接错误');
            break;
    }
}, null);

// 发送消息
Lument.wsSendText(wsId, 'Hello Server');
Lument.wsSend(wsId, binaryData, dataLength);

// 关闭连接
Lument.wsClose(wsId);

// 检查连接状态
if (Lument.wsIsConnected(wsId)) { /* ... */ }
```

### 4.4 JSON 工具

```javascript
// 解析JSON
const name = Lument.jsonParse(jsonStr, 'name');       // 字符串
const score = Lument.jsonGetNumber(jsonStr, 'score', 0); // 数值
const active = Lument.jsonGetBool(jsonStr, 'active', false); // 布尔

// 构建JSON
const json = Lument.jsonBuild('name=player1\nscore=100\nlevel=5');
// 结果: {"name":"player1","score":"100","level":"5"}
```

### 4.5 数据同步

```javascript
// 上传游戏数据
Lument.uploadData('https://api.example.com/sync',
    JSON.stringify({ level: 5, score: 1000, items: ['sword', 'shield'] }),
    function(resp, userData) {
        if (resp.statusCode === 200) {
            console.log('数据同步成功');
        }
    }, null);

// 下载数据
Lument.downloadData('https://api.example.com/save/player1', function(resp, userData) {
    if (resp.statusCode === 200) {
        const data = JSON.parse(resp.body);
        // 恢复游戏存档
    }
}, null);
```

---

## 5. AI 模块

### 5.1 行为树

```javascript
// 创建行为树
const treeId = Lument.aiCreateTree();

// 创建节点
const checkEnemy = Lument.aiCreateNode(treeId, Lument.AI.NODE_CONDITION,
    function(entity, dt, userData) {
        // 检查是否有敌人在附近
        const enemy = findNearestEnemy(entity, 200);
        return enemy ? Lument.AI.SUCCESS : Lument.AI.FAILURE;
    }, null);

const chaseEnemy = Lument.aiCreateNode(treeId, Lument.AI.NODE_ACTION,
    function(entity, dt, userData) {
        const enemy = findNearestEnemy(entity, 200);
        if (!enemy) return Lument.AI.FAILURE;
        moveTo(entity, enemy);
        return distance(entity, enemy) < 10 ? Lument.AI.SUCCESS : Lument.AI.RUNNING;
    }, null);

const attackEnemy = Lument.aiCreateNode(treeId, Lument.AI.NODE_ACTION,
    function(entity, dt, userData) {
        attack(entity);
        return Lument.AI.SUCCESS;
    }, null);

// 组装行为树
// 选择器：先检查敌人，成功则继续
const selector = Lument.aiCreateNode(treeId, Lument.AI.NODE_SELECTOR, null, null);
// 顺序节点：追逐 -> 攻击
const sequence = Lument.aiCreateNode(treeId, Lument.AI.NODE_SEQUENCE, null, null);

Lument.aiAddChild(sequence, chaseEnemy);
Lument.aiAddChild(sequence, attackEnemy);
Lument.aiAddChild(selector, checkEnemy);
Lument.aiAddChild(selector, sequence);

// 绑定实体并执行
Lument.aiSetEntity(treeId, npcEntityId);

// 每帧执行
function update() {
    Lument.aiTick(treeId, dt);
}
```

### 5.2 有限状态机

```javascript
// 创建FSM
const fsmId = Lument.aiCreateFsm();

// 添加状态
const patrolState = Lument.aiFsmAddState(fsmId, '巡逻',
    function(entity, dt, userData) {
        patrol(entity);
    }, null);

const chaseState = Lument.aiFsmAddState(fsmId, '追击',
    function(entity, dt, userData) {
        chaseTarget(entity);
    }, null);

const attackState = Lument.aiFsmAddState(fsmId, '攻击',
    function(entity, dt, userData) {
        attackTarget(entity);
    }, null);

// 添加转换（条件函数返回SUCCESS时触发转换）
Lument.aiFsmAddTransition(fsmId, patrolState, chaseState,
    function(entity, dt, userData) {
        return canSeeEnemy(entity) ? Lument.AI.SUCCESS : Lument.AI.FAILURE;
    }, null);

Lument.aiFsmAddTransition(fsmId, chaseState, attackState,
    function(entity, dt, userData) {
        return inAttackRange(entity) ? Lument.AI.SUCCESS : Lument.AI.FAILURE;
    }, null);

Lument.aiFsmAddTransition(fsmId, attackState, chaseState,
    function(entity, dt, userData) {
        return !inAttackRange(entity) ? Lument.AI.SUCCESS : Lument.AI.FAILURE;
    }, null);

// 每帧执行
function update() {
    Lument.aiFsmTick(fsmId, dt);
    console.log('当前状态:', Lument.aiFsmGetStateName(fsmId));
}
```

### 5.3 A* 寻路

```javascript
// 创建网格
const gridId = Lument.aiCreateGrid(48, 54, 10);  // 宽, 高, 格子大小

// 设置障碍物
for (const wall of walls) {
    Lument.aiGridSetBlocked(gridId, wall.x, wall.y, true);
}

// 设置地形代价（沼泽等）
Lument.aiGridSetCost(gridId, 5, 10, 3.0);  // 通过此格代价3倍

// 寻路
const path = Lument.aiFindPath(gridId, 0, 0, 47, 53, 100);
if (path.length > 0) {
    console.log('找到路径，长度:', Lument.aiPathLength(path, path.length));
    // 沿路径移动
    for (const node of path) {
        moveTo(entity, node.x * 10, node.y * 10);
    }
}
```

### 5.4 黑板系统

```javascript
// 创建黑板（AI共享数据存储）
const bbId = Lument.aiCreateBlackboard();

// 写入数据
Lument.aiBbSetString(bbId, 'target', 'enemy_1');
Lument.aiBbSetFloat(bbId, 'health', 75.5);
Lument.aiBbSetInt(bbId, 'ammo', 30);
Lument.aiBbSetBool(bbId, 'inCombat', true);

// 读取数据
const target = Lument.aiBbGetString(bbId, 'target');
const health = Lument.aiBbGetFloat(bbId, 'health', 100);
const ammo = Lument.aiBbGetInt(bbId, 'ammo', 0);
const inCombat = Lument.aiBbGetBool(bbId, 'inCombat', false);

// 删除数据
Lument.aiBbRemove(bbId, 'target');

// 清空
Lument.aiBbClear(bbId);
```

### 5.5 AI Agent 接口

AI Agent 接口专门为人工智能（如LLM）深度开发设计，允许AI直接控制游戏实体。

```javascript
// 注册AI Agent
const agentId = Lument.aiRegisterAgent('AI助手', function(entity, dt, userData) {
    // AI思考逻辑：可以查询引擎状态、做出决策
    const state = JSON.parse(Lument.aiAgentQuery('status'));

    // 根据引擎状态做出决策
    if (state.physicsBodyCount > 10) {
        // 做出某种反应
    }

    // 控制实体行为
    Lument.physicsApplyForce(entity, 0, -500);
}, null);

// 设置AI目标
Lument.aiAgentSetTarget(agentId, targetEntityId);

// 每帧执行AI思考
function update() {
    Lument.aiAgentTick(agentId, dt);
}

// 查询引擎状态（供AI分析）
const status = Lument.aiAgentQuery('full_status');
// 返回JSON: { engineVersion, entityCount, physicsBodyCount, lightCount, agents: [...] }
```

---

## 6. 快速上手示例

### 综合示例：带物理和AI的简单场景

```javascript
// 初始化引擎
Lument.init({ platform: Lument.PLATFORM.WEB, width: 480, height: 540, targetFPS: 60 });

// === 物理设置 ===
Lument.physicsSetGravity(0, 500);

// 创建地面
const groundId = Lument.physicsCreateBody(
    { type: Lument.BODY.STATIC, mass: 0, friction: 0.5 }, 0, 500);
Lument.physicsSetShape(groundId, { type: Lument.SHAPE.AABB, w: 480, h: 40 });

// 创建玩家
const playerBody = Lument.physicsCreateBody(
    { type: Lument.BODY.DYNAMIC, mass: 1, restitution: 0.2, friction: 0.3 }, 240, 100);
Lument.physicsSetShape(playerBody, { type: Lument.SHAPE.AABB, w: 24, h: 32 });

// === AI设置 ===
const fsmId = Lument.aiCreateFsm();
const idleState = Lument.aiFsmAddState(fsmId, '待机', function(e, dt) {
    // 待机逻辑
}, null);
const moveState = Lument.aiFsmAddState(fsmId, '移动', function(e, dt) {
    const pos = Lument.physicsGetPosition(playerBody);
    if (pos) Lument.physicsApplyForce(playerBody, 100, 0);
}, null);
Lument.aiFsmAddTransition(fsmId, idleState, moveState, function(e, dt) {
    return Lument.keyDown(Lument.KEY.RIGHT) ? Lument.AI.SUCCESS : Lument.AI.FAILURE;
}, null);
Lument.aiFsmAddTransition(fsmId, moveState, idleState, function(e, dt) {
    return !Lument.keyDown(Lument.KEY.RIGHT) ? Lument.AI.SUCCESS : Lument.AI.FAILURE;
}, null);

// === 音频设置 ===
const bgmId = Lument.loadMusic('assets/bgm.ogg');
Lument.setGroupVolume(1, 0.5);
const bgmInst = Lument.playSound(bgmId, 0.5, 1.0, true);
Lument.fadeIn(bgmInst, 2.0);

// === 碰撞回调 ===
Lument.physicsOnCollision(function(col, data) {
    if (col.bodyA === playerBody || col.bodyB === playerBody) {
        Lument.playSound(jumpSfx, 0.3, 1.2, false);
    }
}, null);

// === 主循环 ===
function render() {
    Lument.beginFrame();

    // AI更新
    Lument.aiFsmTick(fsmId, Lument.getDeltaTime() * 0.001);

    // 同步物理体位置到渲染
    const pos = Lument.physicsGetPosition(playerBody);
    if (pos) {
        Lument.drawRect({ x: pos.x, y: pos.y, w: 24, h: 32 },
            { r: 100, g: 200, b: 255, a: 255 }, true);
    }

    Lument.endFrame();
    requestAnimationFrame(render);
}
render();
```

---

## API 常量速查

```javascript
Lument.BODY     = { STATIC: 0, DYNAMIC: 1, KINEMATIC: 2 }
Lument.SHAPE    = { AABB: 0, CIRCLE: 1 }
Lument.AI       = { SUCCESS: 0, FAILURE: 1, RUNNING: 2,
                    NODE_ACTION: 0, NODE_CONDITION: 1, NODE_SEQUENCE: 2,
                    NODE_SELECTOR: 3, NODE_PARALLEL: 4, NODE_DECORATOR: 5 }
Lument.HTTP     = { GET: 0, POST: 1, PUT: 2, DELETE: 3, PATCH: 4 }
Lument.WS       = { OPEN: 0, MESSAGE: 1, CLOSE: 2, ERROR: 3 }
Lument.LIGHT    = { POINT: 0, DIRECTIONAL: 1, SPOT: 2 }
Lument.PLATFORM = { DESKTOP: 0, ANDROID: 1, IOS: 2, WEB: 3 }
Lument.KEY      = { NONE: 0, LEFT: 1, RIGHT: 2, UP: 3, DOWN: 4,
                    ACTION: 5, CANCEL: 6, MENU: 7, MAX: 8 }
```
