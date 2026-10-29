package com.north.device

import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class NorthDeviceModule : Module() {
  private val context get() = appContext.reactContext ?: error("North is unavailable")
  override fun definition() = ModuleDefinition {
    Name("NorthDevice")
    AsyncFunction("status") {
      val ops = context.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      mapOf("usageAccess" to (ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, android.os.Process.myUid(), context.packageName) == AppOpsManager.MODE_ALLOWED),
        "overlay" to Settings.canDrawOverlays(context), "monitoring" to NorthMonitorService.running, "vpn" to NorthDnsService.running, "browserAccess" to NorthBrowserService.running)
    }
    AsyncFunction("openUsageAccess") { context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    AsyncFunction("openBrowserAccess") { context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    AsyncFunction("openOverlayAccess") { context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    AsyncFunction("configure") { value: String ->
      val json = JSONObject(value)
      require(json.optString("owner").isNotBlank())
      require(json.optString("url").startsWith("https://"))
      NorthStore.configure(context, json)
    }
    AsyncFunction("start") {
      val intent = Intent(context, NorthMonitorService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
    }
    AsyncFunction("stop") {
      context.stopService(Intent(context, NorthMonitorService::class.java))
      context.stopService(Intent(context, NorthDnsService::class.java))
      NorthStore.clearSession(context)
    }
    AsyncFunction("startWebsiteBlocking") {
      val consent = VpnService.prepare(context)
      if (consent != null) { context.startActivity(consent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); false }
      else { val intent = Intent(context, NorthDnsService::class.java); if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent); true }
    }
    AsyncFunction("stopWebsiteBlocking") { context.stopService(Intent(context, NorthDnsService::class.java)) }
    AsyncFunction("usage") { owner: String ->
      require(owner == NorthStore.owner(context))
      val id = NorthStore.deviceId(context)
      val rows = NorthStore.usage(context, owner)
      for (i in 0 until rows.length()) rows.getJSONObject(i).put("device_id", id).put("source", "mobile")
      rows.toString()
    }
    AsyncFunction("session") { NorthStore.session(context).toString() }
    AsyncFunction("sync") {
      NorthStore.sync(context, true)
      val syncError = context.getSharedPreferences("north.device", Context.MODE_PRIVATE).getString("syncError", null)
      if (syncError != null) error("Device sync is offline. Your activity is saved locally.")
      true
    }
  }
}
