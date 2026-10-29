package com.north.device

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import org.json.JSONArray
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import java.text.SimpleDateFormat
import java.util.*

object NorthStore {
  @Synchronized fun deviceId(c: Context): String {
    val preferences = c.getSharedPreferences("north.device", Context.MODE_PRIVATE)
    return preferences.getString("device", null) ?: UUID.randomUUID().toString().also { preferences.edit().putString("device", it).commit() }
  }
  private fun prefs(c: Context) = c.getSharedPreferences("north.device", Context.MODE_PRIVATE)
  @Synchronized private fun updateOwner(c: Context, expected: String, action: () -> Unit): Boolean { if (owner(c) != expected) return false; action(); return true }
  private fun key(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!store.containsAlias("north.device.session")) KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
      init(KeyGenParameterSpec.Builder("north.device.session", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); generateKey()
    }
    return store.getKey("north.device.session", null) as SecretKey
  }
  @Synchronized fun session(c: Context): JSONObject { return try {
    val encoded = prefs(c).getString("session", null) ?: return JSONObject()
    val parts = encoded.split(":")
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(parts[0], 2))) }
    JSONObject(String(cipher.doFinal(Base64.decode(parts[1], 2)), Charsets.UTF_8))
  } catch (_: Exception) { JSONObject() } }
  @Synchronized private fun saveSession(c: Context, value: JSONObject) {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, key()) }
    val data = Base64.encodeToString(cipher.iv, 2) + ":" + Base64.encodeToString(cipher.doFinal(value.toString().toByteArray(Charsets.UTF_8)), 2)
    prefs(c).edit().putString("session", data).commit()
  }
  @Synchronized fun configure(c: Context, value: JSONObject) {
    val old = session(c)
    if (old.optString("owner") != value.optString("owner")) prefs(c).edit().remove("externalUsage").remove("externalDay").commit()
    val next = if (old.optString("owner") == value.optString("owner") && old.optLong("expires_at") > value.optLong("expires_at")) old else value
    saveSession(c, next)
    prefs(c).edit().putString("owner", value.getString("owner")).putString("blocking", value.optJSONObject("blocking")?.toString() ?: "{}").commit()
  }
  @Synchronized fun clearSession(c: Context) { prefs(c).edit().remove("session").remove("owner").remove("blocking").remove("externalUsage").remove("externalDay").commit() }
  fun owner(c: Context) = prefs(c).getString("owner", "") ?: ""
  fun blocking(c: Context) = JSONObject(prefs(c).getString("blocking", "{}") ?: "{}")
  fun day() = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.format(Date())
  @Synchronized fun usage(c: Context, owner: String): JSONArray = JSONArray(prefs(c).getString("usage.$owner", "[]") ?: "[]")
  @Synchronized fun addSecond(c: Context, pkg: String, seconds: Int, kind: String = "app") {
    val owner = owner(c); if (owner.isBlank()) return
    val rows = usage(c, owner); val day = day()
    var found: JSONObject? = null
    for (i in 0 until rows.length()) { val row = rows.getJSONObject(i); if (row.optString("name") == pkg && row.optString("day") == day && row.optString("kind") == kind) { found = row; break } }
    val row = found ?: JSONObject().put("day", day).put("kind", kind).put("name", pkg).put("seconds", 0).put("hourly", JSONObject()).also { rows.put(it) }
    row.put("seconds", row.optInt("seconds") + seconds)
    val hour = Calendar.getInstance(TimeZone.getTimeZone("UTC")).get(Calendar.HOUR_OF_DAY).toString()
    val hourly = row.getJSONObject("hourly"); hourly.put(hour, hourly.optInt(hour) + seconds)
    prefs(c).edit().putString("usage.$owner", rows.toString()).apply()
  }
  fun used(c: Context, name: String): Int { val rows = usage(c, owner(c)); var total = 0; for (i in 0 until rows.length()) { val r = rows.getJSONObject(i); if (r.optString("day") == day() && r.optString("name").equals(name, true)) total += r.optInt("seconds") }; return total }
  fun rawAppUsed(c: Context, name: String): Int = maxOf(used(c, name), prefs(c).getInt("raw.${owner(c)}.${day()}.$name", 0))
  fun websiteUsed(c: Context, target: String): Int { val rows = usage(c, owner(c)); var total = 0; for (i in 0 until rows.length()) { val row = rows.getJSONObject(i); val name = row.optString("name"); if (row.optString("kind") == "website" && row.optString("day") == day() && (name.equals(target, true) || name.lowercase().endsWith("." + target.lowercase()))) total += row.optInt("seconds") }; return total }
  fun addRawAppSecond(c: Context, name: String) { prefs(c).edit().putInt("raw.${owner(c)}.${day()}.$name", rawAppUsed(c, name) + 1).apply() }
  fun temporarilyAllowed(c: Context, kind: String, name: String) = prefs(c).getLong("unblock.${owner(c)}.$kind.$name", 0) > System.currentTimeMillis()
  fun allowMinute(c: Context, kind: String, name: String) { prefs(c).edit().putLong("unblock.${owner(c)}.$kind.$name", System.currentTimeMillis() + 60000).apply() }
  fun externalUsed(c: Context, kind: String, target: String): Int {
    if (prefs(c).getString("externalDay", "") != day()) return 0
    val values = JSONObject(prefs(c).getString("externalUsage", "{}") ?: "{}"); var total = 0
    for (key in values.keys()) {
      val prefix = "$kind:"; if (!key.startsWith(prefix)) continue
      val name = key.removePrefix(prefix)
      if (name.equals(target, true) || (kind == "website" && name.lowercase().endsWith("." + target.lowercase()))) total += values.optInt(key)
    }
    return total
  }
  private fun request(config: JSONObject, path: String, method: String = "GET", body: String? = null): String {
    val base = config.getString("url").trimEnd('/'); require(base.startsWith("https://"))
    val conn = URL(base + path).openConnection() as HttpURLConnection
    conn.connectTimeout = 10000; conn.readTimeout = 10000; conn.instanceFollowRedirects = false; conn.requestMethod = method
    conn.setRequestProperty("apikey", config.getString("key")); conn.setRequestProperty("Authorization", "Bearer " + config.getString("access_token")); conn.setRequestProperty("Content-Type", "application/json")
    conn.setRequestProperty("Prefer", "resolution=merge-duplicates,return=minimal")
    try { if (body != null) { conn.doOutput = true; conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) } }; if (conn.responseCode !in 200..299) error("Sync HTTP ${conn.responseCode}"); return conn.inputStream.bufferedReader().use { it.readText() } } finally { conn.disconnect() }
  }
  private val syncGate = java.util.concurrent.locks.ReentrantLock()
  fun sync(c: Context, waitForCompletion: Boolean = false) {
    val acquired = if (waitForCompletion) syncGate.tryLock(45, java.util.concurrent.TimeUnit.SECONDS) else syncGate.tryLock()
    if (!acquired) {
      if (waitForCompletion) error("Sync is still running. Please retry shortly.")
      return
    }
    try { syncOnce(c) } finally { syncGate.unlock() }
  }
  private fun syncOnce(c: Context) {
    var config = session(c); val owner = config.optString("owner"); if (owner.isBlank()) return
    try {
      if (config.optLong("expires_at") * 1000 < System.currentTimeMillis() + 60000) {
        val refreshed = JSONObject(request(config, "/auth/v1/token?grant_type=refresh_token", "POST", JSONObject().put("refresh_token", config.getString("refresh_token")).toString()))
        require(refreshed.getJSONObject("user").getString("id") == owner)
        for (field in listOf("access_token", "refresh_token")) config.put(field, refreshed.get(field))
        config.put("expires_at", refreshed.optLong("expires_at", System.currentTimeMillis() / 1000 + refreshed.optLong("expires_in", 3600)))
        if (!updateOwner(c, owner) { saveSession(c, config) }) return
      }
      // Fetch rules only, not the account's potentially multi-megabyte wallpaper.
      val profiles = JSONArray(request(config, "/rest/v1/profiles?id=eq.$owner&select=blocking:settings-%3Eblocking"))
      if (owner(c) != owner) return
      if (profiles.length() == 1 && !updateOwner(c, owner) { prefs(c).edit().putString("blocking", profiles.getJSONObject(0).optJSONObject("blocking")?.toString() ?: "{}").apply() }) return
      val device = deviceId(c)
      val accountRows = JSONArray(); val today = day(); var offset = 0
      while (true) {
        val page = JSONArray(request(config, "/rest/v1/usage_records?user_id=eq.$owner&day=eq.$today&select=kind,name,seconds,device_id&order=kind,name,device_id&limit=1000&offset=$offset"))
        for (i in 0 until page.length()) accountRows.put(page.getJSONObject(i))
        if (page.length() < 1000) break
        offset += 1000
      }
      val external = JSONObject(); val modern = HashMap<String, MutableMap<String, Int>>(); val legacy = HashMap<String, Int>()
      for (i in 0 until accountRows.length()) {
        val row = accountRows.getJSONObject(i); val name = row.optString("kind") + ":" + row.optString("name"); val source = row.optString("device_id", "legacy"); val seconds = row.optInt("seconds")
        if (source == "legacy") legacy[name] = maxOf(legacy[name] ?: 0, seconds)
        else { val devices = modern.getOrPut(name) { HashMap() }; devices[source] = maxOf(devices[source] ?: 0, seconds) }
      }
      for (name in modern.keys + legacy.keys) {
        val devices = modern[name] ?: emptyMap(); val total = maxOf(devices.values.sum(), legacy[name] ?: 0)
        external.put(name, maxOf(0, total - (devices[device] ?: 0)))
      }
      if (owner(c) != owner) return
      if (!updateOwner(c, owner) { prefs(c).edit().putString("externalUsage", external.toString()).putString("externalDay", day()).apply() }) return
      val pending = usage(c, owner); val payload = JSONArray(); val acknowledged = JSONObject(prefs(c).getString("uploaded.$owner", "{}") ?: "{}")
      for (i in 0 until pending.length()) {
        val original = pending.getJSONObject(i); val recordKey = original.optString("day") + ":" + original.optString("kind") + ":" + original.optString("name")
        if (acknowledged.optInt(recordKey, -1) == original.optInt("seconds")) continue
        val r = JSONObject(original.toString()).put("user_id", owner).put("device_id", device).put("source", "mobile"); payload.put(r)
      }
      if (payload.length() > 0) {
        request(config, "/rest/v1/usage_records?on_conflict=user_id,day,kind,name,device_id", "POST", payload.toString())
        for (i in 0 until payload.length()) { val r = payload.getJSONObject(i); acknowledged.put(r.optString("day") + ":" + r.optString("kind") + ":" + r.optString("name"), r.optInt("seconds")) }
        prefs(c).edit().putString("uploaded.$owner", acknowledged.toString()).apply()
      }
      prefs(c).edit().putLong("lastSync", System.currentTimeMillis()).remove("syncError").apply()
    } catch (error: Exception) { prefs(c).edit().putString("syncError", error.message ?: "Offline").apply() }
  }
}
