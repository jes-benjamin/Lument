// ============================================================
// lument_input.cpp - 输入系统实现
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_key_down / lument_key_pressed  键盘状态 + just-pressed 检测
//   lument_get_touch_count / lument_get_touch   多点触控
//   lument_get_joystick_x / lument_get_joystick_y   摇杆 (-1..1)
//
// 设计：
//   - 键盘采用双缓冲：current[]（本帧状态）+ previous[]（上一帧）。
//     just-pressed = current && !previous。帧末 input_end_frame()
//     将 current 拷贝到 previous，由 lument_end_frame 调用。
//   - 触控用固定大小数组（对象池式），避免每帧分配。
//   - 所有状态为静态 POD，热路径零分配、缓存友好。
//   - 多线程：平台事件可能从其它线程到来，用一个轻量自旋/互斥
//     保护写入；查询在主线程帧循环中调用。
// ============================================================
#include "lument_internal.h"

namespace {

struct InputState {
    // 键盘双缓冲
    bool current[LUMENT_KEY_MAX];
    bool previous[LUMENT_KEY_MAX];

    // 触控点（屏幕坐标）
    LumentVec2 touches[LUMENT_MAX_TOUCHES];
    int    touchCount;

    // 模拟摇杆轴
    float joyX, joyY;

    bool initialized;
};

InputState g_state;
std::mutex g_mutex; // 保护来自其它线程的事件写入

inline bool valid_key(LumentKey key) {
    return key > LUMENT_KEY_NONE && key < LUMENT_KEY_MAX;
}

} // namespace

namespace ue {

bool init_input() {
    std::lock_guard<std::mutex> lk(g_mutex);
    std::memset(&g_state, 0, sizeof(g_state));
    g_state.initialized = true;
    return true;
}

void shutdown_input() {
    std::lock_guard<std::mutex> lk(g_mutex);
    std::memset(&g_state, 0, sizeof(g_state));
}

// 帧末拷贝：current -> previous，并清空触控（触控为瞬时事件，每帧重置）。
// 注：摇杆轴持续保留。
void input_end_frame() {
    std::lock_guard<std::mutex> lk(g_mutex);
    std::memcpy(g_state.previous, g_state.current, sizeof(g_state.previous));
    // 触控每帧由平台重新上报；若未上报则清零。
    g_state.touchCount = 0;
}

// ---- 平台注入接口 ----
void input_set_key(LumentKey key, bool down) {
    if (!valid_key(key)) return;
    std::lock_guard<std::mutex> lk(g_mutex);
    g_state.current[key] = down;
}

void input_clear_keys() {
    std::lock_guard<std::mutex> lk(g_mutex);
    std::memset(g_state.current, 0, sizeof(g_state.current));
}

void input_clear_touches() {
    std::lock_guard<std::mutex> lk(g_mutex);
    g_state.touchCount = 0;
}

void input_add_touch(float x, float y) {
    std::lock_guard<std::mutex> lk(g_mutex);
    if (g_state.touchCount < LUMENT_MAX_TOUCHES) {
        g_state.touches[g_state.touchCount] = LumentVec2{ x, y };
        ++g_state.touchCount;
    }
}

void input_set_joystick(float x, float y) {
    std::lock_guard<std::mutex> lk(g_mutex);
    // 钳制到 [-1,1]
    g_state.joyX = x < -1.0f ? -1.0f : (x > 1.0f ? 1.0f : x);
    g_state.joyY = y < -1.0f ? -1.0f : (y > 1.0f ? 1.0f : y);
}

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

// 按键当前是否按下。
LUMENT_API bool lument_key_down(LumentKey key) {
    if (!valid_key(key)) return false;
    std::lock_guard<std::mutex> lk(g_mutex);
    return g_state.current[key];
}

// 按键是否在本帧“刚刚按下”（current && !previous）。
LUMENT_API bool lument_key_pressed(LumentKey key) {
    if (!valid_key(key)) return false;
    std::lock_guard<std::mutex> lk(g_mutex);
    return g_state.current[key] && !g_state.previous[key];
}

// 当前触点数量。
LUMENT_API int lument_get_touch_count(void) {
    std::lock_guard<std::mutex> lk(g_mutex);
    return g_state.touchCount;
}

// 读取第 index 个触点坐标到 *pos。越界则写零。
LUMENT_API void lument_get_touch(int index, LumentVec2* pos) {
    if (!pos) return;
    std::lock_guard<std::mutex> lk(g_mutex);
    if (index < 0 || index >= g_state.touchCount) {
        pos->x = 0.0f; pos->y = 0.0f;
        return;
    }
    *pos = g_state.touches[index];
}

LUMENT_API float lument_get_joystick_x(void) {
    std::lock_guard<std::mutex> lk(g_mutex);
    return g_state.joyX;
}

LUMENT_API float lument_get_joystick_y(void) {
    std::lock_guard<std::mutex> lk(g_mutex);
    return g_state.joyY;
}

} // extern "C"
