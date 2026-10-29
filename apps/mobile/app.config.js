const fs = require('fs');
const path = require('path');
const base = require('./app.json').expo;
let local = {};
try {
  local = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../../react-app/.env.local'), 'utf8').split(/\r?\n/).map((line) => line.match(/^([A-Z_]+)\s*=\s*["']?(.*?)["']?\s*$/)).filter(Boolean).map((m) => [m[1], m[2]]));
} catch {}
module.exports = {
  ...base, version: '0.2.5', newArchEnabled: false, icon: '../../react-app/public/north-logo.png',
  plugins: ['expo-secure-store', './plugins/withNorthAndroid'],
  extra: { ...base.extra, supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL || local.VITE_SUPABASE_URL, supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || local.VITE_SUPABASE_ANON_KEY },
  android: { ...base.android, versionCode: 7, allowBackup: false, blockedPermissions: ['android.permission.RECORD_AUDIO', 'android.permission.READ_EXTERNAL_STORAGE', 'android.permission.WRITE_EXTERNAL_STORAGE'], adaptiveIcon: { foregroundImage: '../../react-app/public/north-logo.png', backgroundColor: '#171121' }, permissions: ['android.permission.INTERNET', 'android.permission.ACCESS_NETWORK_STATE', 'android.permission.PACKAGE_USAGE_STATS', 'android.permission.SYSTEM_ALERT_WINDOW', 'android.permission.FOREGROUND_SERVICE', 'android.permission.FOREGROUND_SERVICE_SPECIAL_USE', 'android.permission.POST_NOTIFICATIONS'] },
};
