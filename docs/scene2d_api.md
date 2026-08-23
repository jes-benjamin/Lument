# Lument 2D 场景渲染 API 文档

> 版本：Lument Engine v1.1.0
> 新增功能：场景色彩色调控制、清晰度控制、光线渲染、图片接入、离屏渲染目标

## 目录

1. [场景色彩色调控制](#1-场景色彩色调控制)
2. [场景清晰度控制](#2-场景清晰度控制)
3. [暗角与雾效](#3-暗角与雾效)
4. [光线渲染](#4-光线渲染)
5. [图片接入接口](#5-图片接入接口)
6. [离屏渲染目标](#6-离屏渲染目标)
7. [后期处理](#7-后期处理)
8. [使用示例](#8-使用示例)

---

## 1. 场景色彩色调控制

对整个场景应用全局色彩调整，支持亮度、对比度、饱和度、色相、灰度、棕褐色、反色和色调叠加。

### API 列表

| 函数 | 参数 | 说明 |
|------|------|------|
| `setSceneTint(tint)` | `tint: {r,g,b,a}` | 色调叠加色，通过 multiply 混合模式叠加到整个场景 |
| `setSceneBrightness(v)` | `v: 0.0~2.0` | 亮度调整，1.0=原始 |
| `setSceneContrast(v)` | `v: 0.0~2.0` | 对比度调整，1.0=原始 |
| `setSceneSaturation(v)` | `v: 0.0~2.0` | 饱和度调整，1.0=原始 |
| `setSceneHueShift(v)` | `v: 0~360` | 色相偏移（度），0=无偏移 |
| `setSceneGrayscale(v)` | `v: 0.0~1.0` | 灰度混合比例 |
| `setSceneSepia(v)` | `v: 0.0~1.0` | 棕褐色效果比例 |
| `setSceneInvert(v)` | `v: 0.0~1.0` | 反色比例 |
| `setSceneColor(color)` | `color: LumentSceneColor` | 批量设置所有色彩参数 |
| `getSceneColor()` | 返回 `LumentSceneColor` | 获取当前色彩参数 |
| `resetSceneColor()` | 无 | 重置所有色彩参数为默认值 |

### LumentSceneColor 结构

```javascript
{
    tint: { r: 255, g: 255, b: 255, a: 255 },  // 色调叠加
    brightness: 1.0,    // 亮度
    contrast: 1.0,      // 对比度
    saturation: 1.0,    // 饱和度
    hueShift: 0.0,      // 色相偏移
    grayscale: 0.0,     // 灰度
    sepia: 0.0,         // 棕褐色
    invert: 0.0,        // 反色
}
```

---

## 2. 场景清晰度控制

控制场景的锐化、模糊和泛光效果。

### API 列表

| 函数 | 参数 | 说明 |
|------|------|------|
| `setSceneSharpness(v)` | `v: -1.0~1.0` | 锐化程度，正值锐化，负值柔化 |
| `setSceneBlur(radius)` | `radius: 0.0+` | 高斯模糊半径（像素），0=关闭 |
| `setSceneBloom(intensity, threshold)` | `intensity: 0~1, threshold: 0~1` | 泛光效果 |
| `setSceneClarity(clarity)` | `clarity: LumentSceneClarity` | 批量设置清晰度参数 |
| `getSceneClarity()` | 返回 `LumentSceneClarity` | 获取当前清晰度参数 |
| `resetSceneClarity()` | 无 | 重置为默认值 |

---

## 3. 暗角与雾效

### API 列表

| 函数 | 参数 | 说明 |
|------|------|------|
| `setVignette(intensity, radius)` | `intensity: 0~1, radius: 0~1` | 暗角效果，radius 为屏幕比例 |
| `setFog(color, density, start, end)` | `color, density: 0~1, start, end` | 雾效 |
| `resetVignette()` | 无 | 重置暗角 |
| `resetFog()` | 无 | 重置雾效 |

---

## 4. 光线渲染

支持三种光源类型：点光源、方向光、聚光灯，以及环境光。

### 常量

```javascript
Lument.LIGHT.POINT       = 0  // 点光源
Lument.LIGHT.DIRECTIONAL = 1  // 方向光
Lument.LIGHT.SPOT        = 2  // 聚光灯
```

### API 列表

| 函数 | 参数 | 说明 |
|------|------|------|
| `addLight(type, x, y, radius, color, intensity)` | 见下 | 添加光源，返回 lightId |
| `setLightDirection(id, dirX, dirY)` | 方向向量 | 设置光源方向（方向光/聚光） |
| `setLightAngle(id, angle)` | `angle: 度` | 设置聚光锥角 |
| `setLightIntensity(id, intensity)` | `0.0~2.0` | 设置光源强度 |
| `setLightColor(id, color)` | `{r,g,b,a}` | 设置光源颜色 |
| `setLightPosition(id, x, y)` | 世界坐标 | 设置光源位置 |
| `removeLight(id)` | lightId | 移除指定光源 |
| `clearLights()` | 无 | 清除所有光源 |
| `getLightCount()` | 返回 `int` | 获取光源数量 |
| `setAmbientLight(color, intensity)` | `color, 0~1` | 设置环境光 |
| `setLightFalloff(falloff)` | `0.5+` | 设置光衰减指数（1.0=线性, 2.0=二次） |
| `renderLights()` | 无 | 渲染所有累积光源到场景 |

### 使用方式

```javascript
// 1. 在场景绘制完成后调用 renderLights()
// 2. 光源使用加法混合（lighter）叠加到场景上
// 3. 典型调用顺序：绘制场景 -> renderLights() -> applySceneEffects()

// 添加一个暖色点光源
const lightId = Lument.addLight(
    Lument.LIGHT.POINT,    // 类型
    240, 300,              // 位置
    200,                   // 半径
    { r: 255, g: 200, b: 100, a: 255 },  // 颜色
    0.8                    // 强度
);

// 动态移动光源
Lument.setLightPosition(lightId, newX, newY);

// 设置环境光
Lument.setAmbientLight({ r: 50, g: 50, b: 100, a: 255 }, 0.3);
```

---

## 5. 图片接入接口

### API 列表

| 函数 | 参数 | 说明 |
|------|------|------|
| `loadImage(path, callback)` | `path, (id,w,h)=>{}` | 异步加载图片，返回 textureId |
| `drawImageTiled(texId, dest, src, offsetX, offsetY)` | 见下 | 平铺绘制图片 |
| `drawImageRotated(texId, cx, cy, angleDeg, scale, src)` | 见下 | 旋转绘制图片 |
| `drawImageWithColor(texId, dest, src, color)` | 见下 | 带色调绘制图片 |
| `drawImageRegion(texId, dest, src, color, rotation, tiled)` | 见下 | 综合绘制（支持旋转+平铺） |

### 参数说明

- `dest: {x, y, w, h}` — 目标区域（世界坐标）
- `src: {x, y, w, h}` — 源纹理区域（像素坐标），null 表示整张图
- `offsetX/offsetY` — 平铺偏移量（世界坐标）
- `cx, cy` — 旋转中心（世界坐标）
- `angleDeg` — 旋转角度（度）
- `scale` — 缩放比例
- `color: {r,g,b,a}` — 色调叠加

---

## 6. 离屏渲染目标

用于将场景渲染到离屏画布，再进行后期处理或作为纹理使用。

### API 列表

| 函数 | 参数 | 说明 |
|------|------|------|
| `createRenderTarget(w, h)` | 宽高 | 创建离屏渲染目标，返回 id |
| `setRenderTarget(id)` | id 或 0 | 切换渲染目标（0=恢复到主画布） |
| `drawRenderTarget(id, dest)` | id, 目标区域 | 将渲染目标内容绘制到当前画布 |
| `destroyRenderTarget(id)` | id | 销毁渲染目标 |

### 使用示例

```javascript
// 创建离屏渲染目标
const rtId = Lument.createRenderTarget(480, 540);

// 切换到离屏渲染
Lument.setRenderTarget(rtId);
Lument.clear({ r: 0, g: 0, b: 0, a: 255 });
// ... 在离屏画布上绘制 ...

// 切换回主画布
Lument.setRenderTarget(0);

// 将离屏内容绘制到主画布
Lument.drawRenderTarget(rtId, { x: 0, y: 0, w: 480, h: 540 });
```

---

## 7. 后期处理

### API 列表

| 函数 | 说明 |
|------|------|
| `applySceneEffects()` | 应用所有场景效果（色彩/清晰度/暗角/雾）到当前帧 |

### 调用时机

```javascript
function render() {
    Lument.beginFrame();

    // 1. 绘制场景内容
    Lument.clear(bgColor);
    // ... 绘制精灵、图片等 ...

    // 2. 渲染光源（加法混合）
    Lument.renderLights();

    // 3. 应用后期处理（色彩调整、模糊、暗角、雾等）
    Lument.applySceneEffects();

    Lument.endFrame();
}
```

---

## 8. 使用示例

### 场景预设

```javascript
// 日落氛围
Lument.setSceneTint({ r: 255, g: 140, b: 60, a: 180 });
Lument.setSceneBrightness(1.1);
Lument.setSceneContrast(1.2);
Lument.setSceneSaturation(1.3);
Lument.setVignette(0.4, 0.7);

// 夜晚氛围
Lument.setSceneBrightness(0.5);
Lument.setSceneContrast(1.3);
Lument.setSceneSaturation(0.7);
Lument.setSceneTint({ r: 40, g: 60, b: 120, a: 200 });
Lument.setVignette(0.6, 0.6);
Lument.setAmbientLight({ r: 50, g: 50, b: 100, a: 255 }, 0.3);

// 梦境效果
Lument.setSceneBrightness(1.2);
Lument.setSceneSaturation(1.5);
Lument.setSceneHueShift(30);
Lument.setSceneBlur(2);
Lument.setSceneTint({ r: 200, g: 180, b: 255, a: 100 });

// 恐怖氛围
Lument.setSceneBrightness(0.6);
Lument.setSceneContrast(1.5);
Lument.setSceneSaturation(0.3);
Lument.setSceneGrayscale(0.3);
Lument.setSceneTint({ r: 80, g: 20, b: 20, a: 220 });
Lument.setVignette(0.8, 0.4);
Lument.setFog({ r: 20, g: 0, b: 0, a: 255 }, 0.4, 0, 500);
```

### 动态光源

```javascript
// 火把效果：闪烁的点光源
let torchLight = Lument.addLight(
    Lument.LIGHT.POINT, 100, 200, 120,
    { r: 255, g: 180, b: 80, a: 255 }, 0.9
);

// 每帧更新强度模拟闪烁
function update() {
    const flicker = 0.7 + Math.sin(Date.now() * 0.01) * 0.2 + Math.random() * 0.1;
    Lument.setLightIntensity(torchLight, flicker);
}

// 月光：方向光
Lument.addLight(
    Lument.LIGHT.DIRECTIONAL, 0, 0, 0,
    { r: 100, g: 120, b: 200, a: 255 }, 0.4
);
```

### 图片加载与绘制

```javascript
// 异步加载图片
Lument.loadImage('assets/background.png', function(id, w, h) {
    console.log('图片加载完成: id=' + id + ' 尺寸=' + w + 'x' + h);
    bgTextureId = id;
});

// 平铺绘制背景
Lument.drawImageTiled(bgTextureId,
    { x: 0, y: 0, w: 480, h: 540 },
    { x: 0, y: 0, w: 32, h: 32 },
    scrollX, 0  // 横向滚动
);

// 旋转绘制
Lument.drawImageRotated(spriteId,
    240, 300,    // 旋转中心
    45,          // 45度
    2.0,         // 放大2倍
    { x: 0, y: 0, w: 16, h: 16 }
);
```
