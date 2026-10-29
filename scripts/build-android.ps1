param([ValidateSet('universal','arm64-v8a','armeabi-v7a','x86_64','x86')][string]$Architecture = 'universal', [switch]$Offline)
$ErrorActionPreference = 'Stop'
$northRoot = Split-Path $PSScriptRoot -Parent
$northMobile = Join-Path $northRoot 'apps\mobile'
& node --test (Join-Path $northRoot 'tests\mobile-pkce.test.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Mobile sign-in dependency/crypto checks failed. APK was not built.' }
$northTools = Join-Path $northRoot '.tmp\android-tools'
if (!$env:JAVA_HOME) { $env:JAVA_HOME = (Get-ChildItem (Join-Path $northTools 'java') -Directory | Select-Object -First 1).FullName }
if (!$env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $northTools 'sdk' }
$env:GRADLE_USER_HOME = Join-Path $northRoot '.tmp\gradle'
$env:Path = $env:JAVA_HOME + '\bin;' + $env:Path
$northGradle = Join-Path $northTools 'gradle\gradle-8.13\bin\gradle.bat'
if (!(Test-Path -LiteralPath $northGradle)) { throw 'Install Gradle 8.13 or use the Android project wrapper.' }
$northSigning = Join-Path $northMobile '.signing'
New-Item -ItemType Directory -Force -Path $northSigning | Out-Null
$northStore = Join-Path $northSigning 'north-release.p12'
$northPasswordFile = Join-Path $northSigning 'password.dpapi.xml'
if (!(Test-Path -LiteralPath $northStore)) {
  $northBytes = New-Object byte[] 32
  [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($northBytes)
  $env:NORTH_STORE_PASSWORD = [Convert]::ToBase64String($northBytes)
  ConvertTo-SecureString $env:NORTH_STORE_PASSWORD -AsPlainText -Force | Export-Clixml -LiteralPath $northPasswordFile
  & (Join-Path $env:JAVA_HOME 'bin\keytool.exe') -genkeypair -keystore $northStore -storetype PKCS12 -alias north -keyalg RSA -keysize 3072 -validity 10000 -storepass:env NORTH_STORE_PASSWORD -keypass:env NORTH_STORE_PASSWORD -dname 'CN=North Personal Build'
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local signing key.' }
} else {
  $northSecure = Import-Clixml -LiteralPath $northPasswordFile
  $env:NORTH_STORE_PASSWORD = [Net.NetworkCredential]::new('', $northSecure).Password
}
$env:NORTH_SIGNING_STORE_FILE = $northStore
try {
  Push-Location $northMobile
  try { & npx.cmd expo prebuild --platform android --no-install; if ($LASTEXITCODE -ne 0) { throw 'Android configuration failed.' } } finally { Pop-Location }
  $northAbis = if ($Architecture -eq 'universal') { 'arm64-v8a,armeabi-v7a,x86_64,x86' } else { $Architecture }
  $northNetworkArgs = @()
  if ($Offline) { $northNetworkArgs = @('--offline') }
  & $northGradle --project-dir (Join-Path $northMobile 'android') :app:assembleRelease --no-daemon --max-workers=2 "-PreactNativeArchitectures=$northAbis" --console=plain @northNetworkArgs
  if ($LASTEXITCODE -ne 0) { throw 'APK build failed.' }
  $northArtifact = Join-Path $northRoot 'artifacts'
  New-Item -ItemType Directory -Force -Path $northArtifact | Out-Null
  $northApk = Join-Path $northArtifact "North-Android-$Architecture.apk"
  Copy-Item -LiteralPath (Join-Path $northMobile 'android\app\build\outputs\apk\release\app-release.apk') -Destination $northApk
  Write-Output "APK: $northApk"
} finally {
  Remove-Item Env:NORTH_STORE_PASSWORD -ErrorAction SilentlyContinue
  Remove-Item Env:NORTH_SIGNING_STORE_FILE -ErrorAction SilentlyContinue
}
