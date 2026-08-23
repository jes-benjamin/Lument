package com.lument.engine.android;

import android.app.Activity;
import android.content.Context;
import android.content.res.AssetManager;
import android.opengl.GLSurfaceView;
import android.util.Log;
import android.view.Display;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;

import com.lument.engine.Audio;
import com.lument.engine.Engine;
import com.lument.engine.Input;
import com.lument.engine.LumentConfig;

import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;

import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/**
 * Android entry point for the Lument Java bindings.
 *
 * <p>{@code AndroidEngine} extends {@link Engine} and adapts the
 * platform-agnostic core to the Android {@link Activity} lifecycle and the
 * OpenGL ES rendering surface provided by {@link GLSurfaceView}.
 *
 * <h2>Responsibilities</h2>
 * <ul>
 *   <li><b>Lifecycle</b> - wires {@code onCreate/onPause/onResume/onDestroy}
 *       to the engine's init/shutdown and to the GL surface's pause/resume.</li>
 *   <li><b>Rendering surface</b> - creates and owns a {@link GLSurfaceView}
 *       configured for OpenGL ES 2.0+ and drives the frame loop
 *       ({@link Engine#beginFrame()} / {@link Engine#endFrame()}) from the GL
 *       render thread.</li>
 *   <li><b>Input</b> - converts {@link MotionEvent}s captured on the surface
 *       into the engine's input model and pushes them into the native engine
 *       via {@link #nSetTouches}, {@link #nSetJoystick} and {@link #nSetKey}
 *       (which call the {@code ue::input_set_*} injection points): a virtual
 *       analog joystick derived from the primary touch (relative to its press
 *       point), raw multi-touch positions, and mapped hardware keys (Back
 *       -> {@link Input#KEY_CANCEL}, Menu -> {@link Input#KEY_MENU}).</li>
 *   <li><b>Assets</b> - publishes the Android {@link AssetManager} to the JNI
 *       bridge so the native engine can read files packaged inside the APK,
 *       and offers {@link #extractAsset(String)} to materialize an asset onto
 *       the filesystem when a real path is required.</li>
 * </ul>
 *
 * <h2>Usage</h2>
 * <pre>{@code
 * public class GameActivity extends Activity {
 *     private AndroidEngine engine;
 *
 *     protected void onCreate(Bundle savedInstanceState) {
 *         super.onCreate(savedInstanceState);
 *         engine = new AndroidEngine(this);
 *         engine.onCreate(new LumentConfig()
 *                 .platform(Engine.PLATFORM_ANDROID)
 *                 .rendererType(Engine.RENDERER_OPENGLES)
 *                 .targetFPS(60));
 *     }
 *     protected void onPause()    { super.onPause();    engine.onPause(); }
 *     protected void onResume()   { super.onResume();   engine.onResume(); }
 *     protected void onDestroy()  { super.onDestroy();  engine.onDestroy(); }
 *
 *     public boolean onKeyDown(int kc, KeyEvent e) {
 *         return engine.dispatchKeyDown(kc) || super.onKeyDown(kc, e);
 *     }
 *     public boolean onKeyUp(int kc, KeyEvent e) {
 *         return engine.dispatchKeyUp(kc) || super.onKeyUp(kc, e);
 *     }
 * }
 * }</pre>
 *
 * <p>Subclass {@code AndroidEngine} and override
 * {@link #onSurfaceCreated()}, {@link #onSurfaceChanged(int, int)},
 * {@link #onUpdate(float)} and {@link #onRender()} to implement game logic.
 */
public class AndroidEngine extends Engine {

    private static final String TAG = "Lument";

    /** Maximum number of concurrent touches tracked from Android. */
    private static final int MAX_TOUCHES = 16;

    /** Virtual joystick radius, in density-independent pixels. */
    private static final float JOYSTICK_RADIUS_DP = 80f;

    private final Activity activity;

    private GLSurfaceView glView;
    private LumentConfig config;

    // Run on the GL thread; guarded by the single-threaded renderer callbacks.
    private volatile boolean initialized = false;
    private volatile boolean paused = false;

    // Current touch snapshot, updated by TouchHandler (UI thread) and pushed
    // once per frame by feedInput (GL thread). A snapshot is used rather than
    // pushing per MotionEvent because the engine clears its touch list at the
    // end of each frame - re-pushing the latest snapshot every frame keeps a
    // held finger visible even when no new MOVE events arrive.
    private int touchCount = 0;
    private final float[] touchX = new float[MAX_TOUCHES];
    private final float[] touchY = new float[MAX_TOUCHES];

