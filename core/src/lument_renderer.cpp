// ============================================================
// lument_renderer.cpp - 渲染抽象层 + GLES2 后端实现
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_clear / lument_set_camera
//   lument_draw_rect / lument_draw_sprite / lument_draw_text / lument_draw_pixel
//   lument_flush
//   lument_load_texture / lument_create_texture_from_data / lument_destroy_texture
//
// 分层：
//   1) 渲染管理器（本文件上半）：纹理对象池、精灵批次、字体图集、
//      摄像机/视口。负责把高层绘制命令转换为按纹理分组的批量提交。
//   2) IRendererBackend（lument_renderer_backend.h）：可插拔后端。
//      默认 NullRendererBackend（无依赖、始终可编译）。
//   3) GLES2RendererBackend（本文件下半，LUMENT_BACKEND_GLES2 宏守护）：
//      OpenGL ES 2.0 / WebGL1 实现，适用于 Android 与桌面 GLES2。
//
// 热路径：精灵/文本通过批量提交（drawSpriteBatch），同纹理的多个
// 四边形合并为一次 draw call；矩形/像素走即时路径。
// ============================================================
#include "lument_internal.h"
#include "lument_renderer_backend.h"

#include <string>
#include <vector>
#include <cmath>

// ====== GLES2 头文件（仅在后端启用时包含）======
#if defined(LUMENT_BACKEND_GLES2)
#  if defined(__ANDROID__) || defined(__EMSCRIPTEN__)
#    include <GLES2/gl2.h>
#  elif defined(__APPLE__) && (TARGET_OS_IPHONE || TARGET_IPHONE_SIMULATOR)
#    include <OpenGLES/ES2/gl.h>
#  else
     // 桌面 GLES2（如 Mesa libGLESv2）
#    include <GLES2/gl2.h>
#  endif
#endif

namespace {

// =====================================================================
// 第一部分：纹理对象池
// =====================================================================
struct TexSlot {
    bool      used = false;
    uint32_t  backendId = 0;   // 后端纹理句柄
    int       w = 0, h = 0;
};

struct TexturePool {
    TexSlot   slots[LUMENT_MAX_TEXTURES];
    uint32_t  freeNext[LUMENT_MAX_TEXTURES];
    uint32_t  freeHead = 0;
    uint32_t  count = 0;

