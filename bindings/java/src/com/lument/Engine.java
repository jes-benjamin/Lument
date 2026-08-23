package com.lument.engine;

/**
 * Entry point for the Lument Java bindings.
 *
 * <p>This class maps the core C ABI of {@code lument.h} to Java
 * {@code native} methods. The native symbols are implemented in the JNI bridge
 * {@code engine_jni.cpp}, which is compiled into {@code liblument.so}
 * together with the engine core. The shared library is loaded exactly once via
 * {@link System#loadLibrary(String)} in the class static initializer.
 *
 * <h2>Typical desktop usage</h2>
 * <pre>{@code
 * LumentConfig config = new LumentConfig()
 *         .platform(Engine.PLATFORM_DESKTOP)
 *         .rendererType(Engine.RENDERER_OPENGL)
 *         .width(1280).height(720).targetFPS(60);
 * Engine.init(config);
 * while (Engine.isRunning()) {
 *     Engine.beginFrame();
 *     // ... update + render ...
 *     Engine.endFrame();
 * }
 * Engine.shutdown();
 * }</pre>
 *
 * <h2>Platform / renderer constants</h2>
 * The {@code PLATFORM_*} and {@code RENDERER_*} constants mirror the
 * {@code LumentPlatform} and {@code LumentRendererType} enums from the C ABI and are
 * used when constructing a {@link LumentConfig}.
 *
 * @see LumentConfig
 * @see Renderer
 * @see Input
 */
public class Engine {

    // ------------------------------------------------------------------
    // Native library loading.
    // ------------------------------------------------------------------

    /**
     * Name of the shared library that contains both the engine core and the
     * JNI bridge. On Android this resolves to {@code liblument.so}
     * inside the APK; on desktop it is {@code liblument.so} /
     * {@code lument.dll}.
     */
    public static final String NATIVE_LIBRARY = "lument";

    static {
        System.loadLibrary(NATIVE_LIBRARY);
    }

    // Protected so platform-specific subclasses (e.g. AndroidEngine) can be
    // instantiated; the core API itself is entirely static.
    protected Engine() {
    }

    // ------------------------------------------------------------------
    // Platform identifiers (LumentPlatform).
    // ------------------------------------------------------------------

    /** Windows / Linux / macOS. */
    public static final int PLATFORM_DESKTOP = 0;
    /** Android. */
    public static final int PLATFORM_ANDROID = 1;
    /** iOS. */
    public static final int PLATFORM_IOS = 2;
    /** WebAssembly / browser. */
    public static final int PLATFORM_WEB = 3;

    // ------------------------------------------------------------------
    // Renderer backends (LumentRendererType).
    // ------------------------------------------------------------------

    /** Desktop OpenGL. */
    public static final int RENDERER_OPENGL = 0;
    /** Mobile OpenGL ES. */
    public static final int RENDERER_OPENGLES = 1;
    /** Web WebGL. */
    public static final int RENDERER_WEBGL = 2;
    /** HTML5 Canvas 2D. */
    public static final int RENDERER_CANVAS2D = 3;
    /** Vulkan (future). */
    public static final int RENDERER_VULKAN = 4;

    // ------------------------------------------------------------------
    // Engine lifecycle.
    // ------------------------------------------------------------------

