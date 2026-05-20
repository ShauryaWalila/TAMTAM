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
        # Standardize on iOS 15.1
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        
        # Disable signing for ALL pods
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
        
        # Explicitly turn OFF strict concurrency checking
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'off'
        
        # Target specific Swift versions
        if target.name.start_with?('Expo') || target.name.start_with?('EX')
          # Force Swift 6.0 for Expo to recognize @MainActor
          config.build_settings['SWIFT_VERSION'] = '6.0'
          config.build_settings['OTHER_SWIFT_FLAGS'] = '$(inherited) -D EXPO_SWIFT_6_MIGRATION'
        else
          # Fallback to Swift 5.0 for stability in community packages
          config.build_settings['SWIFT_VERSION'] = '5.0'
        end
        
        # Log the change for debugging
        puts "Target: #{target.name} | Swift: #{config.build_settings['SWIFT_VERSION']} | OS: #{config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']}"
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

// More aggressive injection: Find the end of the post_install block and insert before it.
// This ensures our settings are the absolute final word.
if (content.includes('post_install do |installer|')) {
  // We use a regex to find the end of the post_install block.
  // We look for 'post_install do |installer|' followed by any code, then 'end' at the end of a line.
  content = content.replace(/(post_install do \|installer\|[\s\S]*?)(^  end)/m, (match, p1, p2) => {
    return `${p1}\n${podPostInstallFix}\n${p2}`;
  });
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
console.log('Successfully patched Podfile with robust setting injection and logging.');
