# ============================================================
# CMakeLists.txt - Lument 构建脚本
# ------------------------------------------------------------
# 构建为共享库：
#   Linux/macOS : liblument.so / .dylib
#   Windows     : lument.dll (+ lument.lib)
#   Emscripten  : 静态库（Web 平台通常打包为 wasm 模块）
#
# 跨平台：
#   - 桌面 (Linux/Windows/macOS)：默认使用空渲染后端（无外部依赖即可编译）
#   - Android NDK：自动启用 OpenGL ES 2.0 后端，链接 GLESv2/log/android
#   - Emscripten ：自动启用 WebGL(GLES2) 后端
#
# === Android NDK 交叉编译示例 ===
#   cmake -S . -B build-android \
#     -DCMAKE_TOOLCHAIN_FILE=$ANDROID_NDK/build/cmake/android.toolchain.cmake \
#     -DANDROID_ABI=arm64-v8a \
#     -DANDROID_PLATFORM=android-21 \
#     -DCMAKE_BUILD_TYPE=Release
#   cmake --build build-android -j
#
# === Emscripten 示例 ===
#   emcmake cmake -S . -B build-web -DCMAKE_BUILD_TYPE=Release
#   cmake --build build-web -j
# ============================================================
cmake_minimum_required(VERSION 3.13)
project(Lument LANGUAGES C CXX VERSION 1.0.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# ---------- 选项 ----------
option(LUMENT_BUILD_SHARED "构建为共享库（关闭则构建静态库）" ON)
option(LUMENT_ENABLE_GLES2 "启用 OpenGL ES 2.0 / WebGL 渲染后端" OFF)
set(LUMENT_MAX_ENTITIES 16384 CACHE STRING "最大实体数（稀疏集合 sparse 数组容量）")
set(LUMENT_MAX_WIDGETS 4096 CACHE STRING "最大 UI 控件数（对象池容量）")

# Android / Emscripten 默认启用 GLES2
if(ANDROID OR EMSCRIPTEN)
    set(LUMENT_ENABLE_GLES2 ON CACHE BOOL "" FORCE)
endif()
# Emscripten 不支持传统共享库，改用静态库
if(EMSCRIPTEN)
    set(LUMENT_BUILD_SHARED OFF CACHE BOOL "" FORCE)
endif()

# ---------- 源文件 ----------
set(LUMENT_SOURCES
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_core.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_renderer.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_input.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_audio.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_ecs.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_scene.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_ui.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_storage.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_utils.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_physics.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_network.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/core/src/lument_ai.cpp
)

if(LUMENT_BUILD_SHARED)
    set(LUMENT_LIB_TYPE SHARED)
else()
    set(LUMENT_LIB_TYPE STATIC)
endif()

add_library(lument ${LUMENT_LIB_TYPE} ${LUMENT_SOURCES})
set_target_properties(lument PROPERTIES
    OUTPUT_NAME lument
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    POSITION_INDEPENDENT_CODE ON)

# 头文件目录（公共 + 内部均位于 core/include）
target_include_directories(lument
    PUBLIC  $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/core/include>
            $<INSTALL_INTERFACE:include>
    PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/core/include)

# 编译期定义
target_compile_definitions(lument PRIVATE
    LUMENT_BUILDING_DLL
    LUMENT_MAX_ENTITIES=${LUMENT_MAX_ENTITIES}
    LUMENT_MAX_WIDGETS=${LUMENT_MAX_WIDGETS})

if(NOT MSVC)
    target_compile_options(lument PRIVATE
        -Wall -Wextra -Wno-unused-parameter -Wno-unused-function)
else()
    target_compile_options(lument PRIVATE /W3)
endif()

# ---------- 平台 / 渲染后端处理 ----------
set(LUMENT_HAVE_GLES2 OFF)

if(LUMENT_ENABLE_GLES2)
    if(ANDROID)
        set(LUMENT_HAVE_GLES2 ON)
    elseif(EMSCRIPTEN)
        set(LUMENT_HAVE_GLES2 ON)
    else()
        # 桌面：尝试发现 Mesa 提供的 GLES2 头与库
        find_path(LUMENT_GLES2_INCLUDE_DIR NAMES GLES2/gl2.h)
        find_library(LUMENT_GLES2_LIBRARY NAMES GLESv2)
        if(LUMENT_GLES2_INCLUDE_DIR AND LUMENT_GLES2_LIBRARY)
            set(LUMENT_HAVE_GLES2 ON)
        else()
            message(WARNING
                "LUMENT_ENABLE_GLES2=ON 但未找到 GLES2 头/库（尝试安装 libgles2-mesa-dev），"
                "回退到空渲染后端。")
        endif()
    endif()
endif()

if(LUMENT_HAVE_GLES2)
    target_compile_definitions(lument PRIVATE LUMENT_BACKEND_GLES2)
    if(ANDROID)
        target_link_libraries(lument PRIVATE GLESv2 log android)
    elseif(EMSCRIPTEN)
        # Emscripten: -lGL 提供 GLES2/WebGL 绑定
        target_link_libraries(lument PRIVATE GL)
        # 强制 WebGL1，与 #version 100 着色器匹配
        target_link_options(lument PRIVATE -sMAX_WEBGL_VERSION=1)
    else()
        target_include_directories(lument PRIVATE ${LUMENT_GLES2_INCLUDE_DIR})
        target_link_libraries(lument PRIVATE ${LUMENT_GLES2_LIBRARY})
    endif()
endif()

# 数学库
if(UNIX AND NOT EMSCRIPTEN)
    target_link_libraries(lument PRIVATE m)
endif()

# 线程库（Linux 旧平台可能需要）
set(THREADS_PREFER_PTHREAD_FLAG ON)
find_package(Threads)
if(Threads_FOUND)
    target_link_libraries(lument PRIVATE Threads::Threads)
endif()

# ---------- 安装 ----------
include(GNUInstallDirs)
install(TARGETS lument
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR})
install(DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}/core/include/
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/lument
    FILES_MATCHING PATTERN "*.h")

# ---------- 测试目标（可选） ----------
option(LUMENT_BUILD_DEMO "构建一个最小调用示例（验证链接）" OFF)
if(LUMENT_BUILD_DEMO)
    add_executable(lument_demo
        ${CMAKE_CURRENT_SOURCE_DIR}/examples/demo_main.c)
    target_link_libraries(lument_demo PRIVATE lument)
endif()
