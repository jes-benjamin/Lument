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

#include <functional>
#include <cmath>

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
    std::string       name;                          // 自定义标识（用于 find_by_id）
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
    float             marginTop = 0.0f, marginRight = 0.0f, marginBottom = 0.0f, marginLeft = 0.0f;
    float             spacing = 0.0f;
    int               gridCols = 1;
    int               gridRows  = 1;
    int               alignment = ALIGN_START;      // 0=start 1=center 2=end 3=stretch
    std::unordered_map<int, LumentEventCallback> callbacks; // 事件类型 -> 回调
    bool              focused = false;

    // 布局计算后的绝对屏幕坐标（仅供渲染 / 命中测试使用）
    float             absX = 0.0f, absY = 0.0f;

    // ---- v1.3 新增字段 ----
    int               autoSize = LUMENT_AUTOSIZE_OFF;  // 自动尺寸模式
    float             value    = 0.0f;                 // slider/progress/toggle 当前值
    float             minVal   = 0.0f, maxVal = 1.0f;  // slider 范围
    bool              checked  = false;                // checkbox/toggle 状态
    int               selected = 0;                   // dropdown 当前选中项
    std::vector<std::string> options;                 // dropdown 选项列表
    float             scrollX = 0.0f, scrollY = 0.0f; // scrollview 滚动偏移
    float             contentW = 0.0f, contentH = 0.0f; // scrollview 内容尺寸
    bool              dropdownOpen = false;            // dropdown 是否展开
    float             animTime = 0.0f;                // 动画累计时间（spinner 等）

    void reset() {
        id       = LUMENT_INVALID_WIDGET;
        type     = LUMENT_WIDGET_NONE;
        text.clear();
        name.clear();
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
        marginTop = marginRight = marginBottom = marginLeft = 0.0f;
        spacing    = 0.0f;
        gridCols   = 1;
        gridRows   = 1;
        alignment  = ALIGN_START;
        callbacks.clear();
        focused    = false;
        absX = absY = 0.0f;
        autoSize   = LUMENT_AUTOSIZE_OFF;
        value      = 0.0f;
        minVal     = 0.0f;
        maxVal     = 1.0f;
        checked    = false;
        selected   = 0;
        options.clear();
        scrollX = scrollY = 0.0f;
        contentW = contentH = 0.0f;
        dropdownOpen = false;
        animTime = 0.0f;
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

// ---------- 全局主题（v1.3）----------
LumentTheme g_theme = {
    { 18, 18, 24, 255 },   // background
    { 30, 30, 38, 255 },   // surface
    { 60, 90, 160, 255 },  // primary
    { 90, 90, 110, 255 },  // secondary
    { 235, 235, 235, 255 },// text
    { 130, 130, 140, 255 },// textMuted
    { 120, 120, 130, 255 },// border
    { 100, 200, 255, 255 },// accent
    { 220, 70, 70, 255 },  // danger
    { 80, 180, 100, 255 }, // success
};
bool g_themeDirty = false;

// 根据控件类型与主题刷新外观色。新建控件与 set_theme 时调用。
void apply_theme(Widget& w) {
    switch (w.type) {
    case LUMENT_WIDGET_BUTTON:
    case LUMENT_WIDGET_TOGGLE:
        w.bgColor   = g_theme.primary;
        w.textColor = { 255, 255, 255, 255 };
        break;
    case LUMENT_WIDGET_INPUT:
    case LUMENT_WIDGET_SCROLLVIEW:
        w.bgColor   = g_theme.surface;
        w.textColor = g_theme.text;
        break;
    case LUMENT_WIDGET_LABEL:
    case LUMENT_WIDGET_TOOLTIP:
        w.bgColor   = { 0, 0, 0, 0 };
        w.textColor = g_theme.text;
        break;
    case LUMENT_WIDGET_DIVIDER:
        w.bgColor   = g_theme.border;
        break;
    case LUMENT_WIDGET_SPINNER:
        w.bgColor   = { 0, 0, 0, 0 };
        w.textColor = g_theme.accent;
        break;
    case LUMENT_WIDGET_CONTAINER:
    case LUMENT_WIDGET_NAVBAR:
    case LUMENT_WIDGET_TABBAR:
        w.bgColor   = g_theme.surface;
        w.textColor = g_theme.text;
        break;
    case LUMENT_WIDGET_SLIDER:
    case LUMENT_WIDGET_PROGRESS:
        w.bgColor   = g_theme.secondary;
        w.textColor = g_theme.primary;
        break;
    case LUMENT_WIDGET_CHECKBOX:
        w.bgColor   = g_theme.surface;
        w.textColor = g_theme.text;
        break;
    case LUMENT_WIDGET_DROPDOWN:
        w.bgColor   = g_theme.surface;
        w.textColor = g_theme.text;
        break;
    default:
        w.bgColor   = g_theme.surface;
        w.textColor = g_theme.text;
        break;
    }
}

// ---------- 自动尺寸计算（v1.3）----------
// 按内容/子控件自动计算控件宽高。
inline float text_width(const std::string& s, float fontSize);  // 前向声明

void apply_auto_size(WidgetManager& m, Widget& w) {
    if (w.autoSize == LUMENT_AUTOSIZE_OFF) return;
    bool needW = (w.autoSize & LUMENT_AUTOSIZE_WIDTH)  != 0;
    bool needH = (w.autoSize & LUMENT_AUTOSIZE_HEIGHT) != 0;

    // 1) 基于文本内容
    float textW = 0.0f, textH = 0.0f;
    if (!w.text.empty()) {
        textW = text_width(w.text, w.fontSize) + 8.0f; // 留 padding
        textH = w.fontSize + 8.0f;
    }

    // 2) 基于子控件（取最大边界）
    float childMaxW = 0.0f, childMaxH = 0.0f;
    for (LumentWidget ch : w.children) {
        Widget* c = m.validate(ch);
        if (!c) continue;
        float rightEdge = c->x + c->w + c->marginRight;
        float botEdge  = c->y + c->h + c->marginBottom;
        if (rightEdge > childMaxW) childMaxW = rightEdge;
        if (botEdge  > childMaxH) childMaxH = botEdge;
    }
    childMaxW += w.padLeft + w.padRight;
    childMaxH += w.padTop + w.padBottom;

    if (needW) {
        w.w = std::max(textW, childMaxW);
    }
    if (needH) {
        w.h = std::max(textH, childMaxH);
    }
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
    case LUMENT_LAYOUT_FLOW: {
        // 自动换行流式布局：子控件按从左到右排列，超出内容宽度则换行。
        // 支持 margin（外边距），可视为带 margin 的水平流。
        float cursorX = cx;
        float cursorY = cy;
        float rowMaxH = 0.0f;
        for (LumentWidget ch : w->children) {
            Widget* c = m.validate(ch);
            if (!c) continue;
            float cw = c->w + c->marginLeft + c->marginRight;
            float chh = c->h + c->marginTop + c->marginBottom;
            // 判断是否需要换行（cw > contentW 时单独成行）
            if (contentW > 0.0f && cursorX + cw > cx + contentW && cursorX > cx) {
                cursorY += rowMaxH + w->spacing;
                cursorX  = cx;
                rowMaxH  = 0.0f;
            }
            float px = cursorX + c->marginLeft;
            float py = cursorY + c->marginTop;
            // 垂直对齐（基于行高）
            if (w->alignment == ALIGN_CENTER && chh < rowMaxH) {
                py += (rowMaxH - chh) * 0.5f;
            } else if (w->alignment == ALIGN_END && chh < rowMaxH) {
                py += (rowMaxH - chh);
            }
            compute_layout(m, ch, px, py);
            cursorX += cw + w->spacing;
            if (chh > rowMaxH) rowMaxH = chh;
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

    // 2. 图片 / 精灵 / 图标
    if (w->textureId != 0 && w->w > 0.0f && w->h > 0.0f) {
        lument_draw_sprite(w->textureId, { w->absX, w->absY, w->w, w->h }, { 0,0,0,0 });
    }

    // 3. 进度条前景（value 存放 0~1 的比例；兼容旧 text）
    if (w->type == LUMENT_WIDGET_PROGRESS && w->w > 0.0f && w->h > 0.0f) {
        float pct = w->value;
        if (!w->text.empty()) {
            float tp = float(std::atof(w->text.c_str()));
            if (tp >= 0.0f && tp <= 1.0f) pct = tp; // 兼容旧 API
        }
        if (pct < 0.0f) pct = 0.0f;
        if (pct > 1.0f) pct = 1.0f;
        lument_draw_rect({ w->absX, w->absY, w->w * pct, w->h }, g_theme.primary, true);
    }

    // 4. 滑块（track + thumb）
    if (w->type == LUMENT_WIDGET_SLIDER && w->w > 0.0f && w->h > 0.0f) {
        float range = w->maxVal - w->minVal;
        float t = range > 0.0f ? (w->value - w->minVal) / range : 0.0f;
        if (t < 0.0f) t = 0.0f;
        if (t > 1.0f) t = 1.0f;
        float trackY = w->absY + (w->h - 4.0f) * 0.5f;
        lument_draw_rect({ w->absX, trackY, w->w, 4.0f }, g_theme.secondary, true);
        lument_draw_rect({ w->absX, trackY, w->w * t, 4.0f }, g_theme.primary, true);
        float thumbX = w->absX + w->w * t;
        float thumbY = w->absY + w->h * 0.5f;
        lument_draw_circle(thumbX, thumbY, w->h * 0.4f, g_theme.accent, true);
    }

    // 5. 复选框（box + checkmark）
    if (w->type == LUMENT_WIDGET_CHECKBOX && w->w > 0.0f && w->h > 0.0f) {
        float box = std::min(w->w, w->h);
        float bx = w->absX + (w->w - box) * 0.5f;
        float by = w->absY + (w->h - box) * 0.5f;
        lument_draw_rect({ bx, by, box, box }, w->bgColor, true);
        lument_draw_rect({ bx, by, box, box }, g_theme.border, false);
        if (w->checked) {
            // 对勾：用两条线段
            lument_draw_line(bx + box * 0.2f, by + box * 0.55f,
                            bx + box * 0.45f, by + box * 0.8f,
                            std::max(2.0f, box * 0.12f), g_theme.success);
            lument_draw_line(bx + box * 0.45f, by + box * 0.8f,
                            bx + box * 0.8f, by + box * 0.25f,
                            std::max(2.0f, box * 0.12f), g_theme.success);
        }
    }

    // 6. 开关（pill + knob）
    if (w->type == LUMENT_WIDGET_TOGGLE && w->w > 0.0f && w->h > 0.0f) {
        LumentColor trackCol = w->checked ? g_theme.primary : g_theme.secondary;
        lument_draw_rect({ w->absX, w->absY, w->w, w->h }, trackCol, true);
        float knobR = w->h * 0.4f;
        float knobX = w->checked ? (w->absX + w->w - knobR - 2.0f)
                                  : (w->absX + knobR + 2.0f);
        lument_draw_circle(knobX, w->absY + w->h * 0.5f, knobR, { 255,255,255,255 }, true);
    }

    // 7. 下拉框（box + text + arrow + 展开列表）
    if (w->type == LUMENT_WIDGET_DROPDOWN && w->w > 0.0f && w->h > 0.0f) {
        lument_draw_rect({ w->absX, w->absY, w->w, w->h }, w->bgColor, true);
        lument_draw_rect({ w->absX, w->absY, w->w, w->h }, g_theme.border, false);
        // 选中项文本
        std::string sel = (!w->options.empty() && w->selected >= 0 &&
                           w->selected < int(w->options.size()))
                          ? w->options[w->selected] : w->text;
        if (!sel.empty()) {
            float ty = w->absY + (w->h - w->fontSize) * 0.5f;
            lument_draw_text(sel.c_str(), w->absX + 4.0f, ty, w->fontSize, w->textColor);
        }
        // 下拉箭头（右侧三角）
        float ax = w->absX + w->w - 12.0f;
        float ay = w->absY + w->h * 0.5f;
        lument_draw_triangle(ax, ay - 4.0f, ax + 8.0f, ay - 4.0f,
                            ax + 4.0f, ay + 4.0f, w->textColor, true);
        // 展开列表
        if (w->dropdownOpen && !w->options.empty()) {
            float itemH = std::max(w->h, 20.0f);
            for (size_t i = 0; i < w->options.size(); ++i) {
                float iy = w->absY + w->h + i * itemH;
                LumentColor itemBg = (int(i) == w->selected) ? g_theme.primary : g_theme.surface;
                lument_draw_rect({ w->absX, iy, w->w, itemH }, itemBg, true);
                lument_draw_text(w->options[i].c_str(), w->absX + 4.0f,
                                iy + (itemH - w->fontSize) * 0.5f,
                                w->fontSize, w->textColor);
            }
        }
    }

    // 8. 滚动视图：背景 + 滚动条（子控件由 scroll offset 偏移）
    if (w->type == LUMENT_WIDGET_SCROLLVIEW && w->w > 0.0f && w->h > 0.0f) {
        // 垂直滚动条
        if (w->contentH > w->h) {
            float trackH = w->h;
            float thumbH = std::max(20.0f, trackH * (w->h / w->contentH));
            float maxScroll = w->contentH - w->h;
            float thumbY = w->absY + (maxScroll > 0.0f
                            ? (w->scrollY / maxScroll) * (trackH - thumbH) : 0.0f);
            lument_draw_rect({ w->absX + w->w - 6.0f, w->absY, 4.0f, trackH },
                            g_theme.secondary, true);
            lument_draw_rect({ w->absX + w->w - 6.0f, thumbY, 4.0f, thumbH },
                            g_theme.accent, true);
        }
    }

    // 9. 分隔线
    if (w->type == LUMENT_WIDGET_DIVIDER && w->w > 0.0f && w->h > 0.0f) {
        if (w->w >= w->h) {
            // 水平分隔线
            float y = w->absY + w->h * 0.5f;
            lument_draw_line(w->absX, y, w->absX + w->w, y,
                            std::max(1.0f, w->h), w->bgColor);
        } else {
            // 垂直分隔线
            float x = w->absX + w->w * 0.5f;
            lument_draw_line(x, w->absY, x, w->absY + w->h,
                            std::max(1.0f, w->w), w->bgColor);
        }
    }

    // 10. 加载指示器（旋转弧）
    if (w->type == LUMENT_WIDGET_SPINNER && w->w > 0.0f && w->h > 0.0f) {
        float cx = w->absX + w->w * 0.5f;
        float cy = w->absY + w->h * 0.5f;
        float r = std::min(w->w, w->h) * 0.4f;
        // 8 段弧，每段透明度递增（旋转感）
        for (int i = 0; i < 8; ++i) {
            float a0 = w->animTime * 6.0f + i * 0.785f;
            float a1 = a0 + 0.5f;
            uint8_t alpha = uint8_t(40 + (i * 255 / 8));
            LumentColor seg = { w->textColor.r, w->textColor.g, w->textColor.b, alpha };
            lument_draw_line(cx + std::cos(a0) * r * 0.5f,
                            cy + std::sin(a0) * r * 0.5f,
                            cx + std::cos(a1) * r,
                            cy + std::sin(a1) * r,
                            std::max(2.0f, r * 0.15f), seg);
        }
    }

    // 11. 文本（通用，按控件类型决定对齐）
    if (!w->text.empty() &&
        w->type != LUMENT_WIDGET_DROPDOWN &&   // dropdown 已自行渲染
        w->type != LUMENT_WIDGET_DIVIDER &&
        w->type != LUMENT_WIDGET_SPINNER) {
        LumentColor useColor = w->enabled ? w->textColor : g_theme.textMuted;
        if (w->type == LUMENT_WIDGET_INPUT && !w->focused) {
            useColor = g_theme.textMuted;
        }
        float ty = w->absY + (w->h - w->fontSize) * 0.5f;
        float tx;
        if (w->type == LUMENT_WIDGET_BUTTON || w->type == LUMENT_WIDGET_LABEL ||
            w->type == LUMENT_WIDGET_TOGGLE || w->type == LUMENT_WIDGET_TABBAR) {
            float tw = text_width(w->text, w->fontSize);
            if (tw > w->w - 4.0f) tw = w->w - 4.0f;
            tx = w->absX + (w->w - tw) * 0.5f;
        } else {
            tx = w->absX + 4.0f;
        }
        if (tx < w->absX) tx = w->absX;
        lument_draw_text(w->text.c_str(), tx, ty, w->fontSize, useColor);
    }

    // 12. 输入框边框
    if (w->type == LUMENT_WIDGET_INPUT && w->w > 0.0f && w->h > 0.0f) {
        lument_draw_rect({ w->absX, w->absY, w->w, w->h }, g_theme.border, false);
    }

    // 13. 焦点高亮（描边）
    if (w->focused && w->w > 0.0f && w->h > 0.0f) {
        lument_draw_rect({ w->absX - 2, w->absY - 2, w->w + 4, w->h + 4 },
                         g_theme.accent, false);
    }

    // 14. 子控件（后绘制 = 更靠前 / 层级更高）
    //     scrollview 的子控件应用滚动偏移（通过调整 absX/absY）
    if (w->type == LUMENT_WIDGET_SCROLLVIEW) {
        // 偏移子控件：通过临时调整父级 absX/absY 实现
        float savedX = w->absX, savedY = w->absY;
        w->absX -= w->scrollX;
        w->absY -= w->scrollY;
        for (LumentWidget ch : w->children) {
            render_widget(m, ch);
        }
        w->absX = savedX;
        w->absY = savedY;
    } else {
        for (LumentWidget ch : w->children) {
            render_widget(m, ch);
        }
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

// 递归应用自动尺寸（在布局前调用）
void apply_auto_size_recursive(WidgetManager& m, LumentWidget handle) {
    Widget* w = m.validate(handle);
    if (!w) return;
    apply_auto_size(m, *w);
    for (LumentWidget ch : w->children) {
        apply_auto_size_recursive(m, ch);
    }
}

// 递归更新动画时间（spinner 等）
void update_anim_recursive(WidgetManager& m, LumentWidget handle, float dt) {
    Widget* w = m.validate(handle);
    if (!w) return;
    if (w->type == LUMENT_WIDGET_SPINNER) {
        w->animTime += dt;
    }
    for (LumentWidget ch : w->children) {
        update_anim_recursive(m, ch, dt);
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
    WidgetManager& m = mgr();
    LumentWidget h = m.alloc(type);
    Widget* w = m.validate(h);
    if (w) {
        apply_theme(*w);           // 新建控件自动套用主题色
    }
    return h;
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
    float dt = lument_get_delta_time() * 0.001f;  // 秒

    if (!m.navStack.empty()) {
        // 仅渲染栈顶屏幕
        LumentWidget screen = m.navStack.back();
        Widget* sw = m.validate(screen);
        if (!sw) { m.navStack.pop_back(); return; }
        apply_auto_size_recursive(m, screen);
        update_anim_recursive(m, screen, dt);
        compute_layout(m, screen, sw->x, sw->y);
        render_widget(m, screen);
    } else {
        // 无导航栈：渲染所有根控件
        for_each_root(m, [&](LumentWidget h, Widget& wgt) {
            apply_auto_size_recursive(m, h);
            update_anim_recursive(m, h, dt);
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

    Widget* hw = m.validate(hit);

    if (type == 0) {
        // 按下：设置焦点 + 触发 CLICK + 控件交互
        if (hit != LUMENT_INVALID_WIDGET && hw) {
            set_focus(m, hit);
            switch (hw->type) {
            case LUMENT_WIDGET_SLIDER: {
                // 按位置更新值
                if (hw->w > 0.0f) {
                    float t = (x - hw->absX) / hw->w;
                    if (t < 0.0f) t = 0.0f;
                    if (t > 1.0f) t = 1.0f;
                    hw->value = hw->minVal + t * (hw->maxVal - hw->minVal);
                    fire_event(m, hit, LUMENT_EVENT_CHANGE, nullptr);
                }
                break;
            }
            case LUMENT_WIDGET_CHECKBOX:
                hw->checked = !hw->checked;
                fire_event(m, hit, LUMENT_EVENT_CHANGE, nullptr);
                break;
            case LUMENT_WIDGET_TOGGLE:
                hw->checked = !hw->checked;
                fire_event(m, hit, LUMENT_EVENT_CHANGE, nullptr);
                break;
            case LUMENT_WIDGET_DROPDOWN:
                if (hw->dropdownOpen) {
                    // 已展开：判断点击的是哪个选项
                    float itemH = std::max(hw->h, 20.0f);
                    int idx = int((y - hw->absY - hw->h) / itemH);
                    if (idx >= 0 && idx < int(hw->options.size())) {
                        hw->selected = idx;
                        hw->dropdownOpen = false;
                        fire_event(m, hit, LUMENT_EVENT_CHANGE, nullptr);
                    } else {
                        hw->dropdownOpen = false;
                    }
                } else {
                    hw->dropdownOpen = true;
                }
                break;
            default:
                fire_event(m, hit, LUMENT_EVENT_CLICK, nullptr);
                break;
            }
            return true;
        }
        // 点击空白处清除焦点
        set_focus(m, LUMENT_INVALID_WIDGET);
        return false;
    } else if (type == 1) {
        // 移动
        if (hit != LUMENT_INVALID_WIDGET && hw) {
            if (hw->type == LUMENT_WIDGET_SLIDER && hw->w > 0.0f) {
                // 拖动滑块
                float t = (x - hw->absX) / hw->w;
                if (t < 0.0f) t = 0.0f;
                if (t > 1.0f) t = 1.0f;
                hw->value = hw->minVal + t * (hw->maxVal - hw->minVal);
                fire_event(m, hit, LUMENT_EVENT_CHANGE, nullptr);
                return true;
            }
            if (hw->type == LUMENT_WIDGET_SCROLLVIEW) {
                // 简易滚动：根据 y 偏移累加 scrollY
                // 实际滚动由宿主在 SCROLL 回调中调用 lument_ui_set_scroll
                fire_event(m, hit, LUMENT_EVENT_SCROLL, nullptr);
                return true;
            }
            fire_event(m, hit, LUMENT_EVENT_SCROLL, nullptr);
            return true;
        }
        return false;
    } else { // type == 2 抬起
        if (hit != LUMENT_INVALID_WIDGET && hw) {
            if (hw->type == LUMENT_WIDGET_SLIDER) {
                fire_event(m, hit, LUMENT_EVENT_CHANGE, nullptr);
            }
        }
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
        apply_theme(*bw);
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
        apply_theme(*lw);
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
        apply_theme(*iw);
    }
    return handle;
}

// --- 新增控件便捷创建（v1.3）---
LUMENT_API LumentWidget lument_ui_create_dropdown(float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_DROPDOWN);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = w; wgt->h = h;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_toggle(bool initial, float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_TOGGLE);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = w; wgt->h = h;
        wgt->checked = initial;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_scrollview(float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_SCROLLVIEW);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = w; wgt->h = h;
        wgt->contentW = w; wgt->contentH = h; // 默认内容=可视区
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_tooltip(const char* text, float x, float y) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_TOOLTIP);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->text = text ? text : "";
        wgt->x = x; wgt->y = y;
        // 尺寸按内容自适应
        wgt->autoSize = LUMENT_AUTOSIZE_BOTH;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_progress(float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_PROGRESS);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = w; wgt->h = h;
        wgt->value = 0.0f;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_slider(float min, float max, float value,
                                                float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_SLIDER);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = w; wgt->h = h;
        wgt->minVal = min; wgt->maxVal = max; wgt->value = value;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_checkbox(bool initial, float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_CHECKBOX);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = w; wgt->h = h;
        wgt->checked = initial;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_divider(float x, float y, float w, float h) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_DIVIDER);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = w; wgt->h = h;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_spinner(float x, float y, float size) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_SPINNER);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = size; wgt->h = size;
        apply_theme(*wgt);
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_create_icon(uint32_t textureId, float x, float y, float size) {
    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(LUMENT_WIDGET_ICON);
    Widget* wgt = m.validate(handle);
    if (wgt) {
        wgt->x = x; wgt->y = y; wgt->w = size; wgt->h = size;
        wgt->textureId = textureId;
        apply_theme(*wgt);
    }
    return handle;
}

// --- 控件状态查询与设置（v1.3，统一数值接口）---
LUMENT_API void lument_ui_set_value(LumentWidget widget, float value) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    if (w->type == LUMENT_WIDGET_SLIDER) {
        if (value < w->minVal) value = w->minVal;
        if (value > w->maxVal) value = w->maxVal;
    } else if (w->type == LUMENT_WIDGET_PROGRESS) {
        if (value < 0.0f) value = 0.0f;
        if (value > 1.0f) value = 1.0f;
    }
    w->value = value;
}

LUMENT_API float lument_ui_get_value(LumentWidget widget) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return 0.0f;
    return w->value;
}

LUMENT_API void lument_ui_set_min_max(LumentWidget widget, float min, float max) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->minVal = min;
    w->maxVal = max;
}

LUMENT_API void lument_ui_set_options(LumentWidget widget, const char* const* options, int count) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->options.clear();
    w->options.reserve(count);
    for (int i = 0; i < count; ++i) {
        w->options.push_back(options[i] ? options[i] : "");
    }
    if (w->selected >= count) w->selected = count - 1;
    if (w->selected < 0) w->selected = 0;
}

LUMENT_API int lument_ui_get_selected(LumentWidget widget) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return 0;
    return w->selected;
}

LUMENT_API void lument_ui_set_selected(LumentWidget widget, int index) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    if (index >= 0 && index < int(w->options.size())) {
        w->selected = index;
    }
}

