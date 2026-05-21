const fs = require('fs');
const path = require('path');

const podfilePath = path.resolve(__dirname, '../ios/Podfile');

if (!fs.existsSync(podfilePath)) {
  console.log('TAMTAM ERROR: Podfile not found at:', podfilePath);
  process.exit(1);
}

let content = fs.readFileSync(podfilePath, 'utf8');

// 1. Standardize sources: CDN only to avoid duplicate spec errors.
let lines = content.split('\n');
lines = lines.filter(line => !line.includes('github.com/CocoaPods/Specs.git'));
if (!lines.some(l => l.includes('https://cdn.cocoapods.org/'))) {
  lines.unshift("source 'https://cdn.cocoapods.org/'");
}

// 2. Local podspec overrides for RN's third-party C++ deps.
const deps = [
  "  pod 'boost', :podspec => '../node_modules/react-native/third-party-podspecs/boost.podspec'",
  "  pod 'DoubleConversion', :podspec => '../node_modules/react-native/third-party-podspecs/DoubleConversion.podspec'",
  "  pod 'fmt', :podspec => '../node_modules/react-native/third-party-podspecs/fmt.podspec'",
  "  pod 'glog', :podspec => '../node_modules/react-native/third-party-podspecs/glog.podspec'",
  "  pod 'RCT-Folly', :podspec => '../node_modules/react-native/third-party-podspecs/RCT-Folly.podspec'"
];

// 3. Post-install fix-ups applied to every pod target.
const podPostInstallFix = `
    puts "TAMTAM: Applying global build settings..."
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |config|
        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'

        # C++ stdlib for any pod that pulls Folly/Fabric headers.
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
        config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
        config.build_settings['CLANG_ENABLE_MODULES'] = 'YES'

        # Xcode 26 promotes implicit function declarations to errors. expo-*
        # modules occasionally rely on legacy implicit decls; demote to warn.
        existing_cflags = config.build_settings['OTHER_CFLAGS'] || '$(inherited)'
        existing_cflags = existing_cflags.is_a?(Array) ? existing_cflags.join(' ') : existing_cflags.to_s
        unless existing_cflags.include?('-Wno-error=implicit-function-declaration')
          config.build_settings['OTHER_CFLAGS'] = existing_cflags + ' -Wno-error=implicit-function-declaration -URCT_NEW_ARCH_ENABLED'
        end

        # Hard-undefine the new-arch flag at every level. Some podspecs inject
        # -DRCT_NEW_ARCH_ENABLED at the target xcconfig regardless of project
        # newArchEnabled=false. Strip it from preprocessor defs and force =0.
        defs = config.build_settings['GCC_PREPROCESSOR_DEFINITIONS']
        if defs.is_a?(Array)
          defs = defs.reject { |d| d.to_s.start_with?('RCT_NEW_ARCH_ENABLED') }
          defs << 'RCT_NEW_ARCH_ENABLED=0'
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = defs
        elsif defs.is_a?(String)
          parts = defs.split(' ').reject { |d| d.start_with?('RCT_NEW_ARCH_ENABLED') }
          parts << 'RCT_NEW_ARCH_ENABLED=0'
          config.build_settings['GCC_PREPROCESSOR_DEFINITIONS'] = parts.join(' ')
        end
      end
    end

    # Patch react-native-maps for App Extension compilation.
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
  if (line.includes("config.build_settings['SWIFT_VERSION']")) continue;
  if (line.includes("config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']")) continue;

  newLines.push(line);

  if (line.trim().startsWith("target '") && line.trim().endsWith(" do")) {
    deps.forEach(dep => {
      const depName = dep.match(/'([^']+)'/)[1];
      if (!content.includes(`pod '${depName}'`)) {
        newLines.push(dep);
      }
    });
  }

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
console.log('TAMTAM: Successfully patched Podfile.');
