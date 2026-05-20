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
// We will re-apply them globally in post_install
content = content.replace(/config\.build_settings\['SWIFT_VERSION'\]\s*=\s*['"][^'"]*['"]/g, '');
content = content.replace(/config\.build_settings\['IPHONEOS_DEPLOYMENT_TARGET'\]\s*=\s*['"][^'"]*['"]/g, '');

// 2. Definitive Settings Override
const settingsOverride = `
  puts "TAMTAM: Starting global build settings override..."
  installer.pods_project.targets.each do |target|
    target.build_configurations.each do |config|
      # Force a modern but stable Swift version (5.9)
      # This supports @MainActor (Expo 55) without the Swift 6 strict mode errors.
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
  puts "TAMTAM: Global build settings override complete."
`;

// 3. Robust Injection: Find the LAST 'end' in the file and insert before it
// This assumes the last 'end' belongs to the post_install block, which is true for Expo Podfiles.
const lastEndIndex = content.lastIndexOf('end');
if (lastEndIndex !== -1) {
    console.log('TAMTAM: Injecting settings before the last "end" at index', lastEndIndex);
    content = content.slice(0, lastEndIndex) + settingsOverride + content.slice(lastEndIndex);
} else {
    console.log('TAMTAM WARNING: No "end" found, appending new post_install block.');
    content += `\npost_install do |installer|\n${settingsOverride}\nend\n`;
}

fs.writeFileSync(podfilePath, content);
console.log('TAMTAM: Successfully updated Podfile.');
