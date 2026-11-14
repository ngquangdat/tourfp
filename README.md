# tour-guide

Bản thử nghiệm thư viện ghi và phát tour hướng dẫn trên giao diện web, không cần sửa mã nguồn của app.
Phần tử được nhận diện bằng "dấu vân tay" nhiều tín hiệu (chữ, icon, thuộc tính, component cha, tiêu đề khối đứng trước)
thay cho CSS selector, nên tour ít gãy khi app đổi class hay cấu trúc DOM.

Toàn bộ nằm trong một file: [`tourfp.js`](tourfp.js), không phụ thuộc thư viện nào.

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

Trong console:

```js
TourFP.export()               // tour hiện tại dạng JSON
TourFP.load(JSON.parse(json)) // nạp lại một tour
TourFP.capture(el)            // dấu vân tay của một phần tử
TourFP.find(fp)               // tìm phần tử theo dấu vân tay: { status, el, score, ... }
```

## Giới hạn hiện tại

- Tour chỉ nằm trong bộ nhớ của tab; tải lại trang là mất. Chưa có nơi lưu bền.
- Chữ lấy từ API (tên người, tên kế hoạch…) chỉ được loại khỏi dấu vân tay nếu thư viện được nạp **trước** khi app gọi API,
  tức là phải đặt trong `<head>`. Chữ số luôn bị loại.
- Lời hướng dẫn từng bước đang là câu mặc định; chưa có AI viết lời hay phân xử khi có nhiều ứng viên ngang điểm.
- Một số quy tắc đang viết riêng cho Angular Material (lớp phủ `cdk-overlay`, `mat-dialog-container`, `mat-icon`).
- Ngưỡng tách mobile/desktop (768px) là phỏng đoán. Tour ghi ở bố cục nào chỉ phát được ở bố cục đó.
