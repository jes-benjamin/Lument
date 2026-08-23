"""ctypes binding for the Lument C ABI.

This module loads the native shared library ``liblument``
(``.so`` / ``.dll`` / ``.dylib``) and maps **every** function declared in
``lument.h`` to a Pythonic API.

Layering
--------

1. **Low-level**: :func:`load_library` returns a configured
   :class:`ctypes.CDLL` with correct ``argtypes`` / ``restype`` for each
   ``lument_*`` symbol.  :func:`get_lib` returns a lazily-loaded singleton.
2. **Data types**: :class:`LumentColor`, :class:`LumentRect`, :class:`LumentVec2` are
   Python :func:`dataclasses.dataclass` wrappers with helpers to convert
   to/from their C ``struct`` counterparts.  :class:`LumentConfig` and
   :class:`LumentStats` are :class:`ctypes.Structure` subclasses that match the
   C memory layout byte-for-byte.
3. **High-level wrappers**: :class:`Engine`, :class:`Renderer`,
   :class:`Input`, :class:`Audio`, :class:`ECS`, :class:`Scene`,
   :class:`Storage` and :class:`UIManager` group related C functions behind
   ergonomic, type-hinted methods.  :class:`Engine` is the recommended entry
   point and exposes the other wrappers through its properties.

Example
-------

.. code-block:: python

    from lument import Engine, LumentConfig, LumentColor, LumentPlatform, LumentRendererType

    cfg = LumentConfig(platform=LumentPlatform.DESKTOP,
                   renderer_type=LumentRendererType.OPENGL,
                   width=320, height=480, target_fps=60.0)

    with Engine(cfg) as engine:
        engine.renderer.clear(LumentColor.from_rgb(20, 20, 40))
        engine.run(lambda e, dt: e.renderer.draw_text("Hello", 10, 10, 16, LumentColor.WHITE))
"""

from __future__ import annotations

import ctypes
import os
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Callable, ClassVar, Iterable, Optional, Union

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

if TYPE_CHECKING:  # pragma: no cover
    from .sprite import Sprite
    from .scene_manager import SceneBase

__all__ = [
    # version
    "VERSION_MAJOR",
    "VERSION_MINOR",
    "VERSION_PATCH",
    "VERSION_STRING",
    "INVALID_ENTITY",
    "INVALID_WIDGET",
    # exceptions
    "LumentError",
    "LibraryNotFoundError",
    "EngineInitError",
    "EngineNotInitializedError",
    # data types
    "LumentColor",
    "LumentRect",
    "LumentVec2",
    "LumentConfig",
    "LumentStats",
    # callback types
    "UpdateCallbackC",
    "EventCallbackC",
    "EventCallback",
    # wrappers
    "Engine",
    "Renderer",
    "Input",
    "Audio",
    "ECS",
    "Scene",
    "Storage",
    "UIManager",
    "load_library",
    "get_lib",
    "set_library_path",
]

# ===========================================================================
# Version / constants  (mirror lument.h)
# ===========================================================================

VERSION_MAJOR = 1
VERSION_MINOR = 0
VERSION_PATCH = 0
VERSION_STRING = "1.0.0"

#: Sentinel returned by the engine when an entity could not be created.
INVALID_ENTITY: int = 0

#: Sentinel returned by the engine when a UI widget could not be created.
INVALID_WIDGET: int = 0


# ===========================================================================
# Exceptions
# ===========================================================================


class LumentError(Exception):
    """Base class for all Lument binding errors."""


class LibraryNotFoundError(LumentError):
    """Raised when ``liblument`` cannot be located or loaded."""


class EngineInitError(LumentError):
    """Raised when :c:func:`lument_init` returns a non-zero status."""


class EngineNotInitializedError(LumentError):
    """Raised when a wrapper method is called before :c:func:`lument_init`."""


# ===========================================================================
# Internal ctypes structures (mirror the C ``struct`` declarations)
# ===========================================================================


class _CColor(ctypes.Structure):
    """ctypes mirror of ``LumentColor`` (``uint8_t r, g, b, a``)."""

    _fields_ = [
        ("r", ctypes.c_uint8),
        ("g", ctypes.c_uint8),
        ("b", ctypes.c_uint8),
        ("a", ctypes.c_uint8),
    ]


class _CRect(ctypes.Structure):
    """ctypes mirror of ``LumentRect`` (``float x, y, w, h``)."""

    _fields_ = [
        ("x", ctypes.c_float),
        ("y", ctypes.c_float),
        ("w", ctypes.c_float),
        ("h", ctypes.c_float),
    ]


class _CVec2(ctypes.Structure):
    """ctypes mirror of ``LumentVec2`` (``float x, y``)."""

    _fields_ = [
        ("x", ctypes.c_float),
        ("y", ctypes.c_float),
    ]


class LumentConfig(ctypes.Structure):
    """ctypes mirror of ``LumentConfig``.

    Build one explicitly or, more conveniently, pass keyword arguments to
    :class:`Engine` which constructs a default config and overrides only the
    fields you supply.

    The two string fields ``asset_path`` / ``save_path`` accept ``str`` or
    ``bytes``; they are encoded to UTF-8 on assignment.
    """

    _fields_ = [
        ("platform", ctypes.c_int),
        ("renderer_type", ctypes.c_int),
        ("width", ctypes.c_int),
        ("height", ctypes.c_int),
        ("target_fps", ctypes.c_float),
        ("vsync", ctypes.c_bool),
        ("fullscreen", ctypes.c_bool),
        ("asset_path", ctypes.c_char_p),
        ("save_path", ctypes.c_char_p),
    ]

    def __init__(
        self,
        platform: LumentPlatform | int = LumentPlatform.DESKTOP,
        renderer_type: LumentRendererType | int = LumentRendererType.OPENGL,
        width: int = 320,
        height: int = 480,
        target_fps: float = 60.0,
        vsync: bool = True,
        fullscreen: bool = False,
        asset_path: Optional[Union[str, bytes]] = None,
        save_path: Optional[Union[str, bytes]] = None,
    ) -> None:
        super().__init__(
            platform=int(platform),
            renderer_type=int(renderer_type),
            width=int(width),
            height=int(height),
            target_fps=float(target_fps),
            vsync=bool(vsync),
            fullscreen=bool(fullscreen),
            asset_path=_to_cstr(asset_path),
            save_path=_to_cstr(save_path),
        )

    # -- readable repr ----------------------------------------------------
    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return (
            f"LumentConfig(platform={LumentPlatform(self.platform).name}, "
            f"renderer_type={LumentRendererType(self.renderer_type).name}, "
            f"width={self.width}, height={self.height}, "
            f"target_fps={self.target_fps}, vsync={self.vsync}, "
            f"fullscreen={self.fullscreen})"
        )


