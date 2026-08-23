// ============================================================
// lument_ui.cpp - UI / 应用开发系统
// ------------------------------------------------------------
// 实现 C ABI（见 lument.h "UI / 应用开发 API"）：
//   生命周期: lument_ui_create / lument_ui_destroy / lument_ui_clear_all
//   属性:     lument_ui_set_text / get_text / set_position / set_size ...
//   层级:     lument_ui_add_child / remove_child / get_parent
//   布局:     lument_ui_set_layout / set_padding / set_spacing / set_grid / set_alignment
//   事件:     lument_ui_on_event / set_focused
//   渲染:     lument_ui_render / handle_touch / handle_key
//   导航:     lument_ui_navigate_to / navigate_back / get_current_screen
//   便捷:     lument_ui_create_button / create_label / create_input
//
// 设计：
//   - Widget 句柄 = 代(generation, 12bit) | 索引(index+1, 20bit)，与实体
//     编码一致；销毁后代数递增，旧句柄自动失效。
//   - WidgetManager 采用对象池（固定容量数组 + 空闲链表），与 ECS 的
//     EntityPool / TexturePool 风格一致，热路径零动态分配。
//   - 布局系统：支持 绝对定位/垂直/水平/网格/堆叠，递归计算绝对坐标；
//     对齐语义 0=start 1=center 2=end 3=stretch。
//   - 渲染：通过公共渲染 ABI（lument_draw_rect / lument_draw_text /
//     lument_draw_sprite）提交，复用引擎已有批次化与字体图集。
//   - 事件：触摸命中采用自顶向下递归命中测试（子控件优先）；键盘导航
//     在可聚焦控件间循环移动焦点，ACTION 触发 CLICK，CANCEL 返回上一屏。
//   - 导航栈：LumentWidget 栈，navigate_to 压栈、navigate_back 弹栈；
//     render / handle_touch / handle_key 仅作用于栈顶屏幕（无栈时作用于
//     所有根控件）。
//   - 懒初始化：C ABI 首次访问时自动创建管理器，无需 core 显式调用，
//     保证 UI 子系统可独立于完整引擎生命周期使用；ue::init_ui /
//     shutdown_ui 供 core 集成时同步生命周期。
// ============================================================
#include "lument_internal.h"

namespace {

// ---------- 常量 ----------
#ifndef LUMENT_MAX_WIDGETS
#  define LUMENT_MAX_WIDGETS 4096
#endif

constexpr uint32_t INVALID_SLOT = 0xFFFFFFFFu;

// 句柄编码：低 20 位为索引(+1)，高 12 位为代（generation）。
constexpr uint32_t WIDGET_INDEX_BITS = 20;
constexpr uint32_t WIDGET_GEN_BITS   = 12;
constexpr uint32_t WIDGET_INDEX_MASK = ((1u << WIDGET_INDEX_BITS) - 1u);
constexpr uint32_t WIDGET_GEN_MASK   = ((1u << WIDGET_GEN_BITS) - 1u);

inline uint32_t widget_index(LumentWidget w) { return (w & WIDGET_INDEX_MASK) - 1u; }
inline uint16_t widget_gen(LumentWidget w)  { return uint16_t((w >> WIDGET_INDEX_BITS) & WIDGET_GEN_MASK); }

inline LumentWidget make_widget(uint32_t idx, uint16_t gen) {
    return (LumentWidget(gen) << WIDGET_INDEX_BITS) | LumentEntity(idx + 1u);
}

// ---------- 对齐语义 ----------
// 0=start 1=center 2=end 3=stretch（与 lument_ui_set_alignment 注释一致）
enum Align { ALIGN_START = 0, ALIGN_CENTER = 1, ALIGN_END = 2, ALIGN_STRETCH = 3 };

// ---------- 默认外观常量 ----------
const LumentColor COLOR_BTN_BG      = {  60,  90, 160, 255 };
const LumentColor COLOR_LABEL_BG    = {   0,   0,   0,   0 }; // 透明
const LumentColor COLOR_INPUT_BG    = {  22,  22,  28, 255 };
const LumentColor COLOR_INPUT_BORDER= { 120, 120, 130, 255 };
const LumentColor COLOR_PLACEHOLDER = { 130, 130, 140, 255 };
const LumentColor COLOR_FOCUS_RING = { 100, 200, 255, 255 };
const LumentColor COLOR_PROGRESS   = {  80, 180, 100, 255 };

// 位图字体单元宽度（与渲染层一致）：字形 5px + 1px 间距 = 6px，行高 7px
constexpr float GLYPH_CELL_W = 6.0f;
constexpr float GLYPH_H      = 7.0f;

// ---------- Widget 数据结构 ----------
struct Widget {
    LumentWidget      id = LUMENT_INVALID_WIDGET;   // 自身句柄
    LumentWidgetType  type = LUMENT_WIDGET_NONE;
    std::string       text;                          // 文本 / 占位符
    float             x = 0.0f, y = 0.0f;           // 布局位置（相对父级或绝对）
    float             w = 0.0f, h = 0.0f;           // 尺寸
    LumentColor       bgColor   = { 30, 30, 38, 255 };
    LumentColor       textColor = { 235, 235, 235, 255 };
    float             fontSize  = 16.0f;
    bool              visible   = true;
    bool              enabled   = true;
    uint32_t          textureId = 0;                 // 图片 / 精灵纹理 id
    LumentWidget      parent    = LUMENT_INVALID_WIDGET;
    std::vector<LumentWidget> children;             // 子控件有序列表
    LumentLayoutType  layout    = LUMENT_LAYOUT_NONE;
    float             padTop = 0.0f, padRight = 0.0f, padBottom = 0.0f, padLeft = 0.0f;
    float             spacing = 0.0f;
    int               gridCols = 1;
    int               gridRows  = 1;
    int               alignment = ALIGN_START;      // 0=start 1=center 2=end 3=stretch
    std::unordered_map<int, LumentEventCallback> callbacks; // 事件类型 -> 回调
    bool              focused = false;

