package com.lument.engine;

import java.util.Objects;

/**
 * Entity Component System wrapper around the C ABI ECS functions.
 *
 * <p>Entities are opaque {@code int} ids (the C {@code LumentEntity} type is a
 * {@code uint32_t}); {@link #INVALID_ENTITY} marks an unset / destroyed entity.
 * Components are added implicitly through the setter methods below - the
 * native engine attaches the appropriate component ({@code Transform},
 * {@code Sprite}, {@code Collider}, {@code Script}, ...) when the matching
 * setter is first called for an entity.
 *
 * <h2>Script callbacks</h2>
 * The C ABI registers a raw C function pointer per entity
 * ({@code lument_set_script}). Because JNI cannot present a Java object as a C
 * function pointer, the bridge registers a single native trampoline for every
 * scripted entity and keeps a map from entity id back to the Java
 * {@link UpdateCallback}. See {@link #setScript(int, UpdateCallback)}.
 */
public final class ECS {

    /** Sentinel for an invalid / non-existent entity (matches {@code LUMENT_INVALID_ENTITY}). */
    public static final int INVALID_ENTITY = 0;

    private ECS() {
        // No instances; all API is static.
    }

    // ------------------------------------------------------------------
    // Entity lifecycle.
    // ------------------------------------------------------------------

    /**
     * Creates a new, empty entity. Maps to {@code lument_create_entity()}.
     *
     * @return a new entity id, or {@link #INVALID_ENTITY} on failure
     */
    public static int createEntity() {
        return nCreateEntity();
    }

    /**
     * Destroys an entity and all its components. Maps to
     * {@code lument_destroy_entity()}. Safe to call on an already-destroyed entity.
     *
     * @param entity entity id
     */
    public static void destroyEntity(int entity) {
        if (entity == INVALID_ENTITY) {
            return;
        }
        // Release any registered script callback first.
        nSetScript(entity, null);
        nDestroyEntity(entity);
    }

    /**
     * Returns whether an entity is still alive. Maps to
     * {@code lument_entity_alive()}.
     *
     * @param entity entity id
     * @return true if the entity exists
     */
    public static boolean entityAlive(int entity) {
        return entity != INVALID_ENTITY && nEntityAlive(entity);
    }

    // ------------------------------------------------------------------
    // Transform.
    // ------------------------------------------------------------------

    /**
     * Sets the entity world position. Maps to {@code lument_set_position()}.
     *
     * @param entity entity id
     * @param x      X coordinate
     * @param y      Y coordinate
     */
    public static void setPosition(int entity, float x, float y) {
        nSetPosition(entity, x, y);
    }

    /**
     * Sets the entity world position from a vector.
     *
     * @param entity entity id
     * @param pos    position (non-null)
     */
    public static void setPosition(int entity, LumentVec2 pos) {
        Objects.requireNonNull(pos, "pos");
        nSetPosition(entity, pos.x, pos.y);
    }

    /**
     * Returns the entity world position. Maps to {@code lument_get_position()}.
     *
     * @param entity entity id
     * @return a new {@link LumentVec2} with the position
     */
    public static LumentVec2 getPosition(int entity) {
        float[] out = new float[2];
        nGetPosition(entity, out);
        return new LumentVec2(out[0], out[1]);
    }

    /**
     * Sets the entity scale. Maps to {@code lument_set_scale()}.
     *
     * @param entity entity id
     * @param sx     scale X
     * @param sy     scale Y
     */
    public static void setScale(int entity, float sx, float sy) {
        nSetScale(entity, sx, sy);
    }

    // ------------------------------------------------------------------
    // Sprite.
    // ------------------------------------------------------------------

    /**
     * Attaches / updates a sprite component. Maps to {@code lument_set_sprite()}.
     *
     * @param entity     entity id
     * @param textureId  texture handle from {@link Renderer#loadTexture}
     * @param width       sprite width in world units
     * @param height      sprite height in world units
     */
    public static void setSprite(int entity, int textureId, float width, float height) {
        nSetSprite(entity, textureId, width, height);
    }

    /**
     * Sets the sprite tint color. Maps to {@code lument_set_sprite_color()}.
     *
     * @param entity entity id
     * @param color  tint color (non-null)
     */
    public static void setSpriteColor(int entity, LumentColor color) {
        Objects.requireNonNull(color, "color");
        nSetSpriteColor(entity, color.pack());
    }

    /**
     * Shows or hides the entity's sprite. Maps to {@code lument_set_visible()}.
     *
     * @param entity  entity id
     * @param visible true to render, false to skip
     */
    public static void setVisible(int entity, boolean visible) {
        nSetVisible(entity, visible);
    }

    // ------------------------------------------------------------------
    // Collider.
    // ------------------------------------------------------------------

    /**
     * Attaches / updates an axis-aligned collider. Maps to
     * {@code lument_set_collider()}.
     *
     * @param entity entity id
     * @param width  collider width
     * @param height collider height
     */
    public static void setCollider(int entity, float width, float height) {
        nSetCollider(entity, width, height);
    }

    /**
     * Tests whether two entities' colliders overlap. Maps to
     * {@code lument_check_collision()}.
     *
     * @param a first entity
     * @param b second entity
     * @return true if the colliders intersect
     */
    public static boolean checkCollision(int a, int b) {
        return nCheckCollision(a, b);
    }

    // ------------------------------------------------------------------
    // Script.
    // ------------------------------------------------------------------

    /**
     * Attaches (or replaces, or removes) a per-frame update script on an
     * entity. Maps to {@code lument_set_script()}.
     *
     * <p>The bridge registers a native trampoline with the engine and stores a
     * global reference to {@code callback} keyed by entity id. When the native
     * engine fires the trampoline each frame it looks up the entity id and
     * invokes {@link UpdateCallback#onUpdate(int, float)} on this thread (the
     * frame/update thread).
     *
     * <p>Pass {@code null} to remove an existing script and release the
     * reference. {@link #destroyEntity(int)} also releases the script, so
     * calling {@code setScript(entity, null)} explicitly is only needed when
     * you want to keep the entity but drop its behaviour.
     *
     * @param entity   entity id
     * @param callback update callback, or {@code null} to remove
     */
    public static void setScript(int entity, UpdateCallback callback) {
        nSetScript(entity, callback);
    }

    // ==================================================================
    // JNI native method declarations.
    // ==================================================================

    private static native int nCreateEntity();
    private static native void nDestroyEntity(int entity);
    private static native boolean nEntityAlive(int entity);

    private static native void nSetPosition(int entity, float x, float y);
    private static native void nGetPosition(int entity, float[] outPos);
    private static native void nSetScale(int entity, float sx, float sy);

    private static native void nSetSprite(int entity, int textureId, float w, float h);
    private static native void nSetSpriteColor(int entity, int color);
    private static native void nSetVisible(int entity, boolean visible);

    private static native void nSetCollider(int entity, float w, float h);
    private static native boolean nCheckCollision(int a, int b);

    /**
     * Native trampoline registration. When {@code callback} is non-null the
     * bridge stores a global JNI reference and registers the native callback
     * with the engine; when null it removes the entry and unregisters.
     */
    private static native void nSetScript(int entity, UpdateCallback callback);
}
