// Metro, as Expo sets it up, plus one folder from the desktop: src/shared (ADR 0027).
// The phone imports types from there, and a few dependency-free modules at runtime.
const path = require('node:path')
const { getDefaultConfig } = require('expo/metro-config')

const config = getDefaultConfig(__dirname)
const shared = path.resolve(__dirname, '..', 'src', 'shared')
config.watchFolders = [...(config.watchFolders ?? []), shared]
// Anything shared code imports resolves from the phone's own node_modules, never the desktop's.
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')]

module.exports = config