    // 布局计算后的绝对屏幕坐标（仅供渲染 / 命中测试使用）
    float             absX = 0.0f, absY = 0.0f;

    void reset() {
        id       = LUMENT_INVALID_WIDGET;
        type     = LUMENT_WIDGET_NONE;
        text.clear();
        x = y = w = h = 0.0f;
        bgColor   = { 30, 30, 38, 255 };
        textColor = { 235, 235, 235, 255 };
        fontSize  = 16.0f;
        visible   = true;
        enabled   = true;
        textureId = 0;
        parent     = LUMENT_INVALID_WIDGET;
        children.clear();
        layout     = LUMENT_LAYOUT_NONE;
        padTop = padRight = padBottom = padLeft = 0.0f;
        spacing    = 0.0f;
        gridCols   = 1;
        gridRows   = 1;
        alignment  = ALIGN_START;
        callbacks.clear();
        focused    = false;
        absX = absY = 0.0f;
    }
};

// ---------- Widget 管理器（对象池） ----------
struct WidgetManager {
    Widget    widgets[LUMENT_MAX_WIDGETS];
    uint16_t  gen[LUMENT_MAX_WIDGETS];
    bool      used[LUMENT_MAX_WIDGETS];
    uint32_t  freeNext[LUMENT_MAX_WIDGETS]; // 空闲链表
    uint32_t  freeHead;
    uint32_t  liveCount;
    LumentWidget focusedWidget = LUMENT_INVALID_WIDGET;
    std::vector<LumentWidget> navStack;    // 屏幕导航栈（栈顶为当前屏幕）

    WidgetManager() { reset_pool(); }

    void reset_pool() {
        for (uint32_t i = 0; i < LUMENT_MAX_WIDGETS; ++i) {
            used[i] = false;
            gen[i] = 0;
            freeNext[i] = i + 1;
            widgets[i].reset();
        }
        freeNext[LUMENT_MAX_WIDGETS - 1] = INVALID_SLOT; // 链尾
        freeHead  = 0;
        liveCount = 0;
        focusedWidget = LUMENT_INVALID_WIDGET;
        navStack.clear();
    }

