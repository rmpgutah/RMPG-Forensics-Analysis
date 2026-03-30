# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in the Android SDK tools proguard configuration.

# Keep WebView JavaScript interface
-keepclassmembers class com.rmpg.forensics.MainActivity$WebAppInterface {
    public *;
}

# Keep Material Design classes
-keep class com.google.android.material.** { *; }

# Keep AndroidX classes
-keep class androidx.** { *; }
-keep interface androidx.** { *; }

# Preserve line number information for debugging stack traces
-keepattributes SourceFile,LineNumberTable

# Hide the original source file name
-renamesourcefileattribute SourceFile
