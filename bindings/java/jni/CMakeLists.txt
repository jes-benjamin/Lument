# ============================================================
# CMakeLists.txt - JNI bridge build for Lument (Android)
# ------------------------------------------------------------
# Builds a SINGLE shared library `liblument.so` that
# contains BOTH:
#
#   1. The engine core (core/src/*.cpp)   - the C ABI + internal
#      ue::input_set_* injection points (hidden visibility).
#   2. The JNI bridge (engine_jni.cpp)     - implements every
#      `native` method declared by the Java binding classes.
#
# WHY THE SAME LIBRARY?
#   The public C ABI only exposes input *getters*.  On Android,
#   touch / key / joystick events arrive on the Java side and
#   must be pushed into the engine through the internal hooks
#   ue::input_set_key / ue::input_clear_touches / ue::input_add_touch
#   / ue::input_set_joystick.  Those symbols have hidden
#   visibility (CXX_VISIBILITY_PRESET hidden in the engine core),
#   so they are NOT exported from the .so.  The only way the JNI
#   bridge can call them is to be linked into the same binary.
#
#   The JNI entry points themselves (Java_com_lument_*)
#   are declared with JNIEXPORT which applies
#   __attribute__((visibility("default"))), so the JVM can still
#   resolve them by name despite the global hidden-visibility
#   preset.
#
# Java loads the result via:
#   System.loadLibrary("lument");
#
# INVOKE (standalone, for testing the native build):
#   cmake -S . -B build-android \
#     -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
#     -DANDROID_ABI=arm64-v8a \
#     -DANDROID_PLATFORM=android-21
#   cmake --build build-android -j
#
# INVOKE (from Gradle):
#   The Android `build.gradle` in platforms/android/ points its
#   externalNativeBuild.cmake.path at this file.
# ============================================================

cmake_minimum_required(VERSION 3.13)

project(lument_jni LANGUAGES C CXX VERSION 1.0.0)

# ---------- C++ standard ----------
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ---------- Engine root ----------
# This file lives at  bindings/java/jni/CMakeLists.txt
# The engine root (containing core/) is three levels up.
get_filename_component(LUMENT_ENGINE_ROOT
    "${CMAKE_CURRENT_SOURCE_DIR}/../../.." ABSOLUTE)

# ---------- Sources ----------
# Engine core sources (same set as the top-level CMakeLists.txt).
set(LUMENT_CORE_SOURCES
    "${LUMENT_ENGINE_ROOT}/core/src/lument_core.cpp"
    "${LUMENT_ENGINE_ROOT}/core/src/lument_renderer.cpp"
    "${LUMENT_ENGINE_ROOT}/core/src/lument_input.cpp"
    "${LUMENT_ENGINE_ROOT}/core/src/lument_audio.cpp"
    "${LUMENT_ENGINE_ROOT}/core/src/lument_ecs.cpp"
    "${LUMENT_ENGINE_ROOT}/core/src/lument_scene.cpp"
    "${LUMENT_ENGINE_ROOT}/core/src/lument_storage.cpp"
    "${LUMENT_ENGINE_ROOT}/core/src/lument_utils.cpp")

# JNI bridge source.
set(LUMENT_JNI_SOURCES
    "${CMAKE_CURRENT_SOURCE_DIR}/engine_jni.cpp")

# ---------- Build options ----------
option(LUMENT_MAX_ENTITIES "Maximum entity count (sparse-set capacity)" 16384)

# ---------- The library ----------
# A single SHARED library so the JNI bridge can call the engine's
# hidden-visibility ue::input_set_* symbols.
add_library(lument SHARED
    ${LUMENT_CORE_SOURCES}
    ${LUMENT_JNI_SOURCES})

set_target_properties(lument PROPERTIES
    OUTPUT_NAME lument
    # Hidden visibility for the engine core.  JNIEXPORT overrides this
    # for the JNI entry points, and LUMENT_API (default visibility) overrides
    # this for the public C ABI functions.
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    POSITION_INDEPENDENT_CODE ON)

# ---------- Include directories ----------
# core/include holds both the public C ABI header (lument.h)
# and the internal headers (lument_internal.h, lument_renderer_backend.h).
target_include_directories(lument
    PRIVATE "${LUMENT_ENGINE_ROOT}/core/include")

# ---------- Compile definitions ----------
# LUMENT_BUILDING_DLL  -> makes lument_internal.h export the public C ABI (LUMENT_API).
# LUMENT_MAX_ENTITIES  -> sparse-set capacity, must match the engine core.
target_compile_definitions(lument PRIVATE
    LUMENT_BUILDING_DLL
    LUMENT_MAX_ENTITIES=${LUMENT_MAX_ENTITIES})

# ---------- Android platform / renderer backend ----------
# On Android NDK, ANDROID is defined by the toolchain.  Enable the
# OpenGL ES 2.0 renderer backend and link the platform libraries.
if(ANDROID)
    target_compile_definitions(lument PRIVATE LUMENT_BACKEND_GLES2)

    target_link_libraries(lument PRIVATE
        GLESv2      # OpenGL ES 2.0 implementation
        log         # android/log.h, __android_log_print
        android     # android/asset_manager.h, AAssetManager
    )
endif()

# ---------- Math / thread libs (non-Android fallback for CI) ----------
if(UNIX AND NOT ANDROID)
    target_link_libraries(lument PRIVATE m)
endif()

set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads)
if(Threads_FOUND)
    target_link_libraries(lument PRIVATE Threads::Threads)
endif()

# ---------- Warnings ----------
if(NOT MSVC)
    target_compile_options(lument PRIVATE
        -Wall -Wextra -Wno-unused-parameter -Wno-unused-function)
else()
    target_compile_options(lument PRIVATE /W3)
endif()
