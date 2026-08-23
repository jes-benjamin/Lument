// ============================================================
// lument_audio.cpp - 音频系统实现
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_load_audio(path, isMusic)   加载音频源（解析 WAV）
//   lument_play_audio(id, loop)        播放
//   lument_stop_audio(id)              停止
//   lument_set_volume(id, volume)      音量 [0,1]
//   lument_stop_all_audio()            停止全部
//
// 设计：
//   - 音频源采用固定容量对象池（数组 + 空闲链表），热路径零分配。
//   - 解码（目前支持未压缩 PCM WAV）在加载时一次完成，存于池中。
//   - 实际设备输出由 IAudioBackend 完成；默认 NullAudioBackend 仅
//     维护播放状态。可替换为 OpenAL / OpenSL ES / miniaudio 实现。
// ============================================================
#include "lument_internal.h"
#include <cmath>

namespace {

// ---------- 最小 WAV 解码（未压缩 PCM）----------
struct WavData {
    uint32_t sampleRate = 0;
    uint16_t channels = 0;
    uint16_t bitsPerSample = 0;
    std::vector<uint8_t> pcm; // 原始 PCM 字节
};

// 读取小端 16/32 位
inline uint16_t rd16(const uint8_t* p) { return uint16_t(p[0] | (p[1] << 8)); }
inline uint32_t rd32(const uint8_t* p) {
    return uint32_t(p[0]) | (uint32_t(p[1]) << 8) |
           (uint32_t(p[2]) << 16) | (uint32_t(p[3]) << 24);
}

bool load_wav(const char* path, WavData& out) {
    FILE* fp = std::fopen(path, "rb");
    if (!fp) return false;

    uint8_t hdr[44];
    if (std::fread(hdr, 1, sizeof(hdr), fp) != sizeof(hdr)) {
        std::fclose(fp); return false;
    }
    // 校验 RIFF/WAVE 标识
    if (std::memcmp(hdr, "RIFF", 4) != 0 || std::memcmp(hdr + 8, "WAVE", 4) != 0) {
        std::fclose(fp); return false;
    }
    // 解析 fmt 块（简化：假定标准 44 字节头）
    // fmt chunk 位于偏移 12："fmt " (4) size(4) audioFormat(2) channels(2)
    // sampleRate(4) byteRate(4) blockAlign(2) bitsPerSample(2)
    if (std::memcmp(hdr + 12, "fmt ", 4) != 0) {
        std::fclose(fp); return false;
    }
    uint16_t audioFormat = rd16(hdr + 20);
    out.channels      = rd16(hdr + 22);
    out.sampleRate    = rd32(hdr + 24);
    out.bitsPerSample = rd16(hdr + 34);

    if (audioFormat != 1) { // 仅支持 PCM
        std::fclose(fp); return false;
    }
    if (out.channels == 0 || out.sampleRate == 0 ||
        (out.bitsPerSample != 8 && out.bitsPerSample != 16)) {
        std::fclose(fp); return false;
    }

    // 定位 data 块：从偏移 36 起扫描 "data"
    long pos = 36;
    bool found = false;
    uint8_t chunk[8];
    while (pos + 8 <= 44 && !found) {
        if (std::memcmp(hdr + pos, "data", 4) == 0) {
            uint32_t dataSize = rd32(hdr + pos + 4);
            out.pcm.resize(dataSize);
            size_t rd = std::fread(out.pcm.data(), 1, dataSize, fp);
            out.pcm.resize(rd);
            found = true;
        }
        pos += 8;
    }

    // 若 data 块在 44 字节头之外，继续扫描
    if (!found) {
        std::fseek(fp, 44, SEEK_SET);
        while (true) {
            if (std::fread(chunk, 1, 8, fp) != 8) break;
            uint32_t dataSize = rd32(chunk + 4);
            if (std::memcmp(chunk, "data", 4) == 0) {
                out.pcm.resize(dataSize);
                size_t rd = std::fread(out.pcm.data(), 1, dataSize, fp);
                out.pcm.resize(rd);
                found = true;
                break;
            }
            std::fseek(fp, dataSize, SEEK_CUR);
        }
    }

    std::fclose(fp);
    return found;
}

// ---------- 音频源 ----------
struct AudioSource {
    bool      alive = false;       // 槽位是否被占用
    bool      playing = false;
    bool      loop = false;
    bool      isMusic = false;
    float     volume = 1.0f;
    WavData   wav;                 // 解码后的 PCM
    std::string path;