    void reset() {
        for (uint32_t i = 0; i < LUMENT_MAX_TEXTURES; ++i) {
            slots[i].used = false;
            freeNext[i] = i + 1;
        }
        freeNext[LUMENT_MAX_TEXTURES - 1] = 0xFFFFFFFFu;
        freeHead = 0;
        count = 0;
    }
    // 分配槽位，返回池 id（index+1）；0 表示失败
    uint32_t alloc() {
        if (freeHead == 0xFFFFFFFFu) return 0;
        uint32_t idx = freeHead;
        freeHead = freeNext[idx];
        slots[idx].used = true;
        slots[idx].backendId = 0;
        slots[idx].w = slots[idx].h = 0;
        ++count;
        return idx + 1;
    }
    void free(uint32_t id) {
        if (id == 0 || id > LUMENT_MAX_TEXTURES) return;
        uint32_t idx = id - 1;
        if (!slots[idx].used) return;
        slots[idx].used = false;
        freeNext[idx] = freeHead;
        freeHead = idx;
        if (count) --count;
    }
    TexSlot* get(uint32_t id) {
        if (id == 0 || id > LUMENT_MAX_TEXTURES) return nullptr;
        return slots[id - 1].used ? &slots[id - 1] : nullptr;
    }
};

TexturePool g_texPool;
IRendererBackend* g_backend = nullptr;
NullRendererBackend g_nullBackend;

// 内部保留纹理 id（不可被销毁误用）
uint32_t g_whiteTexId = 0;  // 1x1 白色纹理，用于纯色矩形/像素
uint32_t g_fontTexId  = 0;  // 位图字体图集

// 摄像机与视口
struct { float x = 0, y = 0, zoom = 1.0f; } g_cam;
int  g_viewW = 0, g_viewH = 0;
std::string g_assetPath;
bool g_initialized = false;

// =====================================================================
// 2D 场景渲染状态
// =====================================================================

// 场景色彩色调（默认值=无效果）
LumentSceneColor g_sceneColor = {
    {255, 255, 255, 255},  // tint（白色=无叠加）
    1.0f,                   // brightness
    1.0f,                   // contrast
    1.0f,                   // saturation
    0.0f,                   // hueShift
    0.0f,                   // grayscale
    0.0f,                   // sepia
    0.0f,                   // invert
};

// 场景清晰度（默认值=无效果）
LumentSceneClarity g_sceneClarity = {
    0.0f,   // sharpness
    0.0f,   // blurRadius
    0.0f,   // bloomIntensity
    0.5f,   // bloomThreshold
};

// 暗角
LumentVignette g_vignette = { 0.0f, 0.5f };

// 雾效
LumentFog g_fog = { {0, 0, 0, 0}, 0.0f, 0.0f, 0.0f };

// 环境光
LumentSceneLighting g_lighting = { {255, 255, 255, 255}, 0.0f, 2.0f };

// 光源存储
constexpr int MAX_LIGHTS = 64;
LumentLight g_lights[MAX_LIGHTS];
int g_lightCount = 0;
int g_nextLightId = 1;
int g_lightIds[MAX_LIGHTS];

// 光源 id -> 槽位索引映射（线性查找，光源数量通常很少）
int find_light_slot(int lightId) {
    for (int i = 0; i < g_lightCount; ++i)
        if (g_lightIds[i] == lightId) return i;
    return -1;
}

// 渲染目标存储
struct RenderTargetSlot {
    bool      used = false;
    uint32_t  backendId = 0;
    int       w = 0, h = 0;
};
constexpr int MAX_RENDER_TARGETS = 32;
RenderTargetSlot g_renderTargets[MAX_RENDER_TARGETS];
uint32_t g_activeRenderTarget = 0;  // 0=屏幕

// =====================================================================
// 第二部分：精灵批次
// =====================================================================
struct SpriteCmd {
    uint32_t texId;     // 池 id
    LumentRect   dest;
    LumentRect   src;       // 像素；w/h<=0 表示整张纹理
    LumentColor  color;
};

std::vector<SpriteCmd> g_batch;
std::vector<LumentSpriteVertex> g_batchVerts; // 复用缓冲，避免反复分配
uint32_t g_drawCalls = 0;

// 把命令转换为 4 个顶点（三角形带顺序）。
inline void build_quad(std::vector<LumentSpriteVertex>& out,
                       const SpriteCmd& cmd, const TexSlot& tex) {
    const float x = cmd.dest.x, y = cmd.dest.y;
    const float w = cmd.dest.w, h = cmd.dest.h;

    float u0, v0, u1, v1;
    if (cmd.src.w <= 0.0f || cmd.src.h <= 0.0f || tex.w == 0 || tex.h == 0) {
        u0 = 0.0f; v0 = 0.0f; u1 = 1.0f; v1 = 1.0f;
    } else {
        u0 = cmd.src.x / tex.w;
        v0 = cmd.src.y / tex.h;
        u1 = (cmd.src.x + cmd.src.w) / tex.w;
        v1 = (cmd.src.y + cmd.src.h) / tex.h;
    }
    const uint8_t r = cmd.color.r, g = cmd.color.g, b = cmd.color.b, a = cmd.color.a;
    // 三角形带：左上、右上、右下、左下
    out.push_back({ x,     y,     u0, v0, r, g, b, a });
    out.push_back({ x + w, y,     u1, v0, r, g, b, a });
    out.push_back({ x + w, y + h, u1, v1, r, g, b, a });
    out.push_back({ x,     y + h, u0, v1, r, g, b, a });
}

// =====================================================================
// 第三部分：最小 TGA 解码（未压缩真彩 24/32 位）
// 解码后翻转为 top-left 原点，输出 RGBA。
// =====================================================================
bool decode_tga(const char* path, int& w, int& h, std::vector<uint8_t>& rgba) {
    FILE* fp = std::fopen(path, "rb");
    if (!fp) return false;

    uint8_t hdr[18];
    if (std::fread(hdr, 1, 18, fp) != 18) { std::fclose(fp); return false; }

    uint8_t idLen    = hdr[0];
    uint8_t imgType  = hdr[2];
    uint16_t width   = uint16_t(hdr[12] | (hdr[13] << 8));
    uint16_t height  = uint16_t(hdr[14] | (hdr[15] << 8));
    uint8_t  bpp     = hdr[16];
    uint8_t  desc     = hdr[17];
    bool originTop = (desc & 0x20) != 0;

    if (imgType != 2) { // 仅未压缩真彩
        std::fclose(fp); return false;
    }
    if (bpp != 24 && bpp != 32) { std::fclose(fp); return false; }
    if (width == 0 || height == 0) { std::fclose(fp); return false; }

    std::fseek(fp, idLen, SEEK_CUR); // 跳过 ID 段

    const size_t pitch = size_t(width) * (bpp / 8);
    std::vector<uint8_t> raw(size_t(pitch) * height);
    if (std::fread(raw.data(), 1, raw.size(), fp) != raw.size()) {
        std::fclose(fp); return false;
    }
    std::fclose(fp);

    rgba.resize(size_t(width) * height * 4);
    const int comps = bpp / 8;
    for (int row = 0; row < height; ++row) {
        // 翻转为 top-left 原点
        int srcRow = originTop ? row : (height - 1 - row);
        const uint8_t* src = &raw[size_t(srcRow) * pitch];
        uint8_t* dst = &rgba[size_t(row) * width * 4];
        for (int col = 0; col < width; ++col, src += comps, dst += 4) {
            dst[0] = src[2]; // B->R
            dst[1] = src[1]; // G
            dst[2] = src[0]; // R->B
            dst[3] = comps == 4 ? src[3] : 255;
        }
    }
    w = width; h = height;
    return true;
}

// =====================================================================
// 第四部分：内置 5x7 位图字体
// 仅收录常用字符；未收录字符回退为“方块”字形。小写映射为大写。
// 行优先，每字节 bit4(左)..bit0(右)。
// =====================================================================
struct GlyphDef { char ch; uint8_t rows[7]; };

static const GlyphDef kGlyphTable[] = {
    {' ', {0x00,0x00,0x00,0x00,0x00,0x00,0x00}},
    {'!', {0x04,0x04,0x04,0x04,0x04,0x00,0x04}},
    {'"', {0x0A,0x0A,0x00,0x00,0x00,0x00,0x00}},
    {'#', {0x1F,0x11,0x1F,0x11,0x1F,0x00,0x00}},
    {'$', {0x04,0x1E,0x10,0x0E,0x01,0x1E,0x04}},
    {'%', {0x11,0x08,0x04,0x02,0x11,0x00,0x00}},
    {'&', {0x0E,0x11,0x0E,0x14,0x1A,0x12,0x0D}},
    {'\'',{0x04,0x08,0x10,0x00,0x00,0x00,0x00}},
    {'(', {0x02,0x04,0x08,0x08,0x08,0x04,0x02}},
    {')', {0x08,0x04,0x02,0x02,0x02,0x04,0x08}},
    {'*', {0x00,0x04,0x15,0x0E,0x15,0x04,0x00}},
    {'+', {0x00,0x04,0x04,0x1F,0x04,0x04,0x00}},
    {',', {0x00,0x00,0x00,0x00,0x00,0x0C,0x04}},
    {'-', {0x00,0x00,0x00,0x1F,0x00,0x00,0x00}},
    {'.', {0x00,0x00,0x00,0x00,0x00,0x0C,0x0C}},
    {'/', {0x00,0x01,0x02,0x04,0x08,0x10,0x00}},
    {'0', {0x0E,0x11,0x13,0x15,0x19,0x11,0x0E}},
    {'1', {0x04,0x0C,0x04,0x04,0x04,0x04,0x0E}},
    {'2', {0x0E,0x11,0x01,0x02,0x04,0x08,0x1F}},
    {'3', {0x1F,0x02,0x04,0x02,0x01,0x11,0x0E}},
    {'4', {0x02,0x06,0x0A,0x12,0x1F,0x02,0x02}},
    {'5', {0x1F,0x10,0x1E,0x01,0x01,0x11,0x0E}},
    {'6', {0x06,0x08,0x10,0x1E,0x11,0x11,0x0E}},
    {'7', {0x1F,0x01,0x02,0x04,0x08,0x08,0x08}},
    {'8', {0x0E,0x11,0x11,0x0E,0x11,0x11,0x0E}},
    {'9', {0x0E,0x11,0x11,0x0F,0x01,0x02,0x0C}},
    {':', {0x00,0x04,0x00,0x00,0x04,0x00,0x00}},
    {';', {0x00,0x04,0x00,0x00,0x04,0x0C,0x04}},
    {'<', {0x02,0x04,0x08,0x10,0x08,0x04,0x02}},
    {'=', {0x00,0x00,0x1F,0x00,0x1F,0x00,0x00}},
    {'>', {0x08,0x04,0x02,0x01,0x02,0x04,0x08}},
    {'?', {0x0E,0x11,0x01,0x02,0x04,0x00,0x04}},
    {'@', {0x0E,0x11,0x17,0x15,0x17,0x10,0x0E}},
    {'A', {0x0E,0x11,0x11,0x1F,0x11,0x11,0x11}},
    {'B', {0x1E,0x11,0x11,0x1E,0x11,0x11,0x1E}},
    {'C', {0x0E,0x11,0x10,0x10,0x10,0x11,0x0E}},
    {'D', {0x1E,0x11,0x11,0x11,0x11,0x11,0x1E}},
    {'E', {0x1F,0x10,0x10,0x1E,0x10,0x10,0x1F}},
    {'F', {0x1F,0x10,0x10,0x1E,0x10,0x10,0x10}},
    {'G', {0x0E,0x11,0x10,0x17,0x11,0x11,0x0F}},
    {'H', {0x11,0x11,0x11,0x1F,0x11,0x11,0x11}},
    {'I', {0x0E,0x04,0x04,0x04,0x04,0x04,0x0E}},
    {'J', {0x01,0x01,0x01,0x01,0x11,0x11,0x0E}},
    {'K', {0x11,0x12,0x14,0x18,0x14,0x12,0x11}},
    {'L', {0x10,0x10,0x10,0x10,0x10,0x10,0x1F}},
    {'M', {0x11,0x1B,0x15,0x15,0x11,0x11,0x11}},
    {'N', {0x11,0x11,0x19,0x15,0x13,0x11,0x11}},
    {'O', {0x0E,0x11,0x11,0x11,0x11,0x11,0x0E}},
    {'P', {0x1E,0x11,0x11,0x1E,0x10,0x10,0x10}},
    {'Q', {0x0E,0x11,0x11,0x11,0x15,0x12,0x0D}},
    {'R', {0x1E,0x11,0x11,0x1E,0x14,0x12,0x11}},
    {'S', {0x0F,0x10,0x10,0x0E,0x01,0x01,0x1E}},
    {'T', {0x1F,0x04,0x04,0x04,0x04,0x04,0x04}},
    {'U', {0x11,0x11,0x11,0x11,0x11,0x11,0x0E}},
    {'V', {0x11,0x11,0x11,0x11,0x11,0x0A,0x04}},
    {'W', {0x11,0x11,0x11,0x15,0x15,0x15,0x0A}},
    {'X', {0x11,0x11,0x0A,0x04,0x0A,0x11,0x11}},
    {'Y', {0x11,0x11,0x0A,0x04,0x04,0x04,0x04}},
    {'Z', {0x1F,0x01,0x02,0x04,0x08,0x10,0x1F}},
    {'[', {0x0E,0x08,0x08,0x08,0x08,0x08,0x0E}},
    {']', {0x0E,0x02,0x02,0x02,0x02,0x02,0x0E}},
    {'_', {0x00,0x00,0x00,0x00,0x00,0x00,0x1F}},
};
// 回退字形（方块）
static const uint8_t kBoxGlyph[7] = {0x1F,0x11,0x11,0x11,0x11,0x11,0x1F};

constexpr int kGlyphW = 5;
constexpr int kGlyphH = 7;
constexpr int kCellW   = kGlyphW + 1; // 6（右 1px 间距防 UV 渗色）
constexpr int kCellH   = kGlyphH + 1; // 8
constexpr int kAtlasCols = 16;

// char -> glyph 索引（含回退）。表大小 +1 用于回退。
uint8_t g_charToGlyph[128];

const uint8_t* glyph_rows(char c) {
    unsigned char uc = (unsigned char)c;
    if (uc < 128) {
        uint8_t idx = g_charToGlyph[uc];
        if (idx != 0xFF) return kGlyphTable[idx].rows;
    }
    return kBoxGlyph;
}

// 初始化字体图集：栅格化所有字形到一张 RGBA 纹理。
void init_font_atlas() {
    // 构建映射
    for (int i = 0; i < 128; ++i) g_charToGlyph[i] = 0xFF;
    const int n = int(sizeof(kGlyphTable) / sizeof(kGlyphTable[0]));
    for (int i = 0; i < n; ++i) {
        unsigned char c = (unsigned char)kGlyphTable[i].ch;
        g_charToGlyph[c] = uint8_t(i);
        // 小写映射为大写
        if (c >= 'A' && c <= 'Z') g_charToGlyph[c + 32] = uint8_t(i);
    }

    const int totalCells = n + 1; // +1 给回退
    const int rows = (totalCells + kAtlasCols - 1) / kAtlasCols;
    const int atlasW = kAtlasCols * kCellW;
    const int atlasH = rows * kCellH;

    std::vector<uint8_t> rgba(size_t(atlasW) * atlasH * 4, 0); // 透明
    auto setpx = [&](int gx, int gy, uint8_t v) {
        if (!v) return;
        int px = gx, py = gy;
        uint8_t* p = &rgba[(size_t(py) * atlasW + px) * 4];
        p[0] = p[1] = p[2] = 255; p[3] = v ? 255 : 0;
    };

    for (int i = 0; i < n; ++i) {
        int col = i % kAtlasCols, row = i / kAtlasCols;
        int ox = col * kCellW, oy = row * kCellH;
        for (int ry = 0; ry < kGlyphH; ++ry) {
            uint8_t bits = kGlyphTable[i].rows[ry];
            for (int rx = 0; rx < kGlyphW; ++rx) {
                if (bits & (1 << (kGlyphW - 1 - rx))) setpx(ox + rx, oy + ry, 1);
            }
        }
    }
    // 回退字形放在最后一个单元
    {
        int i = n;
        int col = i % kAtlasCols, row = i / kAtlasCols;
        int ox = col * kCellW, oy = row * kCellH;
        for (int ry = 0; ry < kGlyphH; ++ry) {
            uint8_t bits = kBoxGlyph[ry];
            for (int rx = 0; rx < kGlyphW; ++rx) {
                if (bits & (1 << (kGlyphW - 1 - rx))) setpx(ox + rx, oy + ry, 1);
            }
        }
    }

    uint32_t id = g_texPool.alloc();
    if (id == 0) { g_fontTexId = 0; return; }
    TexSlot& slot = g_texPool.slots[id - 1];
    slot.w = atlasW; slot.h = atlasH;
    slot.backendId = g_backend->createTextureFromData(atlasW, atlasH, rgba.data());
    g_fontTexId = id;
}

// =====================================================================
// 第五部分：内部渲染接口
// =====================================================================
void push_sprite(uint32_t texId, LumentRect dest, LumentRect src, LumentColor color) {
    if (!g_initialized) return;
    if (texId == 0) texId = g_whiteTexId; // 无纹理退化为纯色

    // 应用场景色调（tint）和亮度到顶点色
    LumentColor c = color;
    const LumentSceneColor& sc = g_sceneColor;
    // tint 乘法
    c.r = (uint8_t)((uint16_t)c.r * sc.tint.r / 255);
    c.g = (uint8_t)((uint16_t)c.g * sc.tint.g / 255);
    c.b = (uint8_t)((uint16_t)c.b * sc.tint.b / 255);
    // 亮度
    if (sc.brightness != 1.0f) {
        float b = sc.brightness;
        c.r = (uint8_t)std::min(255.0f, c.r * b);
        c.g = (uint8_t)std::min(255.0f, c.g * b);
        c.b = (uint8_t)std::min(255.0f, c.b * b);
    }
    g_batch.push_back({ texId, dest, src, c });
}

} // namespace

