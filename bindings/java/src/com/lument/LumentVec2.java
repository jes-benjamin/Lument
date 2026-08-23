package com.lument.engine;

/**
 * 2D vector, mirroring the C ABI {@code LumentVec2} struct.
 *
 * <p>Members are single-precision floats {@code x} and {@code y}.
 */
public final class LumentVec2 {

    /** X component. */
    public float x;
    /** Y component. */
    public float y;

    /** Creates a zero vector. */
    public LumentVec2() {
        this(0f, 0f);
    }

    /**
     * Creates a vector.
     *
     * @param x X component
     * @param y Y component
     */
    public LumentVec2(float x, float y) {
        this.x = x;
        this.y = y;
    }

    /**
     * Sets both components.
     *
     * @return this vector for chaining
     */
    public LumentVec2 set(float x, float y) {
        this.x = x;
        this.y = y;
        return this;
    }

    /**
     * Adds another vector in place.
     *
     * @param other vector to add
     * @return this vector
     */
    public LumentVec2 add(LumentVec2 other) {
        this.x += other.x;
        this.y += other.y;
        return this;
    }

    /**
     * Subtracts another vector in place.
     *
     * @param other vector to subtract
     * @return this vector
     */
    public LumentVec2 sub(LumentVec2 other) {
        this.x -= other.x;
        this.y -= other.y;
        return this;
    }

    /**
     * Scales this vector in place.
     *
     * @param s scalar
     * @return this vector
     */
    public LumentVec2 scale(float s) {
        this.x *= s;
        this.y *= s;
        return this;
    }

    /** @return the squared length. */
    public float lengthSquared() {
        return x * x + y * y;
    }

    /** @return the length (magnitude). */
    public float length() {
        return (float) Math.sqrt(lengthSquared());
    }

    /**
     * Normalizes this vector in place. No-op if length is zero.
     *
     * @return this vector
     */
    public LumentVec2 normalize() {
        float len = length();
        if (len > 0f) {
            float inv = 1f / len;
            x *= inv;
            y *= inv;
        }
        return this;
    }

    /** @return a new vector that is the negation of this one. */
    public LumentVec2 negate() {
        return new LumentVec2(-x, -y);
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof LumentVec2)) return false;
        LumentVec2 v = (LumentVec2) o;
        return Float.compare(x, v.x) == 0 && Float.compare(y, v.y) == 0;
    }

    @Override
    public int hashCode() {
        int result = (x != 0f ? Float.floatToIntBits(x) : 0);
        result = 31 * result + (y != 0f ? Float.floatToIntBits(y) : 0);
        return result;
    }

    @Override
    public String toString() {
        return "LumentVec2(x=" + x + ", y=" + y + ")";
    }
}
