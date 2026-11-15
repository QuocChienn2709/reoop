// Trình đọc plist thuần JS (chạy được cả Node lẫn trình duyệt).
// Hỗ trợ cả XML plist và binary plist (bplist00) — IPA thật thường dùng binary.

const utf8 = new TextDecoder('utf-8');
const utf16be = new TextDecoder('utf-16be');
const APPLE_EPOCH_MS = 978307200 * 1000; // 2001-01-01

export function parsePlist(input) {
  // Chuẩn hóa về Uint8Array thuần (Buffer của Node có slice() khác nghĩa)
  const bytes = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);
  if (isBinaryPlist(bytes)) return parseBinaryPlist(bytes);
  return parseXmlPlist(utf8.decode(bytes));
}

export function isBinaryPlist(bytes) {
  if (bytes.length < 8) return false;
  return String.fromCharCode(...bytes.subarray(0, 8)) === 'bplist00';
}

/* ------------------------------ Binary plist ------------------------------ */

function readUInt(bytes, pos, size) {
  let n = 0;
  for (let i = 0; i < size; i++) n = n * 256 + bytes[pos + i];
  return n;
}

export function parseBinaryPlist(bytes) {
  if (bytes.length < 40) throw new Error('Binary plist quá ngắn');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const t = bytes.length - 32;
  const offsetSize = bytes[t + 6];
  const refSize = bytes[t + 7];
  const numObjects = readUInt(bytes, t + 8, 8);
  const topObject = readUInt(bytes, t + 16, 8);
  const tableOffset = readUInt(bytes, t + 24, 8);

  const offsets = new Array(numObjects);
  for (let i = 0; i < numObjects; i++) {
    offsets[i] = readUInt(bytes, tableOffset + i * offsetSize, offsetSize);
  }

  function readLength(pos, low) {
    if (low !== 0xf) return { len: low, start: pos + 1 };
    const m = bytes[pos + 1];
    if (m >> 4 !== 0x1) throw new Error('Binary plist: độ dài không hợp lệ');
    const size = 1 << (m & 0xf);
    return { len: readUInt(bytes, pos + 2, size), start: pos + 2 + size };
  }

  function parseObject(index, depth) {
    if (depth > 256) throw new Error('Binary plist lồng quá sâu');
    const pos = offsets[index];
    if (pos === undefined) throw new Error('Binary plist: tham chiếu hỏng');
    const marker = bytes[pos];
    const type = marker >> 4;
    const low = marker & 0xf;

    switch (type) {
      case 0x0:
        if (low === 0x0) return null;
        if (low === 0x8) return false;
        if (low === 0x9) return true;
        return undefined;
      case 0x1: {
        const size = 1 << low;
        if (size === 8) return Number(view.getBigInt64(pos + 1));
        if (size > 8) throw new Error('Binary plist: số nguyên 128-bit chưa hỗ trợ');
        return readUInt(bytes, pos + 1, size);
      }
      case 0x2:
        if (low === 2) return view.getFloat32(pos + 1);
        if (low === 3) return view.getFloat64(pos + 1);
        throw new Error('Binary plist: kiểu real không hợp lệ');
      case 0x3:
        return new Date(APPLE_EPOCH_MS + view.getFloat64(pos + 1) * 1000);
      case 0x4: {
        const { len, start } = readLength(pos, low);
        return Uint8Array.from(bytes.subarray(start, start + len));
      }
      case 0x5: {
        const { len, start } = readLength(pos, low);
        return utf8.decode(bytes.subarray(start, start + len));
      }
      case 0x6: {
        const { len, start } = readLength(pos, low);
        return utf16be.decode(bytes.subarray(start, start + len * 2));
      }
      case 0x8:
        return { UID: readUInt(bytes, pos + 1, low + 1) };
      case 0xa: {
        const { len, start } = readLength(pos, low);
        const arr = [];
        for (let i = 0; i < len; i++) {
          arr.push(parseObject(readUInt(bytes, start + i * refSize, refSize), depth + 1));
        }
        return arr;
      }
      case 0xd: {
        const { len, start } = readLength(pos, low);
        const obj = {};
        for (let i = 0; i < len; i++) {
          const k = parseObject(readUInt(bytes, start + i * refSize, refSize), depth + 1);
          const v = parseObject(readUInt(bytes, start + (len + i) * refSize, refSize), depth + 1);
          obj[k] = v;
        }
        return obj;
      }
      default:
        throw new Error(`Binary plist: marker 0x${marker.toString(16)} chưa hỗ trợ`);
    }
  }

  return parseObject(topObject, 0);
}

/* -------------------------------- XML plist ------------------------------- */

function unescapeXml(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (_, e) => {
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'amp') return '&';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

function tokenize(text) {
  text = text
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '');
  const re = /<(\/?)([A-Za-z]+)[^>]*?(\/?)>|([^<]+)/g;
  const tokens = [];
  let m;
  while ((m = re.exec(text))) {
    if (m[2]) tokens.push({ name: m[2], close: !!m[1], selfClose: !!m[3] });
    else tokens.push({ text: m[4] });
  }
  return tokens;
}

export function parseXmlPlist(text) {
  const tokens = tokenize(text);
  let pos = 0;

  const skipText = () => {
    while (tokens[pos] && tokens[pos].text !== undefined) pos++;
  };

  function readText(name, selfClose) {
    if (selfClose) return '';
    let s = '';
    while (tokens[pos] && tokens[pos].text !== undefined) s += tokens[pos++].text;
    const c = tokens[pos++];
    if (!c || !c.close || c.name !== name) throw new Error(`Plist XML hỏng: thiếu </${name}>`);
    return unescapeXml(s);
  }

  function parseValue() {
    skipText();
    const t = tokens[pos++];
    if (!t || t.close) throw new Error('Plist XML hỏng: thiếu giá trị');
    switch (t.name) {
      case 'dict': {
        const obj = {};
        if (t.selfClose) return obj;
        for (;;) {
          skipText();
          const k = tokens[pos++];
          if (!k) throw new Error('Plist XML hỏng: dict chưa đóng');
          if (k.close && k.name === 'dict') return obj;
          if (k.name !== 'key') throw new Error('Plist XML hỏng: dict cần <key>');
          const key = readText('key', k.selfClose);
          obj[key] = parseValue();
        }
      }
      case 'array': {
        const arr = [];
        if (t.selfClose) return arr;
        for (;;) {
          skipText();
          const n = tokens[pos];
          if (!n) throw new Error('Plist XML hỏng: array chưa đóng');
          if (n.close && n.name === 'array') {
            pos++;
            return arr;
          }
          arr.push(parseValue());
        }
      }
      case 'string':
        return readText('string', t.selfClose);
      case 'integer':
        return parseInt(readText('integer', t.selfClose), 10);
      case 'real':
        return parseFloat(readText('real', t.selfClose));
      case 'true':
        readText('true', t.selfClose);
        return true;
      case 'false':
        readText('false', t.selfClose);
        return false;
      case 'date':
        return new Date(readText('date', t.selfClose));
      case 'data': {
        const b64 = readText('data', t.selfClose).replace(/\s+/g, '');
        return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      }
      default:
        throw new Error(`Plist XML: thẻ <${t.name}> chưa hỗ trợ`);
    }
  }

  skipText();
  const root = tokens[pos++];
  if (!root || root.name !== 'plist') throw new Error('Không phải plist XML (thiếu <plist>)');
  return parseValue();
}
