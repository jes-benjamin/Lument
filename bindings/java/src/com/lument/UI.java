package com.lument.engine;

import java.util.Objects;

/**
 * UI / application-development API wrapper around the C ABI widget functions.
 *
 * <p>This class exposes the lightweight UI layer declared in {@code lument.h}
 * under the "UI / 应用开发 API" section, suitable for building forms, lists,
 * dashboards and tool-style apps on top of the engine.
 *
 * <p>Widgets are opaque {@code int} handles (the C {@code LumentWidget} type is
 * a {@code uint32_t}); {@link #INVALID_WIDGET} marks an unset / destroyed /
 * not-found widget. Colors are passed across the JNI boundary as packed
 * {@code 0xAARRGGBB} ints (see {@link LumentColor#pack()}), matching the
 * convention used by {@link Renderer} and {@link ECS}. Text and placeholder
 * strings are forwarded as Java {@link String}s; a {@code null} string is
 * coalesced to the empty string.
 *
 * <h2>Event callbacks</h2>
 * The C ABI registers a raw C function pointer per {@code (widget, event)}
 * pair ({@code lument_ui_on_event}). Because JNI cannot present a Java object
 * as a C function pointer, the bridge registers a single native trampoline for
 * every registered pair and keeps a map from {@code (widget, event)} back to
 * the Java {@link UIEventCallback}. See
 * {@link #onEvent(int, int, UIEventCallback)}. Pass {@code null} to remove an
 * existing handler and release the held reference.
 *
 * <h2>Typical usage</h2>
 * <pre>{@code
 * int screen = UI.create(UI.WIDGET_CONTAINER);
 * UI.setLayout(screen, UI.LAYOUT_VERTICAL);
 * UI.setPadding(screen, 16, 16, 16, 16);
 *
 * int btn = UI.createButton("Press me", 0, 0, 200, 48);
 * UI.addChild(screen, btn);
 * UI.onEvent(btn, UI.EVENT_CLICK, (widget, event, data) -> {
 *     Engine.log("button " + widget + " clicked");
 * });
 *
 * while (Engine.isRunning()) {
 *     Engine.beginFrame();
 *     UI.render();
 *     Engine.endFrame();
 * }
 * UI.clearAll();
 * }</pre>
 *
 * @see UIEventCallback
 * @see LumentColor
 */
public final class UI {

    // ------------------------------------------------------------------
    // Widget types (LumentWidgetType).
    // ------------------------------------------------------------------

    /** No / unset widget type. */
    public static final int WIDGET_NONE      = 0;
    /** Container widget that may nest other widgets. */
    public static final int WIDGET_CONTAINER = 1;
    /** Button. */
    public static final int WIDGET_BUTTON    = 2;
    /** Text label. */
    public static final int WIDGET_LABEL     = 3;
    /** Text input field. */
    public static final int WIDGET_INPUT     = 4;
    /** Image widget. */
    public static final int WIDGET_IMAGE     = 5;
    /** List / scroll view. */
    public static final int WIDGET_LIST      = 6;
    /** Progress bar. */
    public static final int WIDGET_PROGRESS  = 7;
    /** Checkbox. */
    public static final int WIDGET_CHECKBOX  = 8;
    /** Slider. */
    public static final int WIDGET_SLIDER    = 9;
    /** Tab bar. */
    public static final int WIDGET_TABBAR    = 10;
    /** Navigation bar. */
    public static final int WIDGET_NAVBAR    = 11;

    // ------------------------------------------------------------------
    // Layout types (LumentLayoutType).
    // ------------------------------------------------------------------

    /** Absolute positioning (no automatic layout). */
    public static final int LAYOUT_NONE       = 0;
    /** Children laid out top-to-bottom. */
    public static final int LAYOUT_VERTICAL   = 1;
    /** Children laid out left-to-right. */
    public static final int LAYOUT_HORIZONTAL = 2;
    /** Grid layout (see {@link #setGrid}). */
    public static final int LAYOUT_GRID       = 3;
    /** Stacked along the Z axis. */
    public static final int LAYOUT_STACK      = 4;

    // ------------------------------------------------------------------
    // Event types (LumentEventType).
    // ------------------------------------------------------------------