#if defined(LUMENT_BACKEND_GLES2)
namespace ue {
    IRendererBackend* create_gles2_backend();   // 见本文件末尾
    void destroy_gles2_backend(IRendererBackend*);
}
#endif

namespace ue {

bool init_renderer(const LumentConfig& cfg) {
    g_texPool.reset();
    g_batch.clear();
    g_batch.reserve(512);
    g_batchVerts.clear();
    g_batchVerts.reserve(512 * 4);
    g_drawCalls = 0;
    g_cam = { 0, 0, 1.0f };
    g_viewW = cfg.width;  g_viewH = cfg.height;
    g_assetPath = cfg.assetPath ? cfg.assetPath : "";
    if (!g_assetPath.empty() && g_assetPath.back() != '/' && g_assetPath.back() != '\\')
        g_assetPath.push_back('/');

    // 重置 2D 场景渲染状态
    g_sceneColor = { {255,255,255,255}, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f };
    g_sceneClarity = { 0.0f, 0.0f, 0.0f, 0.5f };
    g_vignette = { 0.0f, 0.5f };
    g_fog = { {0,0,0,0}, 0.0f, 0.0f, 0.0f };
    g_lighting = { {255,255,255,255}, 0.0f, 2.0f };
    g_lightCount = 0;
    g_nextLightId = 1;
    memset(g_lightIds, 0, sizeof(g_lightIds));
    memset(g_lights, 0, sizeof(g_lights));
    memset(g_renderTargets, 0, sizeof(g_renderTargets));
    g_activeRenderTarget = 0;

    // 选择后端
#if defined(LUMENT_BACKEND_GLES2)
    if (cfg.rendererType == LUMENT_RENDERER_OPENGL ||
        cfg.rendererType == LUMENT_RENDERER_OPENGLES ||
        cfg.rendererType == LUMENT_RENDERER_WEBGL) {
        g_backend = create_gles2_backend();
    } else
#endif
    {
        g_backend = &g_nullBackend;
    }

    if (!g_backend->init(g_viewW, g_viewH)) {
        g_backend = &g_nullBackend;
        g_backend->init(g_viewW, g_viewH);
    }
    g_backend->setCamera(0, 0, 1.0f);

    // 创建内置白色纹理（1x1）
    {
        uint8_t white[4] = { 255, 255, 255, 255 };
        uint32_t id = g_texPool.alloc();
        if (id) {
            TexSlot& s = g_texPool.slots[id - 1];
            s.w = 1; s.h = 1;
            s.backendId = g_backend->createTextureFromData(1, 1, white);
            g_whiteTexId = id;
        }
    }

    init_font_atlas();
    g_initialized = true;
    return true;
}

void shutdown_renderer() {
    if (g_backend) {
        // 销毁内置纹理
        if (g_whiteTexId && g_texPool.get(g_whiteTexId))
            g_backend->destroyTexture(g_texPool.get(g_whiteTexId)->backendId);
        if (g_fontTexId && g_texPool.get(g_fontTexId))
            g_backend->destroyTexture(g_texPool.get(g_fontTexId)->backendId);
        g_backend->shutdown();
    }
#if defined(LUMENT_BACKEND_GLES2)
    if (g_backend && g_backend != &g_nullBackend) {
        destroy_gles2_backend(g_backend);
    }
#endif
    g_backend = nullptr;
    g_texPool.reset();
    g_batch.clear();
    g_batchVerts.clear();
    g_whiteTexId = g_fontTexId = 0;
    g_initialized = false;
}

void renderer_set_viewport(int w, int h) {
    g_viewW = w; g_viewH = h;
    if (g_backend) g_backend->resize(w, h);
}

void renderer_begin_frame() {
    g_drawCalls = 0;
    g_batch.clear();
}

void renderer_draw_sprite(uint32_t tex, LumentRect dest, LumentRect src, LumentColor color) {
    push_sprite(tex, dest, src, color);
}

void renderer_flush_batch() {
    if (!g_initialized || g_batch.empty()) return;
    // 按纹理 id 排序，使同纹理命令连续（稳定排序保持绘制顺序）。
    std::stable_sort(g_batch.begin(), g_batch.end(),
        [](const SpriteCmd& a, const SpriteCmd& b) { return a.texId < b.texId; });

    size_t i = 0;
    const size_t n = g_batch.size();
    while (i < n) {
        uint32_t curTex = g_batch[i].texId;
        TexSlot* slot = g_texPool.get(curTex);
        if (!slot) { ++i; continue; }
        size_t j = i;
        g_batchVerts.clear();
        while (j < n && g_batch[j].texId == curTex) {
            build_quad(g_batchVerts, g_batch[j], *slot);
            ++j;
        }
        size_t quadCount = (j - i);
        g_backend->drawSpriteBatch(slot->backendId, g_batchVerts.data(), quadCount);
        // 每个纹理分组至少一次提交；后端内部对超大批次会再分块。
        g_drawCalls += uint32_t((quadCount + 4095) / 4096);
        i = j;
    }
    g_batch.clear();
}

void renderer_present() {
    if (g_backend) g_backend->present();
}

uint32_t renderer_texture_count() { return g_texPool.count; }
uint32_t renderer_draw_calls() { return g_drawCalls; }

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

LUMENT_API void lument_clear(LumentColor color) {
    if (g_backend) g_backend->clear(color);
}

LUMENT_API void lument_set_camera(float x, float y, float zoom) {
    g_cam.x = x; g_cam.y = y; g_cam.zoom = zoom > 0.0f ? zoom : 1.0f;
    if (g_backend) g_backend->setCamera(g_cam.x, g_cam.y, g_cam.zoom);
}

LUMENT_API void lument_draw_rect(LumentRect rect, LumentColor color, bool filled) {
    if (!g_initialized) return;
    if (filled) {
        push_sprite(g_whiteTexId, rect, {0,0,0,0}, color);
    } else {
        // 描边：4 条细矩形
        const float t = 1.0f;
        push_sprite(g_whiteTexId, {rect.x, rect.y, rect.w, t}, {0,0,0,0}, color);
        push_sprite(g_whiteTexId, {rect.x, rect.y + rect.h - t, rect.w, t}, {0,0,0,0}, color);
        push_sprite(g_whiteTexId, {rect.x, rect.y, t, rect.h}, {0,0,0,0}, color);
        push_sprite(g_whiteTexId, {rect.x + rect.w - t, rect.y, t, rect.h}, {0,0,0,0}, color);
    }
}

LUMENT_API void lument_draw_sprite(uint32_t textureId, LumentRect dest, LumentRect src) {
    // 公共 ABI 无颜色参数，使用白色着色（保持纹理原色）。
    push_sprite(textureId, dest, src, LumentColor{255,255,255,255});
}

LUMENT_API void lument_draw_text(const char* text, float x, float y, float size, LumentColor color) {
    if (!g_initialized || !text || g_fontTexId == 0) return;
    const float scale = size > 0.0f ? size / float(kGlyphH) : 1.0f;
    const float advX = float(kCellW) * scale;
    float cx = x;
    for (const char* p = text; *p; ++p) {
        char c = *p;
        if (c == ' ') { cx += advX; continue; }
        const uint8_t* rows = glyph_rows(c);
        // 查找字形在表中的索引（线性，文本通常较短）
        int idx = -1;
        unsigned char uc = (unsigned char)c;
        if (uc < 128 && g_charToGlyph[uc] != 0xFF) idx = g_charToGlyph[uc];
        else idx = int(sizeof(kGlyphTable)/sizeof(kGlyphTable[0])); // 回退单元

        int col = idx % kAtlasCols, row = idx / kAtlasCols;
        LumentRect dest { cx, y, float(kGlyphW) * scale, float(kGlyphH) * scale };
        LumentRect src  { float(col * kCellW), float(row * kCellH), float(kGlyphW), float(kGlyphH) };
        push_sprite(g_fontTexId, dest, src, color);
        cx += advX;
        (void)rows;
    }
}

LUMENT_API void lument_draw_pixel(int x, int y, LumentColor color) {
    if (g_backend) {
        g_backend->drawPixel(x, y, color);
        ++g_drawCalls;
    }
}

LUMENT_API void lument_flush(void) {
    ue::renderer_flush_batch();
}

LUMENT_API uint32_t lument_load_texture(const char* path) {
    if (!g_initialized || !path) return 0;
    std::string full = g_assetPath + path;
    int w = 0, h = 0;
    std::vector<uint8_t> rgba;
    if (!decode_tga(full.c_str(), w, h, rgba)) {
        lument_log("lument_load_texture: failed to load TGA");
        return 0;
    }
    uint32_t id = g_texPool.alloc();
    if (id == 0) return 0;
    TexSlot& s = g_texPool.slots[id - 1];
    s.w = w; s.h = h;
    s.backendId = g_backend->createTextureFromData(w, h, rgba.data());
    return id;
}

LUMENT_API uint32_t lument_create_texture_from_data(int w, int h, const uint8_t* rgba) {
    if (!g_initialized || w <= 0 || h <= 0 || !rgba) return 0;
    uint32_t id = g_texPool.alloc();
    if (id == 0) return 0;
    TexSlot& s = g_texPool.slots[id - 1];
    s.w = w; s.h = h;
    s.backendId = g_backend->createTextureFromData(w, h, rgba);
    return id;
}

LUMENT_API void lument_destroy_texture(uint32_t id) {
    TexSlot* s = g_texPool.get(id);
    if (!s || !g_backend) return;
    // 禁止销毁内置纹理
    if (id == g_whiteTexId || id == g_fontTexId) return;
    g_backend->destroyTexture(s->backendId);
    g_texPool.free(id);
}

// ============================================================
// 2D 场景渲染：色彩色调控制
// ============================================================

LUMENT_API void lument_set_scene_tint(LumentColor tint) {
    g_sceneColor.tint = tint;
}

LUMENT_API void lument_set_scene_brightness(float brightness) {
    g_sceneColor.brightness = brightness < 0.0f ? 0.0f : (brightness > 2.0f ? 2.0f : brightness);
}

LUMENT_API void lument_set_scene_contrast(float contrast) {
    g_sceneColor.contrast = contrast < 0.0f ? 0.0f : (contrast > 2.0f ? 2.0f : contrast);
}

LUMENT_API void lument_set_scene_saturation(float saturation) {
    g_sceneColor.saturation = saturation < 0.0f ? 0.0f : (saturation > 2.0f ? 2.0f : saturation);
}

LUMENT_API void lument_set_scene_hue_shift(float hueShift) {
    g_sceneColor.hueShift = hueShift;
    while (g_sceneColor.hueShift >= 360.0f) g_sceneColor.hueShift -= 360.0f;
    while (g_sceneColor.hueShift < 0.0f) g_sceneColor.hueShift += 360.0f;
}

LUMENT_API void lument_set_scene_grayscale(float amount) {
    g_sceneColor.grayscale = amount < 0.0f ? 0.0f : (amount > 1.0f ? 1.0f : amount);
}

LUMENT_API void lument_set_scene_sepia(float amount) {
    g_sceneColor.sepia = amount < 0.0f ? 0.0f : (amount > 1.0f ? 1.0f : amount);
}

LUMENT_API void lument_set_scene_invert(float amount) {
    g_sceneColor.invert = amount < 0.0f ? 0.0f : (amount > 1.0f ? 1.0f : amount);
}

LUMENT_API void lument_set_scene_color(const LumentSceneColor* color) {
    if (color) g_sceneColor = *color;
}

LUMENT_API void lument_get_scene_color(LumentSceneColor* outColor) {
    if (outColor) *outColor = g_sceneColor;
}

LUMENT_API void lument_reset_scene_color(void) {
    g_sceneColor = { {255,255,255,255}, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f };
}

// ============================================================
// 2D 场景渲染：清晰度控制
// ============================================================

LUMENT_API void lument_set_scene_sharpness(float sharpness) {
    g_sceneClarity.sharpness = sharpness < -1.0f ? -1.0f : (sharpness > 1.0f ? 1.0f : sharpness);
}

LUMENT_API void lument_set_scene_blur(float radius) {
    g_sceneClarity.blurRadius = radius < 0.0f ? 0.0f : radius;
}

LUMENT_API void lument_set_scene_bloom(float intensity, float threshold) {
    g_sceneClarity.bloomIntensity = intensity < 0.0f ? 0.0f : (intensity > 1.0f ? 1.0f : intensity);
    g_sceneClarity.bloomThreshold = threshold < 0.0f ? 0.0f : (threshold > 1.0f ? 1.0f : threshold);
}

LUMENT_API void lument_set_scene_clarity(const LumentSceneClarity* clarity) {
    if (clarity) g_sceneClarity = *clarity;
}

LUMENT_API void lument_get_scene_clarity(LumentSceneClarity* outClarity) {
    if (outClarity) *outClarity = g_sceneClarity;
}

LUMENT_API void lument_reset_scene_clarity(void) {
    g_sceneClarity = { 0.0f, 0.0f, 0.0f, 0.5f };
}

// ============================================================
// 2D 场景渲染：暗角与雾效
// ============================================================

LUMENT_API void lument_set_vignette(float intensity, float radius) {
    g_vignette.intensity = intensity < 0.0f ? 0.0f : (intensity > 1.0f ? 1.0f : intensity);
    g_vignette.radius = radius < 0.0f ? 0.0f : (radius > 1.0f ? 1.0f : radius);
}

LUMENT_API void lument_set_fog(LumentColor color, float density, float start, float end) {
    g_fog.color = color;
    g_fog.density = density < 0.0f ? 0.0f : (density > 1.0f ? 1.0f : density);
    g_fog.start = start;
    g_fog.end = end;
}

LUMENT_API void lument_reset_vignette(void) {
    g_vignette = { 0.0f, 0.5f };
}

LUMENT_API void lument_reset_fog(void) {
    g_fog = { {0,0,0,0}, 0.0f, 0.0f, 0.0f };
}

// ============================================================
// 2D 场景渲染：光线渲染
// ============================================================

LUMENT_API int lument_add_light(LumentLightType type, float x, float y,
                                float radius, LumentColor color, float intensity) {
    if (g_lightCount >= MAX_LIGHTS) return 0;
    int slot = g_lightCount++;
    int id = g_nextLightId++;
    g_lightIds[slot] = id;
    g_lights[slot] = {};
    g_lights[slot].type = type;
    g_lights[slot].x = x;
    g_lights[slot].y = y;
    g_lights[slot].dirX = 0.0f;
    g_lights[slot].dirY = 1.0f;
    g_lights[slot].radius = radius;
    g_lights[slot].angle = 45.0f;
    g_lights[slot].intensity = intensity;
    g_lights[slot].color = color;
    return id;
}

LUMENT_API void lument_set_light_direction(int lightId, float dirX, float dirY) {
    int slot = find_light_slot(lightId);
    if (slot < 0) return;
    g_lights[slot].dirX = dirX;
    g_lights[slot].dirY = dirY;
}

LUMENT_API void lument_set_light_angle(int lightId, float angle) {
    int slot = find_light_slot(lightId);
    if (slot < 0) return;
    g_lights[slot].angle = angle;
}

LUMENT_API void lument_set_light_intensity(int lightId, float intensity) {
    int slot = find_light_slot(lightId);
    if (slot < 0) return;
    g_lights[slot].intensity = intensity;
}

LUMENT_API void lument_set_light_color(int lightId, LumentColor color) {
    int slot = find_light_slot(lightId);
    if (slot < 0) return;
    g_lights[slot].color = color;
}

LUMENT_API void lument_set_light_position(int lightId, float x, float y) {
    int slot = find_light_slot(lightId);
    if (slot < 0) return;
    g_lights[slot].x = x;
    g_lights[slot].y = y;
}

LUMENT_API void lument_remove_light(int lightId) {
    int slot = find_light_slot(lightId);
    if (slot < 0) return;
    // 用最后一个元素填补空位
    int last = g_lightCount - 1;
    if (slot != last) {
        g_lights[slot] = g_lights[last];
        g_lightIds[slot] = g_lightIds[last];
    }
    g_lightCount--;
}

LUMENT_API void lument_clear_lights(void) {
    g_lightCount = 0;
}

LUMENT_API int lument_get_light_count(void) {
    return g_lightCount;
}

LUMENT_API void lument_set_ambient_light(LumentColor color, float intensity) {
    g_lighting.color = color;
    g_lighting.intensity = intensity < 0.0f ? 0.0f : (intensity > 1.0f ? 1.0f : intensity);
}

LUMENT_API void lument_set_light_falloff(float falloff) {
    g_lighting.falloff = falloff < 0.5f ? 0.5f : falloff;
}

LUMENT_API void lument_render_lights(void) {
    if (!g_backend || g_lightCount == 0) return;
    g_backend->renderLights(g_lights, g_lightCount, &g_lighting);
    g_drawCalls++;
}

// ============================================================
// 2D 场景渲染：图片接入接口
// ============================================================

LUMENT_API uint32_t lument_load_image(const char* path, int* outW, int* outH) {
    if (!g_initialized || !path) return 0;
    std::string full = g_assetPath + path;
    int w = 0, h = 0;
    std::vector<uint8_t> rgba;
    if (!decode_tga(full.c_str(), w, h, rgba)) {
        lument_log("lument_load_image: failed to load image");
        return 0;
    }
    if (outW) *outW = w;
    if (outH) *outH = h;
    uint32_t id = g_texPool.alloc();
    if (id == 0) return 0;
    TexSlot& s = g_texPool.slots[id - 1];
    s.w = w; s.h = h;
    s.backendId = g_backend->createTextureFromData(w, h, rgba.data());
    return id;
}

LUMENT_API void lument_draw_image_tiled(uint32_t texId, LumentRect dest,
                                        LumentRect src, float offsetX, float offsetY) {
    if (!g_initialized || texId == 0) return;
    TexSlot* tex = g_texPool.get(texId);
    if (!tex) return;
    // 在 dest 区域内平铺 src 纹理
    float tw = (src.w > 0) ? src.w : (float)tex->w;
    float th = (src.h > 0) ? src.h : (float)tex->h;
    float startX = dest.x + (offsetX - std::floor(offsetX / tw) * tw);
    float startY = dest.y + (offsetY - std::floor(offsetY / th) * th);
    LumentRect srcRect = { src.x, src.y, (src.w > 0) ? src.w : (float)tex->w, (src.h > 0) ? src.h : (float)tex->h };
    for (float y = startY - th; y < dest.y + dest.h; y += th) {
        for (float x = startX - tw; x < dest.x + dest.w; x += tw) {
            LumentRect d = { x, y, tw, th };
            // 裁剪到 dest 区域
            if (d.x < dest.x) { d.w -= (dest.x - d.x); d.x = dest.x; }
            if (d.y < dest.y) { d.h -= (dest.y - d.y); d.y = dest.y; }
            if (d.x + d.w > dest.x + dest.w) d.w = dest.x + dest.w - d.x;
            if (d.y + d.h > dest.y + dest.h) d.h = dest.y + dest.h - d.y;
            if (d.w > 0 && d.h > 0)
                push_sprite(texId, d, srcRect, LumentColor{255,255,255,255});
        }
    }
}

LUMENT_API void lument_draw_image_rotated(uint32_t texId, float cx, float cy,
                                          float angleDeg, float scale, LumentRect src) {
    if (!g_initialized || texId == 0) return;
    TexSlot* tex = g_texPool.get(texId);
    if (!tex) return;
    // 简化实现：通过后端直接绘制旋转四边形
    // 对于不支持旋转的后端，退化为不旋转的精灵
    float w = (src.w > 0 ? src.w : (float)tex->w) * scale;
    float h = (src.h > 0 ? src.h : (float)tex->h) * scale;
    LumentRect dest = { cx - w * 0.5f, cy - h * 0.5f, w, h };
    push_sprite(texId, dest, src, LumentColor{255,255,255,255});
    // 注意：真正的旋转需要后端支持，此处保持与现有架构一致
    // WebGL/Canvas2D 后端可通过 ctx.rotate 实现
    (void)angleDeg;
}

LUMENT_API void lument_draw_image_with_color(uint32_t texId, LumentRect dest,
                                             LumentRect src, LumentColor color) {
    push_sprite(texId, dest, src, color);
}

LUMENT_API void lument_draw_image_region(uint32_t texId, LumentRect dest,
                                         LumentRect src, LumentColor color,
                                         float rotation, bool tiled) {
    if (tiled) {
        lument_draw_image_tiled(texId, dest, src, 0.0f, 0.0f);
    } else {
        if (rotation != 0.0f) {
            lument_draw_image_rotated(texId, dest.x + dest.w * 0.5f, dest.y + dest.h * 0.5f,
                                      rotation, 1.0f, src);
        } else {
            push_sprite(texId, dest, src, color);
        }
    }
}

// ============================================================
// 2D 场景渲染：离屏渲染目标
// ============================================================

LUMENT_API uint32_t lument_create_render_target(int w, int h) {
    if (!g_initialized || w <= 0 || h <= 0) return 0;
    for (int i = 0; i < MAX_RENDER_TARGETS; ++i) {
        if (!g_renderTargets[i].used) {
            uint32_t backendId = g_backend ? g_backend->createRenderTarget(w, h) : 0;
            g_renderTargets[i].used = true;
            g_renderTargets[i].backendId = backendId;
            g_renderTargets[i].w = w;
            g_renderTargets[i].h = h;
            return uint32_t(i + 1);  // 返回池 id（1-based）
        }
    }
    return 0;
}

LUMENT_API void lument_set_render_target(uint32_t id) {
    if (id == 0) {
        g_activeRenderTarget = 0;
        if (g_backend) g_backend->setRenderTarget(0);
        return;
    }
    if (id > MAX_RENDER_TARGETS || !g_renderTargets[id - 1].used) return;
    g_activeRenderTarget = id;
    if (g_backend) g_backend->setRenderTarget(g_renderTargets[id - 1].backendId);
}

LUMENT_API void lument_draw_render_target(uint32_t id, LumentRect dest) {
    if (!g_initialized || id == 0 || id > MAX_RENDER_TARGETS) return;
    RenderTargetSlot& rt = g_renderTargets[id - 1];
    if (!rt.used || !g_backend) return;
    g_backend->drawRenderTarget(rt.backendId, dest);
    g_drawCalls++;
}

LUMENT_API void lument_destroy_render_target(uint32_t id) {
    if (id == 0 || id > MAX_RENDER_TARGETS) return;
    RenderTargetSlot& rt = g_renderTargets[id - 1];
    if (!rt.used) return;
    if (g_backend) g_backend->destroyRenderTarget(rt.backendId);
    rt.used = false;
    rt.backendId = 0;
    if (g_activeRenderTarget == id) {
        g_activeRenderTarget = 0;
        if (g_backend) g_backend->setRenderTarget(0);
    }
}

// ============================================================
// 2D 场景渲染：后期处理
// ============================================================

LUMENT_API void lument_apply_scene_effects(void) {
    if (!g_backend) return;
    // 先提交挂起的精灵批次
    ue::renderer_flush_batch();
    // 调用后端应用场景效果
    g_backend->applySceneEffects(&g_sceneColor, &g_sceneClarity, &g_vignette, &g_fog);
    g_drawCalls++;
}

} // extern "C"

