# TAMTAM Project Context & Build History

## Project Status (as of May 2026)
We are currently upgrading the TAMTAM app (a private couple-sharing app) to **Expo SDK 55** and the **React Native New Architecture (Fabric)**. The build is being orchestrated via GitHub Actions and targeted for sideloading on iOS.

## Core Mandates
- **Environment**: macOS Latest runners on GitHub Actions, Xcode 16.4+, iOS 18.5 SDK.
- **Architecture**: Mandatory New Architecture (Fabric).
- **Swift Versioning**: Targeted Swift 6.0 for Expo modules, Swift 5.0 for legacy community pods.

## Major Changes & Fixes Applied

### 1. Version Alignment (Expo SDK 55)
- **SDK Upgrade**: Moved from Expo 54 to `~55.0.0`.
- **Runtime Alignment**: Updated `react-native` to `0.83.1` and `react` to `19.2.0`.
- **Dependency Sync**: Aligned all `expo-*` packages, `expo-router (~55.0.0)`, and community libraries (`lottie-react-native ~7.3.1`, `react-native-reanimated ~4.2.1`).

### 2. Native Build Fixes (`ios/Podfile`)
- **Swift 6 Migration**: Refactored `scripts/fix-podfile.js` to force `SWIFT_VERSION = '6.0'` specifically for targets containing `Expo` or `EX`. This resolves the `unknown attribute 'MainActor'` error.
- **Concurrency Silencing**: Set `SWIFT_STRICT_CONCURRENCY = 'off'` globally to prevent legacy libraries (like Lottie) from failing under Swift 6's strict rules.
- **Minimum OS**: Forced `IPHONEOS_DEPLOYMENT_TARGET = '15.1'` across all targets to support modern Swift attributes.
- **RCT-Folly Patch**: Maintained a C++ header patch in `build.yaml` to fix missing synchronization headers in RN 0.83.

### 3. Reanimated 4 Integration
- **Worklets Engine**: Explicitly installed `react-native-worklets: 0.7.4` (peer dependency for Reanimated 4).
- **Babel**: Ensured `react-native-reanimated/plugin` is present; `babel-preset-expo` handles worklets automatically in SDK 55.

### 4. Repository Configuration
- Updated remote origin to: `https://github.com/ShauryaWalila/TAMTAM.git`

## Current Task
We are in the **Validate** phase of the build. The next step is to run the GitHub Actions workflow on the new repository to verify that the targeted Swift versioning and dependency alignment produce a functional IPA.
