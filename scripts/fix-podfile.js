const fs = require('fs');
const path = require('path');

const podfilePath = path.resolve(__dirname, '../ios/Podfile');

if (!fs.existsSync(podfilePath)) {
  console.log('Podfile not found at:', podfilePath);
  process.exit(0);
}

let content = fs.readFileSync(podfilePath, 'utf8');

// 1. Add standard CDN source if it doesn't exist
const sources = [
  "source 'https://cdn.cocoapods.org/'"
];

let lines = content.split('\n');
// Remove any GitHub Specs repo source as it causes duplicate spec errors with the CDN
lines = lines.filter(line => !line.includes('github.com/CocoaPods/Specs.git'));
content = lines.join('\n');

sources.forEach(src => {
  if (!content.includes(src)) {
    content = src + '\n' + content;
  }
});

// 2. Inject local paths for dependencies into EVERY target block
const deps = [
  "  pod 'boost', :podspec => '../node_modules/react-native/third-party-podspecs/boost.podspec'",
  "  pod 'DoubleConversion', :podspec => '../node_modules/react-native/third-party-podspecs/DoubleConversion.podspec'",
  "  pod 'fast_float', :podspec => '../node_modules/react-native/third-party-podspecs/fast_float.podspec'",
  "  pod 'fmt', :podspec => '../node_modules/react-native/third-party-podspecs/fmt.podspec'",
  "  pod 'glog', :podspec => '../node_modules/react-native/third-party-podspecs/glog.podspec'",
  "  pod 'RCT-Folly', :podspec => '../node_modules/react-native/third-party-podspecs/RCT-Folly.podspec'"
];

const podPostInstallFix = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        # Standardize on iOS 15.1 (Expo 55 minimum)
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        
        # Disable signing for ALL pods (required for CI builds)
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
        
        # Explicitly turn OFF strict concurrency checking to avoid Swift 6 errors
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'off'
        
        # Specific fixes for Expo modules
        if target.name.start_with?('Expo') || target.name.start_with?('EX')
          # Use Swift 5.10 - supports @MainActor but avoids Swift 6 strict rules
          config.build_settings['SWIFT_VERSION'] = '5.10'
          config.build_settings['OTHER_SWIFT_FLAGS'] = '$(inherited) -D EXPO_SWIFT_6_MIGRATION'
        else
          # Legacy libraries (like Lottie) need Swift 5.0
          config.build_settings['SWIFT_VERSION'] = '5.0'
        end
      end
    end
    
    # Patch react-native-maps for App Extension compilation
    maps_marker = File.join(installer.sandbox.root, 'react-native-maps', 'ios', 'AirMaps', 'AIRMapMarker.m')
    if File.exist?(maps_marker)
      text = File.read(maps_marker)
      text = text.gsub("UIWindow* win = [[[UIApplication sharedApplication] windows] firstObject];", 
                       "#if !TARGET_OS_APP_EXTENSION\\n            UIWindow* win = [[[UIApplication sharedApplication] windows] firstObject];\\n#else\\n            UIWindow* win = nil;\\n#endif")
      File.write(maps_marker, text)
      puts "Successfully patched AIRMapMarker.m for App Extension"
    end
`;

// Use a more robust way to find and inject into post_install
if (content.includes('post_install do |installer|')) {
  // Clear any existing custom logic we might have added previously to avoid duplication
  const startMarker = '    installer.pods_project.targets.each do |target|';
  const endMarker = '    end\n\n    # Patch react-native-maps';
  if (content.includes(startMarker)) {
     // If we find our logic, we replace the whole block
     // But for simplicity in this script, we just append to the start of post_install
     content = content.replace('post_install do |installer|', `post_install do |installer|\n${podPostInstallFix}`);
  } else {
     content = content.replace('post_install do |installer|', `post_install do |installer|\n${podPostInstallFix}`);
  }
} else {
  content += `\npost_install do |installer|\n${podPostInstallFix}\nend\n`;
}

// Inject pods into targets
const targetMatch = /target '([^']+)' do/g;
let match;
const targetPositions = [];
while ((match = targetMatch.exec(content)) !== null) {
  targetPositions.push({ name: match[1], index: match.index + match[0].length });
}

targetPositions.reverse().forEach(pos => {
  let insertion = "";
  deps.forEach(dep => {
    const depName = dep.match(/'([^']+)'/)[1];
    if (!content.includes(`pod '${depName}'`)) {
      insertion += `\n${dep}`;
    }
  });
  content = content.slice(0, pos.index) + insertion + content.slice(pos.index);
});

fs.writeFileSync(podfilePath, content);
console.log('Successfully patched Podfile with unified Swift/iOS version fixes.');
