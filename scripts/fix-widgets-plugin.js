const fs = require('fs');
const path = require('path');

const pluginPath = path.resolve(__dirname, '../node_modules/@bittingz/expo-widgets/plugin/build/ios/withPodfile.js');

if (!fs.existsSync(pluginPath)) {
  console.log('Plugin file not found at:', pluginPath);
  process.exit(0);
}

let content = fs.readFileSync(pluginPath, 'utf8');

// The problematic code is likely being called even if it looks commented out 
// or my previous attempts corrupted it.
// We will replace the entire withPodfile function with a safe version.

const safeWithPodfile = `
const withPodfile = (config, options) => {
    const target_1 = require("./xcode/target");
    const targetName = \`\${(0, target_1.getTargetName)(config, options)}\`;
    const podFilePath = path.join(config.modRequest.platformProjectRoot, "Podfile");
    let podFileContent = fs.readFileSync(podFilePath).toString();
    
    // Check if target already exists to avoid duplicates
    if (podFileContent.includes(\`target '\${targetName}'\`)) {
        return config;
    }

    const podInstaller = \`
target '\${targetName}' do
  use_expo_modules!
  config = use_native_modules!

  use_frameworks! :linkage => podfile_properties['ios.useFrameworks'].to_sym if podfile_properties['ios.useFrameworks']
  use_frameworks! :linkage => ENV['USE_FRAMEWORKS'].to_sym if ENV['USE_FRAMEWORKS']

  use_react_native!(
    :path => config[:reactNativePath],
    :hermes_enabled => podfile_properties['expo.jsEngine'] == nil || podfile_properties['expo.jsEngine'] == 'hermes',
    # An absolute path to your application root.
    :app_path => "#{Pod::Config.instance.installation_root}/..",
    :privacy_file_aggregation_enabled => podfile_properties['apple.privacyManifestAggregationEnabled'] != 'false',
  )
end
\`;
    
    fs.writeFileSync(podFilePath, podFileContent + '\\n' + podInstaller);
    return config;
};
`;

// Replace the existing withPodfile function definition
// We look for the start and end of the function.
const startMarker = 'const withPodfile = (config, options) => {';
const endMarker = 'exports.withPodfile = withPodfile;';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex !== -1 && endIndex !== -1) {
    const newContent = content.substring(0, startIndex) + safeWithPodfile + '\n' + content.substring(endIndex);
    fs.writeFileSync(pluginPath, newContent);
    console.log('Successfully applied deep patch to withPodfile.js');
} else {
    console.log('Could not find function boundaries, applying brute force overwrite...');
    // If we can't find boundaries, we might be in a corrupted state.
    // Just try to fix the SyntaxError at least.
    content = content.replace(/anchor:.*installer.*/g, 'anchor: /post_install do |installer|/');
    fs.writeFileSync(pluginPath, content);
}
