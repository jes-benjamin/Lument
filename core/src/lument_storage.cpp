// ============================================================
// lument_storage.cpp - 存储系统实现
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_save_data(key, data)   以 key 为文件名写入文本
//   lument_load_data(key)         读取，返回缓存的 C 字符串（失败返回 nullptr）
//   lument_clear_data(key)         删除对应文件
//
// 设计：
//   - 轻量键值持久化，每个 key 对应 savePath 下的一个文件。
//   - load_data 返回的指针由内部缓存持有，避免悬空；unordered_map
//     是节点式容器，插入不会使既有字符串的 c_str() 失效。
//   - key 经净化（仅允许字母数字下划线），防止路径穿越。
//   - 跨平台文件操作使用标准 C 的 fopen/fread/fwrite。
// ============================================================
#include "lument_internal.h"

#include <cerrno>
#include <sys/stat.h>
#include <sys/types.h>

namespace {

struct StorageState {
    std::string baseDir;                          // 存档根目录（含尾斜杠）
    std::unordered_map<std::string, std::string> cache; // key -> 内容
    bool initialized = false;
};

StorageState g_state;

// 将 key 净化为安全的文件名：非 [A-Za-z0-9_.-] 替换为 '_'。
std::string sanitize_key(const char* key) {
    std::string out;
    if (!key) return out;
    out.reserve(16);
    for (const char* p = key; *p; ++p) {
        char c = *p;
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
            (c >= '0' && c <= '9') || c == '_' || c == '-' || c == '.') {
            out.push_back(c);
        } else {
            out.push_back('_');
        }
    }
    return out;
}

std::string full_path(const std::string& safeKey) {
    return g_state.baseDir + safeKey + ".dat";
}

// 跨平台目录创建（递归至一级即可，存档根目录通常已存在）。
bool ensure_dir(const std::string& dir) {
    if (dir.empty()) return false;
    struct stat st;
    if (::stat(dir.c_str(), &st) == 0) {
        return S_ISDIR(st.st_mode);
    }
#ifdef _WIN32
    return ::_mkdir(dir.c_str()) == 0;
#else
    return ::mkdir(dir.c_str(), 0755) == 0 || errno == EEXIST;
#endif
}

} // namespace

namespace ue {

bool init_storage(const LumentConfig& cfg) {
    g_state.cache.clear();
    // 选取存档根目录：优先使用配置的 savePath，其次当前目录。
    std::string dir = cfg.savePath ? cfg.savePath : ".";
    if (!dir.empty() && dir.back() != '/' && dir.back() != '\\') {
        dir.push_back('/');
    }
    g_state.baseDir = dir;
    ensure_dir(dir.empty() ? std::string(".") : dir);
    g_state.initialized = true;
    return true;
}

void shutdown_storage() {
    g_state.cache.clear();
    g_state.baseDir.clear();
    g_state.initialized = false;
}

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

// 写入键值。返回 1 成功，0 失败。
LUMENT_API int lument_save_data(const char* key, const char* data) {
    if (!g_state.initialized || !key) return 0;
    const std::string safeKey = sanitize_key(key);
    if (safeKey.empty()) return 0;
    const std::string path = full_path(safeKey);

    FILE* fp = std::fopen(path.c_str(), "wb");
    if (!fp) return 0;

    const char* payload = data ? data : "";
    size_t len = std::strlen(payload);
    size_t written = std::fwrite(payload, 1, len, fp);
    std::fclose(fp);

    if (written != len) return 0;

    // 更新缓存，使随后的 load_data 命中。
    g_state.cache[safeKey] = payload;
    return 1;
}

// 读取键值。返回内部缓存的 C 字符串；不存在时返回 nullptr。
// 注意：返回指针在下次任意 save/clear 调用前保持有效。
LUMENT_API const char* lument_load_data(const char* key) {
    if (!g_state.initialized || !key) return nullptr;
    const std::string safeKey = sanitize_key(key);
    if (safeKey.empty()) return nullptr;

    // 命中缓存
    auto it = g_state.cache.find(safeKey);
    if (it != g_state.cache.end()) {
        return it->second.c_str();
    }

    // 从磁盘读取
    const std::string path = full_path(safeKey);
    FILE* fp = std::fopen(path.c_str(), "rb");
    if (!fp) return nullptr;

    std::fseek(fp, 0, SEEK_END);
    long sz = std::ftell(fp);
    std::fseek(fp, 0, SEEK_SET);
    if (sz < 0) { std::fclose(fp); return nullptr; }

    std::string content;
    content.resize(static_cast<size_t>(sz));
    size_t rd = content.empty() ? 0 :
        std::fread(&content[0], 1, content.size(), fp);
    std::fclose(fp);
    content.resize(rd);

    // 存入缓存并返回稳定指针。
    auto inserted = g_state.cache.emplace(safeKey, std::move(content));
    return inserted.first->second.c_str();
}

// 删除键值文件。返回 1 成功（含文件本不存在），0 失败。
LUMENT_API int lument_clear_data(const char* key) {
    if (!g_state.initialized || !key) return 0;
    const std::string safeKey = sanitize_key(key);
    if (safeKey.empty()) return 0;

    g_state.cache.erase(safeKey);
    const std::string path = full_path(safeKey);
    return std::remove(path.c_str()) == 0 ? 1 : 1; // 文件不存在也视为成功
}

} // extern "C"
