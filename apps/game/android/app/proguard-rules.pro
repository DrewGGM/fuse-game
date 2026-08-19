# Fuse — ProGuard/R8 rules.
#
# The game is JavaScript inside a WebView; the only Java is Capacitor's bridge.
# R8 must not strip what the bridge reaches by reflection, or the app builds
# fine and then shows a blank screen on launch — the worst possible failure,
# because it only appears in a release build.

# Capacitor discovers plugins and their @PluginMethod entry points reflectively.
-keep class com.getcapacitor.** { *; }
-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }
-keepclassmembers class * {
  @com.getcapacitor.PluginMethod public <methods>;
}

# The local-notifications plugin is resolved by name from the JS side.
-keep class com.capacitorjs.plugins.** { *; }

# Anything the WebView calls through addJavascriptInterface.
-keepclassmembers class * {
  @android.webkit.JavascriptInterface <methods>;
}

# Keep source line numbers so a crash report is readable, but hide the original
# file names.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
