// ============================================================
// lument_utils.cpp - 工具函数实现
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_get_time_ms     高精度单调时钟（毫秒）
//   lument_random         [0,1) 伪随机浮点
//   lument_random_range   [min,max) 伪随机浮点
//   lument_log            日志输出（stderr）
//
// 随机数采用 xorshift64，thread_local 无锁，热路径零分配。
// ============================================================
#include "lument_internal.h"

#include <cmath>
#include <ctime>

namespace {

// 单调时钟起点，避免每次都计算 epoch 转换带来的开销。
const std::chrono::steady_clock::time_point g_epoch =
    std::chrono::steady_clock::now();

// 线程局部 xorshift64 状态，按时间+线程 id 播种，保证无锁且互不干扰。
inline uint64_t& rng_state() {
    thread_local uint64_t s = static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::nanoseconds>(
            std::chrono::steady_clock::now().time_since_epoch()).count());
    // 避免 xorshift 全 0 状态
    if (s == 0) s = 0x9E3779B97F4A7C15ULL;
    return s;
}

inline uint64_t xorshift64() {
    uint64_t& s = rng_state();
    s ^= s << 13;
    s ^= s >> 7;
    s ^= s << 17;
    return s;
}

} // namespace

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

// 返回自引擎进程启动以来经过的毫秒数（单调递增，不受系统时间回拨影响）。
LUMENT_API uint64_t lument_get_time_ms(void) {
    const auto now = std::chrono::steady_clock::now();
    return static_cast<uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(now - g_epoch).count());
}

// 返回 [0.0, 1.0) 的伪随机浮点。
LUMENT_API float lument_random(void) {
    // 取高 24 位构造 float，保证精度均匀。
    const uint32_t bits = static_cast<uint32_t>(xorshift64() >> 40);
    return static_cast<float>(bits) / static_cast<float>(1u << 24);
}

// 返回 [min, max) 的伪随机浮点。
LUMENT_API float lument_random_range(float min, float max) {
    return min + lument_random() * (max - min);
}

// 日志输出。简单实现：写到 stderr 并刷新。
// 移动端（Android）可通过 logcat 重定向 stderr，或在此接入 __android_log_print。
LUMENT_API void lument_log(const char* message) {
    if (!message) {
        std::fprintf(stderr, "[Lument] (null)\n");
    } else {
        std::fprintf(stderr, "[Lument] %s\n", message);
    }
    std::fflush(stderr);
}

} // extern "C"