class LumentStats(ctypes.Structure):
    """ctypes mirror of ``LumentStats`` returned by :c:func:`lument_get_stats`."""

    _fields_ = [
        ("fps", ctypes.c_float),
        ("frame_time", ctypes.c_float),
        ("draw_calls", ctypes.c_uint32),
        ("entity_count", ctypes.c_uint32),
        ("memory_used", ctypes.c_uint32),
    ]

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return (
            f"LumentStats(fps={self.fps:.1f}, frame_time={self.frame_time:.2f}ms, "
            f"draw_calls={self.draw_calls}, entities={self.entity_count}, "
            f"memory={self.memory_used}KB)"
        )


# ===========================================================================
# Public dataclasses
# ===========================================================================


@dataclass
class LumentColor:
    """RGBA color (8 bits per channel).

    Usage::

        red = LumentColor(255, 0, 0)
        red = LumentColor.from_rgb(255, 0, 0)
        red = LumentColor.from_hex("#FF0000")
        transparent = LumentColor.from_rgb(0, 0, 0, 0)
    """

    r: int = 255
    g: int = 255
    b: int = 255
    a: int = 255

    # -- constants (ClassVar so they are NOT treated as dataclass fields) --
    WHITE: ClassVar["LumentColor"]
    BLACK: ClassVar["LumentColor"]
    RED: ClassVar["LumentColor"]
    GREEN: ClassVar["LumentColor"]
    BLUE: ClassVar["LumentColor"]
    TRANSPARENT: ClassVar["LumentColor"]

    # -- construction helpers --------------------------------------------
    @classmethod
    def from_rgb(cls, r: int, g: int, b: int, a: int = 255) -> "LumentColor":
        """Create a color from 0-255 channel values."""
        return cls(r & 0xFF, g & 0xFF, b & 0xFF, a & 0xFF)

    @classmethod
    def from_hex(cls, hexstr: str, alpha: int = 255) -> "LumentColor":
        """Create a color from a ``#RRGGBB`` / ``RRGGBB`` / ``#RGB`` string."""
        value = hexstr.lstrip("#")
        if len(value) == 3:
            value = "".join(ch * 2 for ch in value)
        if len(value) != 6:
            raise ValueError(f"Invalid hex color: {hexstr!r}")
        r = int(value[0:2], 16)
        g = int(value[2:4], 16)
        b = int(value[4:6], 16)
        return cls(r, g, b, alpha & 0xFF)

    # -- C conversion ----------------------------------------------------
    def _to_c(self) -> _CColor:
        return _CColor(self.r & 0xFF, self.g & 0xFF, self.b & 0xFF, self.a & 0xFF)

    @classmethod
    def _from_c(cls, c: _CColor) -> "LumentColor":
        return cls(c.r, c.g, c.b, c.a)

    def __iter__(self):
        return iter((self.r, self.g, self.b, self.a))

    def __bytes__(self) -> bytes:
        """Return the 4-byte RGBA representation."""
        return bytes(
            (self.r & 0xFF, self.g & 0xFF, self.b & 0xFF, self.a & 0xFF)
        )

    def to_bytes(self) -> bytes:
        """Alias for :func:`bytes(self)` returning the RGBA bytes."""
        return bytes(self)


# Populate color constants *after* the class body.
LumentColor.WHITE = LumentColor(255, 255, 255, 255)
LumentColor.BLACK = LumentColor(0, 0, 0, 255)
LumentColor.RED = LumentColor(255, 0, 0, 255)
LumentColor.GREEN = LumentColor(0, 255, 0, 255)
LumentColor.BLUE = LumentColor(0, 0, 255, 255)
LumentColor.TRANSPARENT = LumentColor(0, 0, 0, 0)


@dataclass
class LumentRect:
    """Axis-aligned rectangle (``x, y`` = top-left, ``w, h`` = size)."""

    x: float = 0.0
    y: float = 0.0
    w: float = 0.0
    h: float = 0.0

    @classmethod
    def from_xywh(cls, x: float, y: float, w: float, h: float) -> "LumentRect":
        return cls(x, y, w, h)

    @classmethod
    def from_corners(cls, x0: float, y0: float, x1: float, y1: float) -> "LumentRect":
        return cls(x0, y0, x1 - x0, y1 - y0)

    def _to_c(self) -> _CRect:
        return _CRect(self.x, self.y, self.w, self.h)

    @classmethod
    def _from_c(cls, r: _CRect) -> "LumentRect":
        return cls(r.x, r.y, r.w, r.h)

    def __iter__(self):
        return iter((self.x, self.y, self.w, self.h))


@dataclass
class LumentVec2:
    """2D vector / point."""

    x: float = 0.0
    y: float = 0.0

    def _to_c(self) -> _CVec2:
        return _CVec2(self.x, self.y)

    @classmethod
    def _from_c(cls, v: _CVec2) -> "LumentVec2":
        return cls(v.x, v.y)

    def __iter__(self):
        return iter((self.x, self.y))


# ===========================================================================
# C function pointer type for the script update callback
# ===========================================================================

