// ============================================================
// engine_jni.cpp - Lument JNI bridge
//
// Implements every `native` method declared by the Java binding
// classes in com.lument.engine (and the Android-specific
// com.lument.engine.android.AndroidEngine) by forwarding to the
// C ABI declared in lument.h.
//
// This translation unit is compiled into the SAME shared library as
// the engine core (liblument.so) - this is required for two
// reasons:
//   1. The Java side loads it via System.loadLibrary("lument"),
//      expecting the JNI symbols to live in that .so.
//   2. Android input is fed through the engine-internal injection
//      points in namespace `ue` (lument_internal.h documents these as
//      "供宿主 C++ 绑定调用" / for host C++ bindings to call). Those
//      symbols have hidden visibility, so they only resolve within the
//      same binary. The public C ABI has no input setters, so on
//      Android the host must feed input through these internal hooks.
//
// The build must add the engine's include directory (core/include) to
// the include path; the relative include below is a fallback.
// ============================================================

#include <jni.h>

#include <cstdint>
#include <unordered_map>

// The public header uses the `LUMENT_API` export macro without defining it
// (lument_internal.h defines it for the engine core). Provide a harmless fallback
// so the declarations resolve here.
#ifndef LUMENT_API
#define LUMENT_API
#endif

// Engine public C ABI. Relative path from bindings/java/jni/ -> core/include/.
#include "../../../core/include/lument.h"

// ------------------------------------------------------------------
// Engine-internal input injection points.
//
// The public C ABI only exposes input *getters*. On Android the touch / key
// events arrive on the Java side (GLSurfaceView) and must be pushed into the
// engine. lument_internal.h declares the following functions in namespace `ue`
// and explicitly notes them as "供宿主 C++ 绑定调用" (for host C++ bindings
// to call). We forward-declare only the ones we need instead of pulling the
// full internal header; their authoritative declarations live in
// core/include/lument_internal.h.
// ------------------------------------------------------------------
namespace ue {
void input_set_key(LumentKey key, bool down);
void input_clear_touches();
void input_add_touch(float x, float y);
void input_set_joystick(float x, float y);
}

// Android platform headers are only available when building for Android with
// the NDK. Guard them so the same source still compiles for desktop CI.
#if defined(__ANDROID__)
#include <android/asset_manager.h>
#include <android/asset_manager_jni.h>
#endif

namespace {

// ------------------------------------------------------------------
// Small helpers.
// ------------------------------------------------------------------

inline bool to_bool(jboolean v) { return v == JNI_TRUE; }
inline jboolean to_jbool(bool v) { return v ? JNI_TRUE : JNI_FALSE; }

// Unpacks a 0xAARRGGBB int (the layout produced by LumentColor#pack()) into the
// C ABI LumentColor struct {r, g, b, a}.
inline LumentColor unpack_color(uint32_t c) {
    LumentColor col;
    col.r = static_cast<uint8_t>((c >> 16) & 0xFF);
    col.g = static_cast<uint8_t>((c >> 8)  & 0xFF);
    col.b = static_cast<uint8_t>(c & 0xFF);
    col.a = static_cast<uint8_t>((c >> 24) & 0xFF);
    return col;
}

inline LumentRect make_rect(float x, float y, float w, float h) {
    LumentRect r;
    r.x = x; r.y = y; r.w = w; r.h = h;
    return r;
}

// ------------------------------------------------------------------
// Cached JVM + script callback registry.
//
// The C ABI registers a raw function pointer per entity (lument_set_script).
// JNI cannot present a Java object as a C function pointer, so a single
// native trampoline (jni_script_callback) is registered for every scripted
// entity and an entity id -> global-ref map dispatches back into Java.
// ------------------------------------------------------------------

JavaVM* g_jvm = nullptr;

// Lazily-cached class + method id for UpdateCallback.onUpdate(int, float).
jclass    g_updateCallbackClass = nullptr;
jmethodID g_onUpdateMethod      = nullptr;

// entity id -> global JNI ref to the Java UpdateCallback.
std::unordered_map<uint32_t, jobject> g_scripts;

#if defined(__ANDROID__)
AAssetManager* g_assetManager = nullptr;
#endif

void ensureScriptMethod(JNIEnv* env) {
    if (g_onUpdateMethod) return;
    jclass local = env->FindClass("com/lument/engine/UpdateCallback");
    if (!local) {
        env->ExceptionClear();
        return;
    }
    g_updateCallbackClass = static_cast<jclass>(env->NewGlobalRef(local));
    env->DeleteLocalRef(local);
    g_onUpdateMethod = env->GetMethodID(g_updateCallbackClass, "onUpdate", "(IF)V");
    if (!g_onUpdateMethod) env->ExceptionClear();
}

} // namespace

