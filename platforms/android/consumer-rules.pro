# ============================================================
# consumer-rules.pro - ProGuard consumer rules for Lument
# ------------------------------------------------------------
# These rules are applied automatically to apps that depend on
# this library.  They prevent R8/ProGuard from stripping or
# renaming the parts that the JNI runtime depends on.
# ============================================================

# --- JNI native methods ---
# R8 strips native method declarations if it thinks they are
# unreferenced (the native side calls them, which R8 cannot see).
# Keep every native method in every class under com.lument.engine.
-keepclasseswithmembernames class com.lument.engine.** {
    native <methods>;
}

# --- ECS script callback interface ---
# The JNI trampoline (jni_script_callback) looks up
# com.lument.engine.UpdateCallback and its onUpdate(int, float)
# method by name at runtime.  Do not rename or remove it.
-keep interface com.lument.engine.UpdateCallback {
    public void onUpdate(int, float);
}

# --- Engine data classes ---
# These hold struct-like data passed across the JNI boundary.
# Keep their fields (R8 might otherwise rename/remove getters).
-keep class com.lument.engine.LumentColor { *; }
-keep class com.lument.engine.LumentRect  { *; }
-keep class com.lument.engine.LumentVec2  { *; }
-keep class com.lument.engine.LumentConfig { *; }

# --- AndroidEngine ---
# The host Activity subclasses AndroidEngine; keep it and its
# protected hooks so subclasses survive optimization.
-keep class com.lument.engine.android.AndroidEngine { *; }

# --- Engine constants ---
# The static int constants (PLATFORM_*, RENDERER_*, KEY_*) are
# inlined at compile time, but keep the Engine class itself so
# that reflective access (e.g. Class.forName in tooling) works.
-keep class com.lument.engine.Engine { *; }