#: ``typedef void (*UEUpdateCallback)(LumentEntity, float);``
UpdateCallbackC = ctypes.CFUNCTYPE(None, ctypes.c_uint32, ctypes.c_float)

#: Python-side update callback signature: ``callback(entity_id, delta_time)``.
UpdateCallback = Callable[[int, float], None]

#: ``typedef void (*LumentEventCallback)(LumentWidget, LumentEventType, const char* data);``
EventCallbackC = ctypes.CFUNCTYPE(
    None, ctypes.c_uint32, ctypes.c_int, ctypes.c_char_p
)

#: Python-side UI event callback signature: ``callback(widget_id, event, data)``.
EventCallback = Callable[[int, LumentEventType, Optional[str]], None]


# ===========================================================================
# Small conversion utilities
# ===========================================================================


def _to_cstr(value: Optional[Union[str, bytes]]) -> Optional[bytes]:
    """Encode ``str``/``bytes`` to a UTF-8 ``bytes`` object for ctypes."""
    if value is None:
        return None
    if isinstance(value, bytes):
        return value
    return value.encode("utf-8")


def _ensure_lib() -> ctypes.CDLL:
    """Return the loaded library, raising a clear error if unavailable."""
    lib = get_lib()
    if lib is None:
        raise EngineNotInitializedError(
            "The Lument native library has not been loaded. "
            "Call load_library() or construct an Engine first."
        )
    return lib


# ===========================================================================
# Library loading & function configuration
# ===========================================================================

# Candidate library file names per platform.
_LIB_NAMES = {
    "win32": ("lument.dll", "liblument.dll"),
    "darwin": ("liblument.dylib",),
}.get(sys.platform, ("liblument.so",))

# Extra search directories relative to the package and common install roots.
_SEARCH_DIRS: list[str] = [
    os.path.dirname(os.path.abspath(__file__)),
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "lib"),
    "/usr/local/lib",
    "/usr/lib",
    "/opt/lument/lib",
]

# User-overridable absolute path to the shared library.
_library_path: Optional[str] = None

# Singleton loaded library.
_loaded_lib: Optional[ctypes.CDLL] = None


def set_library_path(path: Union[str, os.PathLike, None]) -> None:
    """Pin an explicit path to ``liblument``.

    Call this before :class:`Engine` is constructed (or before the first
    :func:`get_lib` call).  Pass ``None`` to revert to automatic discovery.
    """
    global _library_path, _loaded_lib
    _library_path = os.fspath(path) if path is not None else None
    _loaded_lib = None  # force a reload on next access


def _discover_library() -> str:
    """Locate the native library on disk and return its absolute path."""
    # 1. explicit user override
    if _library_path and os.path.isfile(_library_path):
        return _library_path

    # 2. environment variable
    env_path = os.environ.get("LUMENT_LIB")
    if env_path and os.path.isfile(env_path):
        return env_path

    # 3. search known directories
    for directory in _SEARCH_DIRS:
        for name in _LIB_NAMES:
            candidate = os.path.join(directory, name)
            if os.path.isfile(candidate):
                return candidate

    # 4. last resort: let the OS loader resolve a bare name (relies on
    #    LD_LIBRARY_PATH / PATH / @rpath etc.)
    return _LIB_NAMES[0]


