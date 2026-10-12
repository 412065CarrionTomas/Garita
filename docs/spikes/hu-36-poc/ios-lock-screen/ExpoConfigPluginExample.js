const { withXcodeProject, withEntitlementsPlist, withInfoPlist } = require('@expo/config-plugins');

/**
 * Ejemplo conceptual de Expo Config Plugin para integrar Live Activities / ActivityKit en iOS.
 * Utilizado por herramientas como `@bacons/apple-targets` en EAS Build.
 *
 * Configura:
 * 1. Habilitación de NSSupportsLiveActivities en Info.plist.
 * 2. Habilitación de App Groups ("group.com.garita.app") para compartir tokens entre la app y el widget.
 */
module.exports = function withGaritaLiveActivity(config) {
  // 1. Agregar permiso de Live Activities en Info.plist
  config = withInfoPlist(config, (config) => {
    config.modResults.NSSupportsLiveActivities = true;
    config.modResults.NSSupportsLiveActivitiesFrequentUpdates = true;
    return config;
  });

  // 2. Configurar Entitlements para App Groups
  config = withEntitlementsPlist(config, (config) => {
    const appGroup = 'group.com.garita.app';
    const groups = config.modResults['com.apple.security.application-groups'] || [];
    if (!groups.includes(appGroup)) {
      groups.push(appGroup);
    }
    config.modResults['com.apple.security.application-groups'] = groups;
    return config;
  });

  return config;
};