// All exported JNI symbols must have C linkage so the JVM can locate them by
// their unmangled names.
extern "C" {

// ------------------------------------------------------------------
// Script trampoline: invoked by the engine's update pass for a scripted
// entity. Looks up the registered Java callback and dispatches into it.
// ------------------------------------------------------------------
void jni_script_callback(uint32_t entity, float dt) {
    if (!g_jvm) return;

    JNIEnv* env = nullptr;
    bool attached = false;
    jint rc = g_jvm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    if (rc == JNI_EDETACHED) {
        // Rare path: a non-Java thread fired the callback. Attach transiently.
        // On Android the GL render thread is already attached, so this branch
        // is only hit for unusual host configurations.
        if (g_jvm->AttachCurrentThread(&env, nullptr) != JNI_OK) return;
        attached = true;
    } else if (rc != JNI_OK) {
        return;
    }

    auto it = g_scripts.find(entity);
    if (it != g_scripts.end() && it->second != nullptr) {
        ensureScriptMethod(env);
        if (g_onUpdateMethod) {
            env->CallVoidMethod(it->second, g_onUpdateMethod,
                                static_cast<jint>(entity), static_cast<jfloat>(dt));
            if (env->ExceptionCheck()) env->ExceptionClear();
        }
    }

    if (attached) g_jvm->DetachCurrentThread();
}

// ------------------------------------------------------------------
// Library load / unload hooks.
// ------------------------------------------------------------------
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /*reserved*/) {
    g_jvm = vm;
    return JNI_VERSION_1_6;
}

JNIEXPORT void JNICALL JNI_OnUnload(JavaVM* vm, void* /*reserved*/) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) return;
    for (auto& kv : g_scripts) {
        if (kv.second) env->DeleteGlobalRef(kv.second);
    }
    g_scripts.clear();
    if (g_updateCallbackClass) env->DeleteGlobalRef(g_updateCallbackClass);
    g_updateCallbackClass = nullptr;
    g_onUpdateMethod = nullptr;
}

// ============================================================
// com.lument.engine.Engine
// ============================================================

JNIEXPORT jint JNICALL Java_com_lument_Engine_nInit(
        JNIEnv* env, jclass, jint platform, jint rendererType,
        jint width, jint height, jfloat targetFPS,
        jboolean vsync, jboolean fullscreen,
        jstring assetPath, jstring savePath) {

    LumentConfig cfg;
    cfg.platform     = static_cast<LumentPlatform>(platform);
    cfg.rendererType = static_cast<LumentRendererType>(rendererType);
    cfg.width        = width;
    cfg.height       = height;
    cfg.targetFPS    = targetFPS;
    cfg.vsync        = to_bool(vsync);
    cfg.fullscreen   = to_bool(fullscreen);

    const char* ap = assetPath ? env->GetStringUTFChars(assetPath, nullptr) : nullptr;
    const char* sp = savePath  ? env->GetStringUTFChars(savePath,  nullptr) : nullptr;
    cfg.assetPath = ap;
    cfg.savePath  = sp;

    jint result = static_cast<jint>(lument_init(&cfg));

    if (ap) env->ReleaseStringUTFChars(assetPath, ap);
    if (sp) env->ReleaseStringUTFChars(savePath,  sp);

    return result;
}

JNIEXPORT void JNICALL Java_com_lument_Engine_nShutdown(JNIEnv*, jclass) {
    lument_shutdown();
}

JNIEXPORT jboolean JNICALL Java_com_lument_Engine_nIsRunning(JNIEnv*, jclass) {
    return to_jbool(lument_is_running() != 0);
}

JNIEXPORT void JNICALL Java_com_lument_Engine_nBeginFrame(JNIEnv*, jclass) {
    lument_begin_frame();
}

JNIEXPORT void JNICALL Java_com_lument_Engine_nEndFrame(JNIEnv*, jclass) {
    // The engine's end-frame copies key current->previous state and clears the
    // per-frame touch list (see lument_input.cpp), which is what makes the Android
    // input feed + edge detection work without any bridge-side bookkeeping.
    lument_end_frame();
}

