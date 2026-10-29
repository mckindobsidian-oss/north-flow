const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);
config.watchFolders = [path.resolve(__dirname, '../..')];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'ogg'])];
config.resolver.blockList = [/[/\\]\.tmp[/\\]/, /[/\\]\.build[/\\]/, /[/\\]\.signing[/\\]/, /[/\\]\.git[/\\]/, /[/\\]\.env(?:\.[^/\\]*)?$/, /[/\\]react-app[/\\]node_modules[/\\]/, /[/\\]android[/\\].*[/\\]build[/\\]/];
module.exports = config;
