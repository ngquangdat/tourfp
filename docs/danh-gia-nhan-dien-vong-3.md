# Đánh giá nhận diện TourFP — vòng 3 (bản `tourfp.js` đã sửa, fp v4)

Ngày 14/11/2026, trên tcinvest.tcbs.com.vn (tài khoản thật, chỉ thao tác xem). Thư viện được nạp qua loader `http://127.0.0.1:8791/?f=tourfp.js&to=…`. Mục tiêu: kiểm 5 lỗi nặng của vòng 2 (6.1–6.5) đã sửa chưa, đo lại các màn có vấn đề, ghi lại các tour.

## 1. Kết luận

| Lỗi vòng 2 | Trạng thái | Bằng chứng chính |
|---|---|---|
| 6.1 Cú bấm có tác dụng bị ghi `info`, lúc phát bị chặn | **Đã sửa** | VN30 (dropdown), chuông, tab Khác được ghi là `click`, và cú bấm thật đi qua lúc phát. Tour 01, 05 chạy hết. Cú bấm không có tác dụng (mã BSR, icon phễu không mở, ô tìm kiếm drawer, Nộp tiền) vẫn ghi đúng là `info`. Chưa kiểm được trường hợp số liệu nhảy làm `info` thành `click` nhầm, vì thị trường đã đóng cửa. |
| 6.2 Phần tử trong drawer/panel đang đóng vẫn được tô | **Đã sửa** | Khi drawer đóng, các mục của drawer trả `not-found`, kể cả với fp v3 (vòng 2 tô ở x=−631 và x=−414). `clickables()` có 0 phần tử ngoài màn khi drawer đóng. Panel Thông báo hiện "đang chờ màn hình…" rồi tô đúng khi panel trượt vào (vòng 2 tô ở x≈1272). **Chưa kiểm** thanh cuộn ngang và carousel (xem mục 7). |
| 6.3 Popup lạ lúc phát: kẹt hoặc tải lại trang | **Đã sửa** | Ca có sẵn lúc bấm Phát: sau ~0.9 s hiện "Hãy đóng hộp thoại đang che màn hình, tour sẽ tự tiếp tục.", không có Esc, URL không đổi sau 5 s. Đóng xong thì ~1.2 s sau tự phát bước 1. Ca bật lên giữa bước 2: ~1.1 s sau chuyển sang chờ, cú bấm Đóng đi qua, rồi phát tiếp đúng bước 2. Tour 01 và 08 (quảng cáo lúc ghi, lúc phát không có) vẫn tự bỏ qua bước đóng quảng cáo. |
| 6.4 `nth` lệch khi số bản sao thay đổi | **Sửa một phần** | (a) Bản sao ngoài màn (thanh dưới, footer, drawer) đã bị loại khỏi nhóm. Mục Quỹ trong bottom sheet giờ trả đúng (thứ 8/10; vòng 2 trả nhầm Phái sinh). Desktop /home sau tải lại: 323/0 sai (vòng 2: 4 sai). (b) Danh sách thật sự đổi số lượng thì **vẫn lấy theo thứ tự**: ở tour 07, nút 3M lúc ghi có nhóm 9, lúc phát nhóm 6, trúng chỉ vì thứ tự giữ nguyên. `fp.sub` hoạt động (trả lớp bên trong của mục) nhưng không giải quyết (b). |
| 6.5 Nhãn mềm và anchor là dữ liệu | **Sửa một phần** | `loose` tìm đúng mã theo chữ: 18/18 mã VN30 (vòng 2: 18 sai), BSR, AMC. `scrub()` xoá đúng anchor khi giá trị đã có trong phản hồi API. Nhưng **anchor họ tên ở thanh trên không bị xoá**, vì phản hồi API hồ sơ đến trước khi thư viện được nạp. Ô số trên bảng giá lấy tên công ty làm anchor, nên 198/396 ô mơ hồ. |

- **Không thấy hồi quy** làm hỏng tour.
- Ba tour fp v3 kiểm trên /home (12, 13, 14) vẫn tìm đúng 100%, sau khi file được thêm đủ trường mặc định.
- Bốn tour ghi lại bằng v4 (01, 05, 07, 08) đều **chạy hết không cần can thiệp**. Ở vòng 2, ba trong bốn tour này cần can thiệp hoặc bị kẹt.