JNIEXPORT jfloat JNICALL Java_com_lument_Engine_nGetDeltaTime(JNIEnv*, jclass) {
    return static_cast<jfloat>(lument_get_delta_time());
}

JNIEXPORT void JNICALL Java_com_lument_Engine_nGetStats(JNIEnv* env, jclass, jfloatArray out) {
    if (!out) return;
    if (env->GetArrayLength(out) < 5) return;
    LumentStats stats;
    lument_get_stats(&stats);
    jfloat* p = env->GetFloatArrayElements(out, nullptr);
    if (!p) return;
    p[0] = stats.fps;
    p[1] = stats.frameTime;
    p[2] = static_cast<jfloat>(stats.drawCalls);
    p[3] = static_cast<jfloat>(stats.entityCount);
    p[4] = static_cast<jfloat>(stats.memoryUsed);
    env->ReleaseFloatArrayElements(out, p, 0);
}

JNIEXPORT jint JNICALL Java_com_lument_Engine_nGetPlatform(JNIEnv*, jclass) {
    return static_cast<jint>(lument_get_platform());
}

JNIEXPORT jint JNICALL Java_com_lument_Engine_nGetRendererType(JNIEnv*, jclass) {
    return static_cast<jint>(lument_get_renderer_type());
}

JNIEXPORT jlong JNICALL Java_com_lument_Engine_nGetTimeMs(JNIEnv*, jclass) {
    return static_cast<jlong>(lument_get_time_ms());
}

JNIEXPORT jfloat JNICALL Java_com_lument_Engine_nRandom(JNIEnv*, jclass) {
    return static_cast<jfloat>(lument_random());
}

JNIEXPORT jfloat JNICALL Java_com_lument_Engine_nRandomRange(JNIEnv*, jclass, jfloat min, jfloat max) {
    return static_cast<jfloat>(lument_random_range(min, max));
}

JNIEXPORT void JNICALL Java_com_lument_Engine_nLog(JNIEnv* env, jclass, jstring message) {
    if (!message) return;
    const char* msg = env->GetStringUTFChars(message, nullptr);
    if (msg) {
        lument_log(msg);
        env->ReleaseStringUTFChars(message, msg);
    }
}

// ============================================================
// com.lument.engine.Renderer
// ============================================================

JNIEXPORT void JNICALL Java_com_lument_Renderer_nClear(JNIEnv*, jclass, jint color) {
    lument_clear(unpack_color(static_cast<uint32_t>(color)));
}

JNIEXPORT void JNICALL Java_com_lument_Renderer_nSetCamera(JNIEnv*, jclass, jfloat x, jfloat y, jfloat zoom) {
    lument_set_camera(x, y, zoom);
}

JNIEXPORT void JNICALL Java_com_lument_Renderer_nDrawRect(
        JNIEnv*, jclass, jfloat x, jfloat y, jfloat w, jfloat h,
        jint color, jboolean filled) {
    lument_draw_rect(make_rect(x, y, w, h), unpack_color(static_cast<uint32_t>(color)),
                 to_bool(filled));
}

JNIEXPORT void JNICALL Java_com_lument_Renderer_nDrawSprite(
        JNIEnv*, jclass, jint textureId,
        jfloat dx, jfloat dy, jfloat dw, jfloat dh,
        jfloat sx, jfloat sy, jfloat sw, jfloat sh) {
    lument_draw_sprite(static_cast<uint32_t>(textureId),
                   make_rect(dx, dy, dw, dh),
                   make_rect(sx, sy, sw, sh));
}

JNIEXPORT void JNICALL Java_com_lument_Renderer_nDrawText(
        JNIEnv* env, jclass, jstring text, jfloat x, jfloat y, jfloat size, jint color) {
    if (!text) return;
    const char* str = env->GetStringUTFChars(text, nullptr);
    if (str) {
        lument_draw_text(str, x, y, size, unpack_color(static_cast<uint32_t>(color)));
        env->ReleaseStringUTFChars(text, str);
    }
}

JNIEXPORT void JNICALL Java_com_lument_Renderer_nDrawPixel(
        JNIEnv*, jclass, jint x, jint y, jint color) {
    lument_draw_pixel(x, y, unpack_color(static_cast<uint32_t>(color)));
}

JNIEXPORT void JNICALL Java_com_lument_Renderer_nFlush(JNIEnv*, jclass) {
    lument_flush();
}