def _configure(lib: ctypes.CDLL) -> None:
    """Define ``argtypes`` / ``restype`` for every ``lument_*`` symbol."""

    c_char_p = ctypes.c_char_p
    c_int = ctypes.c_int
    c_uint8 = ctypes.c_uint8
    c_uint32 = ctypes.c_uint32
    c_uint64 = ctypes.c_uint64
    c_float = ctypes.c_float
    c_bool = ctypes.c_bool
    c_void_p = ctypes.c_void_p

    def _bind(name: str, argtypes, restype):
        try:
            fn = getattr(lib, name)
        except AttributeError as exc:  # pragma: no cover - depends on lib
            raise LibraryNotFoundError(
                f"Symbol '{name}' not found in lument library"
            ) from exc
        fn.argtypes = argtypes
        fn.restype = restype
        return fn

    # ---- lifecycle ----
    _bind("lument_init", [ctypes.POINTER(LumentConfig)], c_int)
    _bind("lument_shutdown", None, None)
    _bind("lument_is_running", None, c_int)

    # ---- frame ----
    _bind("lument_begin_frame", None, None)
    _bind("lument_end_frame", None, None)
    _bind("lument_get_delta_time", None, c_float)
    _bind("lument_get_stats", [ctypes.POINTER(LumentStats)], None)

    # ---- platform ----
    _bind("lument_get_platform", None, c_int)
    _bind("lument_get_renderer_type", None, c_int)

    # ---- rendering ----
    _bind("lument_clear", [_CColor], None)
    _bind("lument_set_camera", [c_float, c_float, c_float], None)
    _bind("lument_draw_rect", [_CRect, _CColor, c_bool], None)
    _bind("lument_draw_sprite", [c_uint32, _CRect, _CRect], None)
    _bind("lument_draw_text", [c_char_p, c_float, c_float, c_float, _CColor], None)
    _bind("lument_draw_pixel", [c_int, c_int, _CColor], None)
    _bind("lument_flush", None, None)

    # ---- textures ----
    _bind("lument_load_texture", [c_char_p], c_uint32)
    _bind("lument_create_texture_from_data", [c_int, c_int, ctypes.POINTER(c_uint8)], c_uint32)
    _bind("lument_destroy_texture", [c_uint32], None)

    # ---- input ----
    _bind("lument_key_down", [c_int], c_bool)
    _bind("lument_key_pressed", [c_int], c_bool)
    _bind("lument_get_touch_count", None, c_int)
    _bind("lument_get_touch", [c_int, ctypes.POINTER(_CVec2)], None)
    _bind("lument_get_joystick_x", None, c_float)
    _bind("lument_get_joystick_y", None, c_float)

    # ---- audio ----
    _bind("lument_load_audio", [c_char_p, c_bool], c_uint32)
    _bind("lument_play_audio", [c_uint32, c_bool], None)
    _bind("lument_stop_audio", [c_uint32], None)
    _bind("lument_set_volume", [c_uint32, c_float], None)
    _bind("lument_stop_all_audio", None, None)

    # ---- ecs ----
    _bind("lument_create_entity", None, c_uint32)
    _bind("lument_destroy_entity", [c_uint32], None)
    _bind("lument_entity_alive", [c_uint32], c_bool)
    _bind("lument_set_position", [c_uint32, c_float, c_float], None)
    _bind("lument_get_position", [c_uint32, ctypes.POINTER(_CVec2)], None)
    _bind("lument_set_scale", [c_uint32, c_float, c_float], None)
    _bind("lument_set_sprite", [c_uint32, c_uint32, c_float, c_float], None)
    _bind("lument_set_sprite_color", [c_uint32, _CColor], None)
    _bind("lument_set_visible", [c_uint32, c_bool], None)
    _bind("lument_set_collider", [c_uint32, c_float, c_float], None)
    _bind("lument_check_collision", [c_uint32, c_uint32], c_bool)
    _bind("lument_set_script", [c_uint32, UpdateCallbackC], None)

    # ---- scene ----
    _bind("lument_load_scene", [c_char_p], c_int)
    _bind("lument_set_active_scene", [c_int], None)
    _bind("lument_get_active_scene", None, c_int)
    _bind("lument_scene_set_background", [_CColor], None)

    # ---- ui: widget lifecycle ----
    _bind("lument_ui_create", [c_int], c_uint32)
    _bind("lument_ui_destroy", [c_uint32], None)
    _bind("lument_ui_clear_all", None, None)

    # ---- ui: widget properties ----
    _bind("lument_ui_set_text", [c_uint32, c_char_p], None)
    _bind("lument_ui_get_text", [c_uint32], c_char_p)
    _bind("lument_ui_set_position", [c_uint32, c_float, c_float], None)
    _bind("lument_ui_set_size", [c_uint32, c_float, c_float], None)
    _bind("lument_ui_set_color", [c_uint32, _CColor], None)
    _bind("lument_ui_set_text_color", [c_uint32, _CColor], None)
    _bind("lument_ui_set_font_size", [c_uint32, c_float], None)
    _bind("lument_ui_set_visible", [c_uint32, c_bool], None)
    _bind("lument_ui_set_enabled", [c_uint32, c_bool], None)
    _bind("lument_ui_set_image", [c_uint32, c_uint32], None)

    # ---- ui: widget hierarchy ----
    _bind("lument_ui_add_child", [c_uint32, c_uint32], None)
    _bind("lument_ui_remove_child", [c_uint32, c_uint32], None)
    _bind("lument_ui_get_parent", [c_uint32], c_uint32)

    # ---- ui: layout ----
    _bind("lument_ui_set_layout", [c_uint32, c_int], None)
    _bind("lument_ui_set_padding", [c_uint32, c_float, c_float, c_float, c_float], None)
    _bind("lument_ui_set_spacing", [c_uint32, c_float], None)
    _bind("lument_ui_set_grid", [c_uint32, c_int, c_int], None)
    _bind("lument_ui_set_alignment", [c_uint32, c_int], None)

    # ---- ui: events ----
    _bind("lument_ui_on_event", [c_uint32, c_int, EventCallbackC], None)
    _bind("lument_ui_set_focused", [c_uint32], None)

    # ---- ui: rendering & event handling ----
    _bind("lument_ui_render", None, None)
    _bind("lument_ui_handle_touch", [c_float, c_float, c_int], c_bool)
    _bind("lument_ui_handle_key", [c_int, c_bool], c_bool)

    # ---- ui: navigation ----
    _bind("lument_ui_navigate_to", [c_uint32], None)
    _bind("lument_ui_navigate_back", None, None)
    _bind("lument_ui_get_current_screen", None, c_uint32)

    # ---- ui: convenience creators ----
    _bind("lument_ui_create_button", [c_char_p, c_float, c_float, c_float, c_float], c_uint32)
    _bind("lument_ui_create_label", [c_char_p, c_float, c_float, c_float, c_float], c_uint32)
    _bind("lument_ui_create_input", [c_char_p, c_float, c_float, c_float, c_float], c_uint32)

    # ---- storage ----
    _bind("lument_save_data", [c_char_p, c_char_p], c_int)
    _bind("lument_load_data", [c_char_p], c_char_p)
    _bind("lument_clear_data", [c_char_p], c_int)

    # ---- utility ----
    _bind("lument_get_time_ms", None, c_uint64)
    _bind("lument_random", None, c_float)
    _bind("lument_random_range", [c_float, c_float], c_float)
    _bind("lument_log", [c_char_p], None)


def load_library(path: Optional[Union[str, os.PathLike]] = None) -> ctypes.CDLL:
    """Load and configure the native library.

    Parameters
    ----------
    path:
        Optional explicit path to the shared library.  When omitted, the
        binding searches the standard directories (see :func:`set_library_path`
        and the ``LUMENT_LIB`` environment variable).

    Returns
    -------
    ctypes.CDLL
        A fully configured library handle (cached as a module singleton).

    Raises
    ------
    LibraryNotFoundError
        If the library cannot be loaded or a required symbol is missing.
    """
    global _loaded_lib
    if _loaded_lib is not None:
        return _loaded_lib

    if path is not None:
        target = os.fspath(path)
    else:
        target = _discover_library()

    try:
        lib = ctypes.CDLL(target)
    except OSError as exc:
        raise LibraryNotFoundError(
            f"Failed to load Lument library from {target!r}: {exc}"
        ) from exc

    _configure(lib)
    _loaded_lib = lib
    return lib


def get_lib() -> ctypes.CDLL:
    """Return the lazily-loaded singleton library handle."""
    if _loaded_lib is None:
        load_library()
    return _loaded_lib  # type: ignore[return-value]