    // 校验句柄并返回槽指针（nullptr 表示无效 / 过期）
    Widget* validate(LumentWidget w) {
        if (w == LUMENT_INVALID_WIDGET) return nullptr;
        uint32_t idx = widget_index(w);
        if (idx >= LUMENT_MAX_WIDGETS) return nullptr;
        if (!used[idx]) return nullptr;
        if (gen[idx] != widget_gen(w)) return nullptr; // 句柄过期
        return &widgets[idx];
    }

    // 分配槽位，返回句柄；LUMENT_INVALID_WIDGET 表示池满
    LumentWidget alloc(LumentWidgetType type) {
        if (freeHead == INVALID_SLOT) return LUMENT_INVALID_WIDGET;
        uint32_t idx = freeHead;
        freeHead = freeNext[idx];
        used[idx] = true;
        gen[idx]++;                              // 代数递增（首用时 0->1）
        Widget& wgt = widgets[idx];
        wgt.reset();
        wgt.type = type;
        wgt.id   = make_widget(idx, gen[idx]);
        ++liveCount;
        return wgt.id;
    }

    void free_slot(uint32_t idx) {
        used[idx] = false;
        gen[idx]++;                              // 使旧句柄失效
        widgets[idx].reset();
        freeNext[idx] = freeHead;
        freeHead = idx;
        --liveCount;
    }
};

WidgetManager* g_mgr = nullptr;

// 懒初始化：首次访问自动创建管理器。
inline WidgetManager& mgr() {
    if (!g_mgr) {
        g_mgr = new WidgetManager();
    }
    return *g_mgr;
}

// ---------- 布局计算 ----------
// 递归计算控件树绝对坐标。absX/absY 为本控件左上角的绝对屏幕坐标
// （已由调用方 / 父级确定）。本函数据此定位子控件并递归。
void compute_layout(WidgetManager& m, LumentWidget handle, float absX, float absY) {
    Widget* w = m.validate(handle);
    if (!w) return;
    w->absX = absX;
    w->absY = absY;

    // 内容区起点与尺寸
    const float cx = w->absX + w->padLeft;
    const float cy = w->absY + w->padTop;
    const float contentW = (w->w > w->padLeft + w->padRight)
                            ? (w->w - w->padLeft - w->padRight) : 0.0f;
    const float contentH = (w->h > w->padTop + w->padBottom)
                            ? (w->h - w->padTop - w->padBottom) : 0.0f;

    switch (w->layout) {
    case LUMENT_LAYOUT_VERTICAL: {
        float cursorY = cy;
        for (LumentWidget ch : w->children) {
            Widget* c = m.validate(ch);
            if (!c) continue;
            float cw = c->w;
            float cxOff = cx;
            if (w->alignment == ALIGN_CENTER && contentW > 0.0f && cw < contentW)
                cxOff = cx + (contentW - cw) * 0.5f;
            else if (w->alignment == ALIGN_END && contentW > 0.0f)
                cxOff = cx + (contentW - cw);
            else if (w->alignment == ALIGN_STRETCH && contentW > 0.0f) {
                c->w = contentW; cw = contentW;
            }
            compute_layout(m, ch, cxOff, cursorY);
            cursorY += c->h + w->spacing;
        }
        break;
    }
    case LUMENT_LAYOUT_HORIZONTAL: {
        float cursorX = cx;
        for (LumentWidget ch : w->children) {
            Widget* c = m.validate(ch);
            if (!c) continue;
            float chh = c->h;
            float cyOff = cy;
            if (w->alignment == ALIGN_CENTER && contentH > 0.0f && chh < contentH)
                cyOff = cy + (contentH - chh) * 0.5f;
            else if (w->alignment == ALIGN_END && contentH > 0.0f)
                cyOff = cy + (contentH - chh);
            else if (w->alignment == ALIGN_STRETCH && contentH > 0.0f) {
                c->h = contentH; chh = contentH;
            }
            compute_layout(m, ch, cursorX, cyOff);
            cursorX += c->w + w->spacing;
        }
        break;
    }
    case LUMENT_LAYOUT_GRID: {
        const int cols = w->gridCols > 0 ? w->gridCols : 1;
        const float cellW = contentW > 0.0f ? contentW / float(cols) : 0.0f;
        float cellH = 0.0f;
        if (w->gridRows > 0 && contentH > 0.0f)
            cellH = contentH / float(w->gridRows);
        else {
            // 未显式指定行高时取子控件最大高度作为行高
            for (LumentWidget ch : w->children) {
                Widget* c = m.validate(ch);
                if (c && c->h > cellH) cellH = c->h;
            }
            cellH += w->spacing;
        }
        int i = 0;
        for (LumentWidget ch : w->children) {
            Widget* c = m.validate(ch);
            if (!c) { ++i; continue; }
            int col = i % cols;
            int row = i / cols;
            float gx = cx + col * (cellW + w->spacing);
            float gy = cy + row * (cellH + w->spacing);
            if (w->alignment == ALIGN_CENTER) {
                gx += (cellW - c->w) * 0.5f;
                gy += (cellH - c->h) * 0.5f;
            } else if (w->alignment == ALIGN_END) {
                gx += (cellW - c->w);
                gy += (cellH - c->h);
            } else if (w->alignment == ALIGN_STRETCH) {
                c->w = cellW; c->h = cellH;
            }
            compute_layout(m, ch, gx, gy);
            ++i;
        }
        break;
    }
    case LUMENT_LAYOUT_STACK: {
        // 所有子控件堆叠在内容区起点（z 序由 children 顺序决定）
        for (LumentWidget ch : w->children) {
            compute_layout(m, ch, cx, cy);
        }
        break;
    }
    case LUMENT_LAYOUT_NONE:
    default: {
        // 绝对定位：子控件 x/y 视为相对父级绝对位置的偏移
        for (LumentWidget ch : w->children) {
            Widget* c = m.validate(ch);
            if (!c) continue;
            compute_layout(m, ch, w->absX + c->x, w->absY + c->y);
        }
        break;
    }
    }
}

// ---------- 渲染 ----------
inline bool has_bg(const Widget& w) {
    return w.w > 0.0f && w.h > 0.0f && w.bgColor.a > 0;
}

// 估算文本像素宽度（基于内置位图字体）
inline float text_width(const std::string& s, float fontSize) {
    return float(s.size()) * GLYPH_CELL_W * (fontSize / GLYPH_H);
}

void render_widget(WidgetManager& m, LumentWidget handle) {
    Widget* w = m.validate(handle);
    if (!w || !w->visible) return;

    // 1. 背景
    if (has_bg(*w)) {
        lument_draw_rect({ w->absX, w->absY, w->w, w->h }, w->bgColor, true);
    }

    // 2. 图片 / 精灵
    if (w->textureId != 0 && w->w > 0.0f && w->h > 0.0f) {
        lument_draw_sprite(w->textureId, { w->absX, w->absY, w->w, w->h }, { 0,0,0,0 });
    }

    // 3. 进度条前景（text 中存放 0~1 的比例数值）
    if (w->type == LUMENT_WIDGET_PROGRESS && w->w > 0.0f && w->h > 0.0f) {
        float pct = 0.0f;
        if (!w->text.empty()) {
            pct = float(std::atof(w->text.c_str()));
            if (pct < 0.0f) pct = 0.0f;
            if (pct > 1.0f) pct = 1.0f;
        }
        lument_draw_rect({ w->absX, w->absY, w->w * pct, w->h }, COLOR_PROGRESS, true);
    }

    // 4. 文本
    if (!w->text.empty()) {
        LumentColor useColor = w->enabled ? w->textColor : COLOR_PLACEHOLDER;
        // 输入框未聚焦时以占位符颜色显示文本
        if (w->type == LUMENT_WIDGET_INPUT && !w->focused) {
            useColor = COLOR_PLACEHOLDER;
        }
        float ty = w->absY + (w->h - w->fontSize) * 0.5f;
        float tx;
        if (w->type == LUMENT_WIDGET_BUTTON || w->type == LUMENT_WIDGET_LABEL) {
            // 水平居中
            float tw = text_width(w->text, w->fontSize);
            if (tw > w->w - 4.0f) tw = w->w - 4.0f; // 防止越界
            tx = w->absX + (w->w - tw) * 0.5f;
        } else {
            tx = w->absX + 4.0f; // 左对齐
        }
        if (tx < w->absX) tx = w->absX;
        lument_draw_text(w->text.c_str(), tx, ty, w->fontSize, useColor);
    }

    // 5. 输入框边框
    if (w->type == LUMENT_WIDGET_INPUT && w->w > 0.0f && w->h > 0.0f) {
        lument_draw_rect({ w->absX, w->absY, w->w, w->h }, COLOR_INPUT_BORDER, false);
    }

    // 6. 焦点高亮（描边）
    if (w->focused && w->w > 0.0f && w->h > 0.0f) {
        lument_draw_rect({ w->absX - 2, w->absY - 2, w->w + 4, w->h + 4 },
                         COLOR_FOCUS_RING, false);
    }

    // 7. 子控件（后绘制 = 更靠前 / 层级更高）
    for (LumentWidget ch : w->children) {
        render_widget(m, ch);
    }
}

// ---------- 命中测试 ----------
// 自顶向下递归命中：先测子控件（逆序，靠后的更靠前），再测自身。
LumentWidget hit_test(WidgetManager& m, LumentWidget handle, float x, float y) {
    Widget* w = m.validate(handle);
    if (!w || !w->visible) return LUMENT_INVALID_WIDGET;

    // 先测子控件（逆序，后注册的层级更高）
    for (auto it = w->children.rbegin(); it != w->children.rend(); ++it) {
        LumentWidget hit = hit_test(m, *it, x, y);
        if (hit != LUMENT_INVALID_WIDGET) return hit;
    }

    // 测自身（disabled 控件不响应触摸，但仍可被命中子控件已在上面处理）
    if (w->enabled && w->w > 0.0f && w->h > 0.0f &&
        x >= w->absX && x < w->absX + w->w &&
        y >= w->absY && y < w->absY + w->h) {
        return handle;
    }
    return LUMENT_INVALID_WIDGET;
}

// 触发事件回调
void fire_event(WidgetManager& m, LumentWidget handle,
                LumentEventType event, const char* data) {
    Widget* w = m.validate(handle);
    if (!w) return;
    auto it = w->callbacks.find(int(event));
    if (it != w->callbacks.end() && it->second) {
        it->second(handle, event, data ? data : "");
    }
}

// 设置焦点：blur 旧焦点，focus 新焦点
void set_focus(WidgetManager& m, LumentWidget handle) {
    if (m.focusedWidget == handle) return;
    if (m.focusedWidget != LUMENT_INVALID_WIDGET) {
        Widget* old = m.validate(m.focusedWidget);
        if (old) {
            old->focused = false;
            fire_event(m, m.focusedWidget, LUMENT_EVENT_BLUR, nullptr);
        }
    }
    m.focusedWidget = handle;
    if (handle != LUMENT_INVALID_WIDGET) {
        Widget* w = m.validate(handle);
        if (w) {
            w->focused = true;
            fire_event(m, handle, LUMENT_EVENT_FOCUS, nullptr);
        }
    }
}

// 判断控件是否可聚焦
bool is_focusable(const Widget& w) {
    if (!w.visible || !w.enabled) return false;
    switch (w.type) {
    case LUMENT_WIDGET_BUTTON:
    case LUMENT_WIDGET_INPUT:
    case LUMENT_WIDGET_CHECKBOX:
    case LUMENT_WIDGET_SLIDER:
    case LUMENT_WIDGET_TABBAR:
        return true;
    default:
        return false;
    }
}

// 收集可聚焦控件（深度优先，保持树序）
void collect_focusable(WidgetManager& m, LumentWidget handle,
                       std::vector<LumentWidget>& out) {
    Widget* w = m.validate(handle);
    if (!w) return;
    if (is_focusable(*w)) out.push_back(handle);
    for (LumentWidget ch : w->children) {
        collect_focusable(m, ch, out);
    }
}

// 递归销毁子树（已从父级 children 中摘除后调用）
void destroy_subtree(WidgetManager& m, uint32_t idx) {
    Widget& w = m.widgets[idx];
    // 取走子列表，避免迭代中修改
    std::vector<LumentWidget> kids;
    kids.swap(w.children);
    for (LumentWidget ch : kids) {
        uint32_t ci = widget_index(ch);
        if (ci >= LUMENT_MAX_WIDGETS || !m.used[ci]) continue;
        if (m.gen[ci] != widget_gen(ch)) continue; // 子控件已失效
        destroy_subtree(m, ci);
    }
    // 清理焦点引用
    if (m.focusedWidget != LUMENT_INVALID_WIDGET &&
        widget_index(m.focusedWidget) == idx) {
        m.focusedWidget = LUMENT_INVALID_WIDGET;
    }
    m.free_slot(idx);
}

// 遍历所有根控件（无父级且在导航栈外）执行 fn(handle, widget&)
template <typename Fn>
void for_each_root(WidgetManager& m, Fn fn) {
    for (uint32_t i = 0; i < LUMENT_MAX_WIDGETS; ++i) {
        if (m.used[i] && m.widgets[i].parent == LUMENT_INVALID_WIDGET) {
            fn(make_widget(i, m.gen[i]), m.widgets[i]);
        }
    }
}

} // namespace