    /**
     * Initializes the engine with the given configuration.
     *
     * <p>Maps to {@code lument_init(const LumentConfig*)}. The bridge unpacks the
     * config fields and forwards them to the native engine.
     *
     * @param config engine configuration (non-null)
     * @return non-zero on success, zero on failure
     */
    public static int init(LumentConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("config must not be null");
        }
        return nInit(config.platform, config.rendererType,
                config.width, config.height,
                config.targetFPS, config.vsync, config.fullscreen,
                config.assetPath, config.savePath);
    }

    /**
     * Tears down the engine and releases all native resources.
     * Maps to {@code lument_shutdown()}.
     */
    public static void shutdown() {
        nShutdown();
    }

    /**
     * Returns whether the engine is still running (window open, no quit
     * requested). Maps to {@code lument_is_running()}.
     *
     * @return true while the engine should keep running
     */
    public static boolean isRunning() {
        return nIsRunning();
    }

    // ------------------------------------------------------------------
    // Frame loop.
    // ------------------------------------------------------------------

    /**
     * Begins a new frame: advances input state, computes delta time, clears
     * per-frame counters. Maps to {@code lument_begin_frame()}.
     */
    public static void beginFrame() {
        nBeginFrame();
    }

    /**
     * Ends the current frame: flushes render batches, swaps buffers.
     * Maps to {@code lument_end_frame()}.
     */
    public static void endFrame() {
        nEndFrame();
    }

    /**
     * Returns the time elapsed between the previous frame and the current one.
     * Maps to {@code lument_get_delta_time()}.
     *
     * @return delta time in milliseconds
     */
    public static float getDeltaTime() {
        return nGetDeltaTime();
    }

    /**
     * Returns the current engine statistics. Maps to {@code lument_get_stats()}.
     *
     * @return a snapshot of FPS, frame time and resource counters
     */
    public static Stats getStats() {
        float[] out = new float[5];
        nGetStats(out);
        return new Stats(out[0], out[1], (long) out[2], (long) out[3], (long) out[4]);
    }

    // ------------------------------------------------------------------
    // Platform information.
    // ------------------------------------------------------------------

    /**
     * Returns the platform the engine was built for. Maps to
     * {@code lument_get_platform()}. Compare against the {@code PLATFORM_*}
     * constants.
     *
     * @return platform identifier
     */
    public static int getPlatform() {
        return nGetPlatform();
    }

    /**
     * Returns the active renderer backend. Maps to
     * {@code lument_get_renderer_type()}. Compare against the
     * {@code RENDERER_*} constants.
     *
     * @return renderer type identifier
     */
    public static int getRendererType() {
        return nGetRendererType();
    }

    // ------------------------------------------------------------------
    // Utility helpers.
    // ------------------------------------------------------------------

    /**
     * Returns the engine's monotonic time in milliseconds. Maps to
     * {@code lument_get_time_ms()}.
     *
     * @return elapsed time in milliseconds
     */
    public static long getTimeMs() {
        return nGetTimeMs();
    }

    /**
     * Returns a pseudo-random float in {@code [0.0, 1.0)}. Maps to
     * {@code lument_random()}.
     *
     * @return random value
     */
    public static float random() {
        return nRandom();
    }

    /**
     * Returns a pseudo-random float in {@code [min, max)}. Maps to
     * {@code lument_random_range()}.
     *
     * @param min inclusive lower bound
     * @param max exclusive upper bound
     * @return random value within the range
     */
    public static float randomRange(float min, float max) {
        return nRandomRange(min, max);
    }

    /**
     * Logs a message through the engine's logging facility. Maps to
     * {@code lument_log()}.
     *
     * @param message message to log
     */
    public static void log(String message) {
        nLog(message);
    }

    // ==================================================================
    // JNI native method declarations.
    // ==================================================================

    private static native int nInit(int platform, int rendererType,
                                    int width, int height,
                                    float targetFPS, boolean vsync,
                                    boolean fullscreen,
                                    String assetPath, String savePath);

    private static native void nShutdown();
    private static native boolean nIsRunning();

    private static native void nBeginFrame();
    private static native void nEndFrame();
    private static native float nGetDeltaTime();

    /**
     * Fills {@code outStats} with 5 values in order:
     * {@code [fps, frameTime, drawCalls, entityCount, memoryUsed]}.
     */
    private static native void nGetStats(float[] outStats);

    private static native int nGetPlatform();
    private static native int nGetRendererType();

    private static native long nGetTimeMs();
    private static native float nRandom();
    private static native float nRandomRange(float min, float max);
    private static native void nLog(String message);

    // ==================================================================
    // Nested statistics container.
    // ==================================================================

    /**
     * Snapshot of engine runtime statistics, mirroring {@code LumentStats}.
     *
     * @see Engine#getStats()
     */
    public static final class Stats {
        /** Current frames per second. */
        public final float fps;
        /** Frame time in milliseconds. */
        public final float frameTime;
        /** Number of draw calls in the last frame. */
        public final long drawCalls;
        /** Number of live entities. */
        public final long entityCount;
        /** Engine memory usage in kilobytes. */
        public final long memoryUsed;

        Stats(float fps, float frameTime, long drawCalls,
              long entityCount, long memoryUsed) {
            this.fps = fps;
            this.frameTime = frameTime;
            this.drawCalls = drawCalls;
            this.entityCount = entityCount;
            this.memoryUsed = memoryUsed;
        }

        @Override
        public String toString() {
            return "Stats{fps=" + fps + ", frameTime=" + frameTime
                    + "ms, drawCalls=" + drawCalls
                    + ", entities=" + entityCount
                    + ", mem=" + memoryUsed + "KB}";
        }
    }
}