LUMENT_API void lument_ui_set_checked(LumentWidget widget, bool checked) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->checked = checked;
}

LUMENT_API bool lument_ui_get_checked(LumentWidget widget) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return false;
    return w->checked;
}

LUMENT_API void lument_ui_set_scroll(LumentWidget widget, float offsetX, float offsetY) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    // 钳制在内容范围内
    if (w->contentW > w->w) {
        if (offsetX < 0.0f) offsetX = 0.0f;
        if (offsetX > w->contentW - w->w) offsetX = w->contentW - w->w;
    } else { offsetX = 0.0f; }
    if (w->contentH > w->h) {
        if (offsetY < 0.0f) offsetY = 0.0f;
        if (offsetY > w->contentH - w->h) offsetY = w->contentH - w->h;
    } else { offsetY = 0.0f; }
    w->scrollX = offsetX;
    w->scrollY = offsetY;
}

LUMENT_API void lument_ui_get_scroll(LumentWidget widget, float* offsetX, float* offsetY) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) { if (offsetX) *offsetX = 0; if (offsetY) *offsetY = 0; return; }
    if (offsetX) *offsetX = w->scrollX;
    if (offsetY) *offsetY = w->scrollY;
}

// --- 滚动视图内容管理 ---
LUMENT_API void lument_ui_set_content_size(LumentWidget scrollview, float w, float h) {
    WidgetManager& m = mgr();
    Widget* sv = m.validate(scrollview);
    if (!sv) return;
    sv->contentW = w;
    sv->contentH = h;
}