    void reset() {
        alive = false; playing = false; loop = false; isMusic = false;
        volume = 1.0f; wav = WavData{}; path.clear();
    }
};

struct AudioState {
    AudioSource pool[LUMENT_MAX_AUDIO_SOURCES];
    // 空闲链表：用 nextFree 索引串起空闲槽位，-1 表示链尾。
    int freeHead = 0;
    bool initialized = false;
};

AudioState g_state;

// 初始化空闲链表
void rebuild_free_list() {
    for (int i = 0; i < LUMENT_MAX_AUDIO_SOURCES - 1; ++i) {
        // 复用 path 的内存存放 nextFree 索引避免额外结构；这里简单用 alive=false 全空闲
        g_state.pool[i].alive = false;
    }
    g_state.freeHead = 0;
}

int alloc_source() {
    // 线性扫描空闲槽位（池小，O(n) 可接受）
    for (int i = 0; i < LUMENT_MAX_AUDIO_SOURCES; ++i) {
        if (!g_state.pool[i].alive) {
            g_state.pool[i].reset();
            g_state.pool[i].alive = true;
            return i + 1; // id 从 1 开始，0 = 无效
        }
    }
    return 0;
}

AudioSource* find_source(uint32_t id) {
    if (id == 0 || id > (uint32_t)LUMENT_MAX_AUDIO_SOURCES) return nullptr;
    AudioSource& s = g_state.pool[id - 1];
    return s.alive ? &s : nullptr;
}

// ---------- 音频后端抽象 ----------
class IAudioBackend {
public:
    virtual ~IAudioBackend() = default;
    virtual bool init() = 0;
    virtual void shutdown() = 0;
    virtual void play(AudioSource& src) = 0;
    virtual void stop(AudioSource& src) = 0;
    virtual void setVolume(AudioSource& src, float v) = 0;
    virtual void stopAll() = 0;
};

// 空后端：仅维护状态，不输出声音。始终可编译。
class NullAudioBackend : public IAudioBackend {
public:
    bool init() override { return true; }
    void shutdown() override {}
    void play(AudioSource& src) override { src.playing = true; }
    void stop(AudioSource& src) override { src.playing = false; }
    void setVolume(AudioSource& src, float v) override {
        src.volume = v < 0.0f ? 0.0f : (v > 1.0f ? 1.0f : v);
    }
    void stopAll() override {
        for (int i = 0; i < LUMENT_MAX_AUDIO_SOURCES; ++i) {
            if (g_state.pool[i].alive) g_state.pool[i].playing = false;
        }
    }
};

IAudioBackend* g_backend = nullptr;
NullAudioBackend g_nullBackend;

// ---------- 增强音频：播放实例 ----------
constexpr int LUMENT_MAX_AUDIO_INSTANCES = 128;
constexpr int LUMENT_AUDIO_GROUP_COUNT = 3; // 0=SFX 1=Music 2=Voice

struct AudioInstance {
    bool      alive = false;
    bool      playing = false;
    bool      paused = false;
    bool      loop = false;
    uint32_t  sourceId = 0;       // 引用的 AudioSource id（1-based）
    int       groupId = 0;        // 0=SFX 1=Music 2=Voice
    float     volume = 1.0f;      // 用户设定的基础音量
    float     pitch = 1.0f;       // 音调 1.0=原始
    float     pan = 0.0f;         // 声道平衡 -1(左)~1(右)
    float     position = 0.0f;    // 当前播放位置（秒）
    float     duration = 0.0f;    // 音频时长（秒）
    // 淡入淡出
    bool      fading = false;
    bool      fadeOut = false;     // true=淡出至0, false=淡入至目标
    float     fadeAmount = 1.0f;   // 当前淡变乘数 [0,1]
    float     fadeStart = 1.0f;    // 淡变起始乘数
    float     fadeTarget = 1.0f;   // 淡变目标乘数
    float     fadeDuration = 0.0f; // 淡变总时长（秒）
    float     fadeElapsed = 0.0f;  // 已淡变时间（秒）
    // 3D 空间音频
    bool      is3D = false;
    float     sourceX = 0.0f;
    float     sourceY = 0.0f;
    float     maxDist = 1.0f;
    float     spatialGain = 1.0f;  // 距离衰减增益 [0,1]

