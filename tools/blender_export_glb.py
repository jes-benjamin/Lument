#!/usr/bin/env python3
# ============================================================
# blender_export_glb.py — Lument Cube 的 Blender 桥接导出脚本
# ------------------------------------------------------------
# 作用：把当前打开的 .blend 工程导出为 glTF 2.0 二进制(.glb)，
#      以便 Lument Cube 引擎原生加载（引擎不直接解析 .blend 二进制）。
#
# 用法（引擎 C++ 侧 lument_cube_load_model 对 .blend 自动调用）：
#   blender "model.blend" --background --python tools/blender_export_glb.py -- "model.glb"
#
# 说明：
#   - Blender 的原生二进制 .blend 格式未公开稳定规范，业界通用做法是
#     经 Blender 导出为 glTF 2.0（Khronos 标准，Blender 官方内置导出器）。
#   - 若已预先导出 .glb/.gltf，引擎可直接加载，无需本脚本。
# ============================================================
import sys
import os
import bpy


def find_output_path():
    # Blender 将 '--' 之后的参数追加到 sys.argv，例如 [脚本路径, 输出路径]
    args = list(sys.argv)
    # 找到 '--' 之后的第一个非脚本参数
    if '--' in args:
        idx = args.index('--') + 1
        if idx < len(args):
            return args[idx]
    # 默认：与工程同名 .glb
    blend = bpy.data.filepath
    if blend:
        return os.path.splitext(blend)[0] + ".glb"
    return "lument_export.glb"


def main():
    out_path = find_output_path()
    # 确保父目录存在
    out_dir = os.path.dirname(out_path)
    if out_dir and not os.path.exists(out_dir):
        os.makedirs(out_dir, exist_ok=True)

    # 导出 glTF 2.0 二进制
    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format='GLB',
        use_selection=False,
        export_apply=True,           # 应用变换/修改器
        export_yup=True,             # glTF 默认 Y-Up，引擎按 Y-Up 解释
        export_materials='EXPORT',
        export_texture_dir_mode='COPY',
        export_image_format='AUTO',
    )
    print("[Lument.Cube] 已导出:", out_path)


if __name__ == "__main__":
    # 在 Blender 内部以 --python 运行时，__main__ 即脚本主体
    main()
