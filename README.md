# tourfp

Bản thử nghiệm thư viện ghi và phát tour hướng dẫn trên giao diện web, không cần sửa mã nguồn của app.
Phần tử được nhận diện bằng "dấu vân tay" nhiều tín hiệu (chữ, icon, thuộc tính, component cha, tiêu đề khối đứng trước)
thay cho CSS selector, nên tour ít gãy khi app đổi class hay cấu trúc DOM.

Toàn bộ nằm trong một file: [`tourfp.js`](tourfp.js), không phụ thuộc thư viện nào.

## Cài đặt

Thư viện là gói npm [`tourfp`](https://www.npmjs.com/package/tourfp), chỉ gồm file `tourfp.js`, không có phụ thuộc và không cần bước build.

```bash
npm install tourfp
```

Rồi nạp vào app theo một trong hai cách:

```js
import 'tourfp'; // tạo window.TourFP và hiện thanh ghi tour
```

Với Angular, nên khai báo trong `angular.json` để thư viện được nạp trước mã của app. Thứ tự này cần cho việc lọc chữ lấy từ API:

```json
"scripts": ["node_modules/tourfp/tourfp.js"]
```

Hoặc không cần cài, nạp bằng một thẻ script qua CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/tourfp@0.3.1/tourfp.js"></script>
```

Để dùng thử nhanh trên một trang đang mở (trang phải cho phép script từ `cdn.jsdelivr.net`), dán dòng này vào console:

```js
document.head.appendChild(Object.assign(document.createElement('script'), { src: 'https://cdn.jsdelivr.net/npm/tourfp@0.3.1/tourfp.js' }));
```

Tuỳ chọn, đặt trước khi nạp thư viện:

```js
window.TOURFP_SERVER = 'https://tour.example.com'; // máy chủ lưu tour, mặc định http://localhost:8000
window.TOURFP_PLAYER = true;                       // chỉ phát, không hiện thanh ghi tour
```

## Dùng thử

Sau khi nạp thư viện (xem Cài đặt), một thanh điều khiển hiện ra ở góc dưới trái
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
- **Sửa tên**: bấm vào tên một bước để đặt tên hiển thị cho bước đó (để trống thì dùng lại tên tự lấy từ giao diện); nút **Sửa tên tour** đổi tên và mô tả của tour. Tên đã đặt được dùng trong lời hướng dẫn khi phát và trong việc tìm tour của trợ lý.

Cấu hình bằng biến môi trường: `TOURFP_TARGET` là trang web tour chạy trên đó (mặc định `https://tcinvest.tcbs.com.vn`),
`TOURFP_DATA` là thư mục chứa file SQLite.

Khi thư viện được cài sẵn trong app và app cho phép gọi tới máy chủ này, nút **Lưu** gửi thẳng tour lên máy chủ, và mở
`<trang>?tourfp=<mã tour>` sẽ tải tour đó về rồi phát. Địa chỉ máy chủ đặt bằng `window.TOURFP_SERVER` trước khi nạp thư viện
(mặc định `http://localhost:8000`). Trang TCInvest hiện chặn mọi kết nối ra ngoài danh sách cho phép của nó, nên với trang đó
phải dùng cách dán JSON và dán mã chạy thử.

### Trợ lý tìm tour

Người dùng nói muốn tới màn hình nào, máy chủ tìm tour phù hợp trong danh sách và trả về hai cách đi:

```bash
curl -X POST http://localhost:8000/api/assist -H 'Content-Type: application/json' -d '{"query": "tôi muốn nộp tiền", "layout": "mobile"}'
```

Câu trả lời gồm `tour` (tour được chọn), `to_step` (dừng sau bước thứ mấy; mặc định là bước cuối, hoặc bước người dùng nêu như
"tới bước 3"), `reason` (lý do, để hiện cho người dùng) và `options`:

- `guide` — **Hướng dẫn từng bước**: chỉ từng thao tác, người dùng tự bấm.
- `direct` — **Vào thẳng màn hình**: thư viện tự đưa tới nơi. Nếu bước cuối chuyển sang một trang khác thì vào thẳng trang đó
  bằng đường dẫn; nếu không thì tự bấm các bước trên trang cuối. Gặp bước cần người dùng nhập, hoặc không tìm thấy đích,
  nó chuyển sang hướng dẫn từng bước từ chỗ đó.

Mỗi lựa chọn kèm `run_url` (mở trang với `?tourfp=<mã>&mode=<guide|direct>&to=<bước>`, dùng khi thư viện đã cài trong app) và
`snippet_url` (mã chạy thử để dán vào console). Trên trang quản trị có ô **Trợ lý tìm tour** để thử ngay.

Trong app đã cài thư viện và gọi được máy chủ, có thể dùng thẳng:

```js
TourFP.ask('tôi muốn nộp tiền');          // hỏi trợ lý rồi hiện hai lựa chọn cho người dùng
TourFP.start({ mode: 'direct', to: 3 });  // chạy tour đang nạp: vào thẳng, dừng sau bước 3
```

Chế độ vào thẳng tự bấm thay người dùng. Với tour đi qua thao tác có hậu quả (đặt lệnh, xác nhận giao dịch), nên đặt `to` dừng
trước các bước đó, hoặc chỉ đưa ra lựa chọn hướng dẫn từng bước.

### Nối với mô hình AI

Mặc định trợ lý tìm bằng so khớp từ khoá, không gọi AI. Bật AI bằng biến môi trường `TOURFP_AI`:

| `TOURFP_AI` | Nối tới | Cần đặt thêm |
|---|---|---|
| `off` (mặc định) | Không gọi AI | |
| `bedrock` | Amazon Bedrock, qua API Converse | `TOURFP_AI_MODEL`, `AWS_REGION`, thông tin đăng nhập AWS; cài `boto3` |
| `litellm` | LiteLLM proxy, hoặc máy chủ nào nói giao thức `chat/completions` | `TOURFP_AI_MODEL`, `TOURFP_LITELLM_URL`, `TOURFP_LITELLM_KEY` (nếu proxy yêu cầu) |

```bash
TOURFP_AI=litellm TOURFP_AI_MODEL=<tên mô hình> TOURFP_LITELLM_URL=http://localhost:4000 uvicorn main:app --app-dir server --port 8000
```

Mô hình chỉ nhận tên tour, mô tả và nhãn của từng bước, cùng câu người dùng nhập; không nhận dấu vân tay. Câu trả lời của mô
hình luôn được kiểm lại (tour phải có thật, số bước phải nằm trong tour). Khi mô hình lỗi hoặc trả lời sai dạng, trợ lý tự
chuyển sang so khớp từ khoá và ghi lý do vào `ai_error`. Thêm một nhà cung cấp khác bằng cách viết một lớp có hàm
`complete(system, user)` trong `server/ai.py`.

Máy chủ không có đăng nhập; chỉ nên chạy trên `127.0.0.1`.

## Giới hạn hiện tại

- Trên trang, tour chỉ nằm trong bộ nhớ của tab; tải lại trang là mất. Muốn giữ thì lưu lên trang quản trị.
- Chữ lấy từ API (tên người, tên kế hoạch…) chỉ được loại khỏi dấu vân tay nếu thư viện được nạp **trước** khi app gọi API,
  tức là phải đặt trong `<head>`. Chữ số luôn bị loại.
- Lời hướng dẫn từng bước đang là câu mặc định; chưa có AI viết lời hay phân xử khi có nhiều ứng viên ngang điểm.
- Một số quy tắc đang viết riêng cho Angular Material (lớp phủ `cdk-overlay`, `mat-dialog-container`, `mat-icon`).
- Ngưỡng tách mobile/desktop (768px) là phỏng đoán. Tour ghi ở bố cục nào chỉ phát được ở bố cục đó.