// --- 自动化系统（v1.3）---
LUMENT_API void lument_ui_set_theme(const LumentTheme* theme) {
    if (!theme) return;
    g_theme = *theme;
    g_themeDirty = true;
    // 立即刷新所有存活控件外观
    WidgetManager& m = mgr();
    for (uint32_t i = 0; i < LUMENT_MAX_WIDGETS; ++i) {
        if (m.used[i]) {
            apply_theme(m.widgets[i]);
        }
    }
}

LUMENT_API void lument_ui_get_theme(LumentTheme* outTheme) {
    if (!outTheme) return;
    *outTheme = g_theme;
}

LUMENT_API void lument_ui_reset_theme(void) {
    g_theme = {
        { 18, 18, 24, 255 },   // background
        { 30, 30, 38, 255 },   // surface
        { 60, 90, 160, 255 },  // primary
        { 90, 90, 110, 255 },  // secondary
        { 235, 235, 235, 255 },// text
        { 130, 130, 140, 255 },// textMuted
        { 120, 120, 130, 255 },// border
        { 100, 200, 255, 255 },// accent
        { 220, 70, 70, 255 },  // danger
        { 80, 180, 100, 255 }, // success
    };
    g_themeDirty = true;
    WidgetManager& m = mgr();
    for (uint32_t i = 0; i < LUMENT_MAX_WIDGETS; ++i) {
        if (m.used[i]) apply_theme(m.widgets[i]);
    }
}

