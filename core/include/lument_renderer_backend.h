// ============================================================
// lument_renderer_backend.h - 渲染后端抽象接口
// ------------------------------------------------------------
// 定义 IRendererBackend 抽象基类，所有具体渲染后端
// （OpenGL Desktop / OpenGL ES 2.0 / WebGL / Null）实现该接口。
// 上层渲染抽象（lument_renderer.cpp）只依赖此接口，从而做到
// 后端可插拔、跨平台。
//
// 设计要点：
//   - 批量精灵绘制接口 drawSpriteBatch()：上层将同一纹理的
//     多个精灵顶点一次性提交，后端用一次 draw call 渲染，
//     减少状态切换与驱动开销。
//   - 纹理仅以原始 RGBA 数据创建（createTextureFromData），
//     文件解码在上层完成，后端不依赖图像库。
// ============================================================
#ifndef LUMENT_RENDERER_BACKEND_H
#define LUMENT_RENDERER_BACKEND_H

#include "lument_internal.h"

// 单个精灵顶点：位置(世界坐标)、纹理坐标、顶点色（用于着色/透明度）。
// 布局：4 float(16) + 4 uint8(4) = 20 字节，紧凑无填充，可直接灌入 VBO。
#pragma pack(push, 1)
struct LumentSpriteVertex {
    float    x, y;   // 目标位置（世界坐标，后端负责变换到裁剪空间）
    float    u, v;   // 纹理坐标
    uint8_t  r, g, b, a; // 顶点色（与采样结果相乘）
};
#pragma pack(pop)
static_assert(sizeof(LumentSpriteVertex) == 20, "LumentSpriteVertex 布局需与着色器 stride 一致");

// 渲染后端抽象接口。
class IRendererBackend {
public:
    virtual ~IRendererBackend() = default;

    // ---- 生命周期 ----
    // 初始化后端上下文（创建着色器、VBO 等）。width/height 为画布逻辑尺寸。
    virtual bool init(int width, int height) = 0;
    virtual void shutdown() = 0;
    // 画布尺寸变化时调用（如窗口缩放 / 设备旋转）。
    virtual void resize(int width, int height) = 0;

    // ---- 帧操作 ----
    // 用指定颜色清屏。
    virtual void clear(LumentColor color) = 0;
    // 设置 2D 摄像机：平移 (x,y) 与缩放 zoom（1.0 = 原始大小）。
    virtual void setCamera(float x, float y, float zoom) = 0;
    // 提交所有挂起的绘制命令并交换缓冲（如果后端拥有窗口）。
    virtual void present() = 0;

    // ---- 即时绘制（非批量热路径，但实现应尽量轻量）----
    virtual void drawRect(LumentRect rect, LumentColor color, bool filled) = 0;
    virtual void drawText(const char* text, float x, float y, float size, LumentColor color) = 0;
    virtual void drawPixel(int x, int y, LumentColor color) = 0;

    // ---- 批量精灵绘制（热路径）----
    // 用同一个纹理绘制 count 个四边形（每个 4 个顶点，三角形带）。
    // verts 长度需为 count*4。上层负责按纹理分组后再调用，以最小化 draw call。
    virtual void drawSpriteBatch(uint32_t textureId,
                                const LumentSpriteVertex* verts,
                                size_t quadCount) = 0;

    // ---- 纹理管理 ----
    // 由原始 RGBA 数据创建纹理，返回后端纹理句柄（0 表示失败）。
    virtual uint32_t createTextureFromData(int w, int h, const uint8_t* rgba) = 0;
    // 销毁纹理句柄。
    virtual void destroyTexture(uint32_t id) = 0;

    // ---- 查询 ----
    virtual int viewportWidth() const = 0;
    virtual int viewportHeight() const = 0;

    // ---- 2D 场景渲染扩展 ----
    // 场景色调：对后续所有绘制操作的顶点色乘以 tint
    virtual void setSceneTint(LumentColor tint) { (void)tint; }
    // 应用场景级后期效果（亮度/对比度/饱和度/模糊/暗角/雾等）
    // 默认空实现——仅支持 tint 的后端可在 setSceneTint 中处理
    virtual void applySceneEffects(const LumentSceneColor* color,
                                   const LumentSceneClarity* clarity,
                                   const LumentVignette* vignette,
                                   const LumentFog* fog) {
        (void)color; (void)clarity; (void)vignette; (void)fog;
    }
    // 光线渲染：将所有累积光源以加法混合绘制到当前帧缓冲
    virtual void renderLights(const LumentLight* lights, int count,
                              const LumentSceneLighting* ambient) {
        (void)lights; (void)count; (void)ambient;
    }

    // ---- 离屏渲染目标 ----
    // 创建离屏渲染目标，返回后端句柄（0=失败）
    virtual uint32_t createRenderTarget(int /*w*/, int /*h*/) { return 0; }
    // 设置当前渲染目标（0=恢复到屏幕）
    virtual void setRenderTarget(uint32_t /*id*/) {}
    // 将渲染目标内容绘制到指定区域
    virtual void drawRenderTarget(uint32_t /*id*/, LumentRect /*dest*/) {}
    // 销毁渲染目标
    virtual void destroyRenderTarget(uint32_t /*id*/) {}
};

// ----------------------------------------------------------------
// NullBackend：空实现。不依赖任何图形库，始终可编译。
// 用于无 GPU 环境（如无头测试）或当系统缺少 GL 头时回退。
// 所有绘制操作为 no-op，纹理返回伪句柄。
// ----------------------------------------------------------------
class NullRendererBackend : public IRendererBackend {
public:
    bool init(int w, int h) override { m_w = w; m_h = h; return true; }
    void shutdown() override {}
    void resize(int w, int h) override { m_w = w; m_h = h; }

    void clear(LumentColor) override {}
    void setCamera(float, float, float) override {}
    void present() override {}

    void drawRect(LumentRect, LumentColor, bool) override {}
    void drawText(const char*, float, float, float, LumentColor) override {}
    void drawPixel(int, int, LumentColor) override {}
    void drawSpriteBatch(uint32_t, const LumentSpriteVertex*, size_t) override {}

    uint32_t createTextureFromData(int, int, const uint8_t*) override {
        // 返回递增伪句柄（跳过 0）。
        return ++m_nextTex;
    }
    void destroyTexture(uint32_t) override {}

    int viewportWidth() const override { return m_w; }
    int viewportHeight() const override { return m_h; }

private:
    int      m_w = 0, m_h = 0;
    uint32_t m_nextTex = 0;
};

#endif // LUMENT_RENDERER_BACKEND_H