JNIEXPORT jint JNICALL Java_com_lument_Renderer_nLoadTexture(JNIEnv* env, jclass, jstring path) {
    if (!path) return 0;
    const char* p = env->GetStringUTFChars(path, nullptr);
    if (!p) return 0;
    uint32_t id = lument_load_texture(p);
    env->ReleaseStringUTFChars(path, p);
    return static_cast<jint>(id);
}

JNIEXPORT jint JNICALL Java_com_lument_Renderer_nCreateTextureFromData(
        JNIEnv* env, jclass, jint width, jint height, jbyteArray rgba) {
    if (!rgba) return 0;
    jsize len = env->GetArrayLength(rgba);
    jbyte* data = env->GetByteArrayElements(rgba, nullptr);
    if (!data) return 0;
    uint32_t id = lument_create_texture_from_data(width, height,
            reinterpret_cast<const uint8_t*>(data));
    // JNI_ABORT: we did not modify the buffer.
    env->ReleaseByteArrayElements(rgba, data, JNI_ABORT);
    (void)len;
    return static_cast<jint>(id);
}

JNIEXPORT void JNICALL Java_com_lument_Renderer_nDestroyTexture(JNIEnv*, jclass, jint id) {
    lument_destroy_texture(static_cast<uint32_t>(id));
}

// ============================================================
// com.lument.engine.Input
//
// Pure read-only access to the engine's input state. On desktop the engine
// polls its own windowing system; on Android the host feeds the same state
// through the ue::input_set_* hooks (see the AndroidEngine section below).
// Either way, these getters just query the C ABI - no platform branching.
// ============================================================

JNIEXPORT jboolean JNICALL Java_com_lument_Input_nKeyDown(JNIEnv*, jclass, jint key) {
    return to_jbool(lument_key_down(static_cast<LumentKey>(key)));
}

JNIEXPORT jboolean JNICALL Java_com_lument_Input_nKeyPressed(JNIEnv*, jclass, jint key) {
    return to_jbool(lument_key_pressed(static_cast<LumentKey>(key)));
}

JNIEXPORT jint JNICALL Java_com_lument_Input_nGetTouchCount(JNIEnv*, jclass) {
    return static_cast<jint>(lument_get_touch_count());
}

JNIEXPORT void JNICALL Java_com_lument_Input_nGetTouch(
        JNIEnv* env, jclass, jint index, jfloatArray outPos) {
    if (!outPos || env->GetArrayLength(outPos) < 2) return;
    LumentVec2 pos;
    lument_get_touch(index, &pos);
    jfloat* p = env->GetFloatArrayElements(outPos, nullptr);
    if (!p) return;
    p[0] = pos.x;
    p[1] = pos.y;
    env->ReleaseFloatArrayElements(outPos, p, 0);
}

JNIEXPORT jfloat JNICALL Java_com_lument_Input_nGetJoystickX(JNIEnv*, jclass) {
    return static_cast<jfloat>(lument_get_joystick_x());
}

JNIEXPORT jfloat JNICALL Java_com_lument_Input_nGetJoystickY(JNIEnv*, jclass) {
    return static_cast<jfloat>(lument_get_joystick_y());
}

// ============================================================
// com.lument.engine.Audio
// ============================================================

JNIEXPORT jint JNICALL Java_com_lument_Audio_nLoadAudio(JNIEnv* env, jclass, jstring path, jboolean isMusic) {
    if (!path) return 0;
    const char* p = env->GetStringUTFChars(path, nullptr);
    if (!p) return 0;
    uint32_t id = lument_load_audio(p, to_bool(isMusic));
    env->ReleaseStringUTFChars(path, p);
    return static_cast<jint>(id);
}

JNIEXPORT void JNICALL Java_com_lument_Audio_nPlayAudio(JNIEnv*, jclass, jint id, jboolean loop) {
    lument_play_audio(static_cast<uint32_t>(id), to_bool(loop));
}

JNIEXPORT void JNICALL Java_com_lument_Audio_nStopAudio(JNIEnv*, jclass, jint id) {
    lument_stop_audio(static_cast<uint32_t>(id));
}

JNIEXPORT void JNICALL Java_com_lument_Audio_nSetVolume(JNIEnv*, jclass, jint id, jfloat volume) {
    lument_set_volume(static_cast<uint32_t>(id), volume);
}

JNIEXPORT void JNICALL Java_com_lument_Audio_nStopAllAudio(JNIEnv*, jclass) {
    lument_stop_all_audio();
}