**Giới hạn môi trường:** trong phiên này, một số file JS lazy của app trả 403. Bị ảnh hưởng: hộp thoại tìm kiếm, Fundmart/So sánh quỹ, bộ lọc screener, Nộp tiền, hộp thoại hồ sơ, và việc tải thẳng /tc-price, /my-asset. Vì vậy không ghi lại được tour 02, 03, 04, 06, 15, và tour 07 phải đổi luồng.

## 2. Cách đo

Cách đo giống vòng 2:
- **Tự khớp:** `capture(e)` rồi `find(fp)` ngay trên cùng trang.
- **Sau tải lại:** lưu fp vào sessionStorage, tải lại trang, nạp lại thư viện rồi `find`.

Kết quả ghi theo dạng ok/sai/mơ hồ/không thấy.
- Tập phần tử gồm `clickables()` cộng gốc bấm của mọi lá nhìn thấy, bỏ phần tử ngoài màn theo chiều ngang.
- Mobile 800×(cao), desktop 1280×800.
- Trước mỗi cú bấm thật đều kiểm `elementFromPoint` (đúng đích, không có lớp loading, không nằm trong vùng đặt lệnh).

## 3. Trước / sau

| Màn | Layout | Vòng 2: N, tự khớp → sau tải lại | Vòng 3: N, tự khớp → sau tải lại | Ghi chú |
|---|---|---|---|---|
| /home | mobile | 42: 41/0/1/0 → 40/**1**/1/0 | 403: 252/0/151/0 → 251/**1**/151/0 | Vòng 3 cuộn hết để vẽ khối lazy, nên N không so trực tiếp được. 148/151 mơ hồ là ô bảng giá mini đang ẩn (`app-tc-price-table-floor`). 1 sai: avatar trả về khối bọc (mục 6.7). |
| /tc-price VN30 | mobile | 397: 164/**18**/215/0 | 396: 198/**0**/198/0 | Mã: 18/18 đúng nhờ `loose`. 198 mơ hồ là ô số có anchor là tên công ty. Sau tải lại không so được (app về HOSE). |
| /home | desktop | 131: 131/0/0/0 → 126/**4**/0/1 | 323: 323/0/0/0 → 323/**0**/0/0 | Bản sao ngoài màn bị loại. |
| /tc-price HNX (nửa trên) | desktop | 331: 224/**6**/101/0 | 400: 251/**3**/146/0 | 3 sai đều là ô số (1.20, 3.80, 4.50) trả về ô số khác. Mơ hồ chủ yếu là ô số. |
| Drawer mobile đang đóng | mobile | ok ở x=−631 / −414 (sai) | not-found (đúng) | Cả fp v3. |
| Panel Thông báo đang ẩn | mobile | tô x≈1272 (sai) | chờ, rồi tô đúng (643,72) | |

**Thời gian `find`** (trung bình/max): desktop HNX 36.5/121.3 ms (vòng 2: 32.7/111.6), tương đương vòng 2.

## 4. Kết quả 15 tour