namespace ue {

// 内部生命周期函数（与其它子系统风格一致）。
// UI 子系统采用懒初始化，core 可选调用；不调用也能正常工作。
bool init_ui() {
    (void)mgr(); // 触发懒初始化
    return true;
}

void shutdown_ui() {
    delete g_mgr;
    g_mgr = nullptr;
}

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

// --- 生命周期 ---
LUMENT_API LumentWidget lument_ui_create(LumentWidgetType type) {
    return mgr().alloc(type);
}

LUMENT_API void lument_ui_destroy(LumentWidget widget) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    uint32_t idx = widget_index(widget);

    // 从父级的 children 中移除
    if (w->parent != LUMENT_INVALID_WIDGET) {
        Widget* p = m.validate(w->parent);
        if (p) {
            auto& kids = p->children;
            kids.erase(std::remove(kids.begin(), kids.end(), widget), kids.end());
        }
    }
    // 从导航栈中移除
    auto& ns = m.navStack;
    ns.erase(std::remove(ns.begin(), ns.end(), widget), ns.end());
    // 递归销毁子树
    destroy_subtree(m, idx);
}

LUMENT_API void lument_ui_clear_all(void) {
    mgr().reset_pool();
}

// --- Widget 属性 ---
LUMENT_API void lument_ui_set_text(LumentWidget widget, const char* text) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->text = text ? text : "";
}

