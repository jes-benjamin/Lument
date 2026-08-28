// ============================================================
// lument_network.cpp - 网络模块实现
// ------------------------------------------------------------
// 实现 C ABI（见 lument.h "网络模块 API"）：
//   HTTP 请求: lument_http_request / get / post / put / delete
//              lument_http_cancel / set_header / set_timeout / set_auth_token
//   WebSocket: lument_ws_connect / send / send_text / close / is_connected
//   JSON 工具: lument_json_parse / get_number / get_bool / build
//   数据同步 : lument_upload_data / lument_download_data
//
// 设计：
//   - C++ 后端在网络层使用空实现（桩）。真正的 HTTP/WebSocket 收发在
//     Web 平台通过浏览器的 fetch / WebSocket 完成；原生平台在缺少网络库
//     时同样走桩路径。
//   - HTTP 请求：记录状态（方法/URL/体/头），分配递增的 requestId 并入
//     待处理表。由于桩不发起真实请求，会同步以一个空响应（状态码 0、
//     空体/空头）触发回调，保证回调契约在无网络环境下也被满足；调用者
//     拿到 requestId 后可调用 lument_http_cancel 清理记录。
//   - WebSocket：连接记录状态并分配递增的 wsId，桩将连接标志置为已连接
//     （模拟 open），但不投递任何消息事件；send/send_text 为空操作，
//     close 断开并移除记录，is_connected 返回连接标志。
//   - JSON：使用简易字符串查找解析器（查找 "key": 后的值），不依赖完整
//     JSON 库；build 将 "key=value\n" 形式转换为标准 JSON 对象字符串。
//   - 全局请求头以 vector<pair<string,string>> 存储；超时与 Bearer token
//     作为全局状态保存。
//   - LumentHttpResponse 的 body/headers 使用 thread_local 静态字符串
//     存储，避免释放与悬空指针问题。
//   - 模块目标引擎版本：1.3.0（与 LUMENT_VERSION_STRING 一致）。
// ============================================================
#include "lument_internal.h"

#include <string>
#include <vector>
#include <map>
#include <cstring>
#include <cstdlib>

// 校验本模块对应的引擎版本
static_assert(LUMENT_VERSION_MAJOR == 1 &&
              LUMENT_VERSION_MINOR == 3 &&
              LUMENT_VERSION_PATCH == 0,
              "lument_network.cpp 对应引擎版本 1.3.0");

