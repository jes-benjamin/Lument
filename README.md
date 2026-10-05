# Lument v2.0.0 · LumentCube 分支（Cube / 3D）

> **当前分支 `LumentCube`**：在 Lument 引擎之上新增 **3D 能力分支**，代号 **Cube**。在完全兼容原 2D / GAL / Live2D 能力的同时，新增原生 3D 渲染与主流 3D 建模文件加载（glTF 2.0 / OBJ / STL / PLY / DAE，可选 FBX，Blender 桥接）。
> 其余分支：`main`（通用 2D）、`LumentGAL`（视觉小说 / Live2D）。

轻量级跨平台游戏引擎，支持 C++/Python/Java/HTML 多语言开发，适配桌面、移动、Web 多设备平台。
**v2.0.0 起同时具备 2D 与 3D 能力**。

## 引擎架构

```
┌──────────────────────────────────────────────────────┐
│         游戏代码 (C++/Python/Java/JS)                  │
│       2D 游戏 / 像素风 / 剧情 RPG / 休闲游戏            │
├──────────────────────────────────────────────────────┤
│    Python Binding  │  Java JNI  │  Web JS             │
├──────────────────────────────────────────────────────┤
│             C ABI (lument.h)                         │
├──────────────────────────────────────────────────────┤
│  Core Engine (C++17)                                │
│  ┌──────────┬──────────┬──────────┬──────────┐       │
│  │ Renderer │ Physics  │  Audio   │    AI    │       │
│  │  (ECS)   │ 2D 刚体  │ 3D 空间  │ 行为树   │       │
│  ├──────────┼──────────┼──────────┼──────────┤       │
│  │  Input   │  Scene   │ Storage  │    UI    │       │
│  │  多端输入 │ 场景管理  │ 存档系统  │  UI 组件 │       │
│  └──────────┴──────────┴──────────┴──────────┘       │
│  ┌──────────────────────────────────────────────┐    │
│  │          Network 网络模块 (HTTP/WebSocket)    │    │
│  └──────────────────────────────────────────────┘    │
├──────────────────────────────────────────────────────┤
│  OpenGL ES 2.0 │ Canvas2D │ WebGL                     │
├──────────────────────────────────────────────────────┤
│  Linux │ Windows │ macOS │ Android │ Web              │
└──────────────────────────────────────────────────────┘
```

## v1.3.0 新增特性

- **UI 系统自动化和控件补全**: 新增 7 种控件（Dropdown/Toggle/Scrollview/Tooltip/Divider/Spinner/Icon），主题系统（统一配色），自动尺寸（按内容/子控件自适应），流式布局（FLOW 自动换行），声明式 UI 构建（JSON → 控件树），控件树调试导出，按名查找控件
- **基础渲染图元和批处理**: 新增 6 种图元（Circle/Line/Triangle/Polygon/Ellipse/Point），手动批处理 API（beginBatch/batchQuad/batchTriangle/endBatch），重构 SpriteCmd 支持任意四边形/三角形
- **物理引擎空间分区和调试**: 均匀网格（Grid）与四叉树（Quadtree）宽相检测，物理调试渲染（body 形状/碰撞接触点/空间分区网格可视化），候选对数量统计
- **工程化**: npm 包（package.json），TypeScript 类型定义（lument.d.ts），v1.3 示例页面，62 项自动化测试套件

## v1.2.0 特性

- **2D 物理模拟**: 刚体动力学、自定义阻尼函数、重力控制、碰撞检测与响应
- **3D 空间音频**: 支持主流音频格式（MP3/WAV/OGG），空间音频定位，音量/音调控制
- **网络模块**: HTTP/HTTPS 请求、WebSocket 长连接，厂商可自行接入账户登录、游戏数据同步上传
- **人工智能模块**: 行为树、有限状态机、A* 路径搜索、黑板系统，支持 AI 深度开发
- **图形渲染增强**: 后处理效果、粒子系统、精灵动画、纹理图集
- **ECS 系统**: 实体组件系统，稀疏集合 O(1) 查找

## 设计特点