// =====================================================================
// 第六部分：OpenGL ES 2.0 / WebGL1 后端实现
// =====================================================================
#if defined(LUMENT_BACKEND_GLES2)

namespace {

class GLES2Backend : public IRendererBackend {
public:
    bool init(int w, int h) override {
        m_w = w; m_h = h;
        if (!compile_program()) return false;
        setup_geometry();
        update_screen_mvp();
        setCamera(0, 0, 1.0f);
        // 关闭深度测试与剔除（2D）
        glDisable(GL_DEPTH_TEST);
        glDisable(GL_CULL_FACE);
        glEnable(GL_BLEND);
        glBlendFunc(GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA);
        return true;
    }

    void shutdown() override {
        if (m_vbo) glDeleteBuffers(1, &m_vbo);
        if (m_ibo) glDeleteBuffers(1, &m_ibo);
        if (m_program) glDeleteProgram(m_program);
        if (m_vs) glDeleteShader(m_vs);
        if (m_fs) glDeleteShader(m_fs);
        m_vbo = m_ibo = m_program = m_vs = m_fs = 0;
    }

    void resize(int w, int h) override {
        m_w = w; m_h = h;
        glViewport(0, 0, w, h);
        update_screen_mvp();
        // 摄像机 mvp 依赖视口尺寸，重新计算
        setCamera(m_cx, m_cy, m_zoom);
    }

