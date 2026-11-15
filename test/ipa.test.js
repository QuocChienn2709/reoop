import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { parsePlist, parseIpa } from '../src/index.js';

const fx = (n) => readFile(new URL(`./fixtures/${n}`, import.meta.url));

async function buildIpa(infoName) {
  const zip = new JSZip();
  const base = 'Payload/Demo.app/';
  zip.file(base + 'Info.plist', await fx(infoName));
  zip.file(base + 'embedded.mobileprovision', await fx('embedded.mobileprovision'));
  zip.file(base + 'AppIcon60x60@2x.png', new Uint8Array([1, 2, 3]));
  zip.file(base + 'Demo', new Uint8Array([0]));
  zip.file(base + 'PlugIns/Share.appex/Info.plist', await fx('Ext.plist'));
  zip.file(base + 'Frameworks/Lib.framework/Lib', new Uint8Array([0]));
  zip.file(base + 'vi.lproj/Localizable.strings', 'x');
  return zip.generateAsync({ type: 'uint8array' });
}

test('binary và XML plist cho cùng kết quả', async () => {
  const bin = parsePlist(await fx('Info.bin.plist'));
  const xml = parsePlist(await fx('Info.xml.plist'));
  assert.equal(bin.CFBundleIdentifier, 'com.example.demo3105');
  assert.equal(bin.NSCameraUsageDescription, 'Cần camera để quét mã');
  assert.deepEqual(bin.UIDeviceFamily, [1, 2]);
  assert.equal(bin.Pi, 3.14);
  assert.deepEqual([...bin.Blob], [1, 2, 3]);
  assert.deepEqual(JSON.parse(JSON.stringify(bin)), JSON.parse(JSON.stringify(xml)));
});

for (const name of ['Info.bin.plist', 'Info.xml.plist']) {
  test(`parseIpa đọc đúng dữ liệu gói (${name})`, async () => {
    const r = await parseIpa(await buildIpa(name), { fileName: 'demo.ipa' });
    assert.equal(r.name, 'Demo 3105');
    assert.equal(r.bundleId, 'com.example.demo3105');
    assert.equal(r.version, '2.4.1');
    assert.equal(r.build, '241');
    assert.equal(r.minOS, '15.0');
    assert.deepEqual(r.deviceFamily, ['iPhone', 'iPad']);
    assert.deepEqual(r.urlSchemes, ['demo3105', 'demo']);
    assert.equal(r.permissions.length, 2);
    assert.equal(r.allowsArbitraryLoads, true);
    assert.deepEqual(r.icons.files, ['AppIcon60x60@2x.png']);
    assert.equal(r.extensions[0].bundleId, 'com.example.demo3105.share');
    assert.equal(r.extensions[0].point, 'com.apple.share-services');
    assert.deepEqual(r.frameworks, ['Lib.framework']);
    assert.deepEqual(r.localizations, ['vi']);
    assert.equal(r.provision.type, 'ad-hoc');
    assert.equal(r.provision.teamName, 'Quốc Chiến');
    assert.equal(r.provision.teamId, 'ABCDE12345');
    assert.equal(r.provision.deviceCount, 3);
    assert.equal(r.provision.expired, false);
  });
}

test('từ chối file không phải IPA', async () => {
  const zip = new JSZip();
  zip.file('hello.txt', 'hi');
  const data = await zip.generateAsync({ type: 'uint8array' });
  await assert.rejects(() => parseIpa(data), /Payload/);
});
