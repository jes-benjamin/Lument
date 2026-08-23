package com.lument.engine;

/**
 * Read-only input API wrapper around the C ABI input functions.
 *
 * <p>The engine exposes a small, abstract input model with four logical key
 * directions ({@code LEFT/RIGHT/UP/DOWN}), an {@code ACTION} confirm key, a
 * {@code CANCEL} key and a {@code MENU} key, plus multi-touch and a virtual
 * joystick with normalized {@code [-1, 1]} axes.
 *
 * <h2>Where input comes from</h2>
 * This class only <em>reads</em> the engine's input state. How that state is
 * populated is platform-specific and intentionally kept out of the read API:
 * <ul>
 *   <li>On desktop the native engine polls its own windowing system.</li>
 *   <li>On Android the {@link com.lument.engine.android.AndroidEngine} host
 *       feeds touch / key / joystick samples into the engine through the
 *       internal injection points documented in {@code lument_internal.h}
 *       ({@code ue::input_set_*}).</li>
 * </ul>
 * In both cases the getters below return correct, current values transparently
 * to game code.
 *
 * <h2>Edge detection</h2>
 * The engine double-buffers keys: {@code lument_key_pressed()} returns true for
 * exactly one frame after a press (current {@code && !previous}, where
 * {@code previous} is snapshotted at the end of each frame).
 */
public final class Input {

    // ------------------------------------------------------------------
    // Logical keys (LumentKey).
    // ------------------------------------------------------------------

    public static final int KEY_NONE   = 0;
    public static final int KEY_LEFT   = 1;
    public static final int KEY_RIGHT  = 2;
    public static final int KEY_UP     = 3;
    public static final int KEY_DOWN   = 4;
    /** Confirm / interact. */
    public static final int KEY_ACTION = 5;
    /** Cancel / back. */
    public static final int KEY_CANCEL = 6;
    /** Menu / pause. */
    public static final int KEY_MENU   = 7;

    /** Number of logical keys (matches {@code LUMENT_KEY_MAX}). */
    public static final int KEY_COUNT = 8;

    private Input() {
        // No instances; all API is static.
    }

    /**
     * Whether a logical key is currently held down. Maps to
     * {@code lument_key_down()}.
     *
     * @param key one of the {@code KEY_*} constants
     * @return true while the key is held
     */
    public static boolean keyDown(int key) {
        return nKeyDown(key);
    }

    /**
     * Whether a logical key transitioned from up to down on the current frame.
     * Maps to {@code lument_key_pressed()}.
     *
     * @param key one of the {@code KEY_*} constants
     * @return true for exactly one frame after the press
     */
    public static boolean keyPressed(int key) {
        return nKeyPressed(key);
    }

    /**
     * Returns the number of active touches. Maps to
     * {@code lument_get_touch_count()}.
     *
     * @return touch count
     */
    public static int getTouchCount() {
        return nGetTouchCount();
    }

    /**
     * Returns the position of the touch at {@code index}. Maps to
     * {@code lument_get_touch()}.
     *
     * @param index touch index, in {@code [0, getTouchCount())}
     * @return a new {@link LumentVec2} with the touch coordinates
     * @throws IndexOutOfBoundsException if the index is out of range
     */
    public static LumentVec2 getTouch(int index) {
        if (index < 0 || index >= getTouchCount()) {
            throw new IndexOutOfBoundsException("touch index out of range: " + index);
        }
        float[] out = new float[2];
        nGetTouch(index, out);
        return new LumentVec2(out[0], out[1]);
    }

    /**
     * Returns the virtual joystick X axis in {@code [-1, 1]}. Maps to
     * {@code lument_get_joystick_x()}.
     *
     * @return joystick X
     */
    public static float getJoystickX() {
        return nGetJoystickX();
    }

    /**
     * Returns the virtual joystick Y axis in {@code [-1, 1]}. Maps to
     * {@code lument_get_joystick_y()}.
     *
     * @return joystick Y
     */
    public static float getJoystickY() {
        return nGetJoystickY();
    }

    // ==================================================================
    // JNI native method declarations (read-only).
    // ==================================================================

    private static native boolean nKeyDown(int key);
    private static native boolean nKeyPressed(int key);
    private static native int nGetTouchCount();
    private static native void nGetTouch(int index, float[] outPos);
    private static native float nGetJoystickX();
    private static native float nGetJoystickY();
}
