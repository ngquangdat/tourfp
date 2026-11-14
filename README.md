# tour-guide

Bản thử nghiệm thư viện ghi và phát tour hướng dẫn trên giao diện web, không cần sửa mã nguồn của app.
Phần tử được nhận diện bằng "dấu vân tay" nhiều tín hiệu (chữ, icon, thuộc tính, component cha, tiêu đề khối đứng trước)
thay cho CSS selector, nên tour ít gãy khi app đổi class hay cấu trúc DOM.

Toàn bộ nằm trong một file: [`tourfp.js`](tourfp.js), không phụ thuộc thư viện nào.

## Cài đặt

Thư viện là một gói npm tên `tourfp`, chỉ gồm file `tourfp.js`, không có phụ thuộc và không cần bước build.

Cài thẳng từ repo này (repo đang riêng tư, nên máy cài phải có quyền đọc repo):

```bash
npm install github:ngquangdat/tour-guide
```

Rồi nạp vào app theo một trong hai cách:

```js
import 'tourfp'; // tạo window.TourFP và hiện thanh ghi tour
```

Với Angular, nên khai báo trong `angular.json` để thư viện được nạp trước mã của app. Thứ tự này cần cho việc lọc chữ lấy từ API:

```json
"scripts": ["node_modules/tourfp/tourfp.js"]
```

Tuỳ chọn, đặt trước khi nạp thư viện:

```js
window.TOURFP_SERVER = 'https://tour.example.com'; // máy chủ lưu tour, mặc định http://localhost:8000
window.TOURFP_PLAYER = true;                       // chỉ phát, không hiện thanh ghi tour
```

Gói chưa được đưa lên npm. Khi đã phát hành, có thể cài bằng `npm install tourfp`, hoặc nạp bằng một thẻ script qua CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/tourfp@0.2.0/tourfp.js"></script>
```

## Dùng thử

Dán nội dung `tourfp.js` vào console của trang, hoặc nạp bằng thẻ `<script>`. Một thanh điều khiển hiện ra ở góc dưới trái
(kéo đi chỗ khác được):

- **● Ghi** — thao tác như bình thường, mỗi cú bấm thành một bước và vẫn chạy thật.
  - Bấm vào phần tử làm đổi màn hoặc đổi nội dung: bước "bấm" (khi phát, người dùng phải tự bấm).
  - Bấm vào phần tử không bấm được, hoặc bấm mà trang không đổi gì: bước "tô sáng" (khi phát có nút Tiếp).
  - Bấm vào mục trong menu bật ra do rê chuột: tự chèn bước "rê chuột" phía trước.
  - Giữ Alt khi bấm: ghi bước "tô sáng" và chặn cú bấm.
- **▶ Phát** — tô sáng từng đích, chặn bấm ra ngoài đích, tự chờ màn mới hiện ra.
  - Đang ở màn nào thì phát từ bước của màn đó; màn không có trong tour thì đưa về màn đầu.
  - Bước đã được làm sẵn (ví dụ menu đã mở rộng) thì tự bỏ qua.
  - Đang ở màn cuối và bước cuối đã làm xong thì báo, cho chọn phát lại từ đầu.
- **Xoá** — xoá danh sách bước.
- **Lưu** — gửi tour lên máy chủ quản trị (xem bên dưới). Nếu trang không cho gọi ra ngoài, JSON của tour được chép vào clipboard.

Trong console:

```js
TourFP.export()               // tour hiện tại dạng JSON
TourFP.load(JSON.parse(json)) // nạp lại một tour
TourFP.capture(el)            // dấu vân tay của một phần tử
TourFP.find(fp)               // tìm phần tử theo dấu vân tay: { status, el, score, ... }
```

## Trang quản trị (`server/`)

Một máy chủ FastAPI nhỏ để lưu danh sách tour đã ghi, thêm mới, xoá và chạy thử. Dữ liệu nằm trong SQLite tại `server/data/tours.db`.

```bash
pip install -r server/requirements.txt
```

```bash
uvicorn main:app --app-dir server --host 127.0.0.1 --port 8000
```

Mở <http://localhost:8000>:

- **Thêm tour** — đặt tên rồi dán JSON lấy bằng `copy(TourFP.export())`, hoặc chọn file `.json`.
- **Chạy thử** — chép một đoạn mã gồm cả thư viện lẫn tour; mở màn bắt đầu của tour, dán vào console là tour phát ngay.
  Khi chạy thử, thanh ghi tour không hiện (chế độ chỉ phát); gọi `TourFP.showPanel()` nếu cần hiện lại.
- **Xoá**, **Tải JSON**, và xem danh sách bước của từng tour.

Cấu hình bằng biến môi trường: `TOURFP_TARGET` là trang web tour chạy trên đó (mặc định `https://tcinvest.tcbs.com.vn`),
`TOURFP_DATA` là thư mục chứa file SQLite.

Khi thư viện được cài sẵn trong app và app cho phép gọi tới máy chủ này, nút **Lưu** gửi thẳng tour lên máy chủ, và mở
`<trang>?tourfp=<mã tour>` sẽ tải tour đó về rồi phát. Địa chỉ máy chủ đặt bằng `window.TOURFP_SERVER` trước khi nạp thư viện
(mặc định `http://localhost:8000`). Trang TCInvest hiện chặn mọi kết nối ra ngoài danh sách cho phép của nó, nên với trang đó
phải dùng cách dán JSON và dán mã chạy thử.

Máy chủ không có đăng nhập; chỉ nên chạy trên `127.0.0.1`.

## Giới hạn hiện tại

- Trên trang, tour chỉ nằm trong bộ nhớ của tab; tải lại trang là mất. Muốn giữ thì lưu lên trang quản trị.
- Chữ lấy từ API (tên người, tên kế hoạch…) chỉ được loại khỏi dấu vân tay nếu thư viện được nạp **trước** khi app gọi API,
  tức là phải đặt trong `<head>`. Chữ số luôn bị loại.
- Lời hướng dẫn từng bước đang là câu mặc định; chưa có AI viết lời hay phân xử khi có nhiều ứng viên ngang điểm.
- Một số quy tắc đang viết riêng cho Angular Material (lớp phủ `cdk-overlay`, `mat-dialog-container`, `mat-icon`).
- Ngưỡng tách mobile/desktop (768px) là phỏng đoán. Tour ghi ở bố cục nào chỉ phát được ở bố cục đó.
