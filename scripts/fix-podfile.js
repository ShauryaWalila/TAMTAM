const fs = require('fs');
const path = require('path');

const podfilePath = path.resolve(__dirname, '../ios/Podfile');

if (!fs.existsSync(podfilePath)) {
  console.log('TAMTAM ERROR: Podfile not found at:', podfilePath);
  process.exit(1);
}

let content = fs.readFileSync(podfilePath, 'utf8');
console.log('TAMTAM: Reading Podfile... Length:', content.length);

// 1. Remove all existing SWIFT_VERSION and deployment target assignments to prevent conflicts
content = content.replace(/config\.build_settings\['SWIFT_VERSION'\]\s*=\s*['"][^'"]*['"]/g, '');
content = content.replace(/config\.build_settings\['IPHONEOS_DEPLOYMENT_TARGET'\]\s*=\s*['"][^'"]*['"]/g, '');

// 2. Definitive Settings Override (Ruby code to be injected)
const settingsOverride = `
    # --- TAMTAM OVERRIDES START ---
    puts "TAMTAM: Applying global build settings..."
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        # Force a modern but stable Swift version (5.9)
        config.build_settings['SWIFT_VERSION'] = '5.9'
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        
        # Safety and CI settings
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'off'
        config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
        
        # Additional flags for Expo 55 compatibility
        config.build_settings['OTHER_SWIFT_FLAGS'] = '$(inherited) -D EXPO_SWIFT_6_MIGRATION'
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
    puts "TAMTAM: Global build settings applied."
    # --- TAMTAM OVERRIDES END ---
`;

// 3. Inject settings INSIDE the post_install block
const postInstallRegex = /post_install\s+do\s+\|([^|]+)\|/;
if (postInstallRegex.test(content)) {
    console.log('TAMTAM: Found existing post_install block. Injecting...');
    content = content.replace(postInstallRegex, (match, installerVar) => {
        // Replace 'installer' in our Ruby template with the actual variable name used in the Podfile
        const localizedOverride = settingsOverride.replace(/installer/g, installerVar);
        return `${match}${localizedOverride}`;
    });
} else {
    console.log('TAMTAM: No post_install block found. Appending new one...');
    content += `\npost_install do |installer|\n${settingsOverride}\nend\n`;
}

// 4. Restore Local Podspec Overrides (Essential for build reliability)
const deps = [
  "  pod 'boost', :podspec => '../node_modules/react-native/third-party-podspecs/boost.podspec'",
  "  pod 'DoubleConversion', :podspec => '../node_modules/react-native/third-party-podspecs/DoubleConversion.podspec'",
  "  pod 'fast_float', :podspec => '../node_modules/react-native/third-party-podspecs/fast_float.podspec'",
  "  pod 'fmt', :podspec => '../node_modules/react-native/third-party-podspecs/fmt.podspec'",
  "  pod 'glog', :podspec => '../node_modules/react-native/third-party-podspecs/glog.podspec'",
  "  pod 'RCT-Folly', :podspec => '../node_modules/react-native/third-party-podspecs/RCT-Folly.podspec'"
];

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
console.log('TAMTAM: Successfully updated Podfile with robust overrides.');
