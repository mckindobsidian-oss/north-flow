param([string]$Apk = 'artifacts/North-Android-arm64-v8a.apk', [string]$Architecture = 'arm64-v8a')
$ErrorActionPreference = 'Stop'
$northRoot = Split-Path $PSScriptRoot -Parent
$northSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { Join-Path $northRoot '.tmp/android-tools/sdk' }
if (!$env:JAVA_HOME) { $env:JAVA_HOME = (Get-ChildItem (Join-Path $northRoot '.tmp/android-tools/java') -Directory | Select-Object -First 1).FullName }
$northBuildTools = Join-Path $northSdk 'build-tools/35.0.0'
$northApk = (Resolve-Path -LiteralPath $Apk).Path
& (Join-Path $northBuildTools 'apksigner.bat') verify --verbose $northApk
if ($LASTEXITCODE -ne 0) { throw 'APK signature verification failed.' }
& (Join-Path $northBuildTools 'zipalign.exe') -c -P 16 4 $northApk
if ($LASTEXITCODE -ne 0) { throw 'APK alignment verification failed.' }
$northPermissions = & (Join-Path $northBuildTools 'aapt.exe') dump permissions $northApk
if ($LASTEXITCODE -ne 0) { throw 'Could not read APK permissions.' }
if ($northPermissions -match 'android.permission.(RECORD_AUDIO|READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|QUERY_ALL_PACKAGES)') { throw 'Unnecessary sensitive permission found.' }
$northManifest = & (Join-Path $northBuildTools 'aapt.exe') dump xmltree $northApk AndroidManifest.xml
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect APK manifest.' }
if ($northManifest -match 'android:debuggable.*0xffffffff' -or !($northManifest -match 'android:allowBackup.*0x0$')) { throw 'Unsafe release debug/backup configuration.' }
$northBadging = & (Join-Path $northBuildTools 'aapt.exe') dump badging $northApk
$northExpectedAbis = if ($Architecture -eq 'universal') { "native-code: 'arm64-v8a' 'armeabi-v7a' 'x86' 'x86_64'" } else { "native-code: '$Architecture'" }
if (!(($northBadging | Where-Object { $_ -like 'native-code:*' }).Trim() -eq $northExpectedAbis)) { throw 'APK includes unexpected ABIs.' }
$northBadging | Select-String '^(package:|sdkVersion:|targetSdkVersion:|native-code:)'
Get-FileHash -LiteralPath $northApk -Algorithm SHA256 | Select-Object Hash
Write-Output 'APK signature, 16 KB alignment, permission and backup checks passed. Physical device testing remains separate.'
