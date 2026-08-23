package com.lument.engine;

/**
 * RGBA color value, mirroring the C ABI {@code LumentColor} struct.
 *
 * <p>Components are stored as unsigned 8-bit values (Java {@code byte}). For
 * convenience the constructors and setters accept {@code int} arguments in the
 * range 0-255; values are masked to a single byte.
 *
 * <p>{@link #pack()} produces a packed {@code int} representation
 * {@code 0xAARRGGBB} that is used by the JNI bridge when passing colors to the
 * native engine. {@link #unpack(int)} reverses the operation.
 */
public final class LumentColor {

    /** Red channel (0-255, stored as signed byte). */
    public byte r;
    /** Green channel (0-255, stored as signed byte). */
    public byte g;
    /** Blue channel (0-255, stored as signed byte). */
    public byte b;
    /** Alpha channel (0-255, stored as signed byte). */
    public byte a;

    /** Creates an opaque white color. */
    public LumentColor() {
        this(255, 255, 255, 255);
    }

    /**
     * Creates an opaque RGB color.
     *
     * @param r red   (0-255)
     * @param g green (0-255)
     * @param b blue  (0-255)
     */
    public LumentColor(int r, int g, int b) {
        this(r, g, b, 255);
    }

    /**
     * Creates an RGBA color.
     *
     * @param r red   (0-255)
     * @param g green (0-255)
     * @param b blue  (0-255)
     * @param a alpha (0-255)
     */
    public LumentColor(int r, int g, int b, int a) {
        set(r, g, b, a);
    }

    /**
     * Sets all four channels. Each value is masked to a single byte.
     *
     * @param r red   (0-255)
     * @param g green (0-255)
     * @param b blue  (0-255)
     * @param a alpha (0-255)
     * @return this color for chaining
     */
    public LumentColor set(int r, int g, int b, int a) {
        this.r = (byte) r;
        this.g = (byte) g;
        this.b = (byte) b;
        this.a = (byte) a;
        return this;
    }

    /** @return the red channel as an unsigned int (0-255). */
    public int red()   { return r & 0xFF; }
    /** @return the green channel as an unsigned int (0-255). */
    public int green() { return g & 0xFF; }
    /** @return the blue channel as an unsigned int (0-255). */
    public int blue()  { return b & 0xFF; }
    /** @return the alpha channel as an unsigned int (0-255). */
    public int alpha() { return a & 0xFF; }

    /**
     * Packs this color into a single 32-bit int in {@code 0xAARRGGBB} order.
     *
     * <p>This layout matches what the JNI bridge expects when forwarding colors
     * to {@code lument_clear}, {@code lument_draw_rect}, etc.
     *
     * @return packed color
     */
    public int pack() {
        return (alpha() << 24) | (red() << 16) | (green() << 8) | blue();
    }

    /**
     * Unpacks a {@code 0xAARRGGBB} int into a new color object.
     *
     * @param packed packed color int
     * @return a new {@link LumentColor}
     */
    public static LumentColor unpack(int packed) {
        return new LumentColor(
                (packed >> 16) & 0xFF,
                (packed >> 8)  & 0xFF,
                (packed)       & 0xFF,
                (packed >>> 24) & 0xFF);
    }

    // ------------------------------------------------------------------
    // Common color presets.
    // ------------------------------------------------------------------

    public static LumentColor black()   { return new LumentColor(0, 0, 0, 255); }
    public static LumentColor white()   { return new LumentColor(255, 255, 255, 255); }
    public static LumentColor RED()     { return new LumentColor(255, 0, 0, 255); }
    public static LumentColor GREEN()   { return new LumentColor(0, 255, 0, 255); }
    public static LumentColor BLUE()    { return new LumentColor(0, 0, 255, 255); }
    public static LumentColor yellow()  { return new LumentColor(255, 255, 0, 255); }
    public static LumentColor cyan()    { return new LumentColor(0, 255, 255, 255); }
    public static LumentColor magenta() { return new LumentColor(255, 0, 255, 255); }
    public static LumentColor gray()    { return new LumentColor(128, 128, 128, 255); }
    public static LumentColor transparent() { return new LumentColor(0, 0, 0, 0); }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof LumentColor)) return false;
        LumentColor c = (LumentColor) o;
        return r == c.r && g == c.g && b == c.b && a == c.a;
    }

    @Override
    public int hashCode() {
        return pack();
    }

    @Override
    public String toString() {
        return "LumentColor(r=" + red() + ", g=" + green() + ", b=" + blue() + ", a=" + alpha() + ")";
    }
}