- **低占用**: 对象池 + 空闲链表，热路径零动态分配
- **高性能**: ECS 稀疏集合 O(1) 查找，精灵按纹理批量提交
- **统一 C ABI**: 100+ C 接口函数，所有语言共用同一套核心
- **多语言**: C++ 直接调用 / Python ctypes / Java JNI / JS 原生实现
- **跨平台**: Linux / Windows / macOS / Android / Web 一套代码全平台运行

## 应用场景

- 2D 像素风/矢量风游戏
- **视觉小说 / 美少女游戏（GAL）** ← `LumentGAL` 分支重点优化
- 剧情 RPG / 休闲游戏
- 物理模拟游戏
- 网络游戏（接入网络模块）
- AI 行为驱动的 NPC 系统
- **3D 模型预览 / 3D 场景 / 加载 glTF·OBJ·STL·PLY 等建模文件** ← `LumentCube` 分支新增

## 🌟 LumentGAL 分支 · 视觉小说 / Live2D 能力

### 🎬 GAL 子系统

| 能力 | 说明 |
|------|------|
| **剧本 DSL 解析** | 自定义 GalScript：`角色: 台词` / `@bg` / `@show` / `@choose` / `@if` / `@set` / `@jump` / `@call` 等 20+ 命令，支持行内 `{变量}` 插值 |
| **对话框与打字机** | 圆角对话框 + 名字框，可配置颜色/字体/半径/行高，文字速度 1–10，自动换行，动画显示，点击提示 ▼ |
| **分支选择** | `@choose label|文本;...` 多行选项 UI，支持键盘 `1–9` 快捷键和鼠标点击 |
| **背景 / 立绘 / CG** | 颜色/图片背景切换，立绘槽位 LEFT/CENTER/RIGHT，多种 Tween（淡入/左右上下滑入/缩放/溶解/切），独立 CG 层淡入淡出 |
| **音频** | BGM / SE / VOICE 独立通道，支持音量偏好持久化 |
| **偏好设置** | 文本速度 / 自动播放 / 快进 / 三路音量，localStorage 持久化 |
| **自动 & 快进** | 打字完成后按 autoDelay 自动推进，快进模式按顺序快进至下一选项 |
| **存档 / 读档** | 状态快照存档（剧本、变量、历史、背景、立绘、CG、偏好），任意槽位 + QuickSave/QuickLoad，保存元信息（标题/摘要/时间戳/音量等） |
| **演出系统** | `@shake` 屏幕震动 / `effect fade_to_black / fade_from_black / flash` 淡入淡出闪烁 |
| **剧本状态管理** | 变量系统 `+= -= *= /= %=`，条件跳转 `@if`，标签 `@label`/`@jump`，`@call` / `@return` 子程序栈 |
| **C ABI 声明** | `core/include/lument.h` 追加 `lument_gal_*` 系列接口，方便 C++/Java/Python 未来对接 |
| **TypeScript 类型** | `runtime/js/lument.d.ts` 完整声明 `LumentGalDialogStyle / LumentGalSaveInfo / LumentGalHistoryEntry / LumentGalScript` 等结构 |

### 🎭 Live2D 子系统

| 能力 | 说明 |
|------|------|
| **模型加载** | `live2dLoadModel(model3.json?)`：检测到 Cubism 资源时异步解析 Motions/Expressions/HitAreas；无外部模型时自动走**参数化占位渲染**，开箱即可演示 |
| **动作管理** | 动作分组 `Idle / TapBody / Flick_Head` 等，优先级队列，开始 / 停止 / 查询播放状态，`live2dStartMotion(id, group, idx, priority)` |
| **表情管理** | `neutral / happy / sad / angry / surprise`，参数映射到嘴型/眼开，支持随机表情 |
| **参数控制** | `live2dSetParam / GetParam / ParamAdd / ParamMult`，直接操控 `ParamAngleX/Y / ParamEyeLOpen / ParamMouthOpenY / ParamBreath / ...` |
| **自动动画** | 鼠标视线自动追踪（头+眼）、自动眨眼状态机、语音驱动口型（`ParamMouthOpenY` 随 VOICE 通道变化） |
| **命中测试** | `live2dHitTest(id, sx, sy)` 基于模型 HitAreas 或近似分区，返回 `Head / Body` 等命中文本 |
| **GAL 挂载** | `galAttachLive2d(modelId, slot, z)` 直接把 Live2D 模型作为 GAL 立绘参与槽位、透明度动画、z 排序 |
| **变换** | `LumentLive2DTransform` 支持位置/缩放/旋转/不透明度/宽高/镜像 |
| **C ABI & TS 类型** | `lument.h` 声明、`lument.d.ts` 全量类型 |