namespace {

// ---------- HTTP 请求记录 ----------
struct HttpRequest {
    int             id = 0;
    LumentHttpMethod method = LUMENT_HTTP_GET;
    std::string     url;
    std::string     body;
    std::string     headers;       // 原始请求头字符串（透传）
    bool            cancelled = false;
};

// ---------- WebSocket 连接记录 ----------
struct WebSocket {
    int             id = 0;
    std::string     url;
    LumentWsCallback callback = nullptr;
    void*           userData = nullptr;
    bool            connected = false;
};

// ---------- 全局网络状态（Meyers 单例，规避全局初始化顺序问题） ----------
struct NetworkState {
    std::mutex mutex;
    std::unordered_map<int, HttpRequest> requests;
    std::unordered_map<int, WebSocket>    sockets;
    std::vector<std::pair<std::string, std::string>> globalHeaders; // 全局请求头
    std::string authToken;     // Bearer token
    int timeoutSeconds = 30;   // 默认超时 30 秒
    int nextRequestId = 1;     // 递增的 HTTP 请求 ID（0 视为非法）
    int nextWsId = 1;          // 递增的 WebSocket ID
    bool initialized = false;
};

inline NetworkState& net() {
    static NetworkState s;
    return s;
}

// 构造一个空桩响应（状态码 0、空体/空头）。
// body/headers 指向 thread_local 静态字符串，保证回调期间指针稳定，
// 避免释放与悬空指针问题。
inline const LumentHttpResponse& make_stub_response() {
    thread_local std::string t_body;
    thread_local std::string t_headers;
    thread_local LumentHttpResponse t_resp;
    t_body.clear();
    t_headers.clear();
    t_resp.statusCode = 0;        // 0 = 无可用响应（桩未发起真实请求）
    t_resp.body = t_body.c_str();
    t_resp.bodyLength = 0;
    t_resp.headers = t_headers.c_str();
    return t_resp;
}

// ---------- JSON 解析辅助 ----------
// 在 json 中查找 "key" : 形式的键，返回值起始位置（已跳过冒号与空白）；
// 未找到返回 std::string::npos。通过完整带引号的键匹配，可避免子串误匹配
// （如查找 "name" 不会命中 "username" 内部）。
inline size_t find_value(const std::string& s, const std::string& key) {
    const std::string needle = "\"" + key + "\"";
    const size_t npos = std::string::npos;
    size_t from = 0;
    while (true) {
        const size_t k = s.find(needle, from);
        if (k == npos) return npos;
        size_t i = k + needle.size();
        // 跳过空白，要求紧跟冒号才算键
        while (i < s.size() && (s[i] == ' ' || s[i] == '\t' ||
                                s[i] == '\n' || s[i] == '\r')) ++i;
        if (i < s.size() && s[i] == ':') {
            ++i;
            while (i < s.size() && (s[i] == ' ' || s[i] == '\t' ||
                                    s[i] == '\n' || s[i] == '\r')) ++i;
            return i;
        }
        from = k + 1;
    }
}

// 解析 JSON 字符串值（s[i] 应为起始双引号），处理常见转义。返回内容并前移 i。
inline std::string parse_json_string(const std::string& s, size_t& i) {
    std::string out;
    if (i >= s.size() || s[i] != '"') return out;
    ++i; // 跳过起始引号
    while (i < s.size()) {
        char c = s[i++];
        if (c == '"') break; // 结束引号
        if (c == '\\' && i < s.size()) {
            char e = s[i++];
            switch (e) {
                case '"':  out.push_back('"');  break;
                case '\\': out.push_back('\\'); break;
                case '/':  out.push_back('/');  break;
                case 'n':  out.push_back('\n'); break;
                case 't':  out.push_back('\t'); break;
                case 'r':  out.push_back('\r'); break;
                case 'b':  out.push_back('\b'); break;
                case 'f':  out.push_back('\f'); break;
                case 'u': {
                    // 解析 4 位十六进制并编码为 UTF-8（BMP 基本平面）
                    if (i + 4 <= s.size()) {
                        unsigned cp = 0;
                        bool ok = true;
                        for (int h = 0; h < 4; ++h) {
                            char ch = s[i + h];
                            cp <<= 4;
                            if (ch >= '0' && ch <= '9')      cp |= static_cast<unsigned>(ch - '0');
                            else if (ch >= 'a' && ch <= 'f') cp |= static_cast<unsigned>(ch - 'a' + 10);
                            else if (ch >= 'A' && ch <= 'F') cp |= static_cast<unsigned>(ch - 'A' + 10);
                            else { ok = false; break; }
                        }
                        if (ok) {
                            i += 4;
                            if (cp < 0x80) {
                                out.push_back(static_cast<char>(cp));
                            } else if (cp < 0x800) {
                                out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
                                out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                            } else {
                                out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
                                out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
                                out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                            }
                        }
                    }
                    break;
                }
                default: out.push_back(e); break;
            }
        } else {
            out.push_back(c);
        }
    }
    return out;
}

// 将字符串转义为 JSON 字符串内容（不含外层引号）。
inline std::string escape_json(const std::string& in) {
    std::string out;
    out.reserve(in.size() + 4);
    for (char c : in) {
        switch (c) {
            case '"':  out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\n': out += "\\n";  break;
            case '\t': out += "\\t";  break;
            case '\r': out += "\\r";  break;
            case '\b': out += "\\b";  break;
            case '\f': out += "\\f";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    char hex[8];
                    std::snprintf(hex, sizeof(hex), "\\u%04x",
                                   static_cast<unsigned int>(static_cast<unsigned char>(c)));
                    out += hex;
                } else {
                    out.push_back(c);
                }
                break;
        }
    }
    return out;
}

