package com.lument.engine;

/**
 * Rendering API wrapper around the C ABI drawing and texture functions.
 *
 * <p>All methods are static and forward to the native engine through the JNI
 * bridge. Colors are passed as packed {@code 0xAARRGGBB} ints (see
 * {@link LumentColor#pack()}) and rectangles are expanded to their four float
 * components before crossing the JNI boundary, avoiding struct marshalling.
 *
 * <p>Texture ids are opaque {@code int} handles returned by
 * {@link #loadTexture(String)} / {@link #createTextureFromData(int, int, byte[])}.
 * The special value {@code 0} indicates an invalid/failed texture.
 */
public final class Renderer {

    /** Returned by texture loaders when loading fails. */
    public static final int INVALID_TEXTURE = 0;

    private Renderer() {
        // No instances; all API is static.
    }

    // ------------------------------------------------------------------
    // Drawing.
    // ------------------------------------------------------------------

    /**
     * Clears the whole back buffer with the given color. Maps to
     * {@code lument_clear(LumentColor)}.
     *
     * @param color clear color
     */
    public static void clear(LumentColor color) {
        nClear(color.pack());
    }

    /**
     * Positions and zooms the camera. Maps to {@code lument_set_camera()}.
     *
     * @param x    camera center X
     * @param y    camera center Y
     * @param zoom zoom factor (1.0 = default)
     */
    public static void setCamera(float x, float y, float zoom) {
        nSetCamera(x, y, zoom);
    }

    /**
     * Draws a rectangle. Maps to {@code lument_draw_rect(LumentRect, LumentColor, bool)}.
     *
     * @param rect   destination rectangle
     * @param color  fill / stroke color
     * @param filled true to fill, false to outline
     */
    public static void drawRect(LumentRect rect, LumentColor color, boolean filled) {
        nDrawRect(rect.x, rect.y, rect.w, rect.h, color.pack(), filled);
    }

    /**
     * Draws a textured sprite. Maps to
     * {@code lument_draw_sprite(uint32_t textureId, LumentRect dest, LumentRect src)}.
     *
     * @param textureId texture handle from {@link #loadTexture(String)}
     * @param dest       on-screen destination rectangle
     * @param src        sub-rectangle of the source texture (use the full
     *                   texture bounds for the whole image)
     */
    public static void drawSprite(int textureId, LumentRect dest, LumentRect src) {
        nDrawSprite(textureId,
                dest.x, dest.y, dest.w, dest.h,
                src.x, src.y, src.w, src.h);
    }

    /**
     * Draws a string of text. Maps to
     * {@code lument_draw_text(const char*, float, float, float, LumentColor)}.
     *
     * @param text  text to draw
     * @param x     baseline X
     * @param y     baseline Y
     * @param size  font size in pixels
     * @param color text color
     */
    public static void drawText(String text, float x, float y, float size, LumentColor color) {
        if (text == null) {
            text = "";
        }
        nDrawText(text, x, y, size, color.pack());
    }

    /**
     * Draws a single pixel. Maps to {@code lument_draw_pixel(int, int, LumentColor)}.
     *
     * @param x     pixel X
     * @param y     pixel Y
     * @param color pixel color
     */
    public static void drawPixel(int x, int y, LumentColor color) {
        nDrawPixel(x, y, color.pack());
    }

    /**
     * Flushes any pending render batches immediately. Maps to
     * {@code lument_flush()}. Normally {@link Engine#endFrame()} flushes for you;
     * call this when you need a deterministic ordering mid-frame.
     */
    public static void flush() {
        nFlush();
    }

    // ------------------------------------------------------------------
    // Texture management.
    // ------------------------------------------------------------------

    /**
     * Loads a texture from a file path. Maps to {@code lument_load_texture()}.
     *
     * <p>On desktop {@code path} is a regular filesystem path. On Android the
     * path is resolved through the engine's Android asset layer (the JNI
     * bridge publishes the {@link android.content.res.AssetManager} that
     * {@link com.lument.engine.android.AndroidEngine} registers); pass a
     * path relative to the APK {@code assets/} folder.
     *
     * @param path texture file path
     * @return texture id, or {@link #INVALID_TEXTURE} on failure
     */
    public static int loadTexture(String path) {
        if (path == null) {
            return INVALID_TEXTURE;
        }
        return nLoadTexture(path);
    }

    /**
     * Creates a texture from raw RGBA pixel data. Maps to
     * {@code lument_create_texture_from_data(int, int, const uint8_t*)}.
     *
     * @param width  texture width in pixels
     * @param height texture height in pixels
     * @param rgba   {@code width*height*4} bytes of RGBA data
     * @return texture id, or {@link #INVALID_TEXTURE} on failure
     */
    public static int createTextureFromData(int width, int height, byte[] rgba) {
        if (rgba == null) {
            throw new IllegalArgumentException("rgba must not be null");
        }
        if (rgba.length < (long) width * height * 4) {
            throw new IllegalArgumentException(
                    "rgba buffer too small: expected " + ((long) width * height * 4)
                            + " bytes, got " + rgba.length);
        }
        return nCreateTextureFromData(width, height, rgba);
    }

    /**
     * Destroys a texture and frees its GPU memory. Maps to
     * {@code lument_destroy_texture()}.
     *
     * @param id texture id returned by a load/create call
     */
    public static void destroyTexture(int id) {
        nDestroyTexture(id);
    }

    // ==================================================================
    // JNI native method declarations.
    // ==================================================================

    private static native void nClear(int color);
    private static native void nSetCamera(float x, float y, float zoom);
    private static native void nDrawRect(float x, float y, float w, float h,
                                         int color, boolean filled);
    private static native void nDrawSprite(int textureId,
                                           float dx, float dy, float dw, float dh,
                                           float sx, float sy, float sw, float sh);
    private static native void nDrawText(String text, float x, float y, float size,
                                          int color);
    private static native void nDrawPixel(int x, int y, int color);
    private static native void nFlush();

    private static native int nLoadTexture(String path);
    private static native int nCreateTextureFromData(int width, int height, byte[] rgba);
    private static native void nDestroyTexture(int id);
}
