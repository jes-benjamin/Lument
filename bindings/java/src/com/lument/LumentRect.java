package com.lument.engine;

/**
 * Axis-aligned rectangle, mirroring the C ABI {@code LumentRect} struct.
 *
 * <p>All members are single-precision floats:
 * <ul>
 *   <li>{@code x}, {@code y} - top-left corner position</li>
 *   <li>{@code w}, {@code h} - width and height</li>
 * </ul>
 */
public final class LumentRect {

    /** Top-left X coordinate. */
    public float x;
    /** Top-left Y coordinate. */
    public float y;
    /** Width. */
    public float w;
    /** Height. */
    public float h;

    /** Creates a zero-size rectangle at the origin. */
    public LumentRect() {
        this(0f, 0f, 0f, 0f);
    }

    /**
     * Creates a rectangle.
     *
     * @param x top-left X
     * @param y top-left Y
     * @param w width
     * @param h height
     */
    public LumentRect(float x, float y, float w, float h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
    }

    /**
     * Sets all four components.
     *
     * @return this rectangle for chaining
     */
    public LumentRect set(float x, float y, float w, float h) {
        this.x = x;
        this.y = y;
        this.w = w;
        this.h = h;
        return this;
    }

    /** @return the right edge (x + w). */
    public float right()  { return x + w; }
    /** @return the bottom edge (y + h). */
    public float bottom() { return y + h; }

    /** @return the horizontal center (x + w/2). */
    public float centerX() { return x + w * 0.5f; }
    /** @return the vertical center (y + h/2). */
    public float centerY() { return y + h * 0.5f; }

    /**
     * Tests whether a point is inside this rectangle (inclusive).
     *
     * @param px point X
     * @param py point Y
     * @return true if the point lies within the rectangle
     */
    public boolean contains(float px, float py) {
        return px >= x && px <= right() && py >= y && py <= bottom();
    }

    /**
     * Tests whether this rectangle overlaps another.
     *
     * @param other another rectangle
     * @return true if the rectangles intersect
     */
    public boolean intersects(LumentRect other) {
        return x < other.right() && right() > other.x
            && y < other.bottom() && bottom() > other.y;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof LumentRect)) return false;
        LumentRect r = (LumentRect) o;
        return Float.compare(x, r.x) == 0
            && Float.compare(y, r.y) == 0
            && Float.compare(w, r.w) == 0
            && Float.compare(h, r.h) == 0;
    }

    @Override
    public int hashCode() {
        int result = (x != 0f ? Float.floatToIntBits(x) : 0);
        result = 31 * result + (y != 0f ? Float.floatToIntBits(y) : 0);
        result = 31 * result + (w != 0f ? Float.floatToIntBits(w) : 0);
        result = 31 * result + (h != 0f ? Float.floatToIntBits(h) : 0);
        return result;
    }

    @Override
    public String toString() {
        return "LumentRect(x=" + x + ", y=" + y + ", w=" + w + ", h=" + h + ")";
    }
}
