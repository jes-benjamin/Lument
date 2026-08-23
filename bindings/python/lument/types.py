"""Enumerations mirroring the C ``typedef enum`` declarations in
``lument.h``.

All enums are :class:`enum.IntEnum` subclasses so they can be passed directly
to the ctypes layer (they behave like plain ``int``) while remaining readable
and self-documenting on the Python side.
"""

from __future__ import annotations

from enum import IntEnum

__all__ = [
    "LumentPlatform",
    "LumentRendererType",
    "UEInputType",
    "LumentKey",
    "UEComponentType",
    "LumentWidgetType",
    "LumentLayoutType",
    "LumentEventType",
]


class LumentPlatform(IntEnum):
    """Target runtime platform.

    Mirrors the ``LumentPlatform`` C enum.
    """

    DESKTOP = 0  #: Windows / Linux / macOS
    ANDROID = 1  #: Android
    IOS = 2  #: iOS
    WEB = 3  #: WebAssembly / Browser


class LumentRendererType(IntEnum):
    """Graphics backend used by the engine.

    Mirrors the ``LumentRendererType`` C enum.
    """

    OPENGL = 0  #: Desktop OpenGL
    OPENGLES = 1  #: Mobile OpenGL ES
    WEBGL = 2  #: Web WebGL
    CANVAS2D = 3  #: HTML5 Canvas 2D
    VULKAN = 4  #: Vulkan (future)


class UEInputType(IntEnum):
    """Logical input device category.

    Mirrors the ``UEInputType`` C enum.
    """

    NONE = 0
    KEYBOARD = 1
    TOUCH = 2
    GAMEPAD = 3
    MOUSE = 4


class LumentKey(IntEnum):
    """Abstract, engine-level key codes.

    The engine exposes a small, fixed set of logical keys so that the same
    gameplay code works across keyboard, touch and gamepad.  Mirrors the
    ``LumentKey`` C enum.
    """

    NONE = 0
    LEFT = 1
    RIGHT = 2
    UP = 3
    DOWN = 4
    ACTION = 5  #: Confirm / interact
    CANCEL = 6  #: Cancel / back
    MENU = 7  #: Menu / pause
    MAX = 8


class UEComponentType(IntEnum):
    """ECS component type identifiers.

    Mirrors the ``UEComponentType`` C enum.
    """

    NONE = 0
    TRANSFORM = 1  #: Position / rotation / scale
    SPRITE = 2  #: Sprite rendering
    PHYSICS = 3  #: Physics body
    COLLIDER = 4  #: Collider
    SCRIPT = 5  #: Script component
    AUDIO = 6  #: Audio source
    CAMERA = 7  #: Camera
    TEXT = 8  #: Text rendering
    ANIMATOR = 9  #: Animator


class LumentWidgetType(IntEnum):
    """UI widget type identifiers.

    Mirrors the ``LumentWidgetType`` C enum.  Selects the kind of widget created
    by :meth:`~lument.core.UIManager.create`.
    """

    NONE = 0
    CONTAINER = 1  #: Container (nestable)
    BUTTON = 2  #: Button
    LABEL = 3  #: Text label
    INPUT = 4  #: Text input field
    IMAGE = 5  #: Image
    LIST = 6  #: List / scroll view
    PROGRESS = 7  #: Progress bar
    CHECKBOX = 8  #: Checkbox
    SLIDER = 9  #: Slider
    TABBAR = 10  #: Tab bar
    NAVBAR = 11  #: Navigation bar


class LumentLayoutType(IntEnum):
    """UI layout strategy for a container widget.

    Mirrors the ``LumentLayoutType`` C enum.
    """

    NONE = 0  #: Absolute positioning
    VERTICAL = 1  #: Stack children top-to-bottom
    HORIZONTAL = 2  #: Lay children out left-to-right
    GRID = 3  #: Grid layout
    STACK = 4  #: Stack along the Z axis


class LumentEventType(IntEnum):
    """UI event type identifiers.

    Mirrors the ``LumentEventType`` C enum.  Used to subscribe a widget to a
    specific event via :meth:`~lument.core.UIManager.on_event`.
    """

    NONE = 0
    CLICK = 1
    FOCUS = 2
    BLUR = 3
    CHANGE = 4
    SCROLL = 5
