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
      # Base configurations
      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
      config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
      config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'off'
      config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
      
      # Targeted Swift Versioning
      target_name = target.name
      if target_name.include?('Expo') || target_name.include?('EX') || target_name == 'Pods-TAMTAM' || target_name == 'TAMTAM'
        # Expo 55 Core + App -> Swift 5.10 (Permissive but supports @MainActor)
        config.build_settings['SWIFT_VERSION'] = '5.10'
        config.build_settings['OTHER_SWIFT_FLAGS'] = '$(inherited) -D EXPO_SWIFT_6_MIGRATION'
      else
        # Community libraries -> Swift 5.0
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

const postInstallRegex = /post_install\s+do\s+\|([^|]+)\|/;
if (postInstallRegex.test(content)) {
  console.log('Found post_install block, injecting overrides...');
  content = content.replace(postInstallRegex, (match, p1) => {
    return `${match}\n  puts "TAMTAM: Running final build settings override with installer: #{${p1}}..."\n${settingsOverride.replace(/installer/g, p1)}`;
  });
} else {
  console.log('No post_install block found, appending new one...');
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
