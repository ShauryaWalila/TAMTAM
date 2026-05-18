const fs = require('fs');
const path = require('path');

const podfilePath = path.resolve(__dirname, '../ios/Podfile');

if (!fs.existsSync(podfilePath)) {
  console.log('Podfile not found at:', podfilePath);
  process.exit(0);
}

let content = fs.readFileSync(podfilePath, 'utf8');

// 1. Add sources to the top if they don't exist
const sources = [
  "source 'https://github.com/CocoaPods/Specs.git'",
  "source 'https://cdn.cocoapods.org/'"
];

let topLines = content.split('\n');
sources.reverse().forEach(src => {
  if (!content.includes(src)) {
    topLines.unshift(src);
  }
});
content = topLines.join('\n');

// 2. Inject local paths for dependencies into EVERY target block
const deps = [
  "  pod 'boost', :podspec => '../node_modules/react-native/third-party-podspecs/boost.podspec'",
  "  pod 'DoubleConversion', :podspec => '../node_modules/react-native/third-party-podspecs/DoubleConversion.podspec'",
  "  pod 'fast_float', :podspec => '../node_modules/react-native/third-party-podspecs/fast_float.podspec'",
  "  pod 'fmt', :podspec => '../node_modules/react-native/third-party-podspecs/fmt.podspec'",
  "  pod 'glog', :podspec => '../node_modules/react-native/third-party-podspecs/glog.podspec'",
  "  pod 'RCT-Folly', :podspec => '../node_modules/react-native/third-party-podspecs/RCT-Folly.podspec'"
];

// 3. Fix Swift version mismatch and disable signing for ALL pods
// We also patch AIRMapMarker.m here to ensure it survives pod install
const podPostInstallFix = `
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['SWIFT_VERSION'] = '5.0'
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'
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

const lines = content.split('\n');
const newLines = [];

for (let line of lines) {
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
  }
}

fs.writeFileSync(podfilePath, newLines.join('\n'));
console.log('Successfully patched Podfile with local dependencies and Swift version fix.');
