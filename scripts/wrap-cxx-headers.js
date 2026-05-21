// Wrap C++ Fabric headers in `#if defined(__cplusplus)` so clang's ObjC
// parse of RNScreens / ExpoRouter umbrella headers sees them as empty.
// Xcode 26 + iOS 26 SDK fails on `#include <memory>` in headers reached
// through the chained ObjC module verification step.
//
// Scope: scan Pods/Headers/Public and Pods/React-Core-prebuilt for any
// `.h`/`.hpp` whose content uses C++ syntax (stdlib include, `namespace`,
// `template <`, `using namespace`, `std::...`). Resolve symlinks, chmod
// writable, then wrap. Idempotent via the TAMTAM_CXX_GUARD sentinel.

const fs = require('fs');
const path = require('path');

const CXX_STDLIB = [
  'memory', 'vector', 'string', 'functional', 'optional',
  'unordered_map', 'unordered_set', 'map', 'set', 'deque', 'list',
  'array', 'tuple', 'chrono', 'atomic', 'mutex', 'thread', 'future',
  'variant', 'type_traits', 'algorithm', 'iterator', 'stdexcept',
  'utility', 'cstdint', 'cstddef', 'initializer_list', 'numeric',
  'limits', 'cmath', 'cstdlib', 'cstdio', 'cassert', 'memory_resource',
  'bit', 'concepts', 'coroutine', 'expected', 'ranges', 'span',
  'string_view'
].join('|');

// Pods to skip entirely - pure C libraries that break if wrapped in __cplusplus
// (their headers define C types like WebPConfig that the C build expects).
const SKIP_PODS = new Set([
  'libwebp', 'libavif', 'libdav1d', 'lottie-ios', 'SDWebImage',
  'SDWebImageWebPCoder', 'SDWebImageAVIFCoder', 'libevent', 'libuv',
  'hermes-engine', 'OpenSSL',
]);

const CXX_TOKENS = new RegExp(
  [
    String.raw`#include\s+<(${CXX_STDLIB})>`,
    String.raw`^\s*namespace\s+\w+\s*\{`,
    String.raw`^\s*template\s*<`,
    String.raw`^\s*using\s+namespace\s+\w`,
    // Narrow C++ namespace prefixes - avoids matching `::` in comments of
    // pure-C libraries like libwebp.
    String.raw`\b(std|facebook|react|winrt|boost|folly|fmt|glog|hermes|jsi)::\w+`,
  ].join('|'),
  'm'
);

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  let ents;
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  for (const ent of ents) {
    const p = path.join(dir, ent.name);
    let st;
    try {
      st = fs.statSync(p);
    } catch (e) {
      continue;
    }
    if (st.isDirectory()) out.push(...walk(p));
    else if (st.isFile() && (p.endsWith('.h') || p.endsWith('.hpp'))) out.push(p);
  }
  return out;
}

const roots = ['Pods/Headers/Public', 'Pods/React-Core-prebuilt'];
console.log('TAMTAM: scanning', roots.join(', '), '(cwd=' + process.cwd() + ')');

const all = roots.flatMap((r) => walk(r));
console.log('TAMTAM: found', all.length, '.h/.hpp files');

let patched = 0,
  skipped = 0,
  errs = 0,
  matched = 0;
const seen = new Set();
const sampleMatches = [];

for (const file of all) {
  let real;
  try {
    real = fs.realpathSync(file);
  } catch (e) {
    continue;
  }
  if (seen.has(real)) continue;
  seen.add(real);

  // Skip pods known to be pure C - wrapping breaks their C typedefs.
  const skipHit = [...SKIP_PODS].find(
    (p) => real.includes('/Pods/' + p + '/') || real.includes('/' + p + '/')
  );
  if (skipHit) continue;

  let s;
  try {
    s = fs.readFileSync(real, 'utf8');
  } catch (e) {
    continue;
  }
  if (!CXX_TOKENS.test(s)) continue;
  matched++;
  if (sampleMatches.length < 5) sampleMatches.push(real);

  if (s.includes('// TAMTAM_CXX_GUARD')) {
    skipped++;
    continue;
  }

  const wrapped =
    '// TAMTAM_CXX_GUARD\n#if defined(__cplusplus)\n' +
    s +
    '\n#endif // TAMTAM_CXX_GUARD\n';

  try {
    fs.chmodSync(real, 0o644);
  } catch (e) {}
  try {
    fs.writeFileSync(real, wrapped);
    patched++;
  } catch (e) {
    errs++;
    console.log('  skip (write fail):', real, e.code);
  }
}

console.log('TAMTAM: matched', matched, '/', all.length, '; patched', patched, '; skipped', skipped, '; errors', errs);
console.log('TAMTAM: sample matched files:');
for (const f of sampleMatches) console.log('  ', f);

const target = 'Pods/Headers/Public/React-Fabric/react/renderer/components/view/BaseViewEventEmitter.h';
if (fs.existsSync(target)) {
  console.log('TAMTAM: target file head:');
  console.log(fs.readFileSync(target, 'utf8').split('\n').slice(0, 5).join('\n'));
} else {
  console.log('TAMTAM: target file missing:', target);
}
