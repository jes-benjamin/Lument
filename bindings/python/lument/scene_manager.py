"""High-level scene management with Python callbacks.

The C ABI only exposes primitive scene helpers (load by name, set active,
set background).  This module adds a fully featured *scene stack* on top of
those primitives, where each scene is a plain Python object that implements
``on_enter`` / ``on_exit`` / ``on_update`` / ``on_render`` callbacks.

This lets you structure a game as a set of self-contained :class:`SceneBase`
subclasses and drive them through :class:`SceneManager`::

    from lument import Engine, LumentColor
    from lument.scene_manager import SceneBase, SceneManager

    class TitleScene(SceneBase):
        def on_enter(self, ctx):
            ctx.scene.set_background(LumentColor.BLACK)

        def on_update(self, ctx, dt):
            if ctx.input.key_pressed(ctx.key("ACTION")):
                ctx.manager.push(GameScene())

        def on_render(self, ctx):
            ctx.engine.renderer.draw_text("Press ACTION", 10, 10, 16, LumentColor.WHITE)

    with Engine(width=320, height=480) as engine:
        manager = SceneManager(engine)
        manager.push(TitleScene())
        engine.run(manager.frame)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, List, Optional

from .core import LumentColor, LumentKey
from .types import LumentKey as _LumentKey  # noqa: F401  (re-exported below)

if TYPE_CHECKING:  # pragma: no cover
    from .core import Engine

__all__ = ["SceneBase", "SceneManager", "SceneContext", "SceneTransition"]


class SceneContext:
    """Object passed to every scene callback.

    Bundles the engine, the owning :class:`SceneManager` and a few conveniences
    so that scene classes do not have to thread multiple arguments around.
    """

    __slots__ = ("engine", "manager", "_data")

    def __init__(self, engine: "Engine", manager: "SceneManager") -> None:
        self.engine = engine
        self.manager = manager
        # Per-scene scratch storage (cleared on enter).
        self._data: dict = {}

    # -- convenience accessors ------------------------------------------
    @property
    def renderer(self):
        return self.engine.renderer

    @property
    def input(self):
        return self.engine.input

    @property
    def audio(self):
        return self.engine.audio

    @property
    def ecs(self):
        return self.engine.ecs

    @property
    def scene(self):
        """The low-level :class:`~lument.core.Scene` wrapper."""
        return self.engine.scene

    @property
    def storage(self):
        return self.engine.storage

    # -- per-scene storage ----------------------------------------------
    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def set(self, key: str, value) -> None:
        self._data[key] = value

    def has(self, key: str) -> bool:
        return key in self._data

    # -- key helper ------------------------------------------------------
    @staticmethod
    def key(name: str) -> LumentKey:
        """Look up a :class:`LumentKey` by name (case-insensitive).

        >>> SceneContext.key("left")
        <LumentKey.LEFT: 1>
        """
        return _key_from_name(name)


class SceneBase:
    """Base class for game scenes.

    Subclass and override any of the callbacks below.  All callbacks receive
    a :class:`SceneContext` and are optional — the default implementations are
    no-ops so you only implement what you need.
    """

    #: Optional name used for debugging / logging.
    name: str = "scene"

    # -- lifecycle -------------------------------------------------------
    def on_enter(self, ctx: SceneContext) -> None:
        """Called once when the scene becomes the top of the stack."""

    def on_exit(self, ctx: SceneContext) -> None:
        """Called once when the scene is popped or replaced."""

    # -- per-frame -------------------------------------------------------
    def on_update(self, ctx: SceneContext, delta_time: float) -> None:
        """Called every frame before rendering.  ``delta_time`` is in ms."""

    def on_render(self, ctx: SceneContext) -> None:
        """Called every frame after :meth:`on_update`."""

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"<{type(self).__name__} name={self.name!r}>"


@dataclass
class SceneTransition:
    """Declarative description of a scene change requested during a frame.

    Scenes request transitions by returning one of these from
    :meth:`SceneBase.on_update` (handled by :class:`SceneManager`).  Using a
    dataclass keeps the transition intent explicit and testable.
    """

    kind: str  # "push", "pop", "replace", "switch"
    scene: Optional[SceneBase] = None

    @classmethod
    def push(cls, scene: SceneBase) -> "SceneTransition":
        return cls("push", scene)

    @classmethod
    def replace(cls, scene: SceneBase) -> "SceneTransition":
        return cls("replace", scene)

    @classmethod
    def switch(cls, scene: SceneBase) -> "SceneTransition":
        return cls("switch", scene)

    @classmethod
    def pop(cls) -> "SceneTransition":
        return cls("pop", None)


class SceneManager:
    """Owns a stack of :class:`SceneBase` instances and drives them.

    The typical usage is to construct it once with an :class:`Engine`, push an
    initial scene, and then pass :meth:`frame` as the engine's main-loop
    callback::

        manager = SceneManager(engine)
        manager.push(TitleScene())
        engine.run(manager.frame)

    Scenes are pushed/popped like a call stack; only the top scene receives
    ``on_update`` / ``on_render`` (lower scenes are *paused*).  If you need
    overlays that render underneath, override :meth:`on_render` in a base
    overlay class to delegate to the previous scene.
    """

    def __init__(self, engine: "Engine") -> None:
        self._engine = engine
        self._stack: List[SceneBase] = []
        self._ctx = SceneContext(engine, self)
        self._pending: Optional[SceneTransition] = None

    # -- stack inspection ------------------------------------------------
    @property
    def engine(self) -> "Engine":
        return self._engine

    @property
    def current(self) -> Optional[SceneBase]:
        """The active (top) scene, or ``None`` when the stack is empty."""
        return self._stack[-1] if self._stack else None

    @property
    def depth(self) -> int:
        return len(self._stack)

    def is_empty(self) -> bool:
        return not self._stack

    # -- mutation --------------------------------------------------------
    def push(self, scene: SceneBase) -> None:
        """Pause the current scene and push ``scene`` on top."""
        prev = self.current
        # Note: we do NOT call on_exit for paused scenes; that only fires on
        # actual removal.
        self._stack.append(scene)
        self._reset_context(scene)
        scene.on_enter(self._ctx)
        self._log(f"pushed {scene.name} (depth={self.depth})")

    def pop(self) -> Optional[SceneBase]:
        """Remove and return the top scene, calling ``on_exit`` on it."""
        if not self._stack:
            return None
        scene = self._stack.pop()
        self._ctx._data.clear()
        scene.on_exit(self._ctx)
        self._log(f"popped {scene.name} (depth={self.depth})")
        return scene

    def replace(self, scene: SceneBase) -> None:
        """Replace the top scene with ``scene`` (no extra stack frame)."""
        if not self._stack:
            self.push(scene)
            return
        old = self._stack[-1]
        old.on_exit(self._ctx)
        self._stack[-1] = scene
        self._reset_context(scene)
        scene.on_enter(self._ctx)
        self._log(f"replaced {old.name} -> {scene.name}")

    def switch(self, scene: SceneBase) -> None:
        """Clear the whole stack and start fresh with ``scene``."""
        while self._stack:
            old = self._stack.pop()
            self._ctx._data.clear()
            old.on_exit(self._ctx)
        self.push(scene)

    def clear(self) -> None:
        """Pop every scene."""
        while self._stack:
            self.pop()

    # -- transition requests --------------------------------------------
    def request(self, transition: SceneTransition) -> None:
        """Schedule a transition to apply at the end of the current frame.

        Only the most recent request wins; calling this multiple times in a
        single frame replaces the pending transition.
        """
        self._pending = transition

    # -- main loop driver ------------------------------------------------
    def frame(self, engine: "Engine", delta_time: float) -> None:
        """Single-frame callback suitable for :meth:`Engine.run`.

        Updates the active scene, then renders it, then applies any transition
        requested via :meth:`request` or returned from ``on_update``.
        """
        scene = self.current
        if scene is None:
            return

        transition = scene.on_update(self._ctx, delta_time)
        scene.on_render(self._ctx)

        # A returned transition takes precedence over request().
        if isinstance(transition, SceneTransition):
            self._pending = transition

        self._apply_pending()

    # -- internal --------------------------------------------------------
    def _apply_pending(self) -> None:
        pending = self._pending
        self._pending = None
        if pending is None:
            return
        if pending.kind == "push" and pending.scene is not None:
            self.push(pending.scene)
        elif pending.kind == "pop":
            self.pop()
        elif pending.kind == "replace" and pending.scene is not None:
            self.replace(pending.scene)
        elif pending.kind == "switch" and pending.scene is not None:
            self.switch(pending.scene)

    def _reset_context(self, scene: SceneBase) -> None:
        """Give the entering scene a fresh per-scene scratch dict."""
        self._ctx._data = {}

    def _log(self, message: str) -> None:
        # Route through the engine logger when available, staying quiet if the
        # native library is not loaded (e.g. during unit tests).
        try:
            from .core import get_lib, log as lument_log

            get_lib()  # ensure loaded
            lument_log(f"[scene] {message}")
        except Exception:
            pass

    # -- context manager style usage ------------------------------------
    def __enter__(self) -> "SceneManager":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.clear()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_KEY_ALIASES = {
    "ok": LumentKey.ACTION,
    "enter": LumentKey.ACTION,
    "return": LumentKey.ACTION,
    "esc": LumentKey.CANCEL,
    "escape": LumentKey.CANCEL,
    "back": LumentKey.CANCEL,
    "pause": LumentKey.MENU,
    "select": LumentKey.MENU,
    "space": LumentKey.ACTION,
}


def _key_from_name(name: str) -> LumentKey:
    """Resolve a friendly key name to a :class:`LumentKey`.

    Lookup is case-insensitive.  Recognised aliases (``ok``/``enter`` ->
    ``ACTION``, ``esc``/``back`` -> ``CANCEL``, ``pause`` -> ``MENU`` ...)
    are tried first, then the raw enum member name (``"left"`` ->
    :attr:`LumentKey.LEFT``).
    """
    key = name.strip()
    low = key.lower()
    if low in _KEY_ALIASES:
        return _KEY_ALIASES[low]
    upper = key.upper()
    # "KEY_LEFT" / "key_left" -> "LEFT"
    if upper.startswith("KEY_"):
        upper = upper[4:]
    try:
        return LumentKey[upper]
    except KeyError as exc:
        raise ValueError(f"Unknown key name: {name!r}") from exc