LUMENT_API const char* lument_ui_get_text(LumentWidget widget) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return "";
    return w->text.c_str();
}

LUMENT_API void lument_ui_set_position(LumentWidget widget, float x, float y) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->x = x; w->y = y;
}

LUMENT_API void lument_ui_set_size(LumentWidget widget, float w, float h) {
    WidgetManager& m = mgr();
    Widget* wg = m.validate(widget);
    if (!wg) return;
    wg->w = w; wg->h = h;
}

LUMENT_API void lument_ui_set_color(LumentWidget widget, LumentColor color) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->bgColor = color;
}

LUMENT_API void lument_ui_set_text_color(LumentWidget widget, LumentColor color) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->textColor = color;
}

LUMENT_API void lument_ui_set_font_size(LumentWidget widget, float size) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->fontSize = size;
}

LUMENT_API void lument_ui_set_visible(LumentWidget widget, bool visible) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->visible = visible;
}

LUMENT_API void lument_ui_set_enabled(LumentWidget widget, bool enabled) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->enabled = enabled;
}

LUMENT_API void lument_ui_set_image(LumentWidget widget, uint32_t textureId) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->textureId = textureId;
}

// --- Widget 层级 ---
LUMENT_API void lument_ui_add_child(LumentWidget parent, LumentWidget child) {
    WidgetManager& m = mgr();
    Widget* p = m.validate(parent);
    Widget* c = m.validate(child);
    if (!p || !c) return;
    // 若已有父级，先从旧父级移除
    if (c->parent != LUMENT_INVALID_WIDGET && c->parent != parent) {
        lument_ui_remove_child(c->parent, child);
        // 重新取指针（remove_child 不改变槽位，指针仍有效）
        p = m.validate(parent);
        c = m.validate(child);
        if (!p || !c) return;
    }
    c->parent = parent;
    p->children.push_back(child);
}