    void reset() {
        alive = false; playing = false; paused = false; loop = false;
        sourceId = 0; groupId = 0;
        volume = 1.0f; pitch = 1.0f; pan = 0.0f;
        position = 0.0f; duration = 0.0f;
        fading = false; fadeOut = false;
        fadeAmount = 1.0f; fadeStart = 1.0f; fadeTarget = 1.0f;
        fadeDuration = 0.0f; fadeElapsed = 0.0f;
        is3D = false; sourceX = 0.0f; sourceY = 0.0f;
        maxDist = 1.0f; spatialGain = 1.0f;
    }
};

struct AudioInstancePool {
    AudioInstance instances[LUMENT_MAX_AUDIO_INSTANCES];
    // 听者位置与朝向
    float listenerX = 0.0f;
    float listenerY = 0.0f;
    float listenerDirX = 0.0f;
    float listenerDirY = -1.0f;
    // 主音量与分组音量
    float masterVolume = 1.0f;
    float groupVolumes[LUMENT_AUDIO_GROUP_COUNT] = {1.0f, 1.0f, 1.0f};
    bool  initialized = false;
};

AudioInstancePool g_instances;

inline float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

int alloc_instance() {
    for (int i = 0; i < LUMENT_MAX_AUDIO_INSTANCES; ++i) {
        if (!g_instances.instances[i].alive) {
            g_instances.instances[i].reset();
            g_instances.instances[i].alive = true;
            return i + 1; // 1-based, 0=失败
        }
    }
    return 0;
}

AudioInstance* find_instance(uint32_t instanceId) {
    if (instanceId == 0 || instanceId > (uint32_t)LUMENT_MAX_AUDIO_INSTANCES)
        return nullptr;
    AudioInstance& inst = g_instances.instances[instanceId - 1];
    return inst.alive ? &inst : nullptr;
}

// 计算音频源时长（秒）
float compute_source_duration(const AudioSource& src) {
    if (src.wav.sampleRate == 0 || src.wav.channels == 0 ||
        src.wav.bitsPerSample == 0) return 0.0f;
    float bytesPerSample = float(src.wav.bitsPerSample) / 8.0f;
    float denom = float(src.wav.sampleRate) * float(src.wav.channels) * bytesPerSample;
    if (denom <= 0.0f) return 0.0f;
    return float(src.wav.pcm.size()) / denom;
}

// 3D 距离衰减：volume * (1 - dist/maxDist)
float compute_distance_gain(float sx, float sy, float lx, float ly, float maxDist) {
    float dx = sx - lx;
    float dy = sy - ly;
    float dist = std::sqrt(dx * dx + dy * dy);
    if (maxDist <= 0.0f) return 0.0f;
    float g = 1.0f - (dist / maxDist);
    return g < 0.0f ? 0.0f : (g > 1.0f ? 1.0f : g);
}

} // namespace

