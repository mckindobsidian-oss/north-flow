package com.north.device

import android.app.*
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.*
import android.graphics.PixelFormat
import android.os.*
import android.provider.Settings
import android.view.*
import android.widget.*
import java.util.concurrent.Executors

class NorthMonitorService : Service() {
  companion object { @Volatile var running = false; @Volatile var blockingOverlay = false }
  private val handler = Handler(Looper.getMainLooper())
  private val network = Executors.newSingleThreadExecutor()
  private var foreground = ""; private var lastPackage = ""; private var overlay: View? = null; private var lastElapsed = 0L
  private var lastEvents = 0L; private var lastSync = 0L; private var sessionSeconds = 0
  private var lastHost = ""; private var webSeconds = 0; private var webBudget: Int? = null; private var overlayTarget = ""
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, id: Int): Int {
    if (NorthStore.owner(this).isBlank()) { stopSelf(); return START_NOT_STICKY }
    notification(this, 41, "North is monitoring active apps", "Tap North to manage tracking and blocking.")
    if (!running) { running = true; handler.post(tick) }
    return START_STICKY
  }
  private fun excluded(pkg: String): Boolean {
    if (pkg.isBlank() || pkg == packageName || pkg == "android" || pkg.contains("systemui") || pkg.contains("permissioncontroller") || pkg.contains("settings") || pkg.contains("dialer") || pkg.contains("launcher") || pkg.contains("packageinstaller")) return true
    val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
    return packageManager.resolveActivity(home, 0)?.activityInfo?.packageName == pkg
  }
  private val tick = object : Runnable {
    override fun run() {
      try {
        val ops = getSystemService(APP_OPS_SERVICE) as AppOpsManager
        if (NorthStore.owner(this@NorthMonitorService).isBlank() || ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), packageName) != AppOpsManager.MODE_ALLOWED) { stopSelf(); return }
        val now = System.currentTimeMillis(); val elapsed = SystemClock.elapsedRealtime()
        val power = getSystemService(POWER_SERVICE) as PowerManager
        val locked = (getSystemService(KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
        val events = (getSystemService(USAGE_STATS_SERVICE) as UsageStatsManager).queryEvents(if (lastEvents == 0L) now - 60000 else lastEvents, now)
        lastEvents = now
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
          events.getNextEvent(event)
          if (event.eventType == UsageEvents.Event.ACTIVITY_RESUMED) {
            if (lastPackage != event.packageName) sessionSeconds = 0
            lastPackage = event.packageName
            foreground = event.packageName
          } else if (event.eventType == UsageEvents.Event.ACTIVITY_PAUSED && foreground == event.packageName) foreground = ""
        }
        val active = power.isInteractive && !locked && !excluded(foreground)
        if (active) {
          val label = try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(foreground, 0)).toString() } catch (_: Exception) { foreground }
          val host = NorthBrowserService.host(foreground)
          if (host != lastHost) { lastHost = host; webSeconds = 0; webBudget = null }
          val appBlocked = NorthRules.blocked(this@NorthMonitorService, "app", foreground, label, sessionSeconds)
          val siteBlocked = host.isNotBlank() && NorthRules.blocked(this@NorthMonitorService, "website", host, host, webSeconds, webBudget)
          if ((appBlocked || siteBlocked) && Settings.canDrawOverlays(this@NorthMonitorService)) {
            val sessionChoice = !appBlocked && NorthRules.needsWebsiteSession(this@NorthMonitorService, host) && !NorthRules.blocked(this@NorthMonitorService, "website", host, host, 0, Int.MAX_VALUE)
            showBlock(if (appBlocked) label else host, if (appBlocked) "app" else "website", if (appBlocked) foreground else host, sessionChoice)
          } else {
            hideBlock()
            // Discard suspension/wake gaps; never infer background activity.
            if (lastElapsed > 0 && elapsed - lastElapsed in 500..2000) {
              NorthStore.addRawAppSecond(this@NorthMonitorService, foreground)
              if (host.isNotBlank()) { NorthStore.addSecond(this@NorthMonitorService, host, 1, "website"); webSeconds++ }
              else NorthStore.addSecond(this@NorthMonitorService, foreground, 1)
              sessionSeconds++
            }
          }
        } else { hideBlock(); lastHost = ""; webBudget = null; webSeconds = 0 }
        lastElapsed = elapsed
        if (now - lastSync >= 30000) { lastSync = now; network.execute { NorthStore.sync(this@NorthMonitorService) } }
      } catch (_: Exception) { hideBlock() }
      if (running) handler.postDelayed(this, 1000)
    }
  }
  private fun showBlock(label: String, kind: String, target: String, sessionChoice: Boolean) {
    if (overlay != null && overlayTarget == target) return
    hideBlock(); overlayTarget = target
    val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setPadding(32, 32, 32, 32); setBackgroundColor(0xFF181422.toInt()) }
    box.addView(TextView(this).apply { text = "NORTH\n\n$label is blocked\n\nMake room for what matters."; textSize = 23f; gravity = Gravity.CENTER; setTextColor(0xFFF7F3FF.toInt()) })
    if (sessionChoice) for (minutes in listOf(1, 5, 15, 30)) box.addView(Button(this).apply { text = "$minutes minute visit"; setOnClickListener { webBudget = minutes * 60; webSeconds = 0; hideBlock() } })
    else if (NorthStore.blocking(this).optJSONObject("settings")?.optBoolean("allowTemporaryUnblock", true) != false) box.addView(Button(this).apply { text = "+1 minute"; setOnClickListener { NorthStore.allowMinute(this@NorthMonitorService, kind, target); hideBlock() } })
    box.addView(Button(this).apply { text = "Return home"; setOnClickListener { startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); hideBlock() } })
    box.addView(Button(this).apply { text = "Open North"; setOnClickListener { packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }; hideBlock() } })
    val params = WindowManager.LayoutParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY, WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE, PixelFormat.TRANSLUCENT)
    try { (getSystemService(WINDOW_SERVICE) as WindowManager).addView(box, params); overlay = box; blockingOverlay = true } catch (_: Exception) {}
  }
  private fun hideBlock() { overlay?.let { try { (getSystemService(WINDOW_SERVICE) as WindowManager).removeView(it) } catch (_: Exception) {} }; overlay = null; blockingOverlay = false }
  override fun onDestroy() { running = false; handler.removeCallbacksAndMessages(null); hideBlock(); network.shutdownNow(); super.onDestroy() }
}

fun notification(service: Service, id: Int, title: String, detail: String) {
  val manager = service.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
  manager.createNotificationChannel(NotificationChannel("north-monitor", "North monitoring", NotificationManager.IMPORTANCE_LOW))
  val launch = service.packageManager.getLaunchIntentForPackage(service.packageName) ?: Intent()
  val open = PendingIntent.getActivity(service, id, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  service.startForeground(id, Notification.Builder(service, "north-monitor").setContentTitle(title).setContentText(detail).setSmallIcon(service.applicationInfo.icon).setContentIntent(open).setOngoing(true).build())
}
