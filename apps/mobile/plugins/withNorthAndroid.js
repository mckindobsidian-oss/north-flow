const { withAndroidManifest, withGradleProperties, withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');
module.exports = (config) => {
  config = withProjectBuildGradle(config, (result) => {
    const marker = '// NORTH_WINDOWS_CPP_DRIVER';
    if (!result.modResults.contents.includes(marker)) result.modResults.contents = result.modResults.contents.replace('apply plugin: "expo-root-project"', `
${marker}
// Windows 8.3 aliases can hide clang++'s suffix; explicitly retain C++ linking.
// https://clang.llvm.org/doxygen/ToolChain_8cpp_source.html
if (System.getProperty('os.name').startsWith('Windows')) {
    subprojects { sub ->
        sub.afterEvaluate {
            if (sub.name == 'expo-modules-core') {
                sub.android.defaultConfig.externalNativeBuild.cmake.arguments '-DCMAKE_SHARED_LINKER_FLAGS=--driver-mode=g++'
            }
        }
    }
}
apply plugin: "expo-root-project"
`);
    return result;
  });
  config = withAppBuildGradle(config, (result) => {
    if (!result.modResults.contents.includes('// NORTH_TARGET_ABIS')) result.modResults.contents += `
// NORTH_TARGET_ABIS
// Package only ABIs whose native North/Expo code was actually compiled.
android.defaultConfig.ndk.abiFilters.clear()
android.defaultConfig.ndk.abiFilters.addAll((findProperty('reactNativeArchitectures') ?: 'arm64-v8a').split(',').toList())
`;
    const marker = '// NORTH_RELEASE_SIGNING';
    if (!result.modResults.contents.includes(marker)) result.modResults.contents += `
${marker}
def northSigningStore = System.getenv('NORTH_SIGNING_STORE_FILE')
if (northSigningStore) {
    android.signingConfigs.create('northRelease') {
        storeFile file(northSigningStore)
        storeType 'PKCS12'
        storePassword System.getenv('NORTH_STORE_PASSWORD')
        keyAlias 'north'
        keyPassword System.getenv('NORTH_STORE_PASSWORD')
    }
    android.buildTypes.release.signingConfig = android.signingConfigs.northRelease
} else if (gradle.startParameter.taskNames.any { it.toLowerCase().contains('assemblerelease') }) {
    throw new GradleException('Use scripts/build-android.ps1 to sign North with your private local key.')
}
`;
    return result;
  });
  return withAndroidManifest(withGradleProperties(config, (result) => {
  result.modResults = result.modResults.filter((entry) => entry.key !== 'android.minSdkVersion');
  result.modResults.push({ type: 'property', key: 'android.minSdkVersion', value: '26' });
  return result;
}), (result) => {
  const manifest = result.modResults.manifest;
  manifest.queries = [{ intent: [{ action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }], category: [{ $: { 'android:name': 'android.intent.category.LAUNCHER' } }] }] }];
  const app = manifest.application[0]; app.$['android:allowBackup'] = 'false'; app.$['android:usesCleartextTraffic'] = 'false';
  app.service = [...(app.service || []).filter((s) => !s.$['android:name'].startsWith('com.north.device.')),
    { $: { 'android:name': 'com.north.device.NorthBrowserService', 'android:exported': 'true', 'android:permission': 'android.permission.BIND_ACCESSIBILITY_SERVICE', 'android:label': '@string/north_browser_access_name' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.accessibilityservice.AccessibilityService' } }] }], 'meta-data': [{ $: { 'android:name': 'android.accessibilityservice', 'android:resource': '@xml/north_browser_accessibility' } }] },
    { $: { 'android:name': 'com.north.device.NorthMonitorService', 'android:exported': 'false', 'android:foregroundServiceType': 'specialUse' }, property: [{ $: { 'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE', 'android:value': 'User-enabled foreground screen-time monitoring and blocking' } }] },
    { $: { 'android:name': 'com.north.device.NorthDnsService', 'android:exported': 'false', 'android:permission': 'android.permission.BIND_VPN_SERVICE', 'android:foregroundServiceType': 'specialUse' }, 'intent-filter': [{ action: [{ $: { 'android:name': 'android.net.VpnService' } }] }], property: [{ $: { 'android:name': 'android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE', 'android:value': 'User-enabled local DNS website blocking; no traffic inspection' } }] }
  ]; return result;
});
};