namespace ue {

bool init_audio() {
    g_state = AudioState{};
    rebuild_free_list();
    // 增强音频：重置实例池与分组音量
    g_instances = AudioInstancePool{};
    g_instances.listenerDirX = 0.0f;
    g_instances.listenerDirY = -1.0f;
    // 默认使用空后端；可在此根据平台选择真实后端。
    g_backend = &g_nullBackend;
    g_backend->init();
    g_state.initialized = true;
    g_instances.initialized = true;
    return true;
}

void shutdown_audio() {
    if (g_backend) { g_backend->shutdown(); g_backend = nullptr; }
    g_state = AudioState{};
    g_instances = AudioInstancePool{};
}

uint32_t audio_source_count() {
    uint32_t n = 0;
    for (int i = 0; i < LUMENT_MAX_AUDIO_SOURCES; ++i)
        if (g_state.pool[i].alive) ++n;
    return n;
}

// 增强音频每帧更新：处理淡入淡出、播放位置推进、3D 空间距离衰减。
// 由引擎帧循环调用（dt 为秒）。
void update_audio(float dt) {
    if (!g_instances.initialized || dt <= 0.0f) return;

    for (int i = 0; i < LUMENT_MAX_AUDIO_INSTANCES; ++i) {
        AudioInstance& inst = g_instances.instances[i];
        if (!inst.alive) continue;

        // 1. 淡入淡出更新
        if (inst.fading) {
            inst.fadeElapsed += dt;
            float t = inst.fadeDuration > 0.0f
                      ? (inst.fadeElapsed / inst.fadeDuration) : 1.0f;
            if (t >= 1.0f) {
                inst.fadeAmount = inst.fadeTarget;
                inst.fading = false;
                // 淡出完成：停止并释放实例
                if (inst.fadeOut && inst.fadeTarget <= 0.0f) {
                    inst.playing = false;
                    inst.alive = false;
                    continue;
                }
            } else {
                inst.fadeAmount = inst.fadeStart +
                                 (inst.fadeTarget - inst.fadeStart) * t;
            }
        }

        // 2. 播放位置推进（音调影响播放速度）
        if (inst.playing && !inst.paused) {
            inst.position += dt * inst.pitch;
            if (inst.duration > 0.0f && inst.position >= inst.duration) {
                if (inst.loop) {
                    inst.position = std::fmod(inst.position, inst.duration);
                } else {
                    inst.playing = false;
                    inst.position = inst.duration;
                }
            }
        }

        // 3. 3D 空间音频距离衰减
        if (inst.is3D) {
            inst.spatialGain = compute_distance_gain(
                inst.sourceX, inst.sourceY,
                g_instances.listenerX, g_instances.listenerY,
                inst.maxDist);
        }
    }
}

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

LUMENT_API uint32_t lument_load_audio(const char* path, bool isMusic) {
    if (!g_state.initialized || !path) return 0;
    int id = alloc_source();
    if (id == 0) return 0;
    AudioSource& src = g_state.pool[id - 1];
    src.isMusic = isMusic;
    src.path = path;
    if (!load_wav(path, src.wav)) {
        // 解码失败也返回 id（后端可记录为空源），但记日志。
        lument_log("lument_load_audio: failed to decode WAV");
    }
    return static_cast<uint32_t>(id);
}

LUMENT_API void lument_play_audio(uint32_t id, bool loop) {
    AudioSource* s = find_source(id);
    if (!s || !g_backend) return;
    s->loop = loop;
    g_backend->play(*s);
}

LUMENT_API void lument_stop_audio(uint32_t id) {
    AudioSource* s = find_source(id);
    if (!s || !g_backend) return;
    g_backend->stop(*s);
}

LUMENT_API void lument_set_volume(uint32_t id, float volume) {
    AudioSource* s = find_source(id);
    if (!s || !g_backend) return;
    g_backend->setVolume(*s, volume);
}

LUMENT_API void lument_stop_all_audio(void) {
    if (g_backend) g_backend->stopAll();
    // 增强音频：同时停止所有播放实例
    for (int i = 0; i < LUMENT_MAX_AUDIO_INSTANCES; ++i) {
        if (g_instances.instances[i].alive) {
            g_instances.instances[i].playing = false;
            g_instances.instances[i].alive = false;
        }
    }
}

// ============================================================
// 增强音频 API 实现
// 音频加载增强、播放控制增强、3D 空间音频、音频分组
// ============================================================

// --- 音频加载（自动识别格式）---
LUMENT_API uint32_t lument_load_sound(const char* path) {
    // 音效：isMusic=false
    return lument_load_audio(path, false);
}

LUMENT_API uint32_t lument_load_music(const char* path) {
    // 背景音乐：isMusic=true
    return lument_load_audio(path, true);
}

LUMENT_API const char* lument_get_supported_formats(void) {
    // 空后端仅支持 WAV 解码；声明层返回完整支持格式列表
    return "WAV,MP3,OGG";
}

// --- 播放控制 ---
LUMENT_API uint32_t lument_play_sound(uint32_t id, float volume, float pitch, bool loop) {
    AudioSource* src = find_source(id);
    if (!src || !g_instances.initialized) return 0;

    int iid = alloc_instance();
    if (iid == 0) return 0; // 实例池已满

    AudioInstance& inst = g_instances.instances[iid - 1];
    inst.sourceId  = id;
    inst.groupId   = src->isMusic ? 1 : 0; // Music=1, SFX=0
    inst.volume    = clampf(volume, 0.0f, 1.0f);
    inst.pitch     = pitch > 0.0f ? pitch : 1.0f;
    inst.pan       = 0.0f;
    inst.loop      = loop;
    inst.position  = 0.0f;
    inst.duration  = compute_source_duration(*src);
    inst.playing   = true;
    inst.paused    = false;
    inst.fadeAmount = 1.0f;
    inst.fading    = false;
    inst.is3D      = false;
    inst.spatialGain = 1.0f;

    return static_cast<uint32_t>(iid);
}

LUMENT_API void lument_stop_sound(uint32_t instanceId) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst) return;
    inst->playing = false;
    inst->alive = false; // 释放槽位
}

LUMENT_API void lument_pause_sound(uint32_t instanceId) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst) return;
    inst->paused = true;
}