# ===========================================================================
# High-level wrapper classes
# ===========================================================================


class Engine:
    """Main entry point wrapping the engine lifecycle.

    Construct with a :class:`LumentConfig` (or keyword arguments that build one)
    and use either as a context manager or manually::

        with Engine(width=320, height=480) as engine:
            engine.run(my_update)

    Sub-systems (renderer, input, audio, ecs, scene, storage, ui) are exposed as
    read-only properties.
    """

    def __init__(
        self,
        config: Optional[LumentConfig] = None,
        /,
        *,
        platform: LumentPlatform | int = LumentPlatform.DESKTOP,
        renderer_type: LumentRendererType | int = LumentRendererType.OPENGL,
        width: int = 320,
        height: int = 480,
        target_fps: float = 60.0,
        vsync: bool = True,
        fullscreen: bool = False,
        asset_path: Optional[Union[str, bytes]] = None,
        save_path: Optional[Union[str, bytes]] = None,
    ) -> None:
        lib = get_lib()

        if config is None:
            config = LumentConfig(
                platform=platform,
                renderer_type=renderer_type,
                width=width,
                height=height,
                target_fps=target_fps,
                vsync=vsync,
                fullscreen=fullscreen,
                asset_path=asset_path,
                save_path=save_path,
            )

        result = lib.lument_init(ctypes.byref(config))
        if result != 0:
            raise EngineInitError(
                f"lument_init failed with code {result}. Check the config and "
                "that the requested renderer is available on this platform."
            )

        self._initialized = True
        self._config = config

        # Sub-systems share the singleton library.
        self._renderer = Renderer()
        self._input = Input()
        self._audio = Audio()
        self._ecs = ECS()
        self._scene = Scene()
        self._storage = Storage()
        self._ui = UIManager()

    # -- sub-systems -----------------------------------------------------
    @property
    def renderer(self) -> "Renderer":
        return self._renderer

    @property
    def input(self) -> "Input":
        return self._input

    @property
    def audio(self) -> "Audio":
        return self._audio

    @property
    def ecs(self) -> "ECS":
        return self._ecs

    @property
    def scene(self) -> "Scene":
        return self._scene

    @property
    def storage(self) -> "Storage":
        return self._storage

    @property
    def ui(self) -> "UIManager":
        return self._ui

    @property
    def config(self) -> LumentConfig:
        return self._config

    # -- lifecycle helpers ----------------------------------------------
    def is_running(self) -> bool:
        """Return ``True`` while the engine wants the main loop to continue."""
        return bool(get_lib().lument_is_running())

    def begin_frame(self) -> None:
        get_lib().lument_begin_frame()

    def end_frame(self) -> None:
        get_lib().lument_end_frame()

    def delta_time(self) -> float:
        """Delta time of the current frame in milliseconds."""
        return float(get_lib().lument_get_delta_time())

    def stats(self) -> LumentStats:
        """Return a fresh :class:`LumentStats` snapshot."""
        stats = LumentStats()
        get_lib().lument_get_stats(ctypes.byref(stats))
        return stats

    def run(self, callback: Optional[Callable[["Engine", float], None]] = None) -> None:
        """Run the main loop until :c:func:`lument_is_running` returns false.

        ``callback`` is invoked once per frame as ``callback(engine, dt)``
        where ``dt`` is the frame delta in milliseconds.  The loop drives
        :c:func:`lument_begin_frame` / :c:func:`lument_end_frame` automatically.
        """
        lib = get_lib()
        while lib.lument_is_running():
            lib.lument_begin_frame()
            dt = lib.lument_get_delta_time()
            if callback is not None:
                callback(self, dt)
            lib.lument_end_frame()

    def shutdown(self) -> None:
        """Tear the engine down.  Safe to call multiple times."""
        if getattr(self, "_initialized", False):
            get_lib().lument_shutdown()
            self._initialized = False

    # -- context manager -------------------------------------------------
    def __enter__(self) -> "Engine":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.shutdown()

    def __del__(self) -> None:  # pragma: no cover - best effort cleanup
        with suppress_exceptions():
            self.shutdown()

    # -- platform info ---------------------------------------------------
    @property
    def platform(self) -> LumentPlatform:
        return LumentPlatform(int(get_lib().lument_get_platform()))

    @property
    def renderer_type(self) -> LumentRendererType:
        return LumentRendererType(int(get_lib().lument_get_renderer_type()))


class Renderer:
    """Wrapper around the rendering and texture-management C functions."""

    def clear(self, color: LumentColor = LumentColor.BLACK) -> None:
        get_lib().lument_clear(color._to_c())

    def set_camera(self, x: float, y: float, zoom: float = 1.0) -> None:
        get_lib().lument_set_camera(x, y, zoom)

    def draw_rect(self, rect: LumentRect, color: LumentColor, filled: bool = True) -> None:
        get_lib().lument_draw_rect(rect._to_c(), color._to_c(), bool(filled))

    def draw_sprite(
        self,
        texture_id: int,
        dest: LumentRect,
        src: Optional[LumentRect] = None,
    ) -> None:
        """Draw a textured quad.

        ``src`` selects a sub-rectangle of the texture; when ``None`` the full
        texture is used (passed as a zero rect to the engine).
        """
        src_rect = src._to_c() if src is not None else _CRect(0.0, 0.0, 0.0, 0.0)
        get_lib().lument_draw_sprite(int(texture_id), dest._to_c(), src_rect)

    def draw_text(
        self,
        text: str,
        x: float,
        y: float,
        size: float = 16.0,
        color: LumentColor = LumentColor.WHITE,
    ) -> None:
        get_lib().lument_draw_text(
            _to_cstr(text) or b"", x, y, size, color._to_c()
        )

    def draw_pixel(self, x: int, y: int, color: LumentColor) -> None:
        get_lib().lument_draw_pixel(int(x), int(y), color._to_c())

    def flush(self) -> None:
        """Force-submit any pending draw commands."""
        get_lib().lument_flush()

    # -- textures --------------------------------------------------------
    def load_texture(self, path: str) -> int:
        """Load a texture from an asset path. Returns a texture id (0 on failure)."""
        return int(get_lib().lument_load_texture(_to_cstr(path) or b""))

    def create_texture(self, width: int, height: int, rgba: bytes) -> int:
        """Create a texture from raw RGBA pixel data (``width*height*4`` bytes).

        Returns the new texture id.  This is the low-level counterpart of
        :meth:`Sprite.upload`; prefer using :class:`~lument.sprite.Sprite`
        for authoring pixel art in Python.
        """
        if len(rgba) != width * height * 4:
            raise ValueError(
                f"Expected {width * height * 4} bytes of RGBA data, got {len(rgba)}"
            )
        buf = (ctypes.c_uint8 * len(rgba)).from_buffer_copy(rgba)
        return int(get_lib().lument_create_texture_from_data(int(width), int(height), buf))

    def destroy_texture(self, texture_id: int) -> None:
        get_lib().lument_destroy_texture(int(texture_id))


