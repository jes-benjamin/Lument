"""Python bindings for the Lument game engine.

This package exposes the native C ABI (declared in ``lument.h``)
through a Pythonic, fully type-hinted API built on top of :mod:`ctypes`.

Quick start
-----------

.. code-block:: python

    import lument as ue

    with ue.Engine(width=320, height=480, target_fps=60.0) as engine:
        engine.renderer.clear(ue.LumentColor.from_rgb(15, 15, 30))

        def update(eng, dt):
            eng.renderer.draw_text("Hello Lument!", 10, 10, 16, ue.LumentColor.WHITE)
            if eng.input.key_pressed(ue.LumentKey.ACTION):
                eng.shutdown()

        engine.run(update)

Library discovery
-----------------

The binding looks for ``liblument`` (``.so`` / ``.dll`` / ``.dylib``)
in a few well-known locations and in the ``LUMENT_LIB`` environment
variable.  You can also pin a path explicitly::

    import lument as ue
    ue.set_library_path("/opt/lument/lib/liblument.so")

before constructing an :class:`~lument.core.Engine`.
"""

from __future__ import annotations

# --------------------------------------------------------------------------- #
# Version (mirrors lument.h)
# --------------------------------------------------------------------------- #
VERSION_MAJOR = 1
VERSION_MINOR = 0
VERSION_PATCH = 0
VERSION_STRING = "1.0.0"

__version__ = VERSION_STRING

# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
from .types import (
    UEComponentType,
    UEInputType,
    LumentKey,
    LumentPlatform,
    LumentRendererType,
    LumentWidgetType,
    LumentLayoutType,
    LumentEventType,
)

# --------------------------------------------------------------------------- #
# Core data types, exceptions, wrappers and library helpers
# --------------------------------------------------------------------------- #
from .core import (
    INVALID_ENTITY,
    INVALID_WIDGET,
    Audio,
    ECS,
    Engine,
    EngineInitError,
    EngineNotInitializedError,
    EventCallback,
    EventCallbackC,
    Input,
    LibraryNotFoundError,
    Renderer,
    Scene,
    Storage,
    UIManager,
    LumentColor,
    LumentConfig,
    LumentRect,
    LumentStats,
    LumentVec2,
    LumentError,
    UpdateCallbackC,
    get_lib,
    get_time_ms,
    load_library,
    log,
    random,
    random_range,
    set_library_path,
)

# --------------------------------------------------------------------------- #
# Sprite & scene management helpers
# --------------------------------------------------------------------------- #
from .sprite import Sprite
from .scene_manager import (
    SceneBase,
    SceneContext,
    SceneManager,
    SceneTransition,
)

__all__ = [
    # version
    "VERSION_MAJOR",
    "VERSION_MINOR",
    "VERSION_PATCH",
    "VERSION_STRING",
    "__version__",
    # enums
    "LumentPlatform",
    "LumentRendererType",
    "UEInputType",
    "LumentKey",
    "UEComponentType",
    "LumentWidgetType",
    "LumentLayoutType",
    "LumentEventType",
    # data types
    "LumentColor",
    "LumentRect",
    "LumentVec2",
    "LumentConfig",
    "LumentStats",
    "INVALID_ENTITY",
    "INVALID_WIDGET",
    # exceptions
    "LumentError",
    "LibraryNotFoundError",
    "EngineInitError",
    "EngineNotInitializedError",
    # callbacks
    "UpdateCallbackC",
    "EventCallbackC",
    "EventCallback",
    # high-level wrappers
    "Engine",
    "Renderer",
    "Input",
    "Audio",
    "ECS",
    "Scene",
    "Storage",
    "UIManager",
    # sprite & scenes
    "Sprite",
    "SceneBase",
    "SceneManager",
    "SceneContext",
    "SceneTransition",
    # library helpers
    "load_library",
    "get_lib",
    "set_library_path",
    # utility functions
    "get_time_ms",
    "random",
    "random_range",
    "log",
]
