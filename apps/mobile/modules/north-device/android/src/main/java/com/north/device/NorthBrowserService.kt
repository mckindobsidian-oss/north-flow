package com.north.device

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import java.net.URI

class NorthBrowserService : AccessibilityService() {
  companion object {
    @Volatile var running = false
    @Volatile private var browser = ""
    @Volatile private var hostname = ""
    @Volatile private var observed = 0L
    fun host(packageName: String): String = if (running && browser == packageName && SystemClock.elapsedRealtime() - observed < 2500) hostname else ""
  }
  private val handler = Handler(Looper.getMainLooper())
  override fun onServiceConnected() { running = true; handler.post(tick) }
  override fun onAccessibilityEvent(event: AccessibilityEvent?) { if (NorthMonitorService.running) observe() }
  private val tick = object : Runnable {
    override fun run() { if (NorthMonitorService.running) observe() else { hostname = ""; browser = "" }; if (running) handler.postDelayed(this, 1000) }
  }
  private fun observe() {
    try {
      val root = rootInActiveWindow ?: return
      val pkg = root.packageName?.toString() ?: return
      if (pkg == packageName && NorthMonitorService.blockingOverlay) { observed = SystemClock.elapsedRealtime(); return }
      val ids = when (pkg) {
        "com.android.chrome", "com.chrome.beta", "com.brave.browser", "com.microsoft.emmx" -> listOf("$pkg:id/url_bar")
        "org.mozilla.firefox" -> listOf("$pkg:id/mozac_browser_toolbar_url_view", "$pkg:id/mozac_browser_toolbar_edit_url_view")
        "com.sec.android.app.sbrowser" -> listOf("$pkg:id/location_bar_edit_text")
        else -> { hostname = ""; browser = ""; return }
      }
      browser = pkg
      var host = ""
      for (id in ids) {
        val nodes = root.findAccessibilityNodeInfosByViewId(id)
        for (node in nodes) {
          val raw = node.text?.toString()?.trim() ?: continue
          // Keep only a validated host. Never persist or transmit the URL/query.
          val candidate = URI(if (raw.contains("://")) raw else "https://$raw").host?.lowercase()?.removePrefix("www.") ?: continue
          if (candidate.contains('.') && candidate.matches(Regex("[a-z0-9.-]{1,253}"))) { host = candidate; break }
        }
        if (host.isNotBlank()) break
      }
      hostname = host; observed = SystemClock.elapsedRealtime()
    } catch (_: Exception) { hostname = "" }
  }
  override fun onInterrupt() { hostname = ""; browser = "" }
  override fun onDestroy() { running = false; hostname = ""; browser = ""; handler.removeCallbacksAndMessages(null); super.onDestroy() }
}