    /** No / unset event. */
    public static final int EVENT_NONE   = 0;
    /** Pointer / activation click. */
    public static final int EVENT_CLICK  = 1;
    /** Widget gained focus. */
    public static final int EVENT_FOCUS  = 2;
    /** Widget lost focus. */
    public static final int EVENT_BLUR   = 3;
    /** Widget value changed. */
    public static final int EVENT_CHANGE = 4;
    /** Widget was scrolled. */
    public static final int EVENT_SCROLL = 5;

    // ------------------------------------------------------------------
    // Alignment constants (lument_ui_set_alignment).
    // ------------------------------------------------------------------

    /** Align children to the start edge. */
    public static final int ALIGN_START   = 0;
    /** Center children. */
    public static final int ALIGN_CENTER  = 1;
    /** Align children to the end edge. */
    public static final int ALIGN_END     = 2;
    /** Stretch children to fill the container. */
    public static final int ALIGN_STRETCH = 3;

    // ------------------------------------------------------------------
    // Touch phase constants (lument_ui_handle_touch).
    // ------------------------------------------------------------------

    /** Touch / pointer went down. */
    public static final int TOUCH_DOWN  = 0;
    /** Touch / pointer moved while down. */
    public static final int TOUCH_MOVE  = 1;
    /** Touch / pointer went up. */
    public static final int TOUCH_UP    = 2;

    // ------------------------------------------------------------------
    // Sentinels.
    // ------------------------------------------------------------------

    /** Sentinel for an invalid / non-existent widget (matches {@code LUMENT_INVALID_WIDGET}). */
    public static final int INVALID_WIDGET = 0;

    private UI() {
        // No instances; all API is static.
    }

    // ------------------------------------------------------------------
    // Widget lifecycle.
    // ------------------------------------------------------------------

    /**
     * Creates a new widget of the given type. Maps to
     * {@code lument_ui_create(LumentWidgetType)}.
     *
     * @param type one of the {@code WIDGET_*} constants
     * @return a new widget id, or {@link #INVALID_WIDGET} on failure
     */
    public static int create(int type) {
        return nCreate(type);
    }

    /**
     * Destroys a widget and releases its native resources, including any
     * registered event callbacks. Maps to {@code lument_ui_destroy()}.
     *
     * <p>The JNI bridge releases the global references to any
     * {@link UIEventCallback} objects still registered for this widget; it is
     * therefore not necessary to call
     * {@link #onEvent(int, int, UIEventCallback) onEvent(widget, event, null)}
     * for each event before destroying the widget. Safe to call on an
     * already-destroyed widget.
     *
     * @param widget widget id
     */
    public static void destroy(int widget) {
        if (widget == INVALID_WIDGET) {
            return;
        }
        nDestroy(widget);
    }

    /**
     * Destroys every widget and resets the UI layer to its initial state.
     * Maps to {@code lument_ui_clear_all()}. Also releases every registered
     * event callback.
     */
    public static void clearAll() {
        nClearAll();
    }

    // ------------------------------------------------------------------
    // Widget properties.
    // ------------------------------------------------------------------

    /**
     * Sets the widget's text / label / placeholder. Maps to
     * {@code lument_ui_set_text()}.
     *
     * @param widget widget id
     * @param text   text to set; {@code null} is treated as the empty string
     */
    public static void setText(int widget, String text) {
        if (text == null) {
            text = "";
        }
        nSetText(widget, text);
    }

    /**
     * Returns the widget's current text. Maps to {@code lument_ui_get_text()}.
     *
     * @param widget widget id
     * @return the widget text, or the empty string if the widget has none
     */
    public static String getText(int widget) {
        String text = nGetText(widget);
        return text != null ? text : "";
    }

    /**
     * Sets the widget position within its parent. Maps to
     * {@code lument_ui_set_position()}.
     *
     * @param widget widget id
     * @param x      X coordinate
     * @param y      Y coordinate
     */
    public static void setPosition(int widget, float x, float y) {
        nSetPosition(widget, x, y);
    }

    /**
     * Sets the widget size. Maps to {@code lument_ui_set_size()}.
     *
     * @param widget widget id
     * @param w      width
     * @param h      height
     */
    public static void setSize(int widget, float w, float h) {
        nSetSize(widget, w, h);
    }