### 📚 GalScript 语法速查

```
# 注释
// 另一种注释
@bg #1a2550 FADE 1000              # 切换背景（颜色或图片路径）
@show sprite_id CENTER normal 1 FADE 700    # 展示立绘
@hide sprite_id FADE 500
@cg cg_goodend FADE 800 ; @cg_clear FADE 500
@live2d modelId expression happy
@live2d modelId motion TapBody:0
@bgm bgm_main true 0.7 800 ; @bgm_stop 800
@se click_se 1.0 ; @voice voice001 1.0 由希

由希: 学长，你终于来了！          # 角色台词
旁白: 天台的风轻轻拂过…           # 无冒号行 → 旁白

@choose good|留下来陪我;leave|先回家吧
@label good  ;  @set 花奈好感度 += 1
@if 花奈好感度 >= 3 harem_end
@jump common
@wait click ; @wait 800
@shake 4 400 ; @effect flash 500
@call side_story morning_scene    # 调用其它剧本
@title ; @end                      # 返回标题 / 剧本结束
```

### 🚀 快速体验：LumentGAL Demo

打开仓库中的 [examples/lument_gal_demo.html](examples/lument_gal_demo.html) 即可体验：

- 标题开始 / 回到标题
- 剧本对话 + 打字机 + 自动/快进
- 双 Live2D 角色出场、分支选择（由希线 / 花奈线）、变量与条件跳转
- 文字速度、BGM / SE / 语音 三路音量
- 三槽位存档 + 快速存档 (F5) / 快速读档 (F9)
- 屏幕震动、淡入、闪光演出
- Live2D 侧边控制：表情/动作切换、随机表情、眼/头自动追踪开关、点击模型触发动作
- 完整运行日志

## 🧊 LumentCube 分支 · 3D 能力

> 分支 `LumentCube`（代号 **Cube**）在保留全部 2D / GAL / Live2D 能力的同时，新增一套并行 3D 子系统。完整文档见 [docs/lument_cube.md](docs/lument_cube.md)。

### 📦 原生 3D 模型 / 建模文件支持

| 格式 | 扩展名 | 加载方式 |
|------|--------|----------|
| glTF 2.0 | `.gltf` / `.glb` | **引擎原生解析**（推荐，Blender 官方导出器）|
| Wavefront | `.obj` | 引擎原生解析 |
| STL | `.stl` | 引擎原生解析（ASCII / 二进制）|
| PLY | `.ply` | 引擎原生解析（ASCII / 二进制小端）|
| COLLADA | `.dae` | 引擎原生解析 |
| FBX | `.fbx` | 可选 Assimp 集成（`-DLUMENT_ENABLE_ASSIMP=ON`）|
| Blender | `.blend` | **Blender CLI 桥接** → 导出 glTF 后加载 |

> **关于 Blender `.blend`**：Blender 原生二进制无公开稳定规范，业界通行做法是经 Blender 导出为 glTF 2.0（Khronos 标准）。引擎对 `.blend` 即自动调用 `blender` CLI 导出 `.glb` 再加载；也可手动导出 `.glb`/`.gltf` 后直接加载。详见 [docs/lument_cube.md §6](docs/lument_cube.md)。

### 🧩 3D 子系统组成

