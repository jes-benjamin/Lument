package com.lument.engine;

/**
 * Key/value persistent storage wrapper around the C ABI storage functions.
 *
 * <p>The engine stores arbitrary string data under string keys; the underlying
 * backend (filesystem, SharedPreferences-backed file, etc.) is chosen by the
 * engine based on the {@code savePath} configured at
     * {@link Engine#init(LumentConfig)}.
 *
 * <p><b>Lifetime of returned strings:</b> {@link #loadData(String)} maps to
 * {@code lument_load_data()} which returns a {@code const char*} that may be
 * invalidated by the next storage call. The JNI bridge therefore copies the
 * bytes into a Java {@link String} before returning, so callers may hold the
 * result safely across calls.
 */
public final class Storage {

    /** Non-zero return from save/clear on success. */
    public static final int OK = 1;
    /** Zero return from save/clear on failure / missing key. */
    public static final int FAIL = 0;

    private Storage() {
        // No instances; all API is static.
    }

    /**
     * Saves a string under {@code key}, replacing any previous value. Maps to
     * {@code lument_save_data(const char*, const char*)}.
     *
     * @param key  storage key
     * @param data  string data (non-null)
     * @return {@link #OK} on success, {@link #FAIL} on failure
     */
    public static int saveData(String key, String data) {
        if (key == null || data == null) {
            throw new IllegalArgumentException("key and data must not be null");
        }
        return nSaveData(key, data);
    }

    /**
     * Loads the string stored under {@code key}. Maps to
     * {@code lument_load_data()}.
     *
     * @param key storage key
     * @return the stored data, or {@code null} if the key does not exist
     */
    public static String loadData(String key) {
        if (key == null) {
            return null;
        }
        return nLoadData(key);
    }

    /**
     * Removes the value stored under {@code key}. Maps to
     * {@code lument_clear_data()}.
     *
     * @param key storage key
     * @return {@link #OK} on success (including when the key was already
     *         absent), {@link #FAIL} on failure
     */
    public static int clearData(String key) {
        if (key == null) {
            return FAIL;
        }
        return nClearData(key);
    }

    // ==================================================================
    // JNI native method declarations.
    // ==================================================================

    private static native int nSaveData(String key, String data);
    private static native String nLoadData(String key);
    private static native int nClearData(String key);
}
