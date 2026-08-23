package com.lument.engine;

/**
 * Per-frame update callback used by ECS script components.
 *
 * <p>The C ABI represents a script as a raw function pointer
 * {@code void (*)(LumentEntity, float)}. Because JNI cannot hand a Java object
 * directly to native code as a C function pointer, the bridge registers a
 * single native trampoline for every scripted entity and keeps a mapping from
 * entity id back to the Java callback registered here.
 *
 * <p>When the native engine invokes the script during its update pass, the
 * trampoline looks up the entity id and dispatches to
 * {@link #onUpdate(int, float)} on the object passed to
 * {@link ECS#setScript(int, UpdateCallback)}.
 *
 * <p><b>Threading:</b> {@code onUpdate} is invoked on the thread that drives the
 * engine frame loop (on Android this is the GL render thread). Implementations
 * must not perform blocking I/O on this thread.
 */
@FunctionalInterface
public interface UpdateCallback {

    /**
     * Called once per frame for a scripted entity.
     *
     * @param entity    the entity id (matches {@code LumentEntity} / the value
     *                  returned by {@link ECS#createEntity()})
     * @param deltaTime the frame delta time, in milliseconds
     */
    void onUpdate(int entity, float deltaTime);
}