LUMENT_API void lument_ui_remove_child(LumentWidget parent, LumentWidget child) {
    WidgetManager& m = mgr();
    Widget* p = m.validate(parent);
    Widget* c = m.validate(child);
    if (!p || !c) return;
    auto& kids = p->children;
    kids.erase(std::remove(kids.begin(), kids.end(), child), kids.end());
    if (c->parent == parent) c->parent = LUMENT_INVALID_WIDGET;
}

LUMENT_API LumentWidget lument_ui_get_parent(LumentWidget widget) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return LUMENT_INVALID_WIDGET;
    return w->parent;
}

// --- 布局 ---
LUMENT_API void lument_ui_set_layout(LumentWidget container, LumentLayoutType layout) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(container);
    if (!w) return;
    w->layout = layout;
}

LUMENT_API void lument_ui_set_padding(LumentWidget container, float top, float right, float bottom, float left) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(container);
    if (!w) return;
    w->padTop = top; w->padRight = right; w->padBottom = bottom; w->padLeft = left;
}

LUMENT_API void lument_ui_set_spacing(LumentWidget container, float spacing) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(container);
    if (!w) return;
    w->spacing = spacing;
}

LUMENT_API void lument_ui_set_grid(LumentWidget container, int cols, int rows) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(container);
    if (!w) return;
    w->gridCols = cols > 0 ? cols : 1;
    w->gridRows = rows > 0 ? rows : 1;
}