// ---------- HTTP 请求入队核心 ----------
// 登记请求状态、分配递增 requestId，并以空桩响应同步触发回调。
// 返回 requestId（>=1，0 表示参数非法）。
int enqueue_http_request(LumentHttpMethod method, const char* url,
                         const char* body, const char* headers,
                         LumentHttpCallback callback, void* userData) {
    if (!url) return 0;

    int id = 0;
    {
        std::lock_guard<std::mutex> lk(net().mutex);
        net().initialized = true;
        id = net().nextRequestId++;
        HttpRequest rec;
        rec.id = id;
        rec.method = method;
        rec.url = url;
        rec.body = body ? body : "";
        rec.headers = headers ? headers : "";
        rec.cancelled = false;
        net().requests[id] = std::move(rec);
    }

    // 桩实现：未发起真实网络请求，以空响应触发回调。
    // 在锁外调用回调，避免回调内再次访问网络 API 时死锁。
    if (callback) {
        const LumentHttpResponse& resp = make_stub_response();
        callback(&resp, userData);
    }
    return id;
}

} // namespace

// ============================================================
// 内部子系统接口（供 lument_core.cpp 在生命周期中调用）
// ============================================================
namespace ue {

bool init_network() {
    std::lock_guard<std::mutex> lk(net().mutex);
    net().requests.clear();
    net().sockets.clear();
    net().globalHeaders.clear();
    net().authToken.clear();
    net().timeoutSeconds = 30;
    net().nextRequestId = 1;
    net().nextWsId = 1;
    net().initialized = true;
    return true;
}

void shutdown_network() {
    std::lock_guard<std::mutex> lk(net().mutex);
    net().requests.clear();
    net().sockets.clear();
    net().globalHeaders.clear();
    net().authToken.clear();
    net().initialized = false;
}

} // namespace ue