    void clear(LumentColor color) override {
        glClearColor(color.r / 255.0f, color.g / 255.0f,
                     color.b / 255.0f, color.a / 255.0f);
        glClear(GL_COLOR_BUFFER_BIT);
    }

    void setCamera(float x, float y, float zoom) override {
        m_cx = x; m_cy = y; m_zoom = zoom;
        if (m_w == 0 || m_h == 0) return;
        // 世界->NDC（原点左上，y 向下）
        float a = 2.0f * zoom / float(m_w);
        float b = 2.0f * zoom / float(m_h);
        // 列优先 mat3：{a,0,0, 0,b,0, tx,ty,1}
        m_camMvp[0]=a;     m_camMvp[1]=0.0f; m_camMvp[2]=0.0f;
        m_camMvp[3]=0.0f;  m_camMvp[4]=b;    m_camMvp[5]=0.0f;
        m_camMvp[6]=-x*a-1.0f; m_camMvp[7]=-y*b-1.0f; m_camMvp[8]=1.0f;
    }

    void present() override { glFlush(); }

    // 批量精灵绘制
    void drawSpriteBatch(uint32_t textureId, const LumentSpriteVertex* verts, size_t quadCount) override {
        if (!m_program || !verts || quadCount == 0) return;
        const size_t kMaxQuads = 4096; // 单次上传上限，超出分块
        size_t remaining = quadCount;
        const LumentSpriteVertex* p = verts;
        while (remaining > 0) {
            size_t n = remaining > kMaxQuads ? kMaxQuads : remaining;
            draw_quads(textureId, p, n, m_camMvp);
            p += n * 4;
            remaining -= n;
        }
    }