LUMENT_API void lument_resume_sound(uint32_t instanceId) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst) return;
    inst->paused = false;
}

LUMENT_API void lument_set_pitch(uint32_t instanceId, float pitch) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst) return;
    inst->pitch = pitch > 0.0f ? pitch : 1.0f;
}

LUMENT_API void lument_set_pan(uint32_t instanceId, float pan) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst) return;
    inst->pan = clampf(pan, -1.0f, 1.0f);
}

LUMENT_API float lument_get_audio_duration(uint32_t id) {
    AudioSource* src = find_source(id);
    if (!src) return 0.0f;
    return compute_source_duration(*src);
}

LUMENT_API float lument_get_audio_position(uint32_t instanceId) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst) return 0.0f;
    return inst->position;
}

LUMENT_API void lument_seek_audio(uint32_t instanceId, float position) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst) return;
    if (position < 0.0f) position = 0.0f;
    if (inst->duration > 0.0f && position > inst->duration)
        position = inst->duration;
    inst->position = position;
}

LUMENT_API void lument_fade_in(uint32_t instanceId, float duration) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst || duration <= 0.0f) return;
    inst->fading      = true;
    inst->fadeOut     = false;
    inst->fadeStart   = inst->fadeAmount; // 从当前值开始淡入
    inst->fadeTarget  = 1.0f;
    inst->fadeDuration = duration;
    inst->fadeElapsed  = 0.0f;
}

LUMENT_API void lument_fade_out(uint32_t instanceId, float duration) {
    AudioInstance* inst = find_instance(instanceId);
    if (!inst || duration <= 0.0f) return;
    inst->fading      = true;
    inst->fadeOut     = true;
    inst->fadeStart   = inst->fadeAmount; // 从当前值开始淡出
    inst->fadeTarget  = 0.0f;
    inst->fadeDuration = duration;
    inst->fadeElapsed  = 0.0f;
}

// --- 3D 空间音频 ---
LUMENT_API void lument_set_audio_listener(float x, float y, float dirX, float dirY) {
    g_instances.listenerX    = x;
    g_instances.listenerY    = y;
    g_instances.listenerDirX = dirX;
    g_instances.listenerDirY = dirY;
}

LUMENT_API uint32_t lument_play_sound_3d(uint32_t id, float x, float y,
                                          float maxDist, float volume, bool loop) {
    AudioSource* src = find_source(id);
    if (!src || !g_instances.initialized) return 0;

    int iid = alloc_instance();
    if (iid == 0) return 0; // 实例池已满

    AudioInstance& inst = g_instances.instances[iid - 1];
    inst.sourceId  = id;
    inst.groupId   = src->isMusic ? 1 : 0;
    inst.volume    = clampf(volume, 0.0f, 1.0f);
    inst.pitch     = 1.0f;
    inst.pan       = 0.0f;
    inst.loop      = loop;
    inst.position  = 0.0f;
    inst.duration  = compute_source_duration(*src);
    inst.playing   = true;
    inst.paused    = false;
    inst.fadeAmount = 1.0f;
    inst.fading    = false;
    // 3D 空间参数
    inst.is3D      = true;
    inst.sourceX   = x;
    inst.sourceY   = y;
    inst.maxDist   = maxDist > 0.0f ? maxDist : 1.0f;
    inst.spatialGain = compute_distance_gain(
        x, y, g_instances.listenerX, g_instances.listenerY, inst.maxDist);

    return static_cast<uint32_t>(iid);
}

// --- 音频分组 ---
LUMENT_API void lument_set_master_volume(float volume) {
    g_instances.masterVolume = clampf(volume, 0.0f, 1.0f);
}

LUMENT_API void lument_set_group_volume(int groupId, float volume) {
    if (groupId < 0 || groupId >= LUMENT_AUDIO_GROUP_COUNT) return;
    g_instances.groupVolumes[groupId] = clampf(volume, 0.0f, 1.0f);
}

LUMENT_API void lument_stop_group(int groupId) {
    if (groupId < 0 || groupId >= LUMENT_AUDIO_GROUP_COUNT) return;
    for (int i = 0; i < LUMENT_MAX_AUDIO_INSTANCES; ++i) {
        AudioInstance& inst = g_instances.instances[i];
        if (inst.alive && inst.groupId == groupId) {
            inst.playing = false;
            inst.alive = false; // 释放槽位
        }
    }
}

} // extern "C"
