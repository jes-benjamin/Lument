"""Pixel-art sprite authoring helper.

:class:`Sprite` lets you build small textures directly in Python by painting
individual pixels (or small rectangles) and then uploading the resulting RGBA
buffer to the engine with :meth:`Sprite.upload`.  This is convenient for
retro-style games that generate art procedurally or load it from a compact
custom format.

Example
-------

.. code-block:: python

    from lument import Engine, LumentColor, LumentRect, Sprite

    with Engine(width=128, height=128) as engine:
        smiley = Sprite(8, 8)
        smiley.fill(LumentColor.TRANSPARENT)
        smiley.rect(1, 1, 6, 6, LumentColor.YELLOW)
        smiley.pixel(2, 2, LumentColor.BLACK)
        smiley.pixel(5, 2, LumentColor.BLACK)
        smiley.pixel(2, 5, LumentColor.BLACK)
        smiley.pixel(3, 6, LumentColor.BLACK)
        smiley.pixel(4, 6, LumentColor.BLACK)
        smiley.pixel(5, 5, LumentColor.BLACK)
        tex = smiley.upload(engine.renderer)
        engine.renderer.draw_sprite(tex, LumentRect(0, 0, 64, 64))
"""

from __future__ import annotations

from typing import Iterable, List, Optional, Tuple

from .core import LumentColor, get_lib

__all__ = ["Sprite"]

#: Type alias for a 2D pixel coordinate / size pair.
XY = Tuple[int, int]