    void drawRect(LumentRect rect, LumentColor color, bool filled) override {
        // 注意：渲染层把矩形作为纯色四边形走 drawSpriteBatch 批量提交，
        // 此处仅作后端原生路径保留，实现为单四边形（实心）。
        (void)filled;
        LumentSpriteVertex v[4];
        uint8_t r=color.r,g=color.g,b=color.b,a=color.a;
        v[0]={rect.x,           rect.y,           0.0f,0.0f,r,g,b,a};
        v[1]={rect.x+rect.w,    rect.y,           1.0f,0.0f,r,g,b,a};
        v[2]={rect.x+rect.w,    rect.y+rect.h,    1.0f,1.0f,r,g,b,a};
        v[3]={rect.x,           rect.y+rect.h,    0.0f,1.0f,r,g,b,a};
        draw_quads(m_whiteTexGL, v, 1, m_camMvp);
    }

    void drawText(const char*, float, float, float, LumentColor) override {
        // 文本由渲染层批量化为精灵提交，此处无需实现。
    }

    void drawPixel(int x, int y, LumentColor color) override {
        LumentSpriteVertex v[4];
        float u0=0,v0=0,u1=1,v1=1;
        uint8_t r=color.r,g=color.g,b=color.b,a=color.a;
        v[0]={float(x),  float(y),  u0,v0,r,g,b,a};
        v[1]={float(x+1),float(y),  u1,v0,r,g,b,a};
        v[2]={float(x+1),float(y+1),u1,v1,r,g,b,a};
        v[3]={float(x),  float(y+1),u0,v1,r,g,b,a};
        draw_quads(m_whiteTexGL, v, 1, m_screenMvp);
    }

