package com.lument.engine;

/**
 * Engine configuration, mirroring the C ABI {@code LumentConfig} struct.
 *
 * <p>This is a fluent builder: every setter returns {@code this} so a config
 * can be constructed inline, e.g.
 * <pre>{@code
 * LumentConfig config = new LumentConfig()
 *         .platform(Engine.PLATFORM_ANDROID)
 *         .rendererType(Engine.RENDERER_OPENGLES)
 *         .width(1280).height(720)
 *         .targetFPS(60)
 *         .assetPath("assets");
 * Engine.init(config);
 * }</pre>
 *
 * <p>The platform/renderer constants live on {@link Engine}; this class only
 * holds plain values that the JNI bridge forwards to {@code lument_init}.
 */
public final class LumentConfig {

    /** Target platform. One of the {@code Engine.PLATFORM_*} constants. */
    public int platform = Engine.PLATFORM_DESKTOP;
    /** Renderer backend. One of the {@code Engine.RENDERER_*} constants. */
    public int rendererType = Engine.RENDERER_OPENGL;
    /** Canvas/back-buffer width in pixels. */
    public int width = 1280;
    /** Canvas/back-buffer height in pixels. */
    public int height = 720;
    /** Target frame rate. */
    public float targetFPS = 60f;
    /** Enable vertical sync. */
    public boolean vsync = true;
    /** Run in fullscreen mode (desktop only). */
    public boolean fullscreen = false;
    /** Filesystem path (or Android asset prefix) used to resolve assets. */
    public String assetPath = "";
    /** Filesystem path used for save-data persistence. */
    public String savePath = "";

    /** Creates a default desktop/OpenGL configuration. */
    public LumentConfig() {
    }

    public LumentConfig platform(int platform)           { this.platform = platform; return this; }
    public LumentConfig rendererType(int rendererType)   { this.rendererType = rendererType; return this; }
    public LumentConfig width(int width)                  { this.width = width; return this; }
    public LumentConfig height(int height)                { this.height = height; return this; }
    public LumentConfig targetFPS(float targetFPS)       { this.targetFPS = targetFPS; return this; }
    public LumentConfig vsync(boolean vsync)             { this.vsync = vsync; return this; }
    public LumentConfig fullscreen(boolean fullscreen)   { this.fullscreen = fullscreen; return this; }
    public LumentConfig assetPath(String assetPath)      { this.assetPath = assetPath; return this; }
    public LumentConfig savePath(String savePath)         { this.savePath = savePath; return this; }

    @Override
    public String toString() {
        return "LumentConfig(platform=" + platform + ", rendererType=" + rendererType
                + ", width=" + width + ", height=" + height
                + ", targetFPS=" + targetFPS + ", vsync=" + vsync
                + ", fullscreen=" + fullscreen
                + ", assetPath='" + assetPath + "'"
                + ", savePath='" + savePath + "')";
    }
}