    /**
     * Sets the widget background / fill color. Maps to
     * {@code lument_ui_set_color()}.
     *
     * @param widget widget id
     * @param color  fill color (non-null)
     */
    public static void setColor(int widget, LumentColor color) {
        Objects.requireNonNull(color, "color");
        nSetColor(widget, color.pack());
    }

    /**
     * Sets the widget text color. Maps to {@code lument_ui_set_text_color()}.
     *
     * @param widget widget id
     * @param color  text color (non-null)
     */
    public static void setTextColor(int widget, LumentColor color) {
        Objects.requireNonNull(color, "color");
        nSetTextColor(widget, color.pack());
    }

    /**
     * Sets the widget font size in pixels. Maps to
     * {@code lument_ui_set_font_size()}.
     *
     * @param widget widget id
     * @param size   font size
     */
    public static void setFontSize(int widget, float size) {
        nSetFontSize(widget, size);
    }

    /**
     * Shows or hides the widget. Maps to {@code lument_ui_set_visible()}.
     *
     * @param widget  widget id
     * @param visible true to render, false to hide
     */
    public static void setVisible(int widget, boolean visible) {
        nSetVisible(widget, visible);
    }

    /**
     * Enables or disables (greys out) the widget. Maps to
     * {@code lument_ui_set_enabled()}.
     *
     * @param widget  widget id
     * @param enabled true to enable, false to disable
     */
    public static void setEnabled(int widget, boolean enabled) {
        nSetEnabled(widget, enabled);
    }

    /**
     * Sets the widget's image from a loaded texture. Maps to
     * {@code lument_ui_set_image()}.
     *
     * @param widget    widget id
     * @param textureId texture handle from {@link Renderer#loadTexture(String)}
     */
    public static void setImage(int widget, int textureId) {
        nSetImage(widget, textureId);
    }

    // ------------------------------------------------------------------
    // Widget hierarchy.
    // ------------------------------------------------------------------

    /**
     * Adds {@code child} as a child of {@code parent}. Maps to
     * {@code lument_ui_add_child()}.
     *
     * @param parent parent widget id
     * @param child  child widget id
     */
    public static void addChild(int parent, int child) {
        nAddChild(parent, child);
    }

    /**
     * Removes {@code child} from {@code parent}. Maps to
     * {@code lument_ui_remove_child()}.
     *
     * @param parent parent widget id
     * @param child  child widget id
     */
    public static void removeChild(int parent, int child) {
        nRemoveChild(parent, child);
    }

    /**
     * Returns the parent of a widget. Maps to {@code lument_ui_get_parent()}.
     *
     * @param widget widget id
     * @return the parent widget id, or {@link #INVALID_WIDGET} if the widget is
     *         a root widget
     */
    public static int getParent(int widget) {
        return nGetParent(widget);
    }

    // ------------------------------------------------------------------
    // Layout.
    // ------------------------------------------------------------------

    /**
     * Sets the layout policy of a container widget. Maps to
     * {@code lument_ui_set_layout()}.
     *
     * @param container container widget id
     * @param layout   one of the {@code LAYOUT_*} constants
     */
    public static void setLayout(int container, int layout) {
        nSetLayout(container, layout);
    }

    /**
     * Sets the padding of a container widget. Maps to
     * {@code lument_ui_set_padding()}.
     *
     * @param container container widget id
     * @param top       top padding
     * @param right     right padding
     * @param bottom     bottom padding
     * @param left      left padding
     */
    public static void setPadding(int container, float top, float right,
                                  float bottom, float left) {
        nSetPadding(container, top, right, bottom, left);
    }

    /**
     * Sets the spacing between children of a container widget. Maps to
     * {@code lument_ui_set_spacing()}.
     *
     * @param container container widget id
     * @param spacing   spacing between children
     */
    public static void setSpacing(int container, float spacing) {
        nSetSpacing(container, spacing);
    }

    /**
     * Configures the grid dimensions of a container using
     * {@link #LAYOUT_GRID}. Maps to {@code lument_ui_set_grid()}.
     *
     * @param container container widget id
     * @param cols      number of columns
     * @param rows      number of rows
     */
    public static void setGrid(int container, int cols, int rows) {
        nSetGrid(container, cols, rows);
    }