| # | fp | Ghi lại vòng 3? | Kết quả phát lại | Hết tour không cần can thiệp? |
|---|---|---|---|---|
| 01 Quảng cáo → Bảng giá → HOSE → VN30 → BSR | v4 | Có (bỏ 2 bước bộ lọc vì icon phễu không mở) | 1 bỏ qua (~1.3 s) ✓, 2 ✓ 100% (không còn nth), 3 ✓, 4 ✓ chữ «VN30», giờ là `click`, bấm thật đi qua, 5 ✓ «BSR» loose | **Có** (vòng 2: kẹt ở 4) |
| 02 Bottom sheet Đầu tư → Quỹ … | v3 | Không (403) | Chỉ kiểm bước Quỹ: đúng sau tải lại (vòng 2 sai) | — |
| 03 Drawer → tìm kiếm → Nộp tiền … | v3 | Không (403) | — | — |
| 04 Drawer → Xem thêm → iPower … | v3 | Không (403) | Kiểm 6.2: mục drawer `not-found` khi drawer đóng | — |
| 05 Chuông → Khác → Quan tâm → Xem thêm #2 | v4 | Có | 1 ✓ hint, giờ là `click`; 2 chờ panel rồi ✓; 3 ✓; 4 ✓ thứ 2/8, tự cuộn | **Có** (vòng 2: can thiệp) |
| 06 Tài sản → … → lịch | v3 | Không (/my-asset 403) | — | — |
| 07 Phái sinh → Cơ sở → 3M → 1Y (+ 2 ca quảng cáo) | v4 | Có (đổi luồng) | 2 ca quảng cáo ✓ (mục 1); 3 ✓ nhưng theo thứ tự (nhóm 9→6); 4 ✓ chữ «1Y» | **Có** (vòng 2: can thiệp) |
| 08 Rê Cổ phiếu → Bảng giá → (quảng cáo lúc ghi) → HNX → AMC | v4 | Có (bắt đầu /home) | 1 ✓ hover thật, 2 ✓ → /tc-price, 3 bỏ qua ✓, 4 ✓ thứ 2/2 (lúc ghi nhóm 3), đúng tab sàn, 5 ✓ AMC | **Có** |
| 09–11 | v3 | Không (ngoài phạm vi) | Chưa phát lại | — |
| 12 | v3 | Không | Bước 1 (Cổ phiếu) ✓ 100% | — |
| 13 | v3 | Không | 3/3 bước ✓ 100% trên /home | — |
| 14 | v3 | Không | Bước 1 (Công cụ) ✓ 100% | — |
| 15 Avatar → Hệ thống … | v3 | Không (hộp thoại hồ sơ 403) | Bước 1 trỏ vào khối `main-group` 745×60 (cả ô tìm kiếm, Công cụ, chuông, avatar). Ghi lại bằng v4 cho kết quả y hệt. | Không đúng |

**Tổng:**
- 4/4 tour ghi lại (01, 05, 07, 08) chạy hết không cần can thiệp; ở vòng 2, chỉ tour 08 trong số này chạy hết, và phải phát lại một lần.
- Không bấm nút giao dịch nào. Bước AMC được ghi bằng Alt-click (`info`) để không mở bảng đặt lệnh.

## 5. Kiểm `scrub()` (tour 15)

1. **Capture bằng v4:** capture avatar, khối họ tên và dòng số tài khoản ở thanh trên. Cả ba đều leo về cùng khối `main-group`, có anchor là họ tên khách hàng.
2. **`export()` lần 1:** anchor vẫn còn, vì `isApiValue(họ tên)` = false. Lúc đo, `apiStats()` cho 18 phản hồi và 382 giá trị, nhưng phản hồi hồ sơ không nằm trong đó: app gọi nó lúc khởi động, trước khi loader nạp thư viện.
3. **Nạp thử giá trị đó qua `__tourfpApi.feed(…)` rồi `export()` lại:** anchor bị xoá ở cả 3 bước, không còn trường nào chứa dữ liệu cá nhân, và `find` vẫn trả đúng khối.

**Kết luận:** `scrub()` hoạt động đúng về cơ chế, nhưng không đủ khi thư viện được nạp muộn (loader, bookmarklet, hoặc script tải sau khi app đã gọi API). Vẫn phải rà tay trước khi commit.

## 6. Lỗi còn lại, theo mức độ

### 6.4b [Cao] `nth` vẫn lấy theo thứ tự khi danh sách thật sự đổi

- **Tái hiện:**
  1. Tour 07, bước 3M: lúc ghi `twins: 8` (nhóm 9).
  2. Lúc phát, `find` độc lập trả "thứ 2/6", trúng chỉ vì thứ tự giữ nguyên.
  3. Tour 05 'Xem thêm': thêm hoặc mở rộng một thông báo phía trên thì lệch.
- **Dòng nghi ngờ:** `tourfp.js:449` `const rep = byText ? same[0] : group[fp.nth];`. Không có `exact`/`loose` thì không có tín hiệu nào khác ngoài chỉ số.
- **Gợi ý:**
  - Khi `group.length !== fp.twins + 1`, hạ điểm hoặc trả `ambiguous` thay vì `ok` với `margin: 1`.
  - Hoặc thêm một tín hiệu hàng xóm, ví dụ chữ của anh em trước/sau.

