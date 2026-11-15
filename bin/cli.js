#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { readIpa } from '../src/index.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const file = args.find((a) => !a.startsWith('--'));
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;

if (!file || flags.has('--help')) {
  console.log(`Cách dùng: read-ipa <file.ipa> [--json] [--raw] [--out result.json]

  --json   in kết quả dạng JSON
  --raw    kèm toàn bộ Info.plist gốc
  --out    ghi JSON ra file`);
  process.exit(file ? 0 : 1);
}

const replacer = (_, v) => {
  if (v instanceof Uint8Array) return `<data ${v.length} bytes>`;
  return v;
};

try {
  const result = await readIpa(file);
  if (!flags.has('--raw')) delete result.infoPlist;

  if (outFile) {
    await writeFile(outFile, JSON.stringify(result, replacer, 2));
    console.log(`Đã ghi ${outFile}`);
  } else if (flags.has('--json')) {
    console.log(JSON.stringify(result, replacer, 2));
  } else {
    const p = result.provision;
    console.log(`${result.name}  (${result.bundleId})`);
    console.log(`Phiên bản : ${result.version} (build ${result.build})`);
    console.log(`iOS tối thiểu : ${result.minOS}   Thiết bị: ${result.deviceFamily.join(', ')}`);
    console.log(`Dung lượng: ${(result.fileSize / 1048576).toFixed(2)} MB   Số file: ${result.fileCount}`);
    if (p) {
      console.log(`Provisioning: ${p.type} — ${p.teamName} (${p.teamId}), hết hạn ${p.expiresAt}${p.expired ? ' [ĐÃ HẾT HẠN]' : ''}`);
    }
    console.log(`Quyền: ${result.permissions.map((x) => x.key).join(', ') || '—'}`);
    console.log(`Extension: ${result.extensions.map((x) => x.bundleId).join(', ') || '—'}`);
    console.log(`Framework: ${result.frameworks.length}   URL scheme: ${result.urlSchemes.join(', ') || '—'}`);
  }
} catch (e) {
  console.error('Lỗi:', e.message);
  process.exit(1);
}