    // Virtual joystick state (UI thread writes via TouchHandler; pushed each
    // frame by feedInput). Joystick axes persist in the engine, but re-pushing
    // the current value is harmless and keeps things deterministic.
    private volatile float joyX = 0f;
    private volatile float joyY = 0f;
    private boolean joystickActive = false;
    private float joyAnchorX = 0f;
    private float joyAnchorY = 0f;
    private final float joystickRadiusPx;

    /**
     * Creates the Android engine adapter bound to the given host activity.
     *
     * @param activity the owning activity (the GL surface is set as its
     *                 content view from {@link #onCreate(LumentConfig)})
     */
    public AndroidEngine(Activity activity) {
        this.activity = activity;
        this.joystickRadiusPx = JOYSTICK_RADIUS_DP
                * activity.getResources().getDisplayMetrics().density;
    }

    /** @return the GL surface view managed by this engine. */
    public GLSurfaceView getSurfaceView() {
        return glView;
    }

    /** @return the host activity / application context. */
    public Context getContext() {
        return activity;
    }

    // ------------------------------------------------------------------
    // Activity lifecycle.
    // ------------------------------------------------------------------

    /**
     * Sets up the GL surface and prepares the engine. Must be called from
     * {@link Activity#onCreate(android.os.Bundle)}.
     *
     * <p>The native engine is initialized lazily from the GL render thread
     * once the GL context and surface are ready (see
     * {@link EngineGLRenderer#onSurfaceChanged}), so the activity's content
     * view is switched immediately and rendering begins asynchronously.
     *
     * @param config engine configuration (platform/renderer may be left as
     *               the Android defaults applied here)
     */
    public void onCreate(LumentConfig config) {
        if (config == null) {
            throw new IllegalArgumentException("config must not be null");
        }
        // Force Android / GLES defaults so callers can omit them.
        config.platform = Engine.PLATFORM_ANDROID;
        if (config.rendererType == 0) {
            config.rendererType = Engine.RENDERER_OPENGLES;
        }
        if (config.width <= 0 || config.height <= 0) {
            Display display = ((WindowManager) activity
                    .getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay();
            android.graphics.Point size = new android.graphics.Point();
            display.getRealSize(size);
            config.width = size.x;
            config.height = size.y;
        }
        this.config = config;

        // Publish the AssetManager to the JNI bridge BEFORE the native engine
        // touches any asset.
        nSetAssetManager(activity.getAssets());

        glView = new GLSurfaceView(activity);
        glView.setEGLContextClientVersion(chooseGlesMajorVersion());
        glView.setEGLConfigChooser(8, 8, 8, 8, 0, 0); // RGBA8888, depth0, stencil0
        glView.setRenderer(new EngineGLRenderer());
        glView.setRenderMode(GLSurfaceView.RENDERMODE_CONTINUOUSLY);
        glView.setFocusable(true);
        glView.setFocusableInTouchMode(true);
        glView.setOnTouchListener(new TouchHandler());
        glView.setOnKeyListener(new KeyHandler());

        activity.setContentView(glView);
    }

    /**
     * Pauses rendering and audio. Call from {@link Activity#onPause()}.
     */
    public void onPause() {
        paused = true;
        Audio.stopAllAudio();
        if (glView != null) {
            glView.onPause();
        }
    }

    /**
     * Resumes rendering. Call from {@link Activity#onResume()}.
     */
    public void onResume() {
        paused = false;
        if (glView != null) {
            glView.onResume();
        }
    }

    /**
     * Tears down the engine. Call from {@link Activity#onDestroy()}.
     */
    public void onDestroy() {
        // Release the AssetManager handle on the native side.
        nSetAssetManager(null);
        Engine.shutdown();
        initialized = false;
    }

    // ------------------------------------------------------------------
    // Input dispatch (for host Activity delegation).
    // ------------------------------------------------------------------

    /**
     * Dispatches a hardware key-down event from the host activity. Maps the
     * device Back and Menu keys (and D-pad) to logical engine keys and pushes
     * the held state into the native input system.
     *
     * @param keyCode Android key code (e.g. {@link KeyEvent#KEYCODE_BACK})
     * @return true if the event was consumed
     */
    public boolean dispatchKeyDown(int keyCode) {
        Integer mapped = mapKey(keyCode);
        if (mapped != null) {
            nSetKey(mapped, true);
            return true;
        }
        return false;
    }

    /**
     * Dispatches a hardware key-up event from the host activity.
     *
     * @param keyCode Android key code
     * @return true if the event was consumed
     */
    public boolean dispatchKeyUp(int keyCode) {
        Integer mapped = mapKey(keyCode);
        if (mapped != null) {
            nSetKey(mapped, false);
            return true;
        }
        return false;
    }

    // ------------------------------------------------------------------
    // Hooks for subclasses.
    // ------------------------------------------------------------------

    /** Called once after the GL surface is created and the engine initialized. */
    protected void onSurfaceCreated() { }

    /** Called when the GL surface size changes. */
    protected void onSurfaceChanged(int width, int height) { }

    /**
     * Per-frame update hook, called each frame on the GL render thread before
     * {@link #onRender()}.
     *
     * @param deltaTime frame delta in milliseconds
     */
    protected void onUpdate(float deltaTime) { }

    /** Per-frame render hook, called each frame between begin/end frame. */
    protected void onRender() { }

    /**
     * Chooses the EGL client version (2 or 3). Override to force GLES 3.
     *
     * @return major version, default {@code 2}
     */
    protected int chooseGlesMajorVersion() {
        return 2;
    }

    // ------------------------------------------------------------------
    // Asset helpers.
    // ------------------------------------------------------------------

    /**
     * Copies an asset bundled inside the APK to the app's private files
     * directory and returns the absolute filesystem path. Use this when an API
     * (e.g. {@link com.lument.engine.Renderer#loadTexture(String)}) needs a
     * real path rather than resolving through the engine's asset layer.
     *
     * <p>The asset is only copied once; subsequent calls return the cached
     * path without rewriting the file (unless it is missing).
     *
     * @param assetPath path relative to the APK {@code assets/} folder
     * @return absolute path to the extracted file
     * @throws IOException if the asset cannot be read or the file written
     */
    public String extractAsset(String assetPath) throws IOException {
        java.io.File out = new java.io.File(activity.getFilesDir(),
                sanitizeName(assetPath));
        if (!out.exists()) {
            out.getParentFile().mkdirs();
            try (InputStream in = activity.getAssets().open(assetPath);
                 OutputStream os = new FileOutputStream(out)) {
                byte[] buffer = new byte[8192];
                int n;
                while ((n = in.read(buffer)) > 0) {
                    os.write(buffer, 0, n);
                }
            }
        }
        return out.getAbsolutePath();
    }

    private static String sanitizeName(String assetPath) {
        return assetPath == null ? "asset" : assetPath.replace('/', '_');
    }

    // ------------------------------------------------------------------
    // Touch handling.
    // ------------------------------------------------------------------

    /**
     * Touch listener that maintains the current touch snapshot and derives the
     * virtual joystick from the primary pointer. It writes only Java-side
     * state here; the snapshot is pushed into the native engine once per frame
     * by {@link #feedInput()}.
     */
    private final class TouchHandler implements View.OnTouchListener {

        @Override
        public boolean onTouch(View v, MotionEvent event) {
            int action = event.getActionMasked();
            int pointerCount = event.getPointerCount();
            int count = Math.min(pointerCount, MAX_TOUCHES);

            // Snapshot the current pointer coordinates.
            for (int i = 0; i < count; i++) {
                touchX[i] = event.getX(i);
                touchY[i] = event.getY(i);
            }
            touchCount = count;

            // Drive the virtual joystick from the primary pointer (index 0).
            int primary = event.getActionIndex();
            boolean primaryIsZero = (primary == 0);
            float px = primaryIsZero && primary < count ? event.getX(primary) : 0f;
            float py = primaryIsZero && primary < count ? event.getY(primary) : 0f;

            switch (action) {
                case MotionEvent.ACTION_DOWN:
                case MotionEvent.ACTION_POINTER_DOWN:
                    if (!joystickActive && primaryIsZero) {
                        joystickActive = true;
                        joyAnchorX = px;
                        joyAnchorY = py;
                    }
                    break;
                case MotionEvent.ACTION_MOVE:
                    if (joystickActive) {
                        updateJoystick(px - joyAnchorX, py - joyAnchorY);
                    }
                    break;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    joystickActive = false;
                    joyX = 0f;
                    joyY = 0f;
                    break;
                case MotionEvent.ACTION_POINTER_UP:
                    if (primaryIsZero) {
                        joystickActive = false;
                        joyX = 0f;
                        joyY = 0f;
                    }
                    break;
                default:
                    break;
            }
            return true;
        }

        /** Maps a delta from the anchor to a [-1, 1] analog value. */
        private void updateJoystick(float dx, float dy) {
            float radius = joystickRadiusPx > 0f ? joystickRadiusPx : 1f;
            float jx = dx / radius;
            float jy = dy / radius;
            if (jx > 1f) jx = 1f; else if (jx < -1f) jx = -1f;
            if (jy > 1f) jy = 1f; else if (jy < -1f) jy = -1f;
            joyX = jx;
            joyY = jy;
        }
    }

    /**
     * Key listener attached to the GL view for hardware keys when the view
     * holds focus. For the Back key (which Android dispatches to the activity
     * by default) prefer delegating via {@link #dispatchKeyDown(int)}.
     */
    private final class KeyHandler implements View.OnKeyListener {
        @Override
        public boolean onKey(View v, int keyCode, KeyEvent event) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                return dispatchKeyDown(keyCode);
            } else if (event.getAction() == KeyEvent.ACTION_UP) {
                return dispatchKeyUp(keyCode);
            }
            return false;
        }
    }

    /** Maps an Android key code to an engine logical key, or {@code null}. */
    private static Integer mapKey(int keyCode) {
        switch (keyCode) {
            case KeyEvent.KEYCODE_BACK:        return Input.KEY_CANCEL;
            case KeyEvent.KEYCODE_MENU:        return Input.KEY_MENU;
            case KeyEvent.KEYCODE_DPAD_LEFT:   return Input.KEY_LEFT;
            case KeyEvent.KEYCODE_DPAD_RIGHT:  return Input.KEY_RIGHT;
            case KeyEvent.KEYCODE_DPAD_UP:     return Input.KEY_UP;
            case KeyEvent.KEYCODE_DPAD_DOWN:   return Input.KEY_DOWN;
            case KeyEvent.KEYCODE_BUTTON_A:
            case KeyEvent.KEYCODE_ENTER:      return Input.KEY_ACTION;
            case KeyEvent.KEYCODE_BUTTON_B:
            case KeyEvent.KEYCODE_ESCAPE:      return Input.KEY_CANCEL;
            default: return null;
        }
    }

    // ------------------------------------------------------------------
    // Frame input feed (called from the GL render thread).
    // ------------------------------------------------------------------

    /**
     * Pushes the current touch snapshot and joystick axes into the native
     * engine for the frame about to be processed. Called once per frame at the
     * start of {@link EngineGLRenderer#onDrawFrame(GL10)}, before game logic.
     */
    private void feedInput() {
        nSetTouches(touchCount, touchX, touchY);
        nSetJoystick(joyX, joyY);
    }

    // ------------------------------------------------------------------
    // GL surface renderer.
    // ------------------------------------------------------------------

    /**
     * Drives the engine frame loop from the GL render thread. The native
     * engine is initialized here (not in {@link #onCreate}) because the GL
     * context only becomes current on this thread.
     */
    private final class EngineGLRenderer implements GLSurfaceView.Renderer {

        @Override
        public void onSurfaceCreated(GL10 gl, EGLConfig config) {
            // The GL context is ready; actual init (which needs width/height)
            // is deferred to onSurfaceChanged where the surface size is known.
        }

        @Override
        public void onSurfaceChanged(GL10 gl, int width, int height) {
            if (!initialized) {
                AndroidEngine.this.config.width = width;
                AndroidEngine.this.config.height = height;
                int rc = Engine.init(AndroidEngine.this.config);
                if (rc == 0) {
                    Log.e(TAG, "lument_init failed (rc=" + rc + ")");
                } else {
                    Log.i(TAG, "Lument initialized " + width + "x" + height + " GLES");
                }
                initialized = true;
                AndroidEngine.this.onSurfaceCreated();
            }
            AndroidEngine.this.onSurfaceChanged(width, height);
        }

        @Override
        public void onDrawFrame(GL10 gl) {
            if (paused || !initialized) {
                return;
            }
            Engine.beginFrame();
            // Feed the latest Android input snapshot before game logic reads it.
            AndroidEngine.this.feedInput();
            float dt = Engine.getDeltaTime();
            try {
                AndroidEngine.this.onUpdate(dt);
                AndroidEngine.this.onRender();
            } catch (RuntimeException e) {
                Log.e(TAG, "Error in frame loop", e);
            }
            Engine.endFrame();
        }
    }

    // ------------------------------------------------------------------
    // JNI: Android glue. Implemented in engine_jni.cpp.
    // ------------------------------------------------------------------

    /**
     * Stores (or clears, when {@code null}) the Android {@link AssetManager}
     * on the native side so the engine's Android file-IO layer can open APK
     * assets.
     */
    private static native void nSetAssetManager(AssetManager assetManager);

    /** Pushes the virtual joystick axes into the native input system. */
    private static native void nSetJoystick(float x, float y);

    /**
     * Pushes the current set of touches into the native input system
     * (replaces any previously reported touches for this frame).
     *
     * @param count number of active touches
     * @param xs    array of touch X coordinates (length {@code >= count})
     * @param ys    array of touch Y coordinates (length {@code >= count})
     */
    private static native void nSetTouches(int count, float[] xs, float[] ys);

    /** Sets the held state of a logical engine key. */
    private static native void nSetKey(int key, boolean down);
}