LUMENT_API void lument_ui_set_alignment(LumentWidget container, int align) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(container);
    if (!w) return;
    w->alignment = align;
}

// --- 事件 ---
LUMENT_API void lument_ui_on_event(LumentWidget widget, LumentEventType event, LumentEventCallback callback) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    if (callback) w->callbacks[int(event)] = callback;
    else          w->callbacks.erase(int(event));
}

LUMENT_API void lument_ui_set_focused(LumentWidget widget) {
    WidgetManager& m = mgr();
    if (m.validate(widget)) {
        set_focus(m, widget);
    } else {
        // 传入无效句柄 = 清除焦点
        set_focus(m, LUMENT_INVALID_WIDGET);
    }
}

// --- 渲染与事件处理 ---
LUMENT_API void lument_ui_render(void) {
    WidgetManager& m = mgr();

    if (!m.navStack.empty()) {
        // 仅渲染栈顶屏幕
        LumentWidget screen = m.navStack.back();
        Widget* sw = m.validate(screen);
        if (!sw) { m.navStack.pop_back(); return; }
        compute_layout(m, screen, sw->x, sw->y);
        render_widget(m, screen);
    } else {
        // 无导航栈：渲染所有根控件
        for_each_root(m, [&](LumentWidget h, Widget& wgt) {
            compute_layout(m, h, wgt.x, wgt.y);
            render_widget(m, h);
        });
    }
}

LUMENT_API bool lument_ui_handle_touch(float x, float y, int type) {
    // type: 0=down 1=move 2=up
    WidgetManager& m = mgr();
    LumentWidget hit = LUMENT_INVALID_WIDGET;

    if (!m.navStack.empty()) {
        hit = hit_test(m, m.navStack.back(), x, y);
    } else {
        // 逆序遍历根控件（后注册的层级更高）
        for (int32_t i = LUMENT_MAX_WIDGETS - 1; i >= 0; --i) {
            if (m.used[i] && m.widgets[i].parent == LUMENT_INVALID_WIDGET) {
                LumentWidget h = make_widget(uint32_t(i), m.gen[i]);
                hit = hit_test(m, h, x, y);
                if (hit != LUMENT_INVALID_WIDGET) break;
            }
        }
    }

    if (type == 0) {
        // 按下：设置焦点 + 触发 CLICK
        if (hit != LUMENT_INVALID_WIDGET) {
            set_focus(m, hit);
            fire_event(m, hit, LUMENT_EVENT_CLICK, nullptr);
            return true;
        }
        // 点击空白处清除焦点
        set_focus(m, LUMENT_INVALID_WIDGET);
        return false;
    } else if (type == 1) {
        // 移动：命中控件触发 SCROLL
        if (hit != LUMENT_INVALID_WIDGET) {
            fire_event(m, hit, LUMENT_EVENT_SCROLL, nullptr);
            return true;
        }
        return false;
    } else { // type == 2 抬起
        return hit != LUMENT_INVALID_WIDGET;
    }
}