    /**
     * Sets the child alignment of a container widget. Maps to
     * {@code lument_ui_set_alignment()}.
     *
     * @param container container widget id
     * @param align     one of {@link #ALIGN_START}, {@link #ALIGN_CENTER},
     *                  {@link #ALIGN_END}, {@link #ALIGN_STRETCH}
     */
    public static void setAlignment(int container, int align) {
        nSetAlignment(container, align);
    }

    // ------------------------------------------------------------------
    // Events.
    // ------------------------------------------------------------------

    /**
     * Registers (or replaces, or removes) an event handler on a widget for a
     * specific event. Maps to {@code lument_ui_on_event()}.
     *
     * <p>The bridge registers a native trampoline with the engine and stores a
     * global reference to {@code callback} keyed by {@code (widget, event)}.
     * When the native engine fires the event it looks up the pair and invokes
     * {@link UIEventCallback#onEvent(int, int, String)} on this thread (the
     * frame / render thread).
     *
     * <p>Pass {@code null} to remove an existing handler and release the held
     * reference. Destroying the widget via {@link #destroy(int)} or clearing
     * all widgets via {@link #clearAll()} also releases the reference, so an
     * explicit {@code null} registration is only needed when you want to keep
     * the widget but drop one specific handler.
     *
     * @param widget   widget id
     * @param eventType one of the {@code EVENT_*} constants
     * @param callback event handler, or {@code null} to remove
     */
    public static void onEvent(int widget, int eventType, UIEventCallback callback) {
        nOnEvent(widget, eventType, callback);
    }

    /**
     * Sets keyboard focus to a widget. Maps to {@code lument_ui_set_focused()}.
     *
     * @param widget widget id
     */
    public static void setFocused(int widget) {
        nSetFocused(widget);
    }

    // ------------------------------------------------------------------
    // Rendering and input handling.
    // ------------------------------------------------------------------

    /**
     * Renders the entire UI tree for the current frame. Maps to
     * {@code lument_ui_render()}. Call this each frame between
     * {@link Engine#beginFrame()} and {@link Engine#endFrame()} after your
     * game-world draws.
     */
    public static void render() {
        nRender();
    }

    /**
     * Forwards a touch / pointer event to the UI layer. Maps to
     * {@code lument_ui_handle_touch()}.
     *
     * @param x    touch X coordinate
     * @param y    touch Y coordinate
     * @param type one of {@link #TOUCH_DOWN}, {@link #TOUCH_MOVE},
     *             {@link #TOUCH_UP}
     * @return true if the UI layer consumed the event (hit a widget)
     */
    public static boolean handleTouch(float x, float y, int type) {
        return nHandleTouch(x, y, type);
    }

    /**
     * Forwards a key event to the UI layer. Maps to
     * {@code lument_ui_handle_key()}.
     *
     * @param key     one of the {@code KEY_*} constants on {@link Input}
     *                (mirrors the C {@code LumentKey} enum)
     * @param pressed true on key-down, false on key-up
     * @return true if the UI layer consumed the event
     */
    public static boolean handleKey(int key, boolean pressed) {
        return nHandleKey(key, pressed);
    }

    // ------------------------------------------------------------------
    // Navigation.
    // ------------------------------------------------------------------

    /**
     * Pushes a screen widget onto the navigation stack. Maps to
     * {@code lument_ui_navigate_to()}.
     *
     * @param screen the screen (root container) widget to navigate to
     */
    public static void navigateTo(int screen) {
        nNavigateTo(screen);
    }

    /**
     * Pops the current screen off the navigation stack. Maps to
     * {@code lument_ui_navigate_back()}.
     */
    public static void navigateBack() {
        nNavigateBack();
    }

    /**
     * Returns the widget id of the screen currently on top of the navigation
     * stack. Maps to {@code lument_ui_get_current_screen()}.
     *
     * @return the current screen widget id, or {@link #INVALID_WIDGET} if the
     *         stack is empty
     */
    public static int getCurrentScreen() {
        return nGetCurrentScreen();
    }

    // ------------------------------------------------------------------
    // Convenience creators.
    // ------------------------------------------------------------------

