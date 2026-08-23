package com.lument.engine;

/**
 * Event callback used by the UI widget API.
 *
 * <p>The C ABI represents a widget event handler as a raw function pointer
 * {@code void (*)(LumentWidget, LumentEventType, const char*)} registered per
 * {@code (widget, event)} pair via {@code lument_ui_on_event}. Because JNI
 * cannot hand a Java object directly to native code as a C function pointer,
 * the bridge registers a single native trampoline for every registered
 * {@code (widget, event)} pair and keeps a mapping from that pair back to the
 * Java callback registered here.
 *
 * <p>When the native engine fires an event (a button click, a focus/blur
 * transition, a value change, a scroll, ...), the trampoline looks up the
 * {@code (widget, event)} pair and dispatches to
 * {@link #onEvent(int, int, String)} on the object passed to
 * {@link UI#onEvent(int, int, UIEventCallback)}.
 *
 * <p>Pass {@code null} to {@link UI#onEvent(int, int, UIEventCallback)} to
 * remove an existing handler and release the held global reference. Destroying
 * a widget via {@link UI#destroy(int)} or clearing all widgets via
 * {@link UI#clearAll()} also releases every callback still registered for the
 * affected widget(s).
 *
 * <p><b>Threading:</b> {@code onEvent} is invoked on the thread that drives the
 * engine frame loop (on Android this is the GL render thread). Implementations
 * must not perform blocking I/O on this thread.
 *
 * @see UI#onEvent(int, int, UIEventCallback)
 */
@FunctionalInterface
public interface UIEventCallback {

    /**
     * Called when the event registered via
     * {@link UI#onEvent(int, int, UIEventCallback)} is raised on the widget.
     *
     * @param widget    the widget id (matches {@code LumentWidget} / the value
     *                  returned by {@link UI#create(int)})
     * @param eventType the event that fired; one of the {@code EVENT_*}
     *                  constants on {@link UI}
     * @param data      optional, event-specific payload as a UTF-8 string, or
     *                  {@code null} when the event carries no data
     */
    void onEvent(int widget, int eventType, String data);
}