class Sprite:
    """An in-memory RGBA pixel buffer used to author textures.

    Parameters
    ----------
    width, height:
        Dimensions of the sprite in pixels.
    background:
        Color used to initialise the whole buffer.  Defaults to fully
        transparent black.
    """

    __slots__ = ("_width", "_height", "_pixels")

    def __init__(
        self,
        width: int,
        height: int,
        background: LumentColor = LumentColor.TRANSPARENT,
    ) -> None:
        if width <= 0 or height <= 0:
            raise ValueError("Sprite dimensions must be positive")
        self._width = int(width)
        self._height = int(height)
        # One RGBA pixel == 4 bytes; replicate the background pixel everywhere.
        self._pixels: bytearray = bytearray(bytes(background) * (width * height))

    # -- properties ------------------------------------------------------
    @property
    def width(self) -> int:
        return self._width

    @property
    def height(self) -> int:
        return self._height

    @property
    def size(self) -> Tuple[int, int]:
        return (self._width, self._height)

    @property
    def rgba(self) -> bytes:
        """Read-only view of the raw RGBA pixel buffer."""
        return bytes(self._pixels)

    # -- bounds ----------------------------------------------------------
    def _index(self, x: int, y: int) -> int:
        if not (0 <= x < self._width and 0 <= y < self._height):
            raise IndexError(
                f"Pixel ({x}, {y}) out of {self._width}x{self._height} bounds"
            )
        return (y * self._width + x) * 4

    def _pixel_fast(self, x: int, y: int, raw: bytes) -> None:
        """Write a 4-byte RGBA pixel without bounds checking."""
        idx = (y * self._width + x) * 4
        self._pixels[idx:idx + 4] = raw

    # -- single pixels ---------------------------------------------------
    def pixel(self, x: int, y: int, color: LumentColor) -> "Sprite":
        """Set a single pixel.  Returns ``self`` for chaining."""
        idx = self._index(x, y)
        self._pixels[idx:idx + 4] = bytes(color)
        return self

    def get_pixel(self, x: int, y: int) -> LumentColor:
        """Return the color of a single pixel."""
        idx = self._index(x, y)
        r, g, b, a = self._pixels[idx:idx + 4]
        return LumentColor(r, g, b, a)

    # -- regions ---------------------------------------------------------
    def fill(self, color: LumentColor) -> "Sprite":
        """Fill the entire sprite with ``color``."""
        self._pixels = bytearray(bytes(color) * (self._width * self._height))
        return self

    def rect(
        self,
        x: int,
        y: int,
        w: int,
        h: int,
        color: LumentColor,
        filled: bool = True,
    ) -> "Sprite":
        """Draw a rectangle.

        When ``filled`` is ``False`` only the outline is painted.  The region
        is clipped to the sprite bounds.
        """
        x0, y0 = max(0, x), max(0, y)
        x1, y1 = min(self._width, x + w), min(self._height, y + h)
        if x0 >= x1 or y0 >= y1:
            return self

        raw = bytes(color)
        if filled:
            span = raw * (x1 - x0)
            for row in range(y0, y1):
                start = (row * self._width + x0) * 4
                self._pixels[start:start + len(span)] = span
        else:
            for col in range(x0, x1):
                self._pixel_fast(col, y0, raw)
                self._pixel_fast(col, y1 - 1, raw)
            for row in range(y0, y1):
                self._pixel_fast(x0, row, raw)
                self._pixel_fast(x1 - 1, row, raw)
        return self

    def line(
        self,
        x0: int,
        y0: int,
        x1: int,
        y1: int,
        color: LumentColor,
    ) -> "Sprite":
        """Draw a 1-pixel line using Bresenham's algorithm."""
        raw = bytes(color)
        dx = abs(x1 - x0)
        dy = -abs(y1 - y0)
        sx = 1 if x0 < x1 else -1
        sy = 1 if y0 < y1 else -1
        err = dx + dy
        while True:
            if 0 <= x0 < self._width and 0 <= y0 < self._height:
                self._pixel_fast(x0, y0, raw)
            if x0 == x1 and y0 == y1:
                break
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy
        return self

    def paste(self, other: "Sprite", x: int = 0, y: int = 0) -> "Sprite":
        """Composite ``other`` onto this sprite at ``(x, y)``.

        Source-over blending: fully-transparent source pixels are skipped so
        the destination shows through.
        """
        for sy in range(other._height):
            for sx in range(other._width):
                src_idx = (sy * other._width + sx) * 4
                src = other._pixels[src_idx:src_idx + 4]
                if src[3] == 0:
                    continue
                tx, ty = x + sx, y + sy
                if 0 <= tx < self._width and 0 <= ty < self._height:
                    dst_idx = (ty * self._width + tx) * 4
                    self._pixels[dst_idx:dst_idx + 4] = src
        return self

    def flip(
        self,
        horizontal: bool = True,
        vertical: bool = False,
    ) -> "Sprite":
        """Flip the sprite in place along the requested axes."""
        if not horizontal and not vertical:
            return self
        rows: List[bytes] = self._rows()
        if vertical:
            rows.reverse()
        if horizontal:
            rows = [self._flip_row(row) for row in rows]
        self._pixels = bytearray(b"".join(rows))
        return self

    def copy(self) -> "Sprite":
        """Return an independent copy of this sprite."""
        clone = Sprite(self._width, self._height)
        clone._pixels = bytearray(self._pixels)
        return clone

    # -- iteration helpers ----------------------------------------------
    def _rows(self) -> List[bytes]:
        stride = self._width * 4
        return [
            bytes(self._pixels[row * stride:(row + 1) * stride])
            for row in range(self._height)
        ]

    @staticmethod
    def _flip_row(row: bytes) -> bytes:
        """Reverse pixel order within a single row (each pixel == 4 bytes)."""
        return b"".join(row[i:i + 4] for i in range(len(row) - 4, -1, -4))

    # -- upload ----------------------------------------------------------
    def upload(self, renderer: Optional["object"] = None) -> int:
        """Upload the buffer to the engine, returning a texture id.

        ``renderer`` may be a :class:`~lument.core.Renderer` or
        ``None``.  When ``None`` the function calls the C ABI directly via the
        module singleton.  Returns ``0`` if the engine failed to create the
        texture.
        """
        rgba = bytes(self._pixels)
        if renderer is not None and hasattr(renderer, "create_texture"):
            return renderer.create_texture(self._width, self._height, rgba)
        return _upload_direct(self._width, self._height, rgba)

    def to_texture(self, renderer: Optional["object"] = None) -> int:
        """Alias for :meth:`upload`."""
        return self.upload(renderer)

    # -- loading from external data -------------------------------------
    @classmethod
    def from_rgba(cls, width: int, height: int, data: bytes) -> "Sprite":
        """Build a sprite from a pre-existing RGBA byte buffer."""
        if len(data) != width * height * 4:
            raise ValueError(
                f"Expected {width * height * 4} bytes, got {len(data)}"
            )
        sprite = cls(width, height)
        sprite._pixels = bytearray(data)
        return sprite

    def __repr__(self) -> str:  # pragma: no cover - debug aid
        return f"Sprite(width={self._width}, height={self._height})"


def _upload_direct(width: int, height: int, rgba: bytes) -> int:
    """Call :c:func:`lument_create_texture_from_data` without a Renderer handle.

    Used by :meth:`Sprite.upload` when no renderer is supplied.
    """
    import ctypes

    lib = get_lib()
    buf = (ctypes.c_uint8 * len(rgba)).from_buffer_copy(rgba)
    return int(lib.lument_create_texture_from_data(int(width), int(height), buf))
