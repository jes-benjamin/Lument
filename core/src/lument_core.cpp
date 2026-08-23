// ============================================================
// lument_core.cpp - 引擎核心：生命周期 / 帧循环 / 统计 / 平台检测
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_init / lument_shutdown / lument_is_running
//   lument_begin_frame / lument_end_frame / lument_get_delta_time / lument_get_stats
//   lument_get_platform / lument_get_renderer_type
//
// 帧循环时序：
//   begin_frame: 计算 dt -> 重置渲染统计 -> 脚本 onUpdate -> 场景背景清屏
//   (宿主绘制：lument_clear / lument_draw_* ...)
//   end_frame  : 自动渲染 ECS 精灵 -> 提交批次 -> 交换缓冲
//                -> 输入帧末快照 -> 目标帧率睡眠 -> 更新统计
// ============================================================
#include "lument_internal.h"

#include <thread>
#include <chrono>

namespace {

// 平台与渲染后端类型（编译期/初始化时确定）
LumentPlatform    g_platform = LUMENT_PLATFORM_DESKTOP;
LumentRendererType g_rendererType = LUMENT_RENDERER_OPENGL;

// 运行状态
bool g_running = false;
bool g_initialized = false;

// 计时
uint64_t g_prevFrameMs = 0;   // 上一帧 begin 时刻
float    g_deltaTimeMs = 0.0f; // 上一帧总耗时（含睡眠）

// 配置缓存
LumentConfig g_config{};

// 编译期平台检测
LumentPlatform detect_platform() {
#if defined(LUMENT_SYS_ANDROID)
    return LUMENT_PLATFORM_ANDROID;
#elif defined(LUMENT_SYS_WEB)
    return LUMENT_PLATFORM_WEB;
#elif defined(LUMENT_SYS_IOS)
    return LUMENT_PLATFORM_IOS;
#else
    return LUMENT_PLATFORM_DESKTOP;
#endif
}

// 根据平台校正渲染后端类型
LumentRendererType correct_renderer_type(LumentPlatform p, LumentRendererType r) {
#if defined(LUMENT_BACKEND_GLES2)
    if (p == LUMENT_PLATFORM_ANDROID) return LUMENT_RENDERER_OPENGLES;
    if (p == LUMENT_PLATFORM_WEB)     return LUMENT_RENDERER_WEBGL;
    (void)r;
    return r == LUMENT_RENDERER_VULKAN ? r : LUMENT_RENDERER_OPENGLES;
#else
    (void)p;
    // 未启用 GLES2 后端时，统一回退为 CANVAS2D（空实现）
    return LUMENT_RENDERER_CANVAS2D;
#endif
}

} // namespace

