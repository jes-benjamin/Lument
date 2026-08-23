package com.lument.engine;

/**
 * Scene management wrapper around the C ABI scene functions.
 *
 * <p>Scenes are identified by an opaque {@code int} id returned by
 * {@link #loadScene(String)}. At most one scene is active at a time; switching
 * the active scene drives the engine's entity lifecycle and background
 * configuration.
 */
public final class SceneManager {

    /** Returned by {@link #loadScene} when the scene cannot be loaded. */
    public static final int INVALID_SCENE = 0;

    private SceneManager() {
        // No instances; all API is static.
    }

    /**
     * Loads a scene by name. Maps to {@code lument_load_scene(const char*)}.
     *
     * <p>On desktop {@code name} typically resolves to a file in the asset
     * path; on Android it is resolved through the engine's asset layer.
     *
     * @param name scene name / path
     * @return scene id, or {@link #INVALID_SCENE} on failure
     */
    public static int loadScene(String name) {
        if (name == null) {
            return INVALID_SCENE;
        }
        return nLoadScene(name);
    }

    /**
     * Sets the active scene. Maps to {@code lument_set_active_scene()}.
     *
     * @param sceneId scene id from {@link #loadScene}
     */
    public static void setActiveScene(int sceneId) {
        nSetActiveScene(sceneId);
    }

    /**
     * Returns the currently active scene id. Maps to
     * {@code lument_get_active_scene()}.
     *
     * @return active scene id, or {@link #INVALID_SCENE} if none
     */
    public static int getActiveScene() {
        return nGetActiveScene();
    }

    /**
     * Sets the scene background clear color. Maps to
     * {@code lument_scene_set_background()}.
     *
     * @param color background color (non-null)
     */
    public static void setBackground(LumentColor color) {
        if (color == null) {
            throw new IllegalArgumentException("color must not be null");
        }
        nSceneSetBackground(color.pack());
    }

    // ==================================================================
    // JNI native method declarations.
    // ==================================================================

    private static native int nLoadScene(String name);
    private static native void nSetActiveScene(int sceneId);
    private static native int nGetActiveScene();
    private static native void nSceneSetBackground(int color);
}
