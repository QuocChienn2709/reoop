// Đọc dữ liệu gói thật từ file .ipa: Info.plist, embedded.mobileprovision, extension, framework...
import JSZip from 'jszip';
import { parsePlist } from './plist.js';

const DEVICE_FAMILY = { 1: 'iPhone', 2: 'iPad', 3: 'Apple TV', 4: 'Apple Watch', 7: 'Vision' };

function findAppDir(names) {
  for (const n of names) {
    const m = n.match(/^Payload\/[^/]+\.app\//);
    if (m) return m[0];
  }
  return null;
}

function findSeq(bytes, str, from = 0) {
  const needle = Array.from(str, (c) => c.charCodeAt(0));
  outer: for (let i = from; i <= bytes.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

// embedded.mobileprovision là CMS (PKCS#7) bọc ngoài một plist XML — cắt phần XML ra.
function parseMobileProvision(bytes) {
  const start = findSeq(bytes, '<?xml');
  const endTag = findSeq(bytes, '</plist>', Math.max(start, 0));
  if (start < 0 || endTag < 0) return null;
  return parsePlist(bytes.subarray(start, endTag + '</plist>'.length));
}

function summarizeProvision(p) {
  if (!p) return null;
  const ent = p.Entitlements || {};
  let type = 'app-store';
  if (p.ProvisionsAllDevices) type = 'enterprise';
  else if (Array.isArray(p.ProvisionedDevices)) type = ent['get-task-allow'] ? 'development' : 'ad-hoc';
  else if (ent['get-task-allow']) type = 'development';
  const exp = p.ExpirationDate instanceof Date ? p.ExpirationDate : null;
  return {
    name: p.Name ?? null,
    uuid: p.UUID ?? null,
    appIdName: p.AppIDName ?? null,
    teamName: p.TeamName ?? null,
    teamId: Array.isArray(p.TeamIdentifier) ? p.TeamIdentifier[0] : null,
    type,
    createdAt: p.CreationDate instanceof Date ? p.CreationDate.toISOString() : null,
    expiresAt: exp ? exp.toISOString() : null,
    expired: exp ? exp.getTime() < Date.now() : null,
    deviceCount: Array.isArray(p.ProvisionedDevices) ? p.ProvisionedDevices.length : null,
    entitlements: ent,
  };
}

function collectIconNames(info) {
  const names = new Set();
  for (const key of ['CFBundleIcons', 'CFBundleIcons~ipad']) {
    const primary = info[key]?.CFBundlePrimaryIcon;
    if (!primary) continue;
    if (typeof primary === 'string') names.add(primary);
    (primary.CFBundleIconFiles || []).forEach((n) => names.add(n));
    if (primary.CFBundleIconName) names.add(primary.CFBundleIconName);
  }
  (info.CFBundleIconFiles || []).forEach((n) => names.add(n));
  if (info.CFBundleIconFile) names.add(info.CFBundleIconFile);
  return [...names];
}

export async function parseIpa(data, { fileName = null } = {}) {
  const zip = await JSZip.loadAsync(data);
  const names = Object.keys(zip.files);
  const appDir = findAppDir(names);
  if (!appDir) throw new Error('Không tìm thấy Payload/*.app — không phải file .ipa hợp lệ');

  const infoFile = zip.file(appDir + 'Info.plist');
  if (!infoFile) throw new Error('IPA thiếu Info.plist');
  const info = parsePlist(await infoFile.async('uint8array'));

  const inApp = names.filter((n) => n.startsWith(appDir));
  const rel = (n) => n.slice(appDir.length);

  // Provisioning
  const provFile = zip.file(appDir + 'embedded.mobileprovision');
  const provision = provFile
    ? summarizeProvision(parseMobileProvision(await provFile.async('uint8array')))
    : null;

  // Icon
  const iconNames = collectIconNames(info);
  const iconFiles = inApp
    .map(rel)
    .filter((n) => !n.includes('/') && n.endsWith('.png') && iconNames.some((i) => n.startsWith(i)));

  // Quyền riêng tư
  const permissions = Object.keys(info)
    .filter((k) => /UsageDescription$/.test(k))
    .map((k) => ({ key: k, description: String(info[k]) }));

  // URL schemes
  const urlSchemes = (info.CFBundleURLTypes || []).flatMap((t) => t.CFBundleURLSchemes || []);

  // Extensions (.appex)
  const extensions = [];
  const appexDirs = new Set(
    inApp.map(rel).map((n) => n.match(/^PlugIns\/([^/]+\.appex)\//)?.[1]).filter(Boolean)
  );
  for (const dir of appexDirs) {
    const f = zip.file(`${appDir}PlugIns/${dir}/Info.plist`);
    if (!f) continue;
    try {
      const ei = parsePlist(await f.async('uint8array'));
      extensions.push({
        name: ei.CFBundleDisplayName || ei.CFBundleName || dir,
        bundleId: ei.CFBundleIdentifier ?? null,
        point: ei.NSExtension?.NSExtensionPointIdentifier ?? null,
      });
    } catch {
      extensions.push({ name: dir, bundleId: null, point: null });
    }
  }

  // Framework / dylib nhúng
  const frameworks = [
    ...new Set(
      inApp
        .map(rel)
        .map((n) => n.match(/^Frameworks\/([^/]+\.(?:framework|dylib))/)?.[1])
        .filter(Boolean)
    ),
  ];

  const localizations = [
    ...new Set(inApp.map(rel).map((n) => n.match(/^([^/]+)\.lproj\//)?.[1]).filter(Boolean)),
  ];

  const size = data.byteLength ?? data.size ?? null;

  return {
    fileName,
    fileSize: size,
    appFolder: appDir.slice('Payload/'.length, -1),
    name: info.CFBundleDisplayName || info.CFBundleName || null,
    bundleId: info.CFBundleIdentifier ?? null,
    version: info.CFBundleShortVersionString ?? null,
    build: info.CFBundleVersion ?? null,
    executable: info.CFBundleExecutable ?? null,
    minOS: info.MinimumOSVersion ?? null,
    deviceFamily: (info.UIDeviceFamily || []).map((n) => DEVICE_FAMILY[n] || String(n)),
    platforms: info.CFBundleSupportedPlatforms || [],
    sdk: {
      name: info.DTSDKName ?? null,
      platformVersion: info.DTPlatformVersion ?? null,
      xcode: info.DTXcode ?? null,
      build: info.DTPlatformBuild ?? null,
    },
    requiredCapabilities: info.UIRequiredDeviceCapabilities || [],
    backgroundModes: info.UIBackgroundModes || [],
    permissions,
    urlSchemes,
    queriedSchemes: info.LSApplicationQueriesSchemes || [],
    allowsArbitraryLoads: info.NSAppTransportSecurity?.NSAllowsArbitraryLoads ?? null,
    icons: { names: iconNames, files: iconFiles, hasAssetCatalog: inApp.includes(appDir + 'Assets.car') },
    extensions,
    frameworks,
    localizations,
    hasWatchApp: inApp.some((n) => rel(n).startsWith('Watch/')),
    fileCount: inApp.filter((n) => !zip.files[n].dir).length,
    provision,
    infoPlist: info,
  };
}
