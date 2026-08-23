// ============================================================
// lument_scene.cpp - 场景管理实现
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_load_scene(name)            注册/加载一个具名场景，返回场景 ID
//   lument_set_active_scene(sceneId)   切换活动场景（切换时清空 ECS）
//   lument_get_active_scene()           获取活动场景 ID
//   lument_scene_set_background(color)  设置活动场景背景色
//
// 设计：
//   - 场景表为固定容量数组（对象池），按名称索引，零热路径分配。
//   - 场景内容（实体）由宿主在激活后通过 ECS API 构建；
//     切换场景时引擎自动 ecs_clear()，保证场景间数据隔离。
//   - 背景色由 ue::scene_apply_background() 在每帧 begin_frame 中应用。
// ============================================================
#include "lument_internal.h"

namespace {

struct Scene {
    bool      used = false;
    bool      hasBg = false;
    LumentColor   bg = { 0, 0, 0, 255 };
    std::string name;
};

struct SceneState {
    Scene scenes[LUMENT_MAX_SCENES];
    int   active = 0;      // 活动场景 ID（0 = 无活动场景）
    bool  initialized = false;
};

SceneState g_state;

// 按名称查找场景，返回 ID（index+1），未找到返回 0。
int find_by_name(const char* name) {
    if (!name) return 0;
    for (int i = 0; i < LUMENT_MAX_SCENES; ++i) {
        if (g_state.scenes[i].used && g_state.scenes[i].name == name) {
            return i + 1;
        }
    }
    return 0;
}

int alloc_scene(const char* name) {
    for (int i = 0; i < LUMENT_MAX_SCENES; ++i) {
        if (!g_state.scenes[i].used) {
            g_state.scenes[i].used = true;
            g_state.scenes[i].hasBg = false;
            g_state.scenes[i].bg = LumentColor{ 0, 0, 0, 255 };
            g_state.scenes[i].name = name ? name : "";
            return i + 1;
        }
    }
    return 0;
}

} // namespace

namespace ue {

bool init_scene() {
    g_state = SceneState{};
    g_state.initialized = true;
    return true;
}

void shutdown_scene() {
    g_state = SceneState{};
}

// 若有活动场景且设置了背景色，则用其清屏。
void scene_apply_background() {
    if (!g_state.initialized || g_state.active == 0) return;
    Scene& s = g_state.scenes[g_state.active - 1];
    if (s.hasBg) lument_clear(s.bg);
}

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

// 加载（注册）一个场景。若已存在同名场景则返回其 ID。
// 返回 0 表示失败（表满）。
LUMENT_API int lument_load_scene(const char* name) {
    if (!g_state.initialized || !name) return 0;
    int existing = find_by_name(name);
    if (existing != 0) return existing;
    return alloc_scene(name);
}

// 设置活动场景。切换时会清空 ECS，确保新场景从空状态开始。
LUMENT_API void lument_set_active_scene(int sceneId) {
    if (!g_state.initialized) return;
    if (sceneId < 1 || sceneId > LUMENT_MAX_SCENES) return;
    if (!g_state.scenes[sceneId - 1].used) return;
    if (g_state.active == sceneId) return; // 无变化
    g_state.active = sceneId;
    // 切换场景：重置实体世界
    ue::ecs_clear();
}

LUMENT_API int lument_get_active_scene(void) {
    return g_state.active;
}

LUMENT_API void lument_scene_set_background(LumentColor color) {
    if (!g_state.initialized || g_state.active == 0) return;
    Scene& s = g_state.scenes[g_state.active - 1];
    s.bg = color;
    s.hasBg = true;
}

} // extern "C"
