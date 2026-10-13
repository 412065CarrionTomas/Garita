const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withNfcFeature(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const features = manifest['uses-feature'] ?? [];
    const nfcFeature = features.find(
      (feature) => feature.$['android:name'] === 'android.hardware.nfc',
    );
    if (nfcFeature) nfcFeature.$['android:required'] = 'false';
    else
      features.push({ $: { 'android:name': 'android.hardware.nfc', 'android:required': 'false' } });
    manifest['uses-feature'] = features;
    return modConfig;
  });
};