// ============================================================
// C ABI
// ============================================================
extern "C" {

// ===== HTTP 请求 =====

// 通用 HTTP 请求，返回 requestId（0 表示参数非法）。
LUMENT_API int lument_http_request(LumentHttpMethod method, const char* url,
                                   const char* body, const char* headers,
                                   LumentHttpCallback callback, void* userData) {
    return enqueue_http_request(method, url, body, headers, callback, userData);
}

// GET 快捷方法。
LUMENT_API int lument_http_get(const char* url, LumentHttpCallback callback, void* userData) {
    return enqueue_http_request(LUMENT_HTTP_GET, url, nullptr, nullptr, callback, userData);
}

// POST 快捷方法。
LUMENT_API int lument_http_post(const char* url, const char* body,
                                LumentHttpCallback callback, void* userData) {
    return enqueue_http_request(LUMENT_HTTP_POST, url, body, nullptr, callback, userData);
}

// PUT 快捷方法。
LUMENT_API int lument_http_put(const char* url, const char* body,
                              LumentHttpCallback callback, void* userData) {
    return enqueue_http_request(LUMENT_HTTP_PUT, url, body, nullptr, callback, userData);
}

// DELETE 快捷方法。
LUMENT_API int lument_http_delete(const char* url, LumentHttpCallback callback, void* userData) {
    return enqueue_http_request(LUMENT_HTTP_DELETE, url, nullptr, nullptr, callback, userData);
}

// 取消请求：标记并移除待处理记录。
LUMENT_API void lument_http_cancel(int requestId) {
    if (requestId <= 0) return;
    std::lock_guard<std::mutex> lk(net().mutex);
    auto it = net().requests.find(requestId);
    if (it != net().requests.end()) {
        it->second.cancelled = true;
        net().requests.erase(it);
    }
}

// 设置全局请求头：已存在则更新，否则追加。
LUMENT_API void lument_http_set_header(const char* key, const char* value) {
    if (!key) return;
    std::lock_guard<std::mutex> lk(net().mutex);
    std::string k(key);
    std::string v(value ? value : "");
    for (auto& h : net().globalHeaders) {
        if (h.first == k) { h.second = v; return; }
    }
    net().globalHeaders.emplace_back(std::move(k), std::move(v));
}

// 设置请求超时（秒）。非正值视为 0（不超时）。
LUMENT_API void lument_http_set_timeout(int seconds) {
    std::lock_guard<std::mutex> lk(net().mutex);
    net().timeoutSeconds = seconds > 0 ? seconds : 0;
}

// 设置 Bearer 认证令牌。
LUMENT_API void lument_http_set_auth_token(const char* token) {
    std::lock_guard<std::mutex> lk(net().mutex);
    net().authToken = token ? token : "";
}

// ===== WebSocket =====

// 连接 WebSocket，返回 wsId（0 表示参数非法）。
LUMENT_API int lument_ws_connect(const char* url, LumentWsCallback callback, void* userData) {
    if (!url) return 0;
    int id = 0;
    {
        std::lock_guard<std::mutex> lk(net().mutex);
        net().initialized = true;
        id = net().nextWsId++;
        WebSocket ws;
        ws.id = id;
        ws.url = url;
        ws.callback = callback;
        ws.userData = userData;
        ws.connected = true;   // 桩：模拟 open 状态
        net().sockets[id] = std::move(ws);
    }
    // 不投递 OPEN 事件：真实连接由 Web 端建立；桩仅维护状态。
    return id;
}

// 发送二进制数据（桩：不进行真实发送）。
LUMENT_API void lument_ws_send(int wsId, const char* data, int length) {
    (void)data;
    (void)length;
    std::lock_guard<std::mutex> lk(net().mutex);
    auto it = net().sockets.find(wsId);
    if (it == net().sockets.end() || !it->second.connected) {
        return; // 未连接或不存在，忽略
    }
    // 桩：不进行真实发送
}

// 发送文本数据（桩：不进行真实发送）。
LUMENT_API void lument_ws_send_text(int wsId, const char* text) {
    (void)text;
    std::lock_guard<std::mutex> lk(net().mutex);
    auto it = net().sockets.find(wsId);
    if (it == net().sockets.end() || !it->second.connected) {
        return; // 未连接或不存在，忽略
    }
    // 桩：不进行真实发送
}

// 关闭连接：断开并移除记录。
LUMENT_API void lument_ws_close(int wsId) {
    std::lock_guard<std::mutex> lk(net().mutex);
    auto it = net().sockets.find(wsId);
    if (it != net().sockets.end()) {
        it->second.connected = false;
        net().sockets.erase(it);
    }
}

// 检查连接状态。
LUMENT_API bool lument_ws_is_connected(int wsId) {
    std::lock_guard<std::mutex> lk(net().mutex);
    auto it = net().sockets.find(wsId);
    return it != net().sockets.end() && it->second.connected;
}

// ===== JSON 工具 =====

// 从 JSON 字符串中获取字符串值。返回内部缓存的 C 字符串（thread_local，
// 下次调用会被覆盖）；未找到返回空串。
LUMENT_API const char* lument_json_parse(const char* json, const char* key) {
    thread_local std::string buf;
    if (!json || !key) { buf.clear(); return buf.c_str(); }
    std::string s(json);
    size_t i = find_value(s, key);
    if (i == std::string::npos) { buf.clear(); return buf.c_str(); }
    if (i < s.size() && s[i] == '"') {
        // 字符串值：解析含转义
        buf = parse_json_string(s, i);
    } else {
        // 非字符串值：读取到逗号/结束符为止作为原始 token 返回
        size_t start = i;
        while (i < s.size() && s[i] != ',' && s[i] != '}' && s[i] != ']' &&
               s[i] != ' ' && s[i] != '\t' && s[i] != '\n' && s[i] != '\r') ++i;
        buf.assign(s, start, i - start);
    }
    return buf.c_str();
}

// 获取数值。支持负数、小数、科学计数法；未找到或无效返回 defVal。
LUMENT_API float lument_json_get_number(const char* json, const char* key, float defVal) {
    if (!json || !key) return defVal;
    std::string s(json);
    size_t i = find_value(s, key);
    if (i == std::string::npos) return defVal;
    size_t start = i;
    if (i < s.size() && (s[i] == '-' || s[i] == '+')) ++i;
    bool hasDigit = false;
    while (i < s.size() && s[i] >= '0' && s[i] <= '9') { ++i; hasDigit = true; }
    if (i < s.size() && s[i] == '.') {
        ++i;
        while (i < s.size() && s[i] >= '0' && s[i] <= '9') { ++i; hasDigit = true; }
    }
    if (i < s.size() && (s[i] == 'e' || s[i] == 'E')) {
        ++i;
        if (i < s.size() && (s[i] == '+' || s[i] == '-')) ++i;
        while (i < s.size() && s[i] >= '0' && s[i] <= '9') ++i;
    }
    if (!hasDigit) return defVal;
    try {
        return std::stof(s.substr(start, i - start));
    } catch (...) {
        return defVal;
    }
}

// 获取布尔值。未找到返回 defVal。
LUMENT_API bool lument_json_get_bool(const char* json, const char* key, bool defVal) {
    if (!json || !key) return defVal;
    std::string s(json);
    size_t i = find_value(s, key);
    if (i == std::string::npos) return defVal;
    if (i + 4 <= s.size() && s.compare(i, 4, "true") == 0)  return true;
    if (i + 5 <= s.size() && s.compare(i, 5, "false") == 0) return false;
    return defVal;
}

// 从 "key=value\n" 格式构建 JSON 字符串。返回内部缓存的 C 字符串。
// 例：输入 "name=Lument\nversion=1.2.0\n"
//     输出 {"name":"Lument","version":"1.2.0"}
LUMENT_API const char* lument_json_build(const char* pairs) {
    thread_local std::string buf;
    buf = "{";
    if (pairs) {
        const char* p = pairs;
        bool first = true;
        while (*p) {
            std::string k, v;
            // 读取键直到 '=' 或 '\n'
            while (*p && *p != '=' && *p != '\n') k.push_back(*p++);
            if (*p == '=') {
                ++p;
                // 读取值直到 '\n'
                while (*p && *p != '\n') v.push_back(*p++);
            }
            // 跳过行尾换行
            if (*p == '\n') ++p;
            if (!k.empty() || !v.empty()) {
                if (!first) buf.push_back(',');
                buf.push_back('"');
                buf += escape_json(k);
                buf += "\":\"";
                buf += escape_json(v);
                buf.push_back('"');
                first = false;
            }
        }
    }
    buf.push_back('}');
    return buf.c_str();
}

// ===== 数据同步辅助 =====

// 上传数据 = POST JSON，附带 Content-Type 头。
LUMENT_API int lument_upload_data(const char* url, const char* jsonData,
                                  LumentHttpCallback callback, void* userData) {
    return enqueue_http_request(LUMENT_HTTP_POST, url, jsonData,
                                "Content-Type: application/json",
                                callback, userData);
}

// 下载数据 = GET。
LUMENT_API int lument_download_data(const char* url,
                                   LumentHttpCallback callback, void* userData) {
    return enqueue_http_request(LUMENT_HTTP_GET, url, nullptr, nullptr,
                                callback, userData);
}

} // extern "C"
