// ============================================================
// lument.h - Lument C ABI
// 统一C接口，供 C++/Python/Java/JS 所有语言调用
// 设计原则：低开销、高性能、跨平台
// ============================================================
#ifndef LUMENT_H
#define LUMENT_H

#ifdef __cplusplus
extern "C" {
#endif

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

// ========== 引擎版本 ==========
#define LUMENT_VERSION_MAJOR 1
#define LUMENT_VERSION_MINOR 2
#define LUMENT_VERSION_PATCH 0
#define LUMENT_VERSION_STRING "1.2.0"

// ========== 平台标识 ==========
typedef enum {
    LUMENT_PLATFORM_DESKTOP = 0,   // Windows/Linux/macOS
    LUMENT_PLATFORM_ANDROID = 1,   // Android
    LUMENT_PLATFORM_IOS     = 2,   // iOS
    LUMENT_PLATFORM_WEB     = 3,   // WebAssembly/Browser
} LumentPlatform;

// ========== 渲染后端 ==========
typedef enum {
    LUMENT_RENDERER_OPENGL    = 0,  // Desktop OpenGL
    LUMENT_RENDERER_OPENGLES  = 1,  // Mobile OpenGL ES
    LUMENT_RENDERER_WEBGL     = 2,  // Web WebGL
    LUMENT_RENDERER_CANVAS2D  = 3,  // HTML5 Canvas 2D
    LUMENT_RENDERER_VULKAN    = 4,  // Vulkan (future)
} LumentRendererType;

// ========== 输入类型 ==========
typedef enum {
    LUMENT_INPUT_NONE      = 0,
    LUMENT_INPUT_KEYBOARD  = 1,
    LUMENT_INPUT_TOUCH     = 2,
    LUMENT_INPUT_GAMEPAD   = 3,
    LUMENT_INPUT_MOUSE     = 4,
} UEInputType;

// ========== 按键定义 ==========
typedef enum {
    LUMENT_KEY_NONE    = 0,
    LUMENT_KEY_LEFT    = 1,
    LUMENT_KEY_RIGHT   = 2,
    LUMENT_KEY_UP      = 3,
    LUMENT_KEY_DOWN    = 4,
    LUMENT_KEY_ACTION  = 5,   // 确认/交互
    LUMENT_KEY_CANCEL  = 6,   // 取消/返回
    LUMENT_KEY_MENU    = 7,   // 菜单/暂停
    LUMENT_KEY_MAX     = 8,
} LumentKey;

// ========== 颜色结构 ==========
typedef struct {
    uint8_t r, g, b, a;
} LumentColor;

// ========== 矩形结构 ==========
typedef struct {
    float x, y, w, h;
} LumentRect;

// ========== 向量结构 ==========
typedef struct {
    float x, y;
} LumentVec2;

// ========== 实体ID ==========
typedef uint32_t LumentEntity;
#define LUMENT_INVALID_ENTITY 0

// ========== 组件类型标识 ==========
typedef enum {
    LUMENT_COMP_NONE      = 0,
    LUMENT_COMP_TRANSFORM = 1,   // 位置/旋转/缩放
    LUMENT_COMP_SPRITE    = 2,   // 精灵渲染
    LUMENT_COMP_PHYSICS   = 3,   // 物理体
    LUMENT_COMP_COLLIDER  = 4,   // 碰撞体
    LUMENT_COMP_SCRIPT    = 5,   // 脚本组件
    LUMENT_COMP_AUDIO     = 6,   // 音频源
    LUMENT_COMP_CAMERA    = 7,   // 摄像机
    LUMENT_COMP_TEXT      = 8,   // 文本渲染
    LUMENT_COMP_ANIMATOR  = 9,   // 动画器
} UEComponentType;

// ========== 引擎配置 ==========
typedef struct {
    LumentPlatform       platform;
    LumentRendererType   rendererType;
    int              width;          // 画布宽度
    int              height;         // 画布高度
    float            targetFPS;      // 目标帧率
    bool             vsync;          // 垂直同步
    bool             fullscreen;     // 全屏模式
    const char*      assetPath;      // 资源路径
    const char*      savePath;       // 存档路径
} LumentConfig;

// ========== 引擎统计 ==========
typedef struct {
    float    fps;
    float    frameTime;      // 毫秒
    uint32_t drawCalls;
    uint32_t entityCount;
    uint32_t memoryUsed;     // KB
} LumentStats;

// ============================================================
// 2D 场景渲染：扩展结构定义
// ============================================================

// ========== 场景色彩色调参数 ==========
typedef struct {
    LumentColor tint;           // 色调叠加色 (默认 {255,255,255,255} = 无效果)
    float       brightness;     // 亮度 0.0~2.0 (1.0=原始)
    float       contrast;       // 对比度 0.0~2.0 (1.0=原始)
    float       saturation;     // 饱和度 0.0~2.0 (1.0=原始)
    float       hueShift;       // 色相偏移 0~360 度
    float       grayscale;      // 灰度混合 0.0~1.0
    float       sepia;          // 棕褐色 0.0~1.0
    float       invert;         // 反色 0.0~1.0
} LumentSceneColor;

// ========== 场景清晰度参数 ==========
typedef struct {
    float       sharpness;      // 锐化 -1.0~1.0 (0=原始, 正=锐化, 负=模糊)
    float       blurRadius;     // 高斯模糊半径 0.0+ (0=关闭)
    float       bloomIntensity; // 泛光强度 0.0~1.0
    float       bloomThreshold; // 泛光阈值 0.0~1.0
} LumentSceneClarity;

// ========== 光源类型 ==========
typedef enum {
    LUMENT_LIGHT_POINT       = 0,  // 点光源
    LUMENT_LIGHT_DIRECTIONAL = 1,  // 方向光（平行光）
    LUMENT_LIGHT_SPOT        = 2,  // 聚光灯
} LumentLightType;

// ========== 光源参数 ==========
typedef struct {
    LumentLightType type;
    float       x, y;              // 位置（点光/聚光用）
    float       dirX, dirY;        // 方向向量（方向光/聚光用）
    float       radius;            // 影响半径（点光/聚光用）
    float       angle;             // 聚光锥角（度）
    float       intensity;         // 强度 0.0~2.0
    LumentColor color;             // 光颜色
} LumentLight;

// ========== 环境光参数 ==========
typedef struct {
    LumentColor color;             // 环境光颜色
    float       intensity;         // 强度 0.0~1.0
    float       falloff;           // 衰减指数 (1.0=线性, 2.0=二次)
} LumentSceneLighting;

// ========== 暗角参数 ==========
typedef struct {
    float       intensity;         // 强度 0.0~1.0
    float       radius;            // 半径 0.0~1.0 (占屏幕比例)
} LumentVignette;

// ========== 雾效参数 ==========
typedef struct {
    LumentColor color;             // 雾颜色
    float       density;           // 雾密度 0.0~1.0
    float       start;             // 雾起始距离（世界坐标）
    float       end;               // 雾结束距离（世界坐标）
} LumentFog;

// ============================================================
// 2D 物理模拟：结构定义
// ============================================================

// ========== 物理体类型 ==========
typedef enum {
    LUMENT_BODY_STATIC    = 0,   // 静态体（不受力，不可移动）
    LUMENT_BODY_DYNAMIC   = 1,   // 动态体（受重力/力影响）
    LUMENT_BODY_KINEMATIC = 2,   // 运动学体（手动移动，不受力）
} LumentBodyType;

// ========== 碰撞形状类型 ==========
typedef enum {
    LUMENT_SHAPE_AABB    = 0,   // 轴对齐矩形
    LUMENT_SHAPE_CIRCLE  = 1,   // 圆形
} LumentShapeType;

// ========== 碰撞形状 ==========
typedef struct {
    LumentShapeType type;
    float w, h;     // AABB 用
    float radius;   // Circle 用
} LumentShape;

// ========== 物理体参数 ==========
typedef struct {
    LumentBodyType type;
    float mass;           // 质量（static=0）
    float restitution;    // 弹性系数 0~1
    float friction;       // 摩擦系数 0~1
    float linearDamping;  // 线性阻尼 0~1
    float angularDamping; // 角阻尼 0~1
    float gravityScale;   // 重力缩放（1.0=正常, 0=无重力）
} LumentBodyDef;

// ========== 物理体状态 ==========
typedef struct {
    float x, y;           // 位置
    float vx, vy;         // 速度
    float ax, ay;         // 加速度
    float angle;          // 旋转角度
    float angularVel;     // 角速度
} LumentBodyState;

// ========== 碰撞信息 ==========
typedef struct {
    int     bodyA, bodyB;    // 碰撞的两个体ID
    LumentVec2 point;        // 碰撞点
    LumentVec2 normal;       // 碰撞法线（从A指向B）
    float   penetration;     // 穿透深度
} LumentCollision;

// ========== 自定义阻尼函数指针 ==========
typedef float (*LumentDampingFunc)(float velocity, float mass, float dt, void* userData);

// ============================================================
// 网络模块：结构定义
// ============================================================

// ========== HTTP 方法 ==========
typedef enum {
    LUMENT_HTTP_GET     = 0,
    LUMENT_HTTP_POST    = 1,
    LUMENT_HTTP_PUT     = 2,
    LUMENT_HTTP_DELETE  = 3,
    LUMENT_HTTP_PATCH   = 4,
} LumentHttpMethod;

// ========== HTTP 响应 ==========
typedef struct {
    int         statusCode;     // HTTP 状态码
    const char* body;           // 响应体（字符串）
    int         bodyLength;     // 响应体长度
    const char* headers;        // 响应头（\n 分隔的 key:value）
} LumentHttpResponse;

// ========== HTTP 请求回调 ==========
typedef void (*LumentHttpCallback)(const LumentHttpResponse* response, void* userData);

// ========== WebSocket 事件类型 ==========
typedef enum {
    LUMENT_WS_OPEN    = 0,
    LUMENT_WS_MESSAGE = 1,
    LUMENT_WS_CLOSE   = 2,
    LUMENT_WS_ERROR   = 3,
} LumentWsEventType;

// ========== WebSocket 事件回调 ==========
typedef void (*LumentWsCallback)(LumentWsEventType event, const char* data, int length, void* userData);

// ============================================================
// AI 模块：结构定义
// ============================================================

// ========== AI 行为状态 ==========
typedef enum {
    LUMENT_AI_SUCCESS = 0,
    LUMENT_AI_FAILURE = 1,
    LUMENT_AI_RUNNING = 2,
} LumentAiStatus;

// ========== AI 行为节点类型 ==========
typedef enum {
    LUMENT_AI_NODE_ACTION    = 0,   // 动作节点
    LUMENT_AI_NODE_CONDITION = 1,   // 条件节点
    LUMENT_AI_NODE_SEQUENCE  = 2,   // 顺序节点
    LUMENT_AI_NODE_SELECTOR  = 3,   // 选择节点
    LUMENT_AI_NODE_PARALLEL  = 4,   // 并行节点
    LUMENT_AI_NODE_DECORATOR = 5,   // 装饰节点
} LumentAiNodeType;

// ========== AI 节点回调 ==========
typedef LumentAiStatus (*LumentAiNodeFunc)(LumentEntity entity, float dt, void* userData);

// ========== 网格坐标（用于寻路） ==========
typedef struct {
    int x, y;
} LumentGridPos;

// ============================================================
// 核心 API（C ABI）
// ============================================================

// --- 引擎生命周期 ---
LUMENT_API int  lument_init(const LumentConfig* config);
LUMENT_API void lument_shutdown(void);
LUMENT_API int  lument_is_running(void);

// --- 帧循环 ---
LUMENT_API void lument_begin_frame(void);
LUMENT_API void lument_end_frame(void);
LUMENT_API float lument_get_delta_time(void);     // 毫秒
LUMENT_API void  lument_get_stats(LumentStats* stats);

// --- 平台信息 ---
LUMENT_API LumentPlatform    lument_get_platform(void);
LUMENT_API LumentRendererType lument_get_renderer_type(void);

// ============================================================
// 渲染 API
// ============================================================
LUMENT_API void lument_clear(LumentColor color);
LUMENT_API void lument_set_camera(float x, float y, float zoom);
LUMENT_API void lument_draw_rect(LumentRect rect, LumentColor color, bool filled);
LUMENT_API void lument_draw_sprite(uint32_t textureId, LumentRect dest, LumentRect src);
LUMENT_API void lument_draw_text(const char* text, float x, float y, float size, LumentColor color);
LUMENT_API void lument_draw_pixel(int x, int y, LumentColor color);
LUMENT_API void lument_flush(void);

// --- 纹理管理 ---
LUMENT_API uint32_t lument_load_texture(const char* path);
LUMENT_API uint32_t lument_create_texture_from_data(int w, int h, const uint8_t* rgba);
LUMENT_API void     lument_destroy_texture(uint32_t id);

// ============================================================
// 2D 场景渲染 API
// 提供场景级色彩色调调整、清晰度控制、光线渲染与图片接入
// ============================================================

// --- 场景色彩色调控制 ---
LUMENT_API void lument_set_scene_tint(LumentColor tint);                    // 色调叠加
LUMENT_API void lument_set_scene_brightness(float brightness);              // 亮度 0~2
LUMENT_API void lument_set_scene_contrast(float contrast);                  // 对比度 0~2
LUMENT_API void lument_set_scene_saturation(float saturation);              // 饱和度 0~2
LUMENT_API void lument_set_scene_hue_shift(float hueShift);                 // 色相偏移 0~360
LUMENT_API void lument_set_scene_grayscale(float amount);                   // 灰度 0~1
LUMENT_API void lument_set_scene_sepia(float amount);                       // 棕褐色 0~1
LUMENT_API void lument_set_scene_invert(float amount);                      // 反色 0~1
LUMENT_API void lument_set_scene_color(const LumentSceneColor* color);      // 批量设置色彩参数
LUMENT_API void lument_get_scene_color(LumentSceneColor* outColor);         // 获取当前色彩参数
LUMENT_API void lument_reset_scene_color(void);                             // 重置色彩为默认

// --- 场景清晰度控制 ---
LUMENT_API void lument_set_scene_sharpness(float sharpness);                // 锐化 -1~1
LUMENT_API void lument_set_scene_blur(float radius);                        // 模糊半径 0+
LUMENT_API void lument_set_scene_bloom(float intensity, float threshold);   // 泛光
LUMENT_API void lument_set_scene_clarity(const LumentSceneClarity* clarity);// 批量设置清晰度
LUMENT_API void lument_get_scene_clarity(LumentSceneClarity* outClarity);   // 获取清晰度参数
LUMENT_API void lument_reset_scene_clarity(void);                           // 重置清晰度为默认

// --- 暗角与雾效 ---
LUMENT_API void lument_set_vignette(float intensity, float radius);         // 暗角效果
LUMENT_API void lument_set_fog(LumentColor color, float density, float start, float end); // 雾效
LUMENT_API void lument_reset_vignette(void);
LUMENT_API void lument_reset_fog(void);

// --- 光线渲染 ---
LUMENT_API int  lument_add_light(LumentLightType type, float x, float y,
                                 float radius, LumentColor color, float intensity);
LUMENT_API void lument_set_light_direction(int lightId, float dirX, float dirY);
LUMENT_API void lument_set_light_angle(int lightId, float angle);
LUMENT_API void lument_set_light_intensity(int lightId, float intensity);
LUMENT_API void lument_set_light_color(int lightId, LumentColor color);
LUMENT_API void lument_set_light_position(int lightId, float x, float y);
LUMENT_API void lument_remove_light(int lightId);
LUMENT_API void lument_clear_lights(void);
LUMENT_API int  lument_get_light_count(void);
LUMENT_API void lument_set_ambient_light(LumentColor color, float intensity);
LUMENT_API void lument_set_light_falloff(float falloff);
LUMENT_API void lument_render_lights(void);                               // 渲染所有累积光源

// --- 图片接入接口 ---
LUMENT_API uint32_t lument_load_image(const char* path, int* outW, int* outH);
LUMENT_API void     lument_draw_image_tiled(uint32_t texId, LumentRect dest,
                                            LumentRect src, float offsetX, float offsetY);
LUMENT_API void     lument_draw_image_rotated(uint32_t texId, float cx, float cy,
                                             float angleDeg, float scale, LumentRect src);
LUMENT_API void     lument_draw_image_with_color(uint32_t texId, LumentRect dest,
                                                LumentRect src, LumentColor color);
LUMENT_API void     lument_draw_image_region(uint32_t texId, LumentRect dest,
                                            LumentRect src, LumentColor color,
                                            float rotation, bool tiled);

// --- 离屏渲染目标 ---
LUMENT_API uint32_t lument_create_render_target(int w, int h);
LUMENT_API void     lument_set_render_target(uint32_t id);  // 0=恢复到屏幕
LUMENT_API void     lument_draw_render_target(uint32_t id, LumentRect dest);
LUMENT_API void     lument_destroy_render_target(uint32_t id);

// --- 场景后期处理 ---
LUMENT_API void lument_apply_scene_effects(void);  // 应用所有场景效果（色彩/清晰度/暗角/雾）

// ============================================================
// 输入 API
// ============================================================
LUMENT_API bool lument_key_down(LumentKey key);
LUMENT_API bool lument_key_pressed(LumentKey key);    // just pressed this frame
LUMENT_API int  lument_get_touch_count(void);
LUMENT_API void lument_get_touch(int index, LumentVec2* pos);
LUMENT_API float lument_get_joystick_x(void);     // -1.0 ~ 1.0
LUMENT_API float lument_get_joystick_y(void);     // -1.0 ~ 1.0

// ============================================================
// 音频 API
// ============================================================
LUMENT_API uint32_t lument_load_audio(const char* path, bool isMusic);
LUMENT_API void     lument_play_audio(uint32_t id, bool loop);
LUMENT_API void     lument_stop_audio(uint32_t id);
LUMENT_API void     lument_set_volume(uint32_t id, float volume);
LUMENT_API void     lument_stop_all_audio(void);

// ============================================================
// ECS (Entity Component System) API
// ============================================================
LUMENT_API LumentEntity lument_create_entity(void);
LUMENT_API void     lument_destroy_entity(LumentEntity entity);
LUMENT_API bool     lument_entity_alive(LumentEntity entity);

// --- Transform ---
LUMENT_API void lument_set_position(LumentEntity e, float x, float y);
LUMENT_API void lument_get_position(LumentEntity e, LumentVec2* pos);
LUMENT_API void lument_set_scale(LumentEntity e, float sx, float sy);

// --- Sprite ---
LUMENT_API void lument_set_sprite(LumentEntity e, uint32_t textureId, float w, float h);
LUMENT_API void lument_set_sprite_color(LumentEntity e, LumentColor color);
LUMENT_API void lument_set_visible(LumentEntity e, bool visible);

// --- Collider ---
LUMENT_API void lument_set_collider(LumentEntity e, float w, float h);
LUMENT_API bool lument_check_collision(LumentEntity a, LumentEntity b);

// --- Script (回调由脚本语言注册) ---
typedef void (*UEUpdateCallback)(LumentEntity, float);
LUMENT_API void lument_set_script(LumentEntity e, UEUpdateCallback onUpdate);

// ============================================================
// 场景管理 API
// ============================================================
LUMENT_API int  lument_load_scene(const char* name);
LUMENT_API void lument_set_active_scene(int sceneId);
LUMENT_API int  lument_get_active_scene(void);
LUMENT_API void lument_scene_set_background(LumentColor color);

// ============================================================
// UI / 应用开发 API
// 适用于轻量应用开发：表单、列表、仪表盘、工具类App
// ============================================================

// --- Widget 类型 ---
typedef enum {
    LUMENT_WIDGET_NONE      = 0,
    LUMENT_WIDGET_CONTAINER = 1,   // 容器（可嵌套）
    LUMENT_WIDGET_BUTTON    = 2,   // 按钮
    LUMENT_WIDGET_LABEL     = 3,   // 文本标签
    LUMENT_WIDGET_INPUT     = 4,   // 文本输入框
    LUMENT_WIDGET_IMAGE     = 5,   // 图片
    LUMENT_WIDGET_LIST      = 6,   // 列表/滚动视图
    LUMENT_WIDGET_PROGRESS  = 7,   // 进度条
    LUMENT_WIDGET_CHECKBOX  = 8,   // 复选框
    LUMENT_WIDGET_SLIDER    = 9,   // 滑块
    LUMENT_WIDGET_TABBAR    = 10,  // 标签栏
    LUMENT_WIDGET_NAVBAR    = 11,  // 导航栏
} LumentWidgetType;

// --- 布局类型 ---
typedef enum {
    LUMENT_LAYOUT_NONE      = 0,   // 绝对定位
    LUMENT_LAYOUT_VERTICAL  = 1,   // 垂直排列
    LUMENT_LAYOUT_HORIZONTAL= 2,   // 水平排列
    LUMENT_LAYOUT_GRID      = 3,   // 网格布局
    LUMENT_LAYOUT_STACK     = 4,   // 堆叠（Z轴）
} LumentLayoutType;

// --- 事件类型 ---
typedef enum {
    LUMENT_EVENT_NONE   = 0,
    LUMENT_EVENT_CLICK  = 1,
    LUMENT_EVENT_FOCUS  = 2,
    LUMENT_EVENT_BLUR   = 3,
    LUMENT_EVENT_CHANGE = 4,
    LUMENT_EVENT_SCROLL = 5,
} LumentEventType;

// --- Widget 句柄 ---
typedef uint32_t LumentWidget;
#define LUMENT_INVALID_WIDGET 0

// --- 事件回调 ---
typedef void (*LumentEventCallback)(LumentWidget widget, LumentEventType event, const char* data);

// --- Widget 生命周期 ---
LUMENT_API LumentWidget lument_ui_create(LumentWidgetType type);
LUMENT_API void         lument_ui_destroy(LumentWidget widget);
LUMENT_API void         lument_ui_clear_all(void);

// --- Widget 属性 ---
LUMENT_API void lument_ui_set_text(LumentWidget widget, const char* text);
LUMENT_API const char* lument_ui_get_text(LumentWidget widget);
LUMENT_API void lument_ui_set_position(LumentWidget widget, float x, float y);
LUMENT_API void lument_ui_set_size(LumentWidget widget, float w, float h);
LUMENT_API void lument_ui_set_color(LumentWidget widget, LumentColor color);
LUMENT_API void lument_ui_set_text_color(LumentWidget widget, LumentColor color);
LUMENT_API void lument_ui_set_font_size(LumentWidget widget, float size);
LUMENT_API void lument_ui_set_visible(LumentWidget widget, bool visible);
LUMENT_API void lument_ui_set_enabled(LumentWidget widget, bool enabled);
LUMENT_API void lument_ui_set_image(LumentWidget widget, uint32_t textureId);

// --- Widget 层级 ---
LUMENT_API void lument_ui_add_child(LumentWidget parent, LumentWidget child);
LUMENT_API void lument_ui_remove_child(LumentWidget parent, LumentWidget child);
LUMENT_API LumentWidget lument_ui_get_parent(LumentWidget widget);

// --- 布局 ---
LUMENT_API void lument_ui_set_layout(LumentWidget container, LumentLayoutType layout);
LUMENT_API void lument_ui_set_padding(LumentWidget container, float top, float right, float bottom, float left);
LUMENT_API void lument_ui_set_spacing(LumentWidget container, float spacing);
LUMENT_API void lument_ui_set_grid(LumentWidget container, int cols, int rows);
LUMENT_API void lument_ui_set_alignment(LumentWidget container, int align);  // 0=start 1=center 2=end 3=stretch

// --- 事件 ---
LUMENT_API void lument_ui_on_event(LumentWidget widget, LumentEventType event, LumentEventCallback callback);
LUMENT_API void lument_ui_set_focused(LumentWidget widget);

// --- 渲染与事件处理 ---
LUMENT_API void lument_ui_render(void);
LUMENT_API bool lument_ui_handle_touch(float x, float y, int type);  // type: 0=down 1=move 2=up
LUMENT_API bool lument_ui_handle_key(LumentKey key, bool pressed);

// --- 导航 ---
LUMENT_API void lument_ui_navigate_to(LumentWidget screen);
LUMENT_API void lument_ui_navigate_back(void);
LUMENT_API LumentWidget lument_ui_get_current_screen(void);

// --- 便捷创建 ---
LUMENT_API LumentWidget lument_ui_create_button(const char* text, float x, float y, float w, float h);
LUMENT_API LumentWidget lument_ui_create_label(const char* text, float x, float y, float w, float h);
LUMENT_API LumentWidget lument_ui_create_input(const char* placeholder, float x, float y, float w, float h);

// ============================================================
// 存储 API
// ============================================================
LUMENT_API int  lument_save_data(const char* key, const char* data);
LUMENT_API const char* lument_load_data(const char* key);
LUMENT_API int  lument_clear_data(const char* key);

// ============================================================
// 工具 API
// ============================================================
LUMENT_API uint64_t lument_get_time_ms(void);
LUMENT_API float    lument_random(void);          // 0.0 ~ 1.0
LUMENT_API float    lument_random_range(float min, float max);
LUMENT_API void     lument_log(const char* message);

// ============================================================
// 2D 物理模拟 API
// 提供刚体物理、碰撞检测、自定义阻尼、重力控制
// ============================================================

// --- 物理世界 ---
LUMENT_API void lument_physics_set_gravity(float gx, float gy);
LUMENT_API void lument_physics_get_gravity(float* gx, float* gy);
LUMENT_API void lument_physics_set_iterations(int velocityIter, int positionIter);
LUMENT_API void lument_physics_step(float dt);                        // 步进物理世界
LUMENT_API void lument_physics_reset(void);                           // 清空所有物理体

// --- 物理体管理 ---
LUMENT_API int  lument_physics_create_body(const LumentBodyDef* def, float x, float y);
LUMENT_API void lument_physics_destroy_body(int bodyId);
LUMENT_API void lument_physics_set_shape(int bodyId, LumentShape shape);
LUMENT_API void lument_physics_set_mass(int bodyId, float mass);
LUMENT_API void lument_physics_set_restitution(int bodyId, float restitution);
LUMENT_API void lument_physics_set_friction(int bodyId, float friction);
LUMENT_API void lument_physics_set_gravity_scale(int bodyId, float scale);
LUMENT_API void lument_physics_set_damping(int bodyId, float linear, float angular);

// --- 自定义阻尼 ---
LUMENT_API void lument_physics_set_custom_damping(int bodyId, LumentDampingFunc func, void* userData);
LUMENT_API void lument_physics_clear_custom_damping(int bodyId);

// --- 物理体状态 ---
LUMENT_API void lument_physics_get_state(int bodyId, LumentBodyState* state);
LUMENT_API void lument_physics_set_state(int bodyId, const LumentBodyState* state);
LUMENT_API void lument_physics_get_position(int bodyId, float* x, float* y);
LUMENT_API void lument_physics_set_position(int bodyId, float x, float y);
LUMENT_API void lument_physics_get_velocity(int bodyId, float* vx, float* vy);
LUMENT_API void lument_physics_set_velocity(int bodyId, float vx, float vy);
LUMENT_API void lument_physics_apply_force(int bodyId, float fx, float fy);
LUMENT_API void lument_physics_apply_impulse(int bodyId, float ix, float iy);
LUMENT_API void lument_physics_apply_torque(int bodyId, float torque);
LUMENT_API void lument_physics_apply_angular_impulse(int bodyId, float impulse);

// --- 碰撞检测 ---
LUMENT_API bool lument_physics_check_collision(int bodyA, int bodyB, LumentCollision* outCollision);
LUMENT_API int  lument_physics_get_collisions(int bodyId, LumentCollision* outCollisions, int maxCount);
LUMENT_API bool lument_physics_raycast(float x1, float y1, float x2, float y2,
                                       LumentCollision* outHit, int* outBodyId);
LUMENT_API bool lument_physics_point_query(float x, float y, int* outBodyId);

// --- 碰撞回调 ---
typedef void (*LumentCollisionCallback)(const LumentCollision* collision, void* userData);
LUMENT_API void lument_physics_on_collision(LumentCollisionCallback callback, void* userData);

// ============================================================
// 增强音频 API
// 支持主流音频格式（MP3/WAV/OGG），3D空间音频，音效处理
// ============================================================

// --- 音频加载（自动识别格式） ---
LUMENT_API uint32_t lument_load_sound(const char* path);              // 加载音效
LUMENT_API uint32_t lument_load_music(const char* path);             // 加载背景音乐
LUMENT_API const char* lument_get_supported_formats(void);           // 返回支持的格式列表

// --- 播放控制 ---
LUMENT_API uint32_t lument_play_sound(uint32_t id, float volume, float pitch, bool loop);
LUMENT_API void     lument_stop_sound(uint32_t instanceId);
LUMENT_API void     lument_pause_sound(uint32_t instanceId);
LUMENT_API void     lument_resume_sound(uint32_t instanceId);
LUMENT_API void     lument_set_pitch(uint32_t instanceId, float pitch);
LUMENT_API void     lument_set_pan(uint32_t instanceId, float pan);  // -1.0(左) ~ 1.0(右)
LUMENT_API float    lument_get_audio_duration(uint32_t id);          // 秒
LUMENT_API float    lument_get_audio_position(uint32_t instanceId);  // 秒
LUMENT_API void     lument_seek_audio(uint32_t instanceId, float position); // 秒
LUMENT_API void     lument_fade_in(uint32_t instanceId, float duration);    // 秒
LUMENT_API void     lument_fade_out(uint32_t instanceId, float duration);   // 秒

// --- 3D 空间音频 ---
LUMENT_API void lument_set_audio_listener(float x, float y, float dirX, float dirY);
LUMENT_API uint32_t lument_play_sound_3d(uint32_t id, float x, float y,
                                         float maxDist, float volume, bool loop);

// --- 音频分组 ---
LUMENT_API void lument_set_master_volume(float volume);
LUMENT_API void lument_set_group_volume(int groupId, float volume);  // 0=SFX 1=Music 2=Voice
LUMENT_API void lument_stop_group(int groupId);

// ============================================================
// 网络模块 API
// HTTP请求、WebSocket、JSON工具，供厂商接入账户系统与数据同步
// ============================================================

// --- HTTP 请求 ---
LUMENT_API int  lument_http_request(LumentHttpMethod method, const char* url,
                                    const char* body, const char* headers,
                                    LumentHttpCallback callback, void* userData);
LUMENT_API int  lument_http_get(const char* url, LumentHttpCallback callback, void* userData);
LUMENT_API int  lument_http_post(const char* url, const char* body,
                                 LumentHttpCallback callback, void* userData);
LUMENT_API int  lument_http_put(const char* url, const char* body,
                                LumentHttpCallback callback, void* userData);
LUMENT_API int  lument_http_delete(const char* url, LumentHttpCallback callback, void* userData);
LUMENT_API void lument_http_cancel(int requestId);
LUMENT_API void lument_http_set_header(const char* key, const char* value);  // 全局请求头
LUMENT_API void lument_http_set_timeout(int seconds);
LUMENT_API void lument_http_set_auth_token(const char* token);  // Bearer token

// --- WebSocket ---
LUMENT_API int  lument_ws_connect(const char* url, LumentWsCallback callback, void* userData);
LUMENT_API void lument_ws_send(int wsId, const char* data, int length);
LUMENT_API void lument_ws_send_text(int wsId, const char* text);
LUMENT_API void lument_ws_close(int wsId);
LUMENT_API bool lument_ws_is_connected(int wsId);

// --- JSON 工具 ---
LUMENT_API const char* lument_json_parse(const char* json, const char* key);  // 获取字符串值
LUMENT_API float       lument_json_get_number(const char* json, const char* key, float defVal);
LUMENT_API bool        lument_json_get_bool(const char* json, const char* key, bool defVal);
LUMENT_API const char* lument_json_build(const char* pairs);  // 从 key=value\n 构建 JSON

// --- 数据同步辅助 ---
LUMENT_API int  lument_upload_data(const char* url, const char* jsonData,
                                   LumentHttpCallback callback, void* userData);
LUMENT_API int  lument_download_data(const char* url,
                                     LumentHttpCallback callback, void* userData);

// ============================================================
// AI 模块 API
// 行为树、状态机、寻路、黑板系统，供AI深度开发使用
// ============================================================

// --- 行为树 ---
LUMENT_API int  lument_ai_create_tree(void);
LUMENT_API void lument_ai_destroy_tree(int treeId);
LUMENT_API int  lument_ai_create_node(int treeId, LumentAiNodeType type,
                                      LumentAiNodeFunc func, void* userData);
LUMENT_API void lument_ai_add_child(int parentId, int childId);
LUMENT_API void lument_ai_set_entity(int treeId, LumentEntity entity);
LUMENT_API LumentAiStatus lument_ai_tick(int treeId, float dt);

// --- 有限状态机 ---
LUMENT_API int  lument_ai_create_fsm(void);
LUMENT_API void lument_ai_destroy_fsm(int fsmId);
LUMENT_API int  lument_ai_fsm_add_state(int fsmId, const char* name,
                                        LumentAiNodeFunc onUpdate, void* userData);
LUMENT_API void lument_ai_fsm_add_transition(int fsmId, int fromState, int toState,
                                             LumentAiNodeFunc condition, void* userData);
LUMENT_API void lument_ai_fsm_set_state(int fsmId, int stateId);
LUMENT_API int  lument_ai_fsm_get_state(int fsmId);
LUMENT_API void lument_ai_fsm_tick(int fsmId, float dt);
LUMENT_API const char* lument_ai_fsm_get_state_name(int fsmId);

// --- A* 寻路 ---
LUMENT_API int  lument_ai_create_grid(int width, int height, float cellSize);
LUMENT_API void lument_ai_destroy_grid(int gridId);
LUMENT_API void lument_ai_grid_set_blocked(int gridId, int x, int y, bool blocked);
LUMENT_API bool lument_ai_grid_is_blocked(int gridId, int x, int y);
LUMENT_API void lument_ai_grid_set_cost(int gridId, int x, int y, float cost);
LUMENT_API int  lument_ai_find_path(int gridId, int startX, int startY,
                                    int endX, int endY,
                                    LumentGridPos* outPath, int maxPathLen);
LUMENT_API float lument_ai_path_length(LumentGridPos* path, int pathLen);

// --- 黑板系统（AI共享数据存储） ---
LUMENT_API int  lument_ai_create_blackboard(void);
LUMENT_API void lument_ai_bb_set_int(int bbId, const char* key, int value);
LUMENT_API void lument_ai_bb_set_float(int bbId, const char* key, float value);
LUMENT_API void lument_ai_bb_set_string(int bbId, const char* key, const char* value);
LUMENT_API void lument_ai_bb_set_bool(int bbId, const char* key, bool value);
LUMENT_API int  lument_ai_bb_get_int(int bbId, const char* key, int defVal);
LUMENT_API float lument_ai_bb_get_float(int bbId, const char* key, float defVal);
LUMENT_API const char* lument_ai_bb_get_string(int bbId, const char* key);
LUMENT_API bool lument_ai_bb_get_bool(int bbId, const char* key, bool defVal);
LUMENT_API void lument_ai_bb_remove(int bbId, const char* key);
LUMENT_API void lument_ai_bb_clear(int bbId);

// --- AI Agent 接口（供外部AI/LLM调用） ---
LUMENT_API int  lument_ai_register_agent(const char* name, LumentAiNodeFunc think, void* userData);
LUMENT_API void lument_ai_unregister_agent(int agentId);
LUMENT_API void lument_ai_agent_set_target(int agentId, LumentEntity target);
LUMENT_API LumentEntity lument_ai_agent_get_target(int agentId);
LUMENT_API void lument_ai_agent_tick(int agentId, float dt);
LUMENT_API const char* lument_ai_agent_query(const char* query);  // AI查询引擎状态

#ifdef __cplusplus
}
#endif

#endif // LUMENT_H