namespace ue {

// 内部 setter（供其它子系统在需要时查询；当前仅缓存）
void core_set_platform(LumentPlatform p) { g_platform = p; }
void core_set_renderer_type(LumentRendererType r) { g_rendererType = r; }

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

LUMENT_API int lument_init(const LumentConfig* config) {
    if (g_initialized) {
        lument_log("lument_init: engine already initialized");
        return 0;
    }
    if (!config) {
        lument_log("lument_init: null config");
        return 0;
    }
    g_config = *config;

    // 平台与渲染后端
    g_platform = detect_platform();
    g_rendererType = correct_renderer_type(g_platform, g_config.rendererType);

    // 依次初始化各子系统
    if (!ue::init_input())   { lument_log("lument_init: input init failed"); return 0; }
    if (!ue::init_audio())   { lument_log("lument_init: audio init failed"); return 0; }
    if (!ue::init_ecs())     { lument_log("lument_init: ecs init failed"); return 0; }
    if (!ue::init_scene())   { lument_log("lument_init: scene init failed"); return 0; }
    if (!ue::init_ui())      { lument_log("lument_init: ui init failed"); return 0; }
    if (!ue::init_storage(g_config)) { lument_log("lument_init: storage init failed"); return 0; }
    if (!ue::init_physics()) { lument_log("lument_init: physics init failed"); return 0; }
    if (!ue::init_network()) { lument_log("lument_init: network init failed"); return 0; }
    if (!ue::init_ai())      { lument_log("lument_init: ai init failed"); return 0; }
    if (!ue::init_renderer(g_config)) { lument_log("lument_init: renderer init failed"); return 0; }

    g_prevFrameMs = lument_get_time_ms();
    g_deltaTimeMs = 0.0f;
    g_running = true;
    g_initialized = true;
    return 1;
}

LUMENT_API void lument_shutdown(void) {
    if (!g_initialized) return;
    g_running = false;
    ue::shutdown_renderer();
    ue::shutdown_ai();
    ue::shutdown_network();
    ue::shutdown_physics();
    ue::shutdown_storage();
    ue::shutdown_ui();
    ue::shutdown_scene();
    ue::shutdown_ecs();
    ue::shutdown_audio();
    ue::shutdown_input();
    g_initialized = false;
}

LUMENT_API int lument_is_running(void) {
    return g_running ? 1 : 0;
}

LUMENT_API void lument_begin_frame(void) {
    if (!g_initialized) return;

    const uint64_t now = lument_get_time_ms();
    float dt = float(now - g_prevFrameMs);
    g_prevFrameMs = now;
    // 钳制 dt，避免切后台/断点造成的超大步进
    if (dt > 100.0f) dt = 100.0f;
    if (dt < 0.0f) dt = 0.0f;
    g_deltaTimeMs = dt;

    // 重置本帧渲染统计与精灵批次
    ue::renderer_begin_frame();

    // 脚本逻辑更新（在宿主绘制之前）
    ue::ecs_update_scripts(g_deltaTimeMs);

    // 物理世界步进（dt 转秒）
    ue::physics_step(g_deltaTimeMs * 0.001f);

    // 音频系统更新（淡入淡出、3D距离衰减）
    ue::update_audio(g_deltaTimeMs * 0.001f);

    // 应用活动场景背景色（若有则执行 lument_clear）
    ue::scene_apply_background();
}

LUMENT_API void lument_end_frame(void) {
    if (!g_initialized) return;

    // 自动渲染带精灵+变换的实体（推入批次）
    ue::ecs_render_sprites();
    // 提交所有挂起的绘制命令
    ue::renderer_flush_batch();
    // 交换缓冲（后端内部 glFlush；实际交换由宿主窗口系统完成）
    ue::renderer_present();

    // 输入：本帧 current -> previous（用于 just-pressed）
    ue::input_end_frame();

    // 目标帧率限制
    if (g_config.targetFPS > 0.0f) {
        const float targetMs = 1000.0f / g_config.targetFPS;
        const float elapsed = float(lument_get_time_ms() - g_prevFrameMs);
        if (elapsed < targetMs) {
            const int sleepUs = int((targetMs - elapsed) * 1000.0f);
            std::this_thread::sleep_for(std::chrono::microseconds(sleepUs));
        }
    }
}

LUMENT_API float lument_get_delta_time(void) {
    return g_deltaTimeMs;
}

LUMENT_API void lument_get_stats(LumentStats* stats) {
    if (!stats) return;
    stats->frameTime = g_deltaTimeMs;
    stats->fps = g_deltaTimeMs > 0.0f ? 1000.0f / g_deltaTimeMs : 0.0f;
    stats->drawCalls = ue::renderer_draw_calls();
    stats->entityCount = ue::ecs_entity_count();
    // 粗略内存占用：ECS + 纹理对象池（每纹理按平均 64KB 估算）
    size_t bytes = ue::ecs_memory_bytes();
    bytes += size_t(ue::renderer_texture_count()) * 65536u;
    stats->memoryUsed = uint32_t(bytes / 1024u);
}

LUMENT_API LumentPlatform lument_get_platform(void) {
    return g_platform;
}

LUMENT_API LumentRendererType lument_get_renderer_type(void) {
    return g_rendererType;
}

} // extern "C"