    uint32_t createTextureFromData(int w, int h, const uint8_t* rgba) override {
        GLuint t = 0;
        glGenTextures(1, &t);
        glBindTexture(GL_TEXTURE_2D, t);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, w, h, 0, GL_RGBA, GL_UNSIGNED_BYTE, rgba);
        return uint32_t(t);
    }

    void destroyTexture(uint32_t id) override {
        if (id == 0) return;
        GLuint t = (GLuint)id;
        glDeleteTextures(1, &t);
    }

    int viewportWidth() const override { return m_w; }
    int viewportHeight() const override { return m_h; }

private:
    // 通用四边形绘制
    void draw_quads(uint32_t tex, const LumentSpriteVertex* verts, size_t quadCount, const float* mvp) {
        glUseProgram(m_program);
        GLint loc = glGetUniformLocation(m_program, "u_mvp");
        glUniformMatrix3fv(loc, 1, GL_FALSE, mvp);

        glActiveTexture(GL_TEXTURE0);
        // 若无纹理绑定白色 1x1
        GLuint bindTex = tex ? (GLuint)tex : m_whiteTexGL;
        glBindTexture(GL_TEXTURE_2D, bindTex);
        GLint locTex = glGetUniformLocation(m_program, "u_tex");
        glUniform1i(locTex, 0);

        // 上传顶点
        glBindBuffer(GL_ARRAY_BUFFER, m_vbo);
        glBufferData(GL_ARRAY_BUFFER, sizeof(LumentSpriteVertex) * quadCount * 4,
                     verts, GL_DYNAMIC_DRAW);

        GLsizei stride = sizeof(LumentSpriteVertex);
        GLint aPos = glGetAttribLocation(m_program, "a_pos");
        GLint aUv  = glGetAttribLocation(m_program, "a_uv");
        GLint aCol = glGetAttribLocation(m_program, "a_color");
        glEnableVertexAttribArray(aPos);
        glVertexAttribPointer(aPos, 2, GL_FLOAT, GL_FALSE, stride,
                              (const void*)offsetof(LumentSpriteVertex, x));
        glEnableVertexAttribArray(aUv);
        glVertexAttribPointer(aUv, 2, GL_FLOAT, GL_FALSE, stride,
                              (const void*)offsetof(LumentSpriteVertex, u));
        glEnableVertexAttribArray(aCol);
        glVertexAttribPointer(aCol, 4, GL_UNSIGNED_BYTE, GL_TRUE, stride,
                              (const void*)offsetof(LumentSpriteVertex, r));

        // 索引绘制
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_ibo);
        glDrawElements(GL_TRIANGLES, GLsizei(quadCount * 6), GL_UNSIGNED_SHORT, nullptr);