    /**
     * Creates a {@link #WIDGET_BUTTON} with the given text and bounds in one
     * call. Maps to {@code lument_ui_create_button()}. Equivalent to
     * {@code create(WIDGET_BUTTON)} followed by {@link #setText} and
     * {@link #setPosition} / {@link #setSize}.
     *
     * @param text button label; {@code null} is treated as the empty string
     * @param x    X coordinate
     * @param y    Y coordinate
     * @param w    width
     * @param h    height
     * @return a new button widget id, or {@link #INVALID_WIDGET} on failure
     */
    public static int createButton(String text, float x, float y, float w, float h) {
        if (text == null) {
            text = "";
        }
        return nCreateButton(text, x, y, w, h);
    }

    /**
     * Creates a {@link #WIDGET_LABEL} with the given text and bounds in one
     * call. Maps to {@code lument_ui_create_label()}.
     *
     * @param text label text; {@code null} is treated as the empty string
     * @param x    X coordinate
     * @param y    Y coordinate
     * @param w    width
     * @param h    height
     * @return a new label widget id, or {@link #INVALID_WIDGET} on failure
     */
    public static int createLabel(String text, float x, float y, float w, float h) {
        if (text == null) {
            text = "";
        }
        return nCreateLabel(text, x, y, w, h);
    }

    /**
     * Creates a {@link #WIDGET_INPUT} with the given placeholder and bounds in
     * one call. Maps to {@code lument_ui_create_input()}.
     *
     * @param placeholder placeholder text; {@code null} is treated as the
     *                    empty string
     * @param x           X coordinate
     * @param y           Y coordinate
     * @param w           width
     * @param h           height
     * @return a new input widget id, or {@link #INVALID_WIDGET} on failure
     */
    public static int createInput(String placeholder, float x, float y, float w, float h) {
        if (placeholder == null) {
            placeholder = "";
        }
        return nCreateInput(placeholder, x, y, w, h);
    }

    // ==================================================================
    // JNI native method declarations.
    // ==================================================================

    // --- Widget lifecycle ---
    private static native int nCreate(int type);
    private static native void nDestroy(int widget);
    private static native void nClearAll();

    // --- Widget properties ---
    private static native void nSetText(int widget, String text);
    private static native String nGetText(int widget);
    private static native void nSetPosition(int widget, float x, float y);
    private static native void nSetSize(int widget, float w, float h);
    private static native void nSetColor(int widget, int color);
    private static native void nSetTextColor(int widget, int color);
    private static native void nSetFontSize(int widget, float size);
    private static native void nSetVisible(int widget, boolean visible);
    private static native void nSetEnabled(int widget, boolean enabled);
    private static native void nSetImage(int widget, int textureId);

    // --- Widget hierarchy ---
    private static native void nAddChild(int parent, int child);
    private static native void nRemoveChild(int parent, int child);
    private static native int nGetParent(int widget);

    // --- Layout ---
    private static native void nSetLayout(int container, int layout);
    private static native void nSetPadding(int container, float top, float right,
                                           float bottom, float left);
    private static native void nSetSpacing(int container, float spacing);
    private static native void nSetGrid(int container, int cols, int rows);
    private static native void nSetAlignment(int container, int align);

    // --- Events ---
    /**
     * Native trampoline registration. When {@code callback} is non-null the
     * bridge stores a global JNI reference keyed by {@code (widget, event)}
     * and registers the native callback with the engine; when null it removes
     * the entry and unregisters.
     */
    private static native void nOnEvent(int widget, int eventType, UIEventCallback callback);
    private static native void nSetFocused(int widget);

    // --- Render & input handling ---
    private static native void nRender();
    private static native boolean nHandleTouch(float x, float y, int type);
    private static native boolean nHandleKey(int key, boolean pressed);

    // --- Navigation ---
    private static native void nNavigateTo(int screen);
    private static native void nNavigateBack();
    private static native int nGetCurrentScreen();

    // --- Convenience creators ---
    private static native int nCreateButton(String text, float x, float y, float w, float h);
    private static native int nCreateLabel(String text, float x, float y, float w, float h);
    private static native int nCreateInput(String placeholder, float x, float y, float w, float h);
}
