// ============================================================
// lument_internal.h - Lument 内部共享头文件
// 仅供引擎内部 C++ 源文件使用，不对外暴露。
// 职责：
//   1. 定义 LUMENT_API 导出可见性宏（必须在 lument.h 之前定义）
//   2. 包含公共 C ABI 头 lument.h
//   3. 平台/编译器检测宏
//   4. 全局常量（最大实体数等）
//   5. 各子系统的内部初始化/销毁/帧辅助函数声明
// 设计原则：内部头不污染公共 ABI；子系统之间通过 C ABI 或
//          ue:: 命名空间内的少量内部接口交互。
// ============================================================
#ifndef LUMENT_INTERNAL_H
#define LUMENT_INTERNAL_H

// ===== 1. LUMENT_API 导出可见性宏 =====
// 公共头 lument.h 中使用了 LUMENT_API 但并未定义它，
// 因此本文件必须在包含公共头之前完成定义。
//
// GCC/Clang : __attribute__((visibility("default")))
// MSVC     : __declspec(dllexport)  （构建动态库时）
//
// 配合 CMake 中的 CMAKE_CXX_VISIBILITY_PRESET=hidden，
// 只有标记了 LUMENT_API 的符号才会被导出，减小二进制体积、
// 防止内部符号泄漏。
#ifndef LUMENT_API
#  if defined(_WIN32) || defined(__CYGWIN__)
#    ifdef LUMENT_BUILDING_DLL
#      define LUMENT_API __declspec(dllexport)
#    else
#      define LUMENT_API __declspec(dllimport)
#    endif
#  elif defined(__GNUC__) || defined(__clang__)
#    define LUMENT_API __attribute__((visibility("default")))
#  else
#    define LUMENT_API
#  endif
#endif

// 我们正在构建引擎本体，在 Windows 上需要 dllexport。
#ifndef LUMENT_BUILDING_DLL
#  define LUMENT_BUILDING_DLL
#endif

// ===== 2. 包含公共 C ABI =====
#include "lument.h"

// ===== 3. 标准 C++ 头 =====
#include <cstdint>
#include <cstddef>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>
#include <unordered_map>
#include <array>
#include <chrono>
#include <mutex>
#include <atomic>
#include <algorithm>
#include <memory>

// ===== 4. 平台 / 编译器检测宏 =====
// 注意：公共头中的 LUMENT_PLATFORM_DESKTOP/ANDROID/IOS/WEB 是枚举值，
// 这里使用独立前缀 LUMENT_SYS_* 表示“编译目标平台”，避免与枚举冲突。
#if defined(__ANDROID__)
#  define LUMENT_SYS_ANDROID 1
#elif defined(__EMSCRIPTEN__)
#  define LUMENT_SYS_WEB 1
#elif defined(__APPLE__)
#  include <TargetConditionals.h>
#  if TARGET_OS_IPHONE || TARGET_IPHONE_SIMULATOR
#    define LUMENT_SYS_IOS 1
#  else
#    define LUMENT_SYS_DESKTOP 1
#  endif
#elif defined(_WIN32) || defined(__linux__)
#  define LUMENT_SYS_DESKTOP 1
#else
#  define LUMENT_SYS_DESKTOP 1
#endif

// ===== 5. 全局常量 =====
// 最大实体数。稀疏集合的 sparse 数组按此大小预分配，
// 保证查找 O(1) 且热路径无动态分配。可在 CMake 中覆盖。
#ifndef LUMENT_MAX_ENTITIES
#  define LUMENT_MAX_ENTITIES 16384
#endif

// 最大纹理数量（对象池容量）。
#ifndef LUMENT_MAX_TEXTURES
#  define LUMENT_MAX_TEXTURES 1024
#endif

// 最大音频源数量。
#ifndef LUMENT_MAX_AUDIO_SOURCES
#  define LUMENT_MAX_AUDIO_SOURCES 256
#endif

// 最大场景数量。
#ifndef LUMENT_MAX_SCENES
#  define LUMENT_MAX_SCENES 64
#endif

// 最大 UI 控件数量（对象池容量）。
#ifndef LUMENT_MAX_WIDGETS
#  define LUMENT_MAX_WIDGETS 4096
#endif

// 最大并发触点数量。
#ifndef LUMENT_MAX_TOUCHES
#  define LUMENT_MAX_TOUCHES 10
#endif

// 实体 ID 编码：低 20 位为索引(+1)，高 12 位为代（generation）。
// 这样销毁后的句柄可被检测为过期，避免误用。
#define LUMENT_ENTITY_INDEX_BITS 20
#define LUMENT_ENTITY_GEN_BITS   12
#define LUMENT_ENTITY_INDEX_MASK  ((1u << LUMENT_ENTITY_INDEX_BITS) - 1u)
#define LUMENT_ENTITY_GEN_MASK    ((1u << LUMENT_ENTITY_GEN_BITS) - 1u)

namespace ue {

// ===== 6. 子系统内部接口 =====
// 这些函数由各 .cpp 实现，由 lument_core.cpp 在生命周期/帧循环中调用。
// 它们不是公共 ABI 的一部分。

// --- 渲染 ---
bool init_renderer(const LumentConfig& cfg);
void shutdown_renderer();
void renderer_set_viewport(int w, int h);
void renderer_begin_frame();          // 重置批次/统计
void renderer_flush_batch();          // 提交批次（不交换缓冲）
void renderer_present();              // 交换缓冲
void renderer_draw_sprite(uint32_t tex, LumentRect dest, LumentRect src, LumentColor color);
uint32_t renderer_texture_count();    // 用于统计
uint32_t renderer_draw_calls();       // 用于统计

// --- 输入 ---
bool init_input();
void shutdown_input();
void input_end_frame();               // 帧末：current -> previous
// 平台层注入输入事件（非公共 ABI，供宿主 C++ 绑定调用）。
void input_set_key(LumentKey key, bool down);
void input_clear_keys();
void input_clear_touches();
void input_add_touch(float x, float y);
void input_set_joystick(float x, float y);

// --- 音频 ---
bool init_audio();
void shutdown_audio();
uint32_t audio_source_count();        // 用于统计
void update_audio(float dt);          // 更新淡入淡出与3D空间音频

// --- ECS ---
bool init_ecs();
void shutdown_ecs();
void ecs_clear();                     // 清空所有实体/组件（场景切换时用）
uint32_t ecs_entity_count();          // 用于统计
size_t  ecs_memory_bytes();           // 用于统计（粗略）
void ecs_update_scripts(float dt);    // 调用脚本 onUpdate 回调
void ecs_render_sprites();            // 自动渲染带精灵+变换的实体

// --- 场景 ---
bool init_scene();
void shutdown_scene();
void scene_apply_background();       // 若有活动场景且设置了背景色，则执行 lument_clear

// --- UI ---
bool init_ui();
void shutdown_ui();

// --- 存储 ---
bool init_storage(const LumentConfig& cfg);
void shutdown_storage();

// --- 2D 物理模拟 ---
bool init_physics();
void shutdown_physics();
void physics_step(float dt);         // 物理世界步进

// --- 网络模块 ---
bool init_network();
void shutdown_network();

// --- AI 模块 ---
bool init_ai();
void shutdown_ai();

// ===== 7. 通用内部工具 =====
// 平台/渲染后端类型由 lument_core.cpp 检测并缓存，供其它子系统查询。
void core_set_platform(LumentPlatform p);
void core_set_renderer_type(LumentRendererType r);

} // namespace ue

#endif // LUMENT_INTERNAL_H