// ============================================================
// com.lument.engine.ECS
// ============================================================

JNIEXPORT jint JNICALL Java_com_lument_ECS_nCreateEntity(JNIEnv*, jclass) {
    return static_cast<jint>(lument_create_entity());
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nDestroyEntity(JNIEnv*, jclass, jint entity) {
    lument_destroy_entity(static_cast<LumentEntity>(entity));
}

JNIEXPORT jboolean JNICALL Java_com_lument_ECS_nEntityAlive(JNIEnv*, jclass, jint entity) {
    return to_jbool(lument_entity_alive(static_cast<LumentEntity>(entity)));
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nSetPosition(JNIEnv*, jclass, jint entity, jfloat x, jfloat y) {
    lument_set_position(static_cast<LumentEntity>(entity), x, y);
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nGetPosition(JNIEnv* env, jclass, jint entity, jfloatArray outPos) {
    if (!outPos || env->GetArrayLength(outPos) < 2) return;
    LumentVec2 pos;
    lument_get_position(static_cast<LumentEntity>(entity), &pos);
    jfloat* p = env->GetFloatArrayElements(outPos, nullptr);
    if (!p) return;
    p[0] = pos.x;
    p[1] = pos.y;
    env->ReleaseFloatArrayElements(outPos, p, 0);
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nSetScale(JNIEnv*, jclass, jint entity, jfloat sx, jfloat sy) {
    lument_set_scale(static_cast<LumentEntity>(entity), sx, sy);
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nSetSprite(JNIEnv*, jclass, jint entity, jint textureId, jfloat w, jfloat h) {
    lument_set_sprite(static_cast<LumentEntity>(entity), static_cast<uint32_t>(textureId), w, h);
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nSetSpriteColor(JNIEnv*, jclass, jint entity, jint color) {
    lument_set_sprite_color(static_cast<LumentEntity>(entity), unpack_color(static_cast<uint32_t>(color)));
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nSetVisible(JNIEnv*, jclass, jint entity, jboolean visible) {
    lument_set_visible(static_cast<LumentEntity>(entity), to_bool(visible));
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nSetCollider(JNIEnv*, jclass, jint entity, jfloat w, jfloat h) {
    lument_set_collider(static_cast<LumentEntity>(entity), w, h);
}

JNIEXPORT jboolean JNICALL Java_com_lument_ECS_nCheckCollision(JNIEnv*, jclass, jint a, jint b) {
    return to_jbool(lument_check_collision(static_cast<LumentEntity>(a), static_cast<LumentEntity>(b)));
}

JNIEXPORT void JNICALL Java_com_lument_ECS_nSetScript(JNIEnv* env, jclass, jint entity, jobject callback) {
    uint32_t e = static_cast<uint32_t>(entity);

    // Remove any previously registered callback for this entity.
    auto it = g_scripts.find(e);
    if (it != g_scripts.end()) {
        if (it->second) env->DeleteGlobalRef(it->second);
        g_scripts.erase(it);
    }

    if (callback != nullptr) {
        jobject global = env->NewGlobalRef(callback);
        if (global) {
            g_scripts[e] = global;
        }
        // Register the native trampoline; it dispatches back into Java via the
        // entity id -> callback map.
        lument_set_script(static_cast<LumentEntity>(e), &jni_script_callback);
    } else {
        lument_set_script(static_cast<LumentEntity>(e), nullptr);
    }
}

// ============================================================
// com.lument.engine.SceneManager
// ============================================================

JNIEXPORT jint JNICALL Java_com_lument_SceneManager_nLoadScene(JNIEnv* env, jclass, jstring name) {
    if (!name) return 0;
    const char* n = env->GetStringUTFChars(name, nullptr);
    if (!n) return 0;
    int id = lument_load_scene(n);
    env->ReleaseStringUTFChars(name, n);
    return static_cast<jint>(id);
}

JNIEXPORT void JNICALL Java_com_lument_SceneManager_nSetActiveScene(JNIEnv*, jclass, jint sceneId) {
    lument_set_active_scene(sceneId);
}

JNIEXPORT jint JNICALL Java_com_lument_SceneManager_nGetActiveScene(JNIEnv*, jclass) {
    return static_cast<jint>(lument_get_active_scene());
}

JNIEXPORT void JNICALL Java_com_lument_SceneManager_nSceneSetBackground(JNIEnv*, jclass, jint color) {
    lument_scene_set_background(unpack_color(static_cast<uint32_t>(color)));
}

// ============================================================
// com.lument.engine.Storage
// ============================================================

JNIEXPORT jint JNICALL Java_com_lument_Storage_nSaveData(JNIEnv* env, jclass, jstring key, jstring data) {
    if (!key || !data) return 0;
    const char* k = env->GetStringUTFChars(key, nullptr);
    const char* d = env->GetStringUTFChars(data, nullptr);
    int result = 0;
    if (k && d) {
        result = lument_save_data(k, d);
    }
    if (k) env->ReleaseStringUTFChars(key, k);
    if (d) env->ReleaseStringUTFChars(data, d);
    return static_cast<jint>(result);
}

JNIEXPORT jstring JNICALL Java_com_lument_Storage_nLoadData(JNIEnv* env, jclass, jstring key) {
    if (!key) return nullptr;
    const char* k = env->GetStringUTFChars(key, nullptr);
    if (!k) return nullptr;
    // lument_load_data returns a const char* whose storage may be invalidated by
    // the next storage call, so copy it into a Java String immediately.
    const char* result = lument_load_data(k);
    env->ReleaseStringUTFChars(key, k);
    if (!result) return nullptr;
    return env->NewStringUTF(result);
}

JNIEXPORT jint JNICALL Java_com_lument_Storage_nClearData(JNIEnv* env, jclass, jstring key) {
    if (!key) return 0;
    const char* k = env->GetStringUTFChars(key, nullptr);
    if (!k) return 0;
    int result = lument_clear_data(k);
    env->ReleaseStringUTFChars(key, k);
    return static_cast<jint>(result);
}

// ============================================================
// com.lument.engine.android.AndroidEngine (Android glue)
//
// The host feeds Android touch / key / joystick samples into the engine
// through the ue::input_set_* injection points. The engine clears its
// per-frame touch list at end_frame, so AndroidEngine pushes the current
// touch snapshot once per frame (from feedInput, called at frame start) so
// held fingers remain visible. Key state and joystick axes persist across
// frames, so they are pushed as events arrive.
// ============================================================

JNIEXPORT void JNICALL Java_com_lument_android_AndroidEngine_nSetAssetManager(
        JNIEnv* env, jclass, jobject assetManager) {
#if defined(__ANDROID__)
    g_assetManager = assetManager ? AAssetManager_fromJava(env, assetManager) : nullptr;
#else
    (void)env;
    (void)assetManager;
#endif
}

JNIEXPORT void JNICALL Java_com_lument_android_AndroidEngine_nSetJoystick(
        JNIEnv*, jclass, jfloat x, jfloat y) {
    ue::input_set_joystick(x, y);
}

JNIEXPORT void JNICALL Java_com_lument_android_AndroidEngine_nSetTouches(
        JNIEnv* env, jclass, jint count, jfloatArray xs, jfloatArray ys) {
    // The engine clears its own touch list at end_frame; clearing again here
    // is harmless and guarantees a clean slate before re-adding the snapshot.
    ue::input_clear_touches();
    if (count <= 0) return;

    jfloat* px = xs ? env->GetFloatArrayElements(xs, nullptr) : nullptr;
    jfloat* py = ys ? env->GetFloatArrayElements(ys, nullptr) : nullptr;
    int nx = px ? env->GetArrayLength(xs) : 0;
    int ny = py ? env->GetArrayLength(ys) : 0;

    int n = count;
    if (n > nx) n = nx;
    if (n > ny) n = ny;
    for (int i = 0; i < n; ++i) {
        ue::input_add_touch(px[i], py[i]);
    }

    if (px) env->ReleaseFloatArrayElements(xs, px, JNI_ABORT);
    if (py) env->ReleaseFloatArrayElements(ys, py, JNI_ABORT);
}

JNIEXPORT void JNICALL Java_com_lument_android_AndroidEngine_nSetKey(
        JNIEnv*, jclass, jint key, jboolean down) {
    ue::input_set_key(static_cast<LumentKey>(key), to_bool(down));
}

} // extern "C"

// ------------------------------------------------------------------
// C accessor for the engine's Android platform layer. The native engine
// cannot reach the Java AssetManager directly, so its Android file-IO layer
// is expected to call this bridge function to open APK assets. No-op on
// non-Android builds.
// ------------------------------------------------------------------
#if defined(__ANDROID__)
extern "C" AAssetManager* lument_bridge_get_asset_manager(void) {
    return g_assetManager;
}
#endif
