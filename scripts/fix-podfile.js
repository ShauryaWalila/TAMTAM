const fs = require('fs');
const path = require('path');

const podfilePath = path.resolve(__dirname, '../ios/Podfile');

if (!fs.existsSync(podfilePath)) {
  console.log('TAMTAM ERROR: Podfile not found at:', podfilePath);
  process.exit(1);
}

let content = fs.readFileSync(podfilePath, 'utf8');

// 1. Standardize sources: Use CDN only to avoid duplicate spec errors
let lines = content.split('\n');
lines = lines.filter(line => !line.includes('github.com/CocoaPods/Specs.git'));
if (!lines.some(l => l.includes('https://cdn.cocoapods.org/'))) {
  lines.unshift("source 'https://cdn.cocoapods.org/'");
}

// 2. Local Podspec Overrides
const deps = [
  "  pod 'boost', :podspec => '../node_modules/react-native/third-party-podspecs/boost.podspec'",
  "  pod 'DoubleConversion', :podspec => '../node_modules/react-native/third-party-podspecs/DoubleConversion.podspec'",
  "  pod 'fast_float', :podspec => '../node_modules/react-native/third-party-podspecs/fast_float.podspec'",
  "  pod 'fmt', :podspec => '../node_modules/react-native/third-party-podspecs/fmt.podspec'",
  "  pod 'glog', :podspec => '../node_modules/react-native/third-party-podspecs/glog.podspec'",
  "  pod 'RCT-Folly', :podspec => '../node_modules/react-native/third-party-podspecs/RCT-Folly.podspec'"
];

// 3. Settings Override (Proven Logic)
const podPostInstallFix = `
    puts "TAMTAM: Applying global build settings..."
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        # Remove any strict SWIFT_VERSION settings Expo might have added and force 5.9
        config.build_settings.delete('SWIFT_VERSION')
        config.build_settings['SWIFT_VERSION'] = '5.9'
        
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'off'
        config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
        
        # Expo 55 compatibility flags
        config.build_settings['OTHER_SWIFT_FLAGS'] = '$(inherited) -D EXPO_SWIFT_6_MIGRATION'
      end
    end
    
    # Patch react-native-maps for App Extension compilation
    maps_marker = File.join(installer.sandbox.root, 'react-native-maps', 'ios', 'AirMaps', 'AIRMapMarker.m')
    if File.exist?(maps_marker)
      text = File.read(maps_marker)
      text = text.gsub("UIWindow* win = [[[UIApplication sharedApplication] windows] firstObject];", 
                       "#if !TARGET_OS_APP_EXTENSION\\n            UIWindow* win = [[[UIApplication sharedApplication] windows] firstObject];\\n#else\\n            UIWindow* win = nil;\\n#endif")
      File.write(maps_marker, text)
      puts "TAMTAM: Patched AIRMapMarker.m"
    end
`;

const newLines = [];
let postInstallFound = false;

for (let line of lines) {
  // Strip existing Swift Version hardcodes to prevent them overriding us
  if (line.includes("config.build_settings['SWIFT_VERSION']")) {
      continue; 
  }
  if (line.includes("config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']")) {
      continue;
  }

  newLines.push(line);

  // Match target 'Name' do
  if (line.trim().startsWith("target '") && line.trim().endsWith(" do")) {
    deps.forEach(dep => {
      const depName = dep.match(/'([^']+)'/)[1];
      if (!content.includes(`pod '${depName}'`)) {
        newLines.push(dep);
      }
    });
  }
  
  // Match post_install do |installer|
  if (line.trim().startsWith("post_install do |installer|")) {
    newLines.push(podPostInstallFix);
    postInstallFound = true;
  }
}

if (!postInstallFound) {
    console.log('TAMTAM WARNING: No post_install block found. Appending new one...');
    newLines.push(`post_install do |installer|\n${podPostInstallFix}\nend`);
}

fs.writeFileSync(podfilePath, newLines.join('\n'));
console.log('TAMTAM: Successfully patched Podfile with line-by-line method.');
