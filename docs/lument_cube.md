# Lument Cube · 3D 引擎分支文档

> **分支 `LumentCube`（发行代号 `Cube`）** — 在 Lument v2.0.0 引擎之上新增的 3D 能力分支。
> 原生支持主流 3D 建模文件与模型，复用全部 2D 能力（渲染/物理/UI/音频/AI/网络）。

## 1. 概览

Lument 原本是 2D 游戏引擎；`LumentCube` 在不破坏 2D ABI 的前提下，新增了一套并行的 3D 子系统：

- **3D 数学**：`vec3 / quat / mat4`（透视矩阵、lookAt、四元数欧拉、TRS 组合）。
- **3D 场景图**：节点变换层级（位置/旋转/缩放/父子关系）。
- **网格 / 材质 / 模型**：统一的数据抽象，支持 PBR（金属度/粗糙度）+ 反照率/法线/自发光贴图。
- **原生模型加载**：glTF 2.0（`.gltf`/`.glb`）、Wavefront OBJ、STL、PLY、COLLADA（`.dae`）；并通过可选 **Assimp** 集成支持 FBX，通过 **Blender CLI 桥接** 支持 `.blend`。
- **3D 渲染**：WebGL2（JS Runtime，浏览器可直接运行）/ GLES2（C++ 移动端与 Emscripten 真渲染）；无 GPU 后端（桌面 Null）下 API 仍可用、加载器仍工作（便于无头测试）。

## 2. 支持的 3D 格式

| 格式 | 扩展名 | 加载方式 | 说明 |
|------|--------|----------|------|
| glTF 2.0 | `.gltf` / `.glb` | 引擎原生解析 | **推荐格式**。Blender 官方内置导出器，"File → Export → glTF 2.0"。 |
| Wavefront | `.obj` | 引擎原生解析 | 通用交换格式；读取几何，材质走默认白。 |
| STL | `.stl` | 引擎原生解析 | 支持 ASCII 与二进制；适合 3D 打印/工业模型。 |
| PLY | `.ply` | 引擎原生解析 | 支持 ASCII 与二进制小端；支持顶点色。 |
| COLLADA | `.dae` | 引擎原生解析 | 尽力而为的 XML 解析（位置/法线/索引）。 |
| FBX | `.fbx` | **可选 Assimp** | 编译时开启 `-DLUMENT_ENABLE_ASSIMP=ON`。 |
| Blender | `.blend` | **Blender 桥接** | 调用 `blender` CLI 导出为 `.glb` 后加载（见第 6 节）。 |

> 关于 **Blender / `.blend`**：Blender 的原生二进制 `.blend` 没有稳定公开的规范，业界通行做法是**经 Blender 导出为 glTF 2.0**（Khronos 标准，Blender 官方一级支持）。Lument Cube 对 `.blend` 的处理就是自动调用 Blender 导出 glTF 后加载——这是最稳健、最专业的路径。若你已自行导出 `.glb`/`.gltf`，引擎可直接加载，无需 Blender。

## 3. C++ 用法（统一 C ABI）

3D API 全部声明在 `core/include/lument.h` 的 `Lument Cube 3D 引擎 API` 章节（约 50+ 函数）。典型流程：

```cpp
#include "lument.h"

int main() {
    LumentConfig cfg = { LUMENT_PLATFORM_DESKTOP, LUMENT_RENDERER_OPENGL, 960, 540, 60, false, false, "", "" };
    lument_init(&cfg);
    lument_cube_init();                       // 初始化 3D 子系统

    // 相机
    LumentCamera3DHandle cam = lument_cube_create_camera();
    LumentCamera3D cd = { {0,0,5}, {0,0,0}, {0,1,0}, 60.0f, 0.1f, 100.0f, 16.0f/9.0f };
    lument_cube_set_camera(cam, &cd);

    // 程序化立方体
    LumentMesh box = lument_cube_create_box(2,2,2);
    LumentCubeMaterial mat = {}; mat.baseColor = {200,200,210,255}; mat.roughness = 0.6f;
    LumentMaterial matH = lument_cube_create_material(&mat);

    // 场景节点
    LumentNode3D node = lument_cube_create_node();
    lument_cube_node_set_mesh(node, box);
    lument_cube_node_set_material(node, matH);

    // 光照
    lument_cube_set_ambient({255,255,255,255}, 1.0f);
    lument_cube_add_light(LUMENT_CUBE_LIGHT_DIRECTIONAL, {0.5f,1.0f,0.3f}, {255,255,255,255}, 1.0f, 0.0f);

    // 原生加载模型（glTF/OBJ/STL/PLY/DAE/FBX/.blend 按扩展名自动识别）
    LumentModel model = lument_cube_load_model("assets/character.glb");

    while (lument_is_running()) {
        lument_begin_frame();
        lument_cube_render(cam);             // 渲染根场景所有节点
        lument_end_frame();
    }
    lument_shutdown();
}
```