LUMENT_API bool lument_ui_handle_key(LumentKey key, bool pressed) {
    WidgetManager& m = mgr();
    if (!pressed) return false;

    // 收集可聚焦控件
    std::vector<LumentWidget> focusable;
    if (!m.navStack.empty()) {
        collect_focusable(m, m.navStack.back(), focusable);
    } else {
        for_each_root(m, [&](LumentWidget h, Widget&) {
            collect_focusable(m, h, focusable);
        });
    }

    // 无可聚焦控件时仅响应 CANCEL（返回上一屏）
    if (focusable.empty()) {
        if (key == LUMENT_KEY_CANCEL && !m.navStack.empty()) {
            lument_ui_navigate_back();
            return true;
        }
        return false;
    }

    // 找到当前焦点在列表中的位置
    size_t cur = focusable.size();
    for (size_t i = 0; i < focusable.size(); ++i) {
        if (focusable[i] == m.focusedWidget) { cur = i; break; }
    }

    switch (key) {
    case LUMENT_KEY_ACTION: {
        // 确认键：触发当前焦点控件（或首个）的 CLICK
        LumentWidget target = (cur < focusable.size()) ? focusable[cur] : focusable[0];
        set_focus(m, target);
        fire_event(m, target, LUMENT_EVENT_CLICK, nullptr);
        return true;
    }
    case LUMENT_KEY_CANCEL: {
        // 取消键：返回上一屏
        if (!m.navStack.empty()) {
            lument_ui_navigate_back();
            return true;
        }
        return false;
    }
    case LUMENT_KEY_UP:
    case LUMENT_KEY_LEFT: {
        // 上一个（循环）
        if (cur == focusable.size()) cur = 0;
        else cur = (cur == 0) ? (focusable.size() - 1) : (cur - 1);
        set_focus(m, focusable[cur]);
        return true;
    }
    case LUMENT_KEY_DOWN:
    case LUMENT_KEY_RIGHT: {
        // 下一个（循环）
        if (cur == focusable.size()) cur = 0;
        else cur = (cur + 1) % focusable.size();
        set_focus(m, focusable[cur]);
        return true;
    }
    default:
        return false;
    }
}

// --- 导航 ---
LUMENT_API void lument_ui_navigate_to(LumentWidget screen) {
    WidgetManager& m = mgr();
    if (!m.validate(screen)) return;
    m.navStack.push_back(screen);
}

LUMENT_API void lument_ui_navigate_back(void) {
    WidgetManager& m = mgr();
    if (!m.navStack.empty()) m.navStack.pop_back();
}

LUMENT_API LumentWidget lument_ui_get_current_screen(void) {
    WidgetManager& m = mgr();
    if (m.navStack.empty()) return LUMENT_INVALID_WIDGET;
    return m.navStack.back();
}

// --- 便捷创建 ---
LUMENT_API LumentWidget lument_ui_create_button(const char* text, float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_BUTTON);
    Widget* bw = m.validate(handle);
    if (bw) {
        bw->text = text ? text : "";
        bw->x = x; bw->y = y; bw->w = w; bw->h = h;
        bw->bgColor   = COLOR_BTN_BG;
        bw->textColor = { 255, 255, 255, 255 };
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_label(const char* text, float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_LABEL);
    Widget* lw = m.validate(handle);
    if (lw) {
        lw->text = text ? text : "";
        lw->x = x; lw->y = y; lw->w = w; lw->h = h;
        lw->bgColor   = COLOR_LABEL_BG; // 透明
        lw->textColor = { 235, 235, 235, 255 };
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_input(const char* placeholder, float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_INPUT);
    Widget* iw = m.validate(handle);
    if (iw) {
        iw->text = placeholder ? placeholder : "";
        iw->x = x; iw->y = y; iw->w = w; iw->h = h;
        iw->bgColor   = COLOR_INPUT_BG;
        iw->textColor = { 235, 235, 235, 255 };
    }
    return handle;
}

} // extern "C"
