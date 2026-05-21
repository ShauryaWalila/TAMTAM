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
      # Only ExpoModulesCore uses Swift 6.2 isolated-conformance syntax
      # (@MainActor on protocol conformances) -- it MUST compile in Swift 6
      # mode. Every other Expo pod (speech, splash-screen, etc.) was never
      # fully ported to Swift 6 strict concurrency and trips on implicit
      # Sendable inference. Force Swift 5 elsewhere to silence those.
      needs_swift6 = (target.name == 'ExpoModulesCore')
      target.build_configurations.each do |config|
        config.build_settings.delete('SWIFT_VERSION')
        config.build_settings['SWIFT_VERSION'] = needs_swift6 ? '6.0' : '5.0'

        config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.1'
        config.build_settings['SWIFT_STRICT_CONCURRENCY'] = 'off'
        config.build_settings['SWIFT_TREAT_WARNINGS_AS_ERRORS'] = 'NO'
        config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'
        config.build_settings['CODE_SIGNING_REQUIRED'] = 'NO'

        # Xcode 26 / iOS 26 SDK requires explicit C++ stdlib for Fabric headers
        # (React-Fabric headers use <memory>, <vector>, etc.). Without these,
        # clang module compilation of ObjC++ umbrella headers fails with
        # "'memory' file not found" while building RNScreens / ExpoRouter etc.
        config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
        config.build_settings['CLANG_CXX_LIBRARY'] = 'libc++'
        config.build_settings['CLANG_ENABLE_MODULES'] = 'YES'

        # Skip generated Swift-to-ObjC compatibility header install. The
        # generated RNScreens-Swift.h etc. imports the ObjC umbrella, which
        # transitively pulls Fabric C++ headers and fails parse in ObjC mode.
        # Pods are linked, not consumed as ObjC frameworks, so this header
        # isn't needed by downstream targets.
        config.build_settings['SWIFT_INSTALL_OBJC_HEADER'] = 'NO'

        # Xcode 26 promotes implicit function declarations from warning to
        # error. expo-location 19.0.8 and a few other pods rely on EXFatal /
        # EXErrorWithMessage being implicitly declared because their include
        # chain misses the declaring header. Demote to warning so the build
        # completes; runtime symbol resolution still works (these are real
        # ObjC functions linked from ExpoModulesCore).
        existing = config.build_settings['OTHER_CFLAGS'] || '$(inherited)'
        existing = existing.is_a?(Array) ? existing.join(' ') : existing.to_s
        unless existing.include?('-Wno-error=implicit-function-declaration')
          config.build_settings['OTHER_CFLAGS'] = existing + ' -Wno-error=implicit-function-declaration'
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
      puts "TAMTAM: Patched AIRMapMarker.m"
    end

    # Add a build phase to ReactCodegen that re-runs the wrap script AFTER
    # codegen regenerates EventEmitters.h / Props.h / etc. in build/generated.
    # Without this, codegen overwrites our pre-build wrap mid-xcodebuild.
    codegen_target = installer.pods_project.targets.find { |t| t.name == 'ReactCodegen' }
    if codegen_target
      already = codegen_target.shell_script_build_phases.any? { |p| p.name == 'TAMTAM: Wrap codegen C++ headers' }
      unless already
        phase = codegen_target.new_shell_script_build_phase('TAMTAM: Wrap codegen C++ headers')
        # $SRCROOT for a Pods-project target == ios/Pods, so two .. to reach
        # the repo root. cwd is set to ios/ so the wrap script relative paths
        # (Pods/Headers/Public, Pods/React-Core-prebuilt) resolve.
        phase.shell_script = 'cd "$PODS_ROOT/.." && node "$PODS_ROOT/../../scripts/wrap-cxx-headers.js" >> "$PODS_ROOT/../wrap-codegen.log" 2>&1 || true'
        phase.show_env_vars_in_log = '0'
        puts "TAMTAM: Added post-codegen wrap phase to ReactCodegen target"
      end
    else
      puts "TAMTAM WARNING: ReactCodegen target not found - skipping post-codegen wrap"
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