        glDisableVertexAttribArray(aPos);
        glDisableVertexAttribArray(aUv);
        glDisableVertexAttribArray(aCol);
        glBindBuffer(GL_ARRAY_BUFFER, 0);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);
    }

    void setup_geometry() {
        glGenBuffers(1, &m_vbo);
        glGenBuffers(1, &m_ibo);
        // 预建索引（每四边形 6 个索引：0,1,2,2,3,0 偏移 base）
        static const int kMaxQuads = 4096;
        static GLushort indices[kMaxQuads * 6];
        static bool initIdx = false;
        if (!initIdx) {
            for (int i = 0; i < kMaxQuads; ++i) {
                GLushort b = GLushort(i * 4);
                indices[i*6+0] = b + 0;
                indices[i*6+1] = b + 1;
                indices[i*6+2] = b + 2;
                indices[i*6+3] = b + 2;
                indices[i*6+4] = b + 3;
                indices[i*6+5] = b + 0;
            }
            initIdx = true;
        }
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, m_ibo);
        glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof(indices), indices, GL_STATIC_DRAW);
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, 0);

        // 创建内置 1x1 白色纹理（后端私有，用于纯色/像素）
        uint8_t white[4] = {255,255,255,255};
        glGenTextures(1, &m_whiteTexGL);
        glBindTexture(GL_TEXTURE_2D, m_whiteTexGL);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, 1, 1, 0, GL_RGBA, GL_UNSIGNED_BYTE, white);
    }

    void update_screen_mvp() {
        if (m_w == 0 || m_h == 0) return;
        float a = 2.0f / float(m_w);
        float b = 2.0f / float(m_h);
        // 列优先：{a,0,0, 0,b,0, -1,-1,1}
        m_screenMvp[0]=a;     m_screenMvp[1]=0; m_screenMvp[2]=0;
        m_screenMvp[3]=0;     m_screenMvp[4]=b; m_screenMvp[5]=0;
        m_screenMvp[6]=-1.0f; m_screenMvp[7]=-1.0f; m_screenMvp[8]=1.0f;
    }

    static GLuint compile(GLenum type, const char* src) {
        GLuint sh = glCreateShader(type);
        glShaderSource(sh, 1, &src, nullptr);
        glCompileShader(sh);
        GLint ok = 0; glGetShaderiv(sh, GL_COMPILE_STATUS, &ok);
        if (!ok) {
            char log[1024];
            glGetShaderInfoLog(sh, sizeof(log), nullptr, log);
            lument_log("GLES2 shader compile failed");
            (void)log;
            glDeleteShader(sh);
            return 0;
        }
        return sh;
    }

    bool compile_program() {
        static const char* vsSrc =
            "attribute vec2 a_pos;\n"
            "attribute vec2 a_uv;\n"
            "attribute vec4 a_color;\n"
            "uniform mat3 u_mvp;\n"
            "varying vec2 v_uv;\n"
            "varying vec4 v_color;\n"
            "void main(){\n"
            "  vec3 p = u_mvp * vec3(a_pos, 1.0);\n"
            "  gl_Position = vec4(p.xy, 0.0, 1.0);\n"
            "  v_uv = a_uv;\n"
            "  v_color = a_color;\n"
            "}\n";
        static const char* fsSrc =
            "precision mediump float;\n"
            "varying vec2 v_uv;\n"
            "varying vec4 v_color;\n"
            "uniform sampler2D u_tex;\n"
            "void main(){ gl_FragColor = texture2D(u_tex, v_uv) * v_color; }\n";
        m_vs = compile(GL_VERTEX_SHADER, vsSrc);
        m_fs = compile(GL_FRAGMENT_SHADER, fsSrc);
        if (!m_vs || !m_fs) return false;
        m_program = glCreateProgram();
        glAttachShader(m_program, m_vs);
        glAttachShader(m_program, m_fs);
        glLinkProgram(m_program);
        GLint ok = 0; glGetProgramiv(m_program, GL_LINK_STATUS, &ok);
        if (!ok) { lument_log("GLES2 program link failed"); return false; }
        return true;
    }

    int     m_w = 0, m_h = 0;
    float   m_cx = 0, m_cy = 0, m_zoom = 1.0f;
    float   m_camMvp[9];
    float   m_screenMvp[9];
    GLuint  m_program = 0, m_vs = 0, m_fs = 0;
    GLuint  m_vbo = 0, m_ibo = 0;
    GLuint  m_whiteTexGL = 0;
};

GLES2Backend* g_gles2 = nullptr;

} // namespace

IRendererBackend* ue::create_gles2_backend() {
    if (!g_gles2) g_gles2 = new GLES2Backend();
    return g_gles2;
}
void ue::destroy_gles2_backend(IRendererBackend* b) {
    if (b == g_gles2) { delete g_gles2; g_gles2 = nullptr; }
}

#endif // LUMENT_BACKEND_GLES2