- **3D 数学**：`vec3 / quat / mat4`（透视、lookAt、四元数欧拉、TRS 组合）
- **3D 场景图**：节点变换层级（位置/旋转/缩放/父子关系）
- **网格 / 材质 / 模型**：PBR（金属度/粗糙度）+ 反照率/法线/自发光贴图
- **3D 渲染**：WebGL2（JS Runtime 浏览器真渲染）/ GLES2（C++ 移动端与 Emscripten）；无 GPU 后端下 API 与加载器仍可用（无头测试友好）
- **约 50+ 个 `lument_cube_*` C ABI 函数**，与 2D ABI 并存

### 🚀 快速体验 Lument Cube 3D

用浏览器打开 [examples/lument_cube_demo.html](examples/lument_cube_demo.html)：

- 程序化立方体 / 球体 / 平面实时旋转预览（WebGL2）
- 鼠标拖拽轨道相机、滚轮缩放
- 粘贴 glTF / OBJ / STL / PLY 的 URL 原生加载并渲染

```javascript
Lument.Cube.init(document.getElementById('cube-canvas')); // 初始化 WebGL2
const box = Lument.Cube.createBox(2,2,2);
const root = Lument.Cube.createNode();
Lument.Cube.nodeSetMesh(root, box);
Lument.Cube.setLight([5,8,5], [1,1,1], 1.2, 1);
const camera = { position:[0,1.5,6], target:[0,0,0], up:[0,1,0], fovY:55 };
Lument.Cube.render(camera, root);
```

## 目录结构

| 路径 | 说明 |
|------|------|
| `core/include/lument.h` | C ABI 公共头文件（**150+ API 函数**，含 3D 子系统）|
| `core/include/lument_internal.h` | 内部头文件 |
| `core/include/lument_renderer_backend.h` | 渲染后端抽象接口 |
| `core/src/` | C++17 核心实现（含 `lument_3d.cpp` 3D 子系统）|
| `bindings/python/` | Python ctypes 绑定 |
| `bindings/java/` | Java JNI 绑定 |
| `platforms/android/` | Android 平台层 |
| `runtime/js/lument.js` | Web 运行时（JS/Canvas2D + `Lument.Cube` WebGL2 3D 实现）|
| `tools/blender_export_glb.py` | Blender `.blend → glTF` 桥接导出脚本 |
| `game/` | 《遮伞世界》游戏 Demo（使用引擎构建）|
| `docs/` | 开发文档与 API 参考（含 `lument_cube.md`）|
| `examples/` | 示例代码（含 `lument_cube_demo.html`）|
| `tests/` | 单元测试（C++ / JS 3D 加载器）|
| `CMakeLists.txt` | CMake 构建系统 |
| `build.sh` | 跨平台构建脚本 |

## 引擎模块 API 统计

| 模块 | API 数量 | 说明 |
|------|---------|------|
| 核心 | 8 | init/shutdown/frame/stats/platform |
| 渲染 | 16 | clear/camera/rect/sprite/text/pixel/texture/粒子/后处理 |
| 物理 | 14 | 刚体/力/冲量/重力/阻尼/碰撞检测/射线 |
| 输入 | 7 | key/touch/joystick |
| 音频 | 10 | load/play/stop/volume/3D 空间/音调 |
| 网络 | 8 | HTTP 请求/WebSocket/下载/上传 |
| AI | 12 | 行为树/状态机/A*/黑板 |
| ECS | 13 | entity/transform/sprite/collider/script |
| 场景 | 4 | load/switch/background |
| UI/应用 | 33 | widget/layout/event/navigation |
| 存储 | 3 | save/load/clear |
| 工具 | 4 | time/random/log |
| **Cube 3D** | **52** | 3D 数学/相机/网格/材质/模型加载/场景图/光照/渲染 |
| **合计** | **184** | 统一 C ABI（2D + 3D 并存）|

## 快速开始

### Web 游戏开发（最快上手）

