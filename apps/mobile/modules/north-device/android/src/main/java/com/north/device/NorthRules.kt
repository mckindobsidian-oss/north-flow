package com.north.device

import android.content.Context
import org.json.JSONObject
import java.util.Calendar

object NorthRules {
  private fun window(schedule: JSONObject): Boolean {
    if (!schedule.optBoolean("enabled", true)) return false
    fun minutes(value: String): Int { val p = value.split(":"); return (p.getOrNull(0)?.toIntOrNull() ?: 0) * 60 + (p.getOrNull(1)?.toIntOrNull() ?: 0) }
    val start = minutes(schedule.optString("start")); val end = minutes(schedule.optString("end")); if (start == end) return false
    val now = Calendar.getInstance(); val time = now.get(Calendar.HOUR_OF_DAY) * 60 + now.get(Calendar.MINUTE); val day = now.get(Calendar.DAY_OF_WEEK) - 1
    val selectedDay = if (start > end && time < end) (day + 6) % 7 else day
    val days = schedule.optJSONArray("days") ?: return false
    var selected = false; for (i in 0 until days.length()) if (days.optInt(i) == selectedDay) selected = true
    return selected && if (start < end) time >= start && time < end else time >= start || time < end
  }
  fun needsWebsiteSession(c: Context, name: String): Boolean {
    val limits = NorthStore.blocking(c).optJSONArray("usageLimits") ?: return false
    for (i in 0 until limits.length()) { val rule = limits.getJSONObject(i); val target = rule.optString("target"); if (rule.optBoolean("enabled", true) && rule.optString("kind") == "website" && rule.optString("mode") == "session" && (name == target || name.endsWith(".$target"))) return true }
    return false
  }
  fun blocked(c: Context, kind: String, name: String, label: String = name, sessionSeconds: Int = 0, sessionBudget: Int? = null): Boolean {
    if (NorthStore.temporarilyAllowed(c, kind, name)) return false
    val state = NorthStore.blocking(c); val now = System.currentTimeMillis()
    fun matches(target: String) = if (kind == "website") name.equals(target, true) || name.lowercase().endsWith("." + target.lowercase()) else target.equals(name, true) || target.equals(label, true)
    val schedules = state.optJSONArray("schedules")
    val rules = state.optJSONArray("rules")
    for (i in 0 until (rules?.length() ?: 0)) {
      val rule = rules!!.getJSONObject(i)
      if (!rule.optBoolean("enabled", true) || rule.optString("kind") != kind || !matches(rule.optString("target"))) continue
      if ((state.optJSONObject("unblocks")?.optLong(rule.optString("id")) ?: 0) > now) continue
      when (rule.optString("when")) {
        "always" -> return true
        "focus" -> if ((state.optJSONObject("settings")?.optBoolean("blockDuringFocus", true) ?: true) && (state.optJSONObject("focus")?.optLong("endAt") ?: 0) > now) return true
        "scheduled" -> {
          val ids = rule.optJSONArray("scheduleIds")
          for (s in 0 until (schedules?.length() ?: 0)) {
            val schedule = schedules!!.getJSONObject(s); var selected = ids == null || ids.length() == 0
            for (j in 0 until (ids?.length() ?: 0)) if (ids!!.optString(j) == schedule.optString("id")) selected = true
            if (selected && window(schedule)) return true
          }
        }
      }
    }
    val limits = state.optJSONArray("usageLimits")
    for (i in 0 until (limits?.length() ?: 0)) {
      val limit = limits!!.getJSONObject(i)
      if (!limit.optBoolean("enabled", true) || limit.optString("kind") != kind || !matches(limit.optString("target"))) continue
      val isSession = limit.optString("mode") == "session"
      if (isSession && kind == "website" && sessionBudget == null) return true
      val seconds = if (isSession) sessionSeconds else (if (kind == "app") NorthStore.rawAppUsed(c, name) else NorthStore.websiteUsed(c, limit.optString("target"))) + NorthStore.externalUsed(c, kind, limit.optString("target"))
      val budget = if (isSession && kind == "website") sessionBudget ?: 0 else limit.optInt("dailyLimitMinutes", 25) * 60
      if (seconds >= budget) return true
    }
    return false
  }
}
