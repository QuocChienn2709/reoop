import { parseIpa } from './ipa.js';

export { parsePlist } from './plist.js';
export { parseIpa } from './ipa.js';

/**
 * Tự động đọc dữ liệu gói từ file upload.
 * input: đường dẫn (Node), File/Blob (trình duyệt), ArrayBuffer, Uint8Array hoặc Buffer.
 */
export async function readIpa(input) {
  let data = input;
  let fileName = input?.name ?? null;

  if (typeof input === 'string') {
    const { readFile } = await import('node:fs/promises');
    const path = await import('node:path');
    data = await readFile(input);
    fileName = path.basename(input);
  }
  return parseIpa(data, { fileName });
}