```html
<!DOCTYPE html>
<html>
<head>
    <script src="runtime/js/lument.js"></script>
</head>
<body>
    <canvas id="game-canvas"></canvas>
    <script>
        Lument.init({
            platform: Lument.PLATFORM.WEB,
            rendererType: Lument.RENDERER.CANVAS2D,
            width: 960, height: 540,
            targetFPS: 60,
        });

        let player = { x: 100, y: 400, vx: 0, vy: 0 };

        Lument.run(
            // update
            (dt) => {
                player.x += player.vx * dt;
                player.y += player.vy * dt;
            },
            // render
            () => {
                Lument.Renderer.clear(15, 15, 30);
                Lument.Renderer.drawRect(player.x, player.y, 32, 32, 100, 200, 255);
            }
        );
    </script>
</body>
</html>
```

### C++ 物理模拟示例

```cpp
#include "lument.h"

int main() {
    LumentConfig config = {
        .platform = LUMENT_PLATFORM_DESKTOP,
        .rendererType = LUMENT_RENDERER_OPENGL,
        .width = 960, .height = 540,
        .targetFPS = 60,
    };
    lument_init(&config);

    // 创建物理世界
    LumentPhysicsWorld world = lument_physics_create_world();
    lument_physics_set_gravity(world, 0.0f, -980.0f);

    // 创建动态刚体
    LumentRigidBody ball = lument_physics_create_body(world, LUMENT_BODY_DYNAMIC);
    lument_physics_set_position(ball, 100.0f, 400.0f);
    lument_physics_set_mass(ball, 1.0f);
    lument_physics_add_circle_collider(ball, 16.0f, 0.8f); // 半径16, 弹性0.8

    while (lument_is_running()) {
        lument_begin_frame();
        lument_physics_step(world, 1.0f / 60.0f);

        float x, y;
        lument_physics_get_position(ball, &x, &y);
        lument_draw_circle(x, y, 16, 255, 100, 100);

        lument_end_frame();
    }

    lument_shutdown();
    return 0;
}
```

### 网络模块示例（JS）

```javascript
// HTTP 请求
Lument.Network.httpGet('https://api.example.com/user/profile', (response) => {
    const data = JSON.parse(response);
    console.log('用户:', data.nickname);
}, (error) => {
    console.error('请求失败:', error);
});

// WebSocket
const ws = Lument.Network.createWebSocket('wss://game.example.com/ws');
ws.onOpen = () => ws.send(JSON.stringify({ type: 'login', token: 'xxx' }));
ws.onMessage = (data) => console.log('收到:', data);
```

### AI 行为树示例（JS）

```javascript
const tree = Lument.AI.createBehaviorTree('enemy_patrol');

const patrol = new Lument.AI.SequenceNode([
    new Lument.AI.MoveToNode(100, 200),
    new Lument.AI.WaitNode(2.0),
    new Lument.AI.MoveToNode(300, 200),
    new Lument.AI.WaitNode(2.0),
]);

const chase = new Lument.AI.SelectorNode([
    new Lument.AI.ConditionNode(() => playerInRange()),
    new Lument.AI.ChaseNode('player'),
]);

tree.setRoot(new Lument.AI.SelectorNode([chase, patrol]));
tree.start();
```

## 构建方式

### C++ 核心 (CMake)
```bash
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
make -j$(nproc)
```

### Android APK
```bash
./build.sh apk
```

### Web 打包
```bash
./build.sh web
```

### Python 绑定
```bash
pip install -e bindings/python
```

### 一键构建全部
```bash
./build.sh all
```

## 开发文档

完整开发文档请查看 `docs/` 目录：

- [开发文档首页](docs/lument_docs_v1.2.html) - 完整的 HTML 版开发文档
- [开发指南](docs/lument_dev_guide_v1.2.md) - Markdown 版开发指南
- [Scene2D API](docs/scene2d_api.md) - 2D 场景 API 参考

## 示例游戏

本仓库包含一个完整的示例游戏 **《遮伞世界》**，位于 `game/` 目录：

- 像素风剧情 RPG
- 七大章节，七个结局
- 成就系统
- 对话系统
- 多场景（暴雨街道、学校走廊、公司办公室等）

直接在浏览器打开 `game/index.html` 即可体验。

## 许可证

MIT License - 自由使用、修改、分发。