LUMENT_API void lument_ui_set_auto_size(LumentWidget widget, int mode) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->autoSize = mode;
}

LUMENT_API void lument_ui_measure_text(const char* text, float fontSize, float* outW, float* outH) {
    if (!outW && !outH) return;
    std::string s = text ? text : "";
    if (outW) *outW = text_width(s, fontSize);
    if (outH) *outH = fontSize;
}

LUMENT_API void lument_ui_set_margin(LumentWidget widget, float top, float right, float bottom, float left) {
    WidgetManager& m = mgr();
    Widget* w = m.validate(widget);
    if (!w) return;
    w->marginTop = top; w->marginRight = right;
    w->marginBottom = bottom; w->marginLeft = left;
}

// --- 声明式 UI 构建（v1.3）---
// 极简 JSON 解析器（仅支持本 API 所需子集）
namespace ui_json {

struct Value {
    enum Type { NUL, BOOL, NUM, STR, ARR, OBJ } type = NUL;
    bool b = false;
    double num = 0.0;
    std::string str;
    std::vector<Value> arr;
    std::vector<std::pair<std::string, Value>> obj;

    const Value* find(const std::string& key) const {
        if (type != OBJ) return nullptr;
        for (const auto& kv : obj) {
            if (kv.first == key) return &kv.second;
        }
        return nullptr;
    }
};

// 跳过空白
inline const char* skip_ws(const char* p) {
    while (*p && (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')) ++p;
    return p;
}

// 解析字符串（假定已跳过开头引号）
inline std::string parse_string(const char*& p) {
    std::string s;
    while (*p && *p != '"') {
        if (*p == '\\') {
            ++p;
            switch (*p) {
            case 'n': s += '\n'; break;
            case 't': s += '\t'; break;
            case '"': s += '"'; break;
            case '\\': s += '\\'; break;
            default: s += *p; break;
            }
        } else {
            s += *p;
        }
        ++p;
    }
    if (*p == '"') ++p; // 跳过结尾引号
    return s;
}

inline Value parse_value(const char*& p);

inline Value parse_array(const char*& p) {
    Value v; v.type = Value::ARR;
    p = skip_ws(p + 1); // 跳过 '['
    while (*p && *p != ']') {
        p = skip_ws(p);
        v.arr.push_back(parse_value(p));
        p = skip_ws(p);
        if (*p == ',') ++p;
        p = skip_ws(p);
    }
    if (*p == ']') ++p;
    return v;
}

inline Value parse_object(const char*& p) {
    Value v; v.type = Value::OBJ;
    p = skip_ws(p + 1); // 跳过 '{'
    while (*p && *p != '}') {
        p = skip_ws(p);
        if (*p != '"') { ++p; continue; }
        ++p; // 跳过开头引号
        std::string key = parse_string(p);
        p = skip_ws(p);
        if (*p == ':') ++p;
        p = skip_ws(p);
        v.obj.emplace_back(std::move(key), parse_value(p));
        p = skip_ws(p);
        if (*p == ',') ++p;
        p = skip_ws(p);
    }
    if (*p == '}') ++p;
    return v;
}

inline Value parse_value(const char*& p) {
    p = skip_ws(p);
    Value v;
    if (*p == '"') {
        ++p;
        v.type = Value::STR;
        v.str = parse_string(p);
    } else if (*p == '{') {
        return parse_object(p);
    } else if (*p == '[') {
        return parse_array(p);
    } else if (*p == 't') {
        v.type = Value::BOOL; v.b = true;
        while (*p && *p != ',' && *p != '}' && *p != ']') ++p;
    } else if (*p == 'f') {
        v.type = Value::BOOL; v.b = false;
        while (*p && *p != ',' && *p != '}' && *p != ']') ++p;
    } else {
        // 数字
        char* end = nullptr;
        v.type = Value::NUM;
        v.num = std::strtod(p, &end);
        p = end;
    }
    return v;
}

} // namespace ui_json

// 类型名 -> 枚举值
LumentWidgetType parse_widget_type(const std::string& s) {
    if (s == "container")  return LUMENT_WIDGET_CONTAINER;
    if (s == "button")     return LUMENT_WIDGET_BUTTON;
    if (s == "label")      return LUMENT_WIDGET_LABEL;
    if (s == "input")      return LUMENT_WIDGET_INPUT;
    if (s == "image")      return LUMENT_WIDGET_IMAGE;
    if (s == "list")       return LUMENT_WIDGET_LIST;
    if (s == "progress")   return LUMENT_WIDGET_PROGRESS;
    if (s == "checkbox")   return LUMENT_WIDGET_CHECKBOX;
    if (s == "slider")     return LUMENT_WIDGET_SLIDER;
    if (s == "tabbar")     return LUMENT_WIDGET_TABBAR;
    if (s == "navbar")     return LUMENT_WIDGET_NAVBAR;
    if (s == "dropdown")   return LUMENT_WIDGET_DROPDOWN;
    if (s == "toggle")     return LUMENT_WIDGET_TOGGLE;
    if (s == "scrollview") return LUMENT_WIDGET_SCROLLVIEW;
    if (s == "tooltip")    return LUMENT_WIDGET_TOOLTIP;
    if (s == "divider")    return LUMENT_WIDGET_DIVIDER;
    if (s == "spinner")    return LUMENT_WIDGET_SPINNER;
    if (s == "icon")       return LUMENT_WIDGET_ICON;
    return LUMENT_WIDGET_CONTAINER;
}

// 布局名 -> 枚举值
LumentLayoutType parse_layout(const std::string& s) {
    if (s == "none")       return LUMENT_LAYOUT_NONE;
    if (s == "vertical")   return LUMENT_LAYOUT_VERTICAL;
    if (s == "horizontal") return LUMENT_LAYOUT_HORIZONTAL;
    if (s == "grid")       return LUMENT_LAYOUT_GRID;
    if (s == "stack")      return LUMENT_LAYOUT_STACK;
    if (s == "flow")       return LUMENT_LAYOUT_FLOW;
    return LUMENT_LAYOUT_NONE;
}

// 递归从 JSON 构建控件树
LumentWidget build_widget_recursive(const ui_json::Value& node) {
    if (node.type != ui_json::Value::OBJ) return LUMENT_INVALID_WIDGET;
    const ui_json::Value* t = node.find("type");
    std::string typeStr = t ? t->str : "container";
    LumentWidgetType wt = parse_widget_type(typeStr);

    WidgetManager& m = mgr();
    LumentWidget handle = m.alloc(wt);
    Widget* w = m.validate(handle);
    if (!w) return LUMENT_INVALID_WIDGET;
    apply_theme(*w);

    // 通用属性
    if (const auto* v = node.find("text"))     if (v->type == ui_json::Value::STR) w->text = v->str;
    if (const auto* v = node.find("name"))      if (v->type == ui_json::Value::STR) w->name = v->str;
    if (const auto* v = node.find("x"))          if (v->type == ui_json::Value::NUM) w->x = float(v->num);
    if (const auto* v = node.find("y"))          if (v->type == ui_json::Value::NUM) w->y = float(v->num);
    if (const auto* v = node.find("w"))          if (v->type == ui_json::Value::NUM) w->w = float(v->num);
    if (const auto* v = node.find("h"))          if (v->type == ui_json::Value::NUM) w->h = float(v->num);
    if (const auto* v = node.find("fontSize"))   if (v->type == ui_json::Value::NUM) w->fontSize = float(v->num);
    if (const auto* v = node.find("visible"))    if (v->type == ui_json::Value::BOOL) w->visible = v->b;
    if (const auto* v = node.find("enabled"))    if (v->type == ui_json::Value::BOOL) w->enabled = v->b;
    if (const auto* v = node.find("layout"))     if (v->type == ui_json::Value::STR) w->layout = parse_layout(v->str);
    if (const auto* v = node.find("spacing"))    if (v->type == ui_json::Value::NUM) w->spacing = float(v->num);
    if (const auto* v = node.find("alignment"))  if (v->type == ui_json::Value::NUM) w->alignment = int(v->num);
    if (const auto* v = node.find("padding"))    if (v->type == ui_json::Value::ARR && v->arr.size() >= 4) {
        w->padTop = float(v->arr[0].num);
        w->padRight = float(v->arr[1].num);
        w->padBottom = float(v->arr[2].num);
        w->padLeft = float(v->arr[3].num);
    }
    if (const auto* v = node.find("gridCols"))   if (v->type == ui_json::Value::NUM) w->gridCols = int(v->num);
    if (const auto* v = node.find("gridRows"))   if (v->type == ui_json::Value::NUM) w->gridRows = int(v->num);
    if (const auto* v = node.find("checked"))    if (v->type == ui_json::Value::BOOL) w->checked = v->b;
    if (const auto* v = node.find("value"))      if (v->type == ui_json::Value::NUM) w->value = float(v->num);
    if (const auto* v = node.find("min"))        if (v->type == ui_json::Value::NUM) w->minVal = float(v->num);
    if (const auto* v = node.find("max"))        if (v->type == ui_json::Value::NUM) w->maxVal = float(v->num);
    if (const auto* v = node.find("selected"))  if (v->type == ui_json::Value::NUM) w->selected = int(v->num);
    if (const auto* v = node.find("options"))    if (v->type == ui_json::Value::ARR) {
        for (const auto& opt : v->arr) {
            if (opt.type == ui_json::Value::STR) w->options.push_back(opt.str);
        }
    }

    // 子控件
    if (const auto* children = node.find("children")) {
        if (children->type == ui_json::Value::ARR) {
            for (const auto& childNode : children->arr) {
                LumentWidget child = build_widget_recursive(childNode);
                if (child != LUMENT_INVALID_WIDGET) {
                    lument_ui_add_child(handle, child);
                }
            }
        }
    }
    return handle;
}

LUMENT_API LumentWidget lument_ui_build_from_json(const char* json) {
    if (!json) return LUMENT_INVALID_WIDGET;
    const char* p = json;
    ui_json::Value root = ui_json::parse_value(p);
    return build_widget_recursive(root);
}

// 调试：输出控件树为 JSON（返回静态缓冲区）
LUMENT_API const char* lument_ui_dump_tree(LumentWidget root) {
    static std::string buf;
    buf.clear();
    WidgetManager& m = mgr();
    Widget* w = m.validate(root);
    if (!w) { buf = "null"; return buf.c_str(); }

    auto type_name = [](LumentWidgetType t) -> const char* {
        switch (t) {
        case LUMENT_WIDGET_CONTAINER:  return "container";
        case LUMENT_WIDGET_BUTTON:     return "button";
        case LUMENT_WIDGET_LABEL:      return "label";
        case LUMENT_WIDGET_INPUT:      return "input";
        case LUMENT_WIDGET_IMAGE:      return "image";
        case LUMENT_WIDGET_LIST:       return "list";
        case LUMENT_WIDGET_PROGRESS:   return "progress";
        case LUMENT_WIDGET_CHECKBOX:   return "checkbox";
        case LUMENT_WIDGET_SLIDER:     return "slider";
        case LUMENT_WIDGET_TABBAR:     return "tabbar";
        case LUMENT_WIDGET_NAVBAR:     return "navbar";
        case LUMENT_WIDGET_DROPDOWN:   return "dropdown";
        case LUMENT_WIDGET_TOGGLE:     return "toggle";
        case LUMENT_WIDGET_SCROLLVIEW: return "scrollview";
        case LUMENT_WIDGET_TOOLTIP:    return "tooltip";
        case LUMENT_WIDGET_DIVIDER:    return "divider";
        case LUMENT_WIDGET_SPINNER:    return "spinner";
        case LUMENT_WIDGET_ICON:       return "icon";
        default: return "unknown";
        }
    };

    std::function<void(LumentWidget, int)> dump_rec = [&](LumentWidget h, int depth) {
        Widget* cw = m.validate(h);
        if (!cw) return;
        for (int i = 0; i < depth; ++i) buf += "  ";
        buf += "{";
        buf += "\"type\":\""; buf += type_name(cw->type); buf += "\"";
        if (!cw->name.empty()) { buf += ",\"name\":\""; buf += cw->name; buf += "\""; }
        if (!cw->text.empty()) { buf += ",\"text\":\""; buf += cw->text; buf += "\""; }
        buf += ",\"x\":"; buf += std::to_string(cw->x);
        buf += ",\"y\":"; buf += std::to_string(cw->y);
        buf += ",\"w\":"; buf += std::to_string(cw->w);
        buf += ",\"h\":"; buf += std::to_string(cw->h);
        if (cw->checked) buf += ",\"checked\":true";
        if (cw->type == LUMENT_WIDGET_SLIDER) {
            buf += ",\"value\":"; buf += std::to_string(cw->value);
            buf += ",\"min\":"; buf += std::to_string(cw->minVal);
            buf += ",\"max\":"; buf += std::to_string(cw->maxVal);
        }
        if (cw->type == LUMENT_WIDGET_DROPDOWN) {
            buf += ",\"selected\":"; buf += std::to_string(cw->selected);
        }
        if (!cw->children.empty()) {
            buf += ",\"children\":[\n";
            for (size_t i = 0; i < cw->children.size(); ++i) {
                dump_rec(cw->children[i], depth + 1);
                if (i + 1 < cw->children.size()) buf += ",";
                buf += "\n";
            }
            for (int i = 0; i < depth; ++i) buf += "  ";
            buf += "]";
        }
        buf += "}";
    };
    dump_rec(root, 0);
    return buf.c_str();
}

LUMENT_API LumentWidget lument_ui_find_by_id(const char* name) {
    if (!name) return LUMENT_INVALID_WIDGET;
    WidgetManager& m = mgr();
    for (uint32_t i = 0; i < LUMENT_MAX_WIDGETS; ++i) {
        if (m.used[i] && m.widgets[i].name == name) {
            return make_widget(i, m.gen[i]);
        }
    }
    return LUMENT_INVALID_WIDGET;
}

} // extern "C"