### 3.1 关键 API 速查

| 类别 | 函数 |
|------|------|
| 数学 | `lument_cube_mat4_perspective / look_at / multiply / invert`、`lument_cube_quat_from_euler` |
| 相机 | `lument_cube_create_camera / set_camera / get_camera` |
| 网格 | `lument_cube_create_mesh / create_box / create_plane / create_sphere / get_mesh_bounds` |
| 材质 | `lument_cube_create_material / material_set_color / material_set_map / material_set_pbr` |
| 模型 | `lument_cube_load_model / load_model_format / load_model_memory / model_get_mesh / model_get_bounds` |
| 场景图 | `lument_cube_create_node / node_set_transform / node_set_mesh / node_set_model / node_set_parent` |
| 光照 | `lument_cube_add_light / set_ambient / clear_lights` |
| 渲染 | `lument_cube_render / render_node / render_model / set_background` |
| 格式 | `lument_cube_format_name / supported_format_count / get_supported_formats` |

## 4. JavaScript / Web 用法（Web Runtime）

Web Runtime（`runtime/js/lument.js`）内置 `Lument.Cube` 命名空间，使用 **WebGL2** 真实渲染，浏览器开箱即用：

```html
<canvas id="cube-canvas" width="960" height="540"></canvas>
<script src="runtime/js/lument.js"></script>
<script>
  const cv = document.getElementById('cube-canvas');
  Lument.Cube.init(cv);                       // 初始化 WebGL2

  // 程序化立方体 + 轨道相机
  const box = Lument.Cube.createBox(2,2,2);
  const root = Lument.Cube.createNode();
  Lument.Cube.nodeSetMesh(root, box);
  Lument.Cube.setAmbient([0.2,0.2,0.25]);
  Lument.Cube.setLight([5,8,5], [1,1,1], 1.2, 1); // 点光源

  const camera = { position:[0,1.5,6], target:[0,0,0], up:[0,1,0], fovY:55, near:0.1, far:100 };

  function frame(t){
    const a = t*0.001;
    root.euler = [0, a*30, 0];                // 绕 Y 旋转
    Lument.Cube.render(camera, root);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 原生加载外部 3D 模型（glTF/OBJ/STL/PLY）
  Lument.Cube.loadModel('assets/character.glb').then(model => {
    const n = Lument.Cube.createNode();
    Lument.Cube.nodeSetModel(n, model);
    // 加入场景树后由 render() 自动绘制
  });
</script>
```

> **注意**：2D 引擎（`Lument.init` 的 `RENDERER.CANVAS2D`）与 3D（`Lument.Cube.init` 的 WebGL2）使用**不同的 canvas / 上下文**。请为 3D 单独准备一个 `<canvas>`，避免与 2D 的 Canvas2D 上下文冲突。

## 5. 编译 / 构建

```bash
# 仅 3D 核心（Null 后端，无头可用，含加载器与数学）
mkdir build && cd build && cmake .. -DCMAKE_BUILD_TYPE=Release
make -j

# 移动端 / Web（GLES2/WebGL 真渲染）
cmake .. -DLUMENT_ENABLE_GLES2=ON
make -j

# 启用 Assimp 以支持 FBX 等格式
cmake .. -DLUMENT_ENABLE_ASSIMP=ON
make -j
```

## 6. Blender 桥接（`.blend` → glTF）

引擎对 `.blend` 文件的处理：若系统已安装 `blender` CLI，会自动执行：

```bash
blender "<模型>.blend" --background \
       --python tools/blender_export_glb.py -- "<模型>.cube_export.glb"
```

`tools/blender_export_glb.py` 将当前工程导出为 **glTF 2.0 二进制 (.glb)**（Y-Up），导出后引擎再用原生 glTF 加载器读取。你也可以手动在 Blender 中 `File → Export → glTF 2.0 (.glb)` 后直接加载 `.glb`，无需 Blender 在运行环境存在。

## 7. 单元验证

- C++：`tests/cube_loader_test.cpp` —— 验证图元、OBJ/STL/PLY/glTF 加载、3D 数学（`build_test/cube_test`）。
- JS：`tests/cube_js_loader_test.js` —— 验证 `Lument.Cube` 端的解析器与数学（`node tests/cube_js_loader_test.js`）。
- 交互演示：`examples/lument_cube_demo.html` —— 浏览器中旋转预览程序化模型，并可粘贴 URL 加载 glTF/OBJ/STL/PLY。
