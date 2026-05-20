const fs = require('fs');
const path = require('path');

const podfilePath = path.resolve(__dirname, '../ios/Podfile');

if (!fs.existsSync(podfilePath)) {
  console.log('Podfile not found at:', podfilePath);
  process.exit(0);
}

let content = fs.readFileSync(podfilePath, 'utf8');

// 1. Standardize sources: Use CDN only to avoid duplicate spec errors
let lines = content.split('\n');
lines = lines.filter(line => !line.includes('github.com/CocoaPods/Specs.git'));
if (!lines.some(l => l.includes('https://cdn.cocoapods.org/'))) {
  lines.unshift("source 'https://cdn.cocoapods.org/'");
}
content = lines.join('\n');

// 2. Local Podspec Overrides
const deps = [
  "  pod 'boost', :podspec => '../node_modules/react-native/third-party-podspecs/boost.podspec'",
  "  pod 'DoubleConversion', :podspec => '../node_modules/react-native/third-party-podspecs/DoubleConversion.podspec'",
  "  pod 'fast_float', :podspec => '../node_modules/react-native/third-party-podspecs/fast_float.podspec'",
  "  pod 'fmt', :podspec => '../node_modules/react-native/third-party-podspecs/fmt.podspec'",
  "  pod 'glog', :podspec => '../node_modules/react-native/third-party-podspecs/glog.podspec'",
  "  pod 'RCT-Folly', :podspec => '../node_modules/react-native/third-party-podspecs/RCT-Folly.podspec'"
];

// 3. Final Build Settings Override
// We INJECT this into the existing post_install block to avoid the "multiple hooks" error.
const settingsOverride = `
  puts "TAMTAM: Running final build settings override..."
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      # Force iOS 15.1 for modern Swift features
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      
      # Disable signing to prevent CI failures
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
      
      # Global Concurrency fix: turn OFF strict checking for all
      config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'off'
      
      # Targeted Swift Versioning
      # We target Swift 6.0 ONLY for core Expo infrastructure.
      # Other modules (RNScreens, Lottie) are failing with thousands of concurrency errors.
      if target.name == 'ExpoModulesCore' || target.name == 'Expo' || target.name == 'EXOpenSSL'
        config.build_settings['SWIFT_VERSION'] = '6.0'
        config.build_settings['OTHER_SWIFT_FLAGS'] = '$(inherited) -D EXPO_SWIFT_6_MIGRATION'
      else
        # Fallback to 5.0 for maximum compatibility with community libs
        config.build_settings['SWIFT_VERSION'] = '5.0'
      end
    end
  end
  
  # Final Patch for react-native-maps extension safety
  maps_marker = File.join(installer.sandbox.root, 'react-native-maps', 'ios', 'AirMaps', 'AIRMapMarker.m')
  if File.exist?(maps_marker)
    text = File.read(maps_marker)
    text = text.gsub("UIWindow* win = [[[UIApplication sharedApplication] windows] firstObject];", 
                     "#if !TARGET_OS_APP_EXTENSION\\n            UIWindow* win = [[[UIApplication sharedApplication] windows] firstObject];\\n#else\\n            UIWindow* win = nil;\\n#endif")
    File.write(maps_marker, text)
    puts "TAMTAM: Patched AIRMapMarker.m"
  end
`;

if (content.includes('post_install do |installer|')) {
  content = content.replace('post_install do |installer|', `post_install do |installer|${settingsOverride}`);
} else {
  // Fallback if no post_install exists (unlikely in Expo projects)
  content += `\npost_install do |installer|\n${settingsOverride}\nend\n`;
}

// 4. Inject local pods into targets
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
console.log('Successfully applied final Podfile overrides.');
