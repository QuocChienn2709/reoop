# app-3105-package-reader

Tự động đọc **dữ liệu gói thật** từ file `.ipa` khi upload, dùng cho app 3105.
Không cần nhập tay: tên app, bundle ID, phiên bản, quyền, provisioning... đều lấy thẳng từ file.

Chạy được cả **Node** lẫn **trình duyệt** (đọc ngay trên máy người dùng, file không bị gửi đi đâu).

## Dữ liệu đọc được

| Nhóm | Trường |
|---|---|
| Cơ bản | `name`, `bundleId`, `version`, `build`, `executable`, `minOS`, `deviceFamily`, `fileSize`, `fileCount` |
| Build | `sdk` (SDK, Xcode), `platforms`, `requiredCapabilities`, `backgroundModes` |
| Quyền | `permissions[]` (mọi key `*UsageDescription`) |
| Liên kết | `urlSchemes`, `queriedSchemes`, `allowsArbitraryLoads` |
| Thành phần | `extensions[]` (.appex), `frameworks[]`, `localizations[]`, `hasWatchApp`, `icons` |
| Provisioning | `type` (development / ad-hoc / enterprise / app-store), `teamName`, `teamId`, `expiresAt`, `expired`, `deviceCount`, `entitlements` |
| Gốc | `infoPlist` (toàn bộ Info.plist đã parse) |

Hỗ trợ cả **binary plist** (`bplist00`, loại IPA thật hay dùng) và XML plist.

## Cài đặt

```bash
npm install
npm test
```

## Dùng trong code

```js
import { readIpa } from 'app-3105-package-reader';

// Trình duyệt: truyền thẳng File từ <input type="file">
input.onchange = async () => {
  const pkg = await readIpa(input.files[0]);
  console.log(pkg.bundleId, pkg.version, pkg.provision?.expiresAt);
};

// Node: truyền đường dẫn
const pkg = await readIpa('./MyApp.ipa');
```

Nhận `File`, `Blob`, `ArrayBuffer`, `Uint8Array`, `Buffer` hoặc đường dẫn (Node).
Trong trình duyệt cần import map cho `jszip` (xem `demo/index.html`) hoặc dùng bundler.

## CLI

```bash
node bin/cli.js MyApp.ipa            # tóm tắt dễ đọc
node bin/cli.js MyApp.ipa --json     # JSON đầy đủ
node bin/cli.js MyApp.ipa --out info.json --raw
```

## Demo

```bash
npm run demo     # serve tại http://localhost:3105/demo/
```

Kéo thả file `.ipa` vào trang demo. Sau khi đọc xong, trang bắn sự kiện
`ipa:parsed` (kèm `detail` là kết quả) để app 3105 móc vào.

## Cấu trúc

```
src/plist.js   parser plist (binary + XML), không phụ thuộc
src/ipa.js     đọc IPA: Info.plist, mobileprovision, extension...
src/index.js   readIpa() — nhận input và tự đọc
bin/cli.js     CLI
demo/          trang thả file
test/          node --test
```

## Lưu ý

- Icon trong IPA thật thường ở định dạng PNG "CgBI" của Apple nên trình duyệt không hiển thị trực tiếp; thư viện chỉ trả về tên file icon.
- `embedded.mobileprovision` không được xác thực chữ ký, chỉ đọc nội dung plist bên trong.
- Dữ liệu đọc ra là khai báo trong file, không phải bằng chứng file đã được ký hợp lệ.
