param([string]$Device = '')
$ErrorActionPreference = 'Stop'
$northRoot = Split-Path $PSScriptRoot -Parent
$northAdb = Join-Path $northRoot '.tmp\android-tools\sdk\platform-tools\adb.exe'
$northApk = Join-Path $northRoot 'artifacts\North-Android-universal.apk'
if (!(Test-Path -LiteralPath $northAdb) -or !(Test-Path -LiteralPath $northApk)) { throw 'Build the Android APK and install platform-tools first.' }
if (!$Device) {
  $northDevices = @(& $northAdb devices | Where-Object { $_ -match '^\S+\s+device$' } | ForEach-Object { ($_ -split '\s+')[0] })
  if ($northDevices.Count -ne 1) { throw 'Connect one Android phone with USB debugging enabled and approve this computer on the phone. Or pass -Device with its adb ID.' }
  $Device = $northDevices[0]
}
# -r updates in place. Never uninstall or discard local data automatically.
& $northAdb -s $Device install -r $northApk
if ($LASTEXITCODE -ne 0) { throw 'Android rejected installation. Keep the INSTALL_FAILED code above; it identifies the actual cause. No app data was deleted.' }
Write-Output 'Installed. Open North from your phone app list.'
