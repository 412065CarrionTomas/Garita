const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
// expo-sqlite en web carga wa-sqlite.wasm como asset.
config.resolver.assetExts.push('wasm');

module.exports = config;