class Input:
    """Wrapper around keyboard, touch and gamepad queries."""

    def key_down(self, key: LumentKey | int) -> bool:
        """``True`` while ``key`` is currently held."""
        return bool(get_lib().lument_key_down(int(key)))

    def key_pressed(self, key: LumentKey | int) -> bool:
        """``True`` on the frame ``key`` transitions to pressed."""
        return bool(get_lib().lument_key_pressed(int(key)))

    @property
    def touch_count(self) -> int:
        return int(get_lib().lument_get_touch_count())

    def get_touch(self, index: int = 0) -> LumentVec2:
        """Return the position of touch ``index`` (zero if out of range)."""
        pos = _CVec2()
        get_lib().lument_get_touch(int(index), ctypes.byref(pos))
        return LumentVec2._from_c(pos)

    @property
    def touches(self) -> list[LumentVec2]:
        return [self.get_touch(i) for i in range(self.touch_count)]

    @property
    def joystick(self) -> LumentVec2:
        """Gamepad left-stick value, each axis in ``[-1, 1]``."""
        return LumentVec2(
            float(get_lib().lument_get_joystick_x()),
            float(get_lib().lument_get_joystick_y()),
        )

    @property
    def joystick_x(self) -> float:
        return float(get_lib().lument_get_joystick_x())

    @property
    def joystick_y(self) -> float:
        return float(get_lib().lument_get_joystick_y())


class Audio:
    """Wrapper around audio loading / playback."""

    def load(self, path: str, music: bool = False) -> int:
        """Load a sound effect (``music=False``) or music stream.

        Returns an audio id (0 on failure).
        """
        return int(get_lib().lument_load_audio(_to_cstr(path) or b"", bool(music)))

    def play(self, audio_id: int, loop: bool = False) -> None:
        get_lib().lument_play_audio(int(audio_id), bool(loop))

    def stop(self, audio_id: int) -> None:
        get_lib().lument_stop_audio(int(audio_id))

    def set_volume(self, audio_id: int, volume: float) -> None:
        """Set per-source volume (``0.0`` - ``1.0``)."""
        get_lib().lument_set_volume(int(audio_id), float(volume))

    def stop_all(self) -> None:
        get_lib().lument_stop_all_audio()


class ECS:
    """Wrapper around the Entity-Component-System API.

    Each created entity can carry a Python update callback registered via
    :meth:`set_script`.  Callbacks are kept alive for the lifetime of the
    entity (or until replaced), preventing premature garbage collection of the
    underlying ``CFUNCTYPE`` trampolines.
    """

    def __init__(self) -> None:
        # entity_id -> CFUNCTYPE trampoline (keeps them alive)
        self._scripts: dict[int, UpdateCallbackC] = {}

    # -- entities --------------------------------------------------------
    def create_entity(self) -> int:
        entity = int(get_lib().lument_create_entity())
        if entity == INVALID_ENTITY:
            raise LumentError("lument_create_entity returned an invalid entity")
        return entity

    def destroy_entity(self, entity: int) -> None:
        get_lib().lument_destroy_entity(int(entity))
        self._scripts.pop(entity, None)

    def entity_alive(self, entity: int) -> bool:
        return bool(get_lib().lument_entity_alive(int(entity)))

    # -- transform -------------------------------------------------------
    def set_position(self, entity: int, x: float, y: float) -> None:
        get_lib().lument_set_position(int(entity), x, y)

    def get_position(self, entity: int) -> LumentVec2:
        pos = _CVec2()
        get_lib().lument_get_position(int(entity), ctypes.byref(pos))
        return LumentVec2._from_c(pos)

    def set_scale(self, entity: int, sx: float, sy: float) -> None:
        get_lib().lument_set_scale(int(entity), sx, sy)

    # -- sprite ----------------------------------------------------------
    def set_sprite(self, entity: int, texture_id: int, w: float, h: float) -> None:
        get_lib().lument_set_sprite(int(entity), int(texture_id), w, h)

    def set_sprite_color(self, entity: int, color: LumentColor) -> None:
        get_lib().lument_set_sprite_color(int(entity), color._to_c())

    def set_visible(self, entity: int, visible: bool = True) -> None:
        get_lib().lument_set_visible(int(entity), bool(visible))

    # -- collider --------------------------------------------------------
    def set_collider(self, entity: int, w: float, h: float) -> None:
        get_lib().lument_set_collider(int(entity), w, h)

    def check_collision(self, entity_a: int, entity_b: int) -> bool:
        return bool(get_lib().lument_check_collision(int(entity_a), int(entity_b)))

    # -- script ----------------------------------------------------------
    def set_script(self, entity: int, callback: Optional[UpdateCallback]) -> None:
        """Attach a Python ``callback(entity_id, dt)`` to an entity.

        Pass ``None`` to remove an existing script.  The callback runs every
        frame for as long as the entity is alive.
        """
        lib = get_lib()
        if callback is None:
            lib.lument_set_script(int(entity), ctypes.cast(None, UpdateCallbackC))
            self._scripts.pop(entity, None)
            return
        trampoline = UpdateCallbackC(
            lambda eid, dt: self._invoke_script(callback, eid, dt)
        )
        self._scripts[entity] = trampoline  # keep alive
        lib.lument_set_script(int(entity), trampoline)

    @staticmethod
    def _invoke_script(callback: UpdateCallback, entity: int, dt: float) -> None:
        # Guard the C trampoline from Python exceptions so a buggy script
        # cannot abort the native frame loop.
        with suppress_exceptions():
            callback(entity, dt)

    def __del__(self) -> None:  # pragma: no cover - best effort
        with suppress_exceptions():
            self._scripts.clear()


