package com.lument.engine;

/**
 * Audio API wrapper around the C ABI audio functions.
 *
 * <p>The engine distinguishes short sound effects from long streaming music:
 * pass {@code true} for {@code isMusic} when loading background music so the
 * engine can choose a streaming decoder and pool. Audio handles are opaque
 * {@code int} ids; {@code 0} indicates a failed load.
 */
public final class Audio {

    /** Returned by {@link #loadAudio} when loading fails. */
    public static final int INVALID_AUDIO = 0;

    private Audio() {
        // No instances; all API is static.
    }

    /**
     * Loads an audio clip. Maps to {@code lument_load_audio(const char*, bool)}.
     *
     * @param path    audio file path (relative to assets on Android)
     * @param isMusic true for long streaming music, false for short SFX
     * @return audio id, or {@link #INVALID_AUDIO} on failure
     */
    public static int loadAudio(String path, boolean isMusic) {
        if (path == null) {
            return INVALID_AUDIO;
        }
        return nLoadAudio(path, isMusic);
    }

    /**
     * Plays an audio clip. Maps to {@code lument_play_audio(uint32_t, bool)}.
     *
     * @param id   audio id from {@link #loadAudio}
     * @param loop true to loop indefinitely
     */
    public static void playAudio(int id, boolean loop) {
        nPlayAudio(id, loop);
    }

    /**
     * Stops a playing audio clip. Maps to {@code lument_stop_audio()}.
     *
     * @param id audio id
     */
    public static void stopAudio(int id) {
        nStopAudio(id);
    }

    /**
     * Sets the playback volume of a clip. Maps to {@code lument_set_volume()}.
     *
     * @param id     audio id
     * @param volume linear volume in {@code [0, 1]}
     */
    public static void setVolume(int id, float volume) {
        nSetVolume(id, volume);
    }

    /**
     * Stops every currently playing clip. Maps to {@code lument_stop_all_audio()}.
     */
    public static void stopAllAudio() {
        nStopAllAudio();
    }

    // ==================================================================
    // JNI native method declarations.
    // ==================================================================

    private static native int nLoadAudio(String path, boolean isMusic);
    private static native void nPlayAudio(int id, boolean loop);
    private static native void nStopAudio(int id);
    private static native void nSetVolume(int id, float volume);
    private static native void nStopAllAudio();
}