### 6.5b [Trung bình] Anchor dữ liệu không bị phát hiện khi thư viện nạp muộn (dữ liệu cá nhân)

- **Tái hiện:** nạp thư viện sau khi app đã tải xong, capture avatar ở thanh trên, rồi `export()`. Anchor chứa họ tên.
- **Dòng nghi ngờ:**
  - `tourfp.js:278–279`: anchor chỉ bị loại nếu `isApiValue`.
  - `tourfp.js:992–996` `scrub()`: chỉ xét `anchor`, và chỉ dựa trên `api.set`.
- **Gợi ý:**
  - Coi chữ nằm trong vùng hồ sơ/thanh trên (`app-toolbar`) là dữ liệu.
  - Hoặc đọc thêm `localStorage`/`sessionStorage` của app vào `api.set` lúc khởi động.
  - Hoặc cảnh báo khi anchor trông giống tên người (2–4 từ viết hoa có dấu).

### 6.5c [Trung bình] Ô số trên bảng giá mơ hồ hàng loạt

- **Tái hiện:** mobile VN30 có 198/396 phần tử mơ hồ; desktop HNX có 146/400 mơ hồ và 3 sai.
- **Nguyên nhân:**
  - Ô số không có nhãn (chỉ có số).
  - Anchor là tên công ty của dòng. Đây là dữ liệu nhưng không được nhận ra là giá trị API, vì bảng giá nhận qua websocket hoặc trước khi hook.
  - Các ô cùng dòng chung một anchor.
- **Dòng nghi ngờ:**
  - `tourfp.js:278` (`anchorCands`/`isApiValue`).
  - Nhánh scan ở `tourfp.js:470`.
- **Ảnh hưởng:** an toàn (mơ hồ chứ không tô sai), nhưng không làm tour trên ô giá được. 3 ca sai trên desktop đáng chú ý hơn.

### 6.7 [Trung bình] `clickableRoot` leo quá cao (chưa sửa, vòng 2 đã báo)

- **Tái hiện:**
  - Desktop /home: `captureAt(avatar img)` trả `div.main-group` 745×60, chứa cả ô tìm kiếm, Công cụ, chuông, avatar. Tô sáng phủ cả thanh trên, và tour 15 bước 1 "đúng" chỉ vì khối chứa avatar.
  - Mobile /tc-price: icon phễu được ghi thành cả thanh "VN30".
- **Dòng nghi ngờ:** `tourfp.js:214` `clickableRoot`. Vòng leo theo `cursor:pointer` không giới hạn diện tích so với phần tử gốc.

### 6.6 [Thấp] Lớp mặc định thiếu khi `load()` file đã lược trường

- `sameKind` (`tourfp.js:249`) so `icon` chặt, và `hasStrong` gọi `Object.keys(fp.key)`. Vì vậy fp thiếu `icon`/`key` thì bước `nth` không khớp hoặc `find` ném lỗi.
- Bộ dữ liệu vòng 2 bị đúng lỗi này; vòng 3 đã thêm đủ trường vào file.
- **Gợi ý:** `load()` nên điền mặc định cho fp.

## 7. Chưa kiểm chứng / giới hạn

- **6.1:** chưa kiểm cú bấm không tác dụng trong lúc số liệu nhảy (thị trường đóng cửa). Chưa rõ có bị nâng nhầm thành `click` hay không.
- **6.2:** chưa kiểm thanh cuộn ngang, carousel và phân trang (mục C tuỳ chọn: chưa làm).
- **6.4:** chưa đo lại các danh sách quỹ và mẫu báo cáo sau tải lại, vì Fundmart và Báo cáo của tôi bị 403.
- **Tour chưa ghi lại hoặc chưa phát lại hết:** tour 02, 03, 04, 06, 15 không ghi lại được (403). Tour 09–11 chưa phát lại vòng 3.
- **Máy chủ admin:**
  - Đã xoá 15 tour testdata cũ và nhập lại 15 file.
  - Không đụng hai tour "Mua trái phiếu" và "Nộp tiền từ menu (mobile)".