class Scene:
    """Wrapper around scene loading / activation."""

    def load(self, name: str) -> int:
        """Load a built-in scene by name. Returns the scene id (<=0 on failure)."""
        return int(get_lib().lument_load_scene(_to_cstr(name) or b""))

    def set_active(self, scene_id: int) -> None:
        get_lib().lument_set_active_scene(int(scene_id))

    @property
    def active(self) -> int:
        return int(get_lib().lument_get_active_scene())

    def set_background(self, color: LumentColor) -> None:
        get_lib().lument_scene_set_background(color._to_c())


class Storage:
    """Wrapper around the key/value persistence API.

    Values are stored as UTF-8 strings.  :meth:`load` returns ``None`` when the
    key is unset instead of an empty C string.
    """

    def save(self, key: str, data: str) -> bool:
        return int(get_lib().lument_save_data(_to_cstr(key) or b"", _to_cstr(data) or b"")) == 0

    def load(self, key: str) -> Optional[str]:
        raw = get_lib().lument_load_data(_to_cstr(key) or b"")
        if not raw:
            return None
        return raw.decode("utf-8")

    def clear(self, key: str) -> bool:
        return int(get_lib().lument_clear_data(_to_cstr(key) or b"")) == 0


class UIManager:
    """Wrapper around the UI / app-development C functions.

    Widgets are created by :meth:`create` (or one of the convenience creators
    :meth:`create_button` / :meth:`create_label` / :meth:`create_input`) and
    referenced by integer handles returned from the engine.  Event callbacks
    registered via :meth:`on_event` are kept alive for the lifetime of the
    widget (or until replaced / cleared), preventing premature garbage
    collection of the underlying ``CFUNCTYPE`` trampolines.

    Example
    -------
    .. code-block:: python

        with Engine(width=320, height=480) as engine:
            ui = engine.ui
            screen = ui.create(LumentWidgetType.CONTAINER)
            ui.set_layout(screen, LumentLayoutType.VERTICAL)
            ui.set_size(screen, 320, 480)

            btn = ui.create_button("Click me", 10, 10, 300, 40)
            ui.add_child(screen, btn)
            ui.on_event(btn, LumentEventType.CLICK,
                        lambda wid, evt, data: print("clicked!"))

            ui.navigate_to(screen)
            engine.run(lambda e, dt: e.ui.render())
    """

    def __init__(self) -> None:
        # (widget_id, event) -> CFUNCTYPE trampoline (keeps them alive)
        self._callbacks: dict[tuple[int, int], EventCallbackC] = {}

    # -- widget lifecycle ------------------------------------------------
    def create(self, type: LumentWidgetType | int) -> int:
        """Create a widget of ``type`` and return its handle.

        Raises :class:`LumentError` if the engine cannot create the widget.
        """
        widget = int(get_lib().lument_ui_create(int(type)))
        if widget == INVALID_WIDGET:
            raise LumentError("lument_ui_create returned an invalid widget")
        return widget

    def destroy(self, widget: int) -> None:
        """Destroy a widget and drop any callbacks owned by it."""
        get_lib().lument_ui_destroy(int(widget))
        self._callbacks = {
            key: cb for key, cb in self._callbacks.items() if key[0] != widget
        }

    def clear_all(self) -> None:
        """Destroy every widget managed by the engine."""
        get_lib().lument_ui_clear_all()
        self._callbacks.clear()

    # -- widget properties -----------------------------------------------
    def set_text(self, widget: int, text: str) -> None:
        get_lib().lument_ui_set_text(int(widget), _to_cstr(text) or b"")

    def get_text(self, widget: int) -> str:
        """Return the widget's text (empty string when unset)."""
        raw = get_lib().lument_ui_get_text(int(widget))
        if not raw:
            return ""
        return raw.decode("utf-8")

    def set_position(self, widget: int, x: float, y: float) -> None:
        get_lib().lument_ui_set_position(int(widget), x, y)

    def set_size(self, widget: int, w: float, h: float) -> None:
        get_lib().lument_ui_set_size(int(widget), w, h)

    def set_color(self, widget: int, color: LumentColor) -> None:
        get_lib().lument_ui_set_color(int(widget), color._to_c())

    def set_text_color(self, widget: int, color: LumentColor) -> None:
        get_lib().lument_ui_set_text_color(int(widget), color._to_c())

    def set_font_size(self, widget: int, size: float) -> None:
        get_lib().lument_ui_set_font_size(int(widget), float(size))

    def set_visible(self, widget: int, visible: bool = True) -> None:
        get_lib().lument_ui_set_visible(int(widget), bool(visible))

    def set_enabled(self, widget: int, enabled: bool = True) -> None:
        get_lib().lument_ui_set_enabled(int(widget), bool(enabled))

    def set_image(self, widget: int, texture_id: int) -> None:
        get_lib().lument_ui_set_image(int(widget), int(texture_id))

    # -- widget hierarchy ------------------------------------------------
    def add_child(self, parent: int, child: int) -> None:
        get_lib().lument_ui_add_child(int(parent), int(child))

    def remove_child(self, parent: int, child: int) -> None:
        get_lib().lument_ui_remove_child(int(parent), int(child))

    def get_parent(self, widget: int) -> int:
        """Return the parent widget handle (``0`` for a root widget)."""
        return int(get_lib().lument_ui_get_parent(int(widget)))

    # -- layout ----------------------------------------------------------
    def set_layout(self, container: int, layout: LumentLayoutType | int) -> None:
        get_lib().lument_ui_set_layout(int(container), int(layout))

    def set_padding(
        self,
        container: int,
        top: float,
        right: float,
        bottom: float,
        left: float,
    ) -> None:
        get_lib().lument_ui_set_padding(
            int(container), top, right, bottom, left
        )

    def set_spacing(self, container: int, spacing: float) -> None:
        get_lib().lument_ui_set_spacing(int(container), float(spacing))

    def set_grid(self, container: int, cols: int, rows: int) -> None:
        get_lib().lument_ui_set_grid(int(container), int(cols), int(rows))

    def set_alignment(self, container: int, align: int) -> None:
        """Set alignment (``0``=start, ``1``=center, ``2``=end, ``3``=stretch)."""
        get_lib().lument_ui_set_alignment(int(container), int(align))

    # -- events ----------------------------------------------------------
    def on_event(
        self,
        widget: int,
        event: LumentEventType | int,
        callback: Optional[EventCallback],
    ) -> None:
        """Attach a Python ``callback(widget_id, event, data)`` to a widget.

        Pass ``None`` to remove an existing handler for the given ``event``.
        The callback fires whenever the engine dispatches ``event`` to the
        widget.  ``data`` is the event payload decoded as UTF-8 (or ``None``
        when the engine sends no payload).
        """
        lib = get_lib()
        key = (int(widget), int(event))
        if callback is None:
            lib.lument_ui_on_event(
                int(widget), int(event), ctypes.cast(None, EventCallbackC)
            )
            self._callbacks.pop(key, None)
            return
        trampoline = EventCallbackC(
            lambda wid, evt, data: self._invoke_event(callback, wid, evt, data)
        )
        self._callbacks[key] = trampoline  # keep alive
        lib.lument_ui_on_event(int(widget), int(event), trampoline)

    @staticmethod
    def _invoke_event(
        callback: EventCallback, widget: int, event: int, data
    ) -> None:
        # Guard the C trampoline from Python exceptions so a buggy handler
        # cannot abort the native frame loop.
        with suppress_exceptions():
            text = data.decode("utf-8") if data else None
            callback(widget, LumentEventType(event), text)

    def set_focused(self, widget: int) -> None:
        """Give keyboard focus to ``widget``."""
        get_lib().lument_ui_set_focused(int(widget))

    # -- rendering & event handling --------------------------------------
    def render(self) -> None:
        """Render the active UI screen.  Call this once per frame."""
        get_lib().lument_ui_render()

    def handle_touch(self, x: float, y: float, touch_type: int = 0) -> bool:
        """Forward a touch to the UI layer.

        ``touch_type`` selects the phase: ``0``=down, ``1``=move, ``2``=up.
        Returns ``True`` if a widget consumed the event.
        """
        return bool(get_lib().lument_ui_handle_touch(x, y, int(touch_type)))

    def handle_key(self, key: LumentKey | int, pressed: bool) -> bool:
        """Forward a key event to the UI layer.

        Returns ``True`` if a widget consumed the event.
        """
        return bool(get_lib().lument_ui_handle_key(int(key), bool(pressed)))

    # -- navigation ------------------------------------------------------
    def navigate_to(self, screen: int) -> None:
        """Push ``screen`` onto the navigation stack."""
        get_lib().lument_ui_navigate_to(int(screen))

    def navigate_back(self) -> None:
        """Pop the current screen off the navigation stack."""
        get_lib().lument_ui_navigate_back()

    def get_current_screen(self) -> int:
        """Return the handle of the currently active screen."""
        return int(get_lib().lument_ui_get_current_screen())

    # -- convenience creators -------------------------------------------
    def create_button(
        self, text: str, x: float, y: float, w: float, h: float
    ) -> int:
        """Create a button widget at ``(x, y)`` with size ``(w, h)``."""
        return int(
            get_lib().lument_ui_create_button(_to_cstr(text) or b"", x, y, w, h)
        )

    def create_label(
        self, text: str, x: float, y: float, w: float, h: float
    ) -> int:
        """Create a label widget at ``(x, y)`` with size ``(w, h)``."""
        return int(
            get_lib().lument_ui_create_label(_to_cstr(text) or b"", x, y, w, h)
        )

    def create_input(
        self, placeholder: str, x: float, y: float, w: float, h: float
    ) -> int:
        """Create a text input widget with ``placeholder``."""
        return int(
            get_lib().lument_ui_create_input(
                _to_cstr(placeholder) or b"", x, y, w, h
            )
        )

    def __del__(self) -> None:  # pragma: no cover - best effort
        with suppress_exceptions():
            self._callbacks.clear()


# ===========================================================================
# Utility functions exposed at module level
# ===========================================================================


def get_time_ms() -> int:
    """Engine monotonic clock, in milliseconds."""
    return int(get_lib().lument_get_time_ms())


def random() -> float:
    """Uniform float in ``[0.0, 1.0)``."""
    return float(get_lib().lument_random())


def random_range(min_value: float, max_value: float) -> float:
    """Uniform float in ``[min_value, max_value)``."""
    return float(get_lib().lument_random_range(float(min_value), float(max_value)))


def log(message: str) -> None:
    """Write ``message`` through the engine's logging system."""
    get_lib().lument_log(_to_cstr(message) or b"")


# ===========================================================================
# Helpers
# ===========================================================================


class suppress_exceptions:
    """``contextlib.suppress`` analogue that swallows *all* exceptions.

    Used inside C trampolines and ``__del__`` where raising would cross the
    ctypes boundary.  Defining a local variant avoids importing
    ``contextlib`` for a one-shot use and keeps exception handling explicit.
    """

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return exc_type is not None  # swallow everything
