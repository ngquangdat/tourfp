# Đánh giá nhận diện TourFP — vòng 2 (bản `tourfp.js` đã sửa, fp v3)

Ngày 14/11/2026, tcinvest.tcbs.com.vn, tài khoản thật đang đăng nhập. Thư viện nạp qua máy chủ 127.0.0.1:8791 → `window.name` →
`(0, eval)(window.name)` trong một tab riêng. Số dòng mã nguồn ứng với `tourfp.js` hiện có trong thư mục làm việc (1037 dòng).
Không bấm nút giao dịch, xác nhận, chuyển tiền, đổi cài đặt nào; các nút rủi ro chỉ được `locate`.

## 1. Kết luận

Bản sửa giải quyết gần hết lỗi nặng của vòng 1:
- nút ⋮ theo thứ tự đúng;
- 11/11 nút MUA bảng trái phiếu đúng (vòng 1: 5/11);
- 1M/3M/6M/1Y/12-18 tháng phân biệt được nhờ `exact`;
- ô chọn không lấy giá trị làm nhãn;
- kết quả mơ hồ không còn bị tô sáng, mà báo "có nhiều phần tử giống…" sau khoảng 8 s.

Trên 20 màn/trạng thái, 2082 phần tử, tự khớp đạt 82,3% đúng, 1,2% ok-nhưng-sai, 16,5% mơ hồ, 0 không thấy. Bỏ hai bảng giá
thì đạt 97,9% đúng, 0 sai, 2,1% mơ hồ. Toàn bộ 24 trường hợp ok-nhưng-sai nằm ở bảng giá, do nhóm `nth` lồng nhau.

Khi phát thật, 15 tour (82 bước) cho thấy các lỗi còn lại nằm ở **cách ghi và cách dẫn**, không phải ở khớp phần tử:
- nhiều cú bấm có tác dụng bị ghi thành `info`, rồi chính cú bấm đó bị chặn lúc phát;
- phần tử nằm trong drawer/panel đang đóng (ngoài màn) vẫn được coi là "thấy";
- quảng cáo bật lên giữa bước gây kẹt;
- `nth` lệch khi số bản sao ẩn thay đổi.

Kết quả 15 tour:
- 6 tour chạy hết không cần can thiệp;
- 4 tour chạy hết sau khi người dùng tự thao tác;
- 5 tour có bước sai hoặc không hoàn thành đúng.

## 2. Cách đo

- **Phần tử được quét**: `TourFP.clickables()` cộng thêm "gốc bấm được" của mọi lá chữ/icon trong vùng quét (cùng quy tắc với
  `clickableRoot`). Bỏ phần tử ngoài màn theo chiều ngang. Vùng quét là hộp thoại nếu đang mở, ngược lại là cả trang.
- **Tự khớp**: `capture(e)` rồi `find(fp)` ngay trên trang đó. Kết quả trả về là `e` hoặc cha/con của `e` thì tính là đúng.
- **Sau tải lại**: lưu fp cùng mô tả phần tử (thẻ, chữ, toạ độ) vào sessionStorage, tải lại trang qua bộ nạp, `find` lại.
  Tính là đúng khi cùng thẻ, cùng chữ và (chữ là duy nhất hoặc toạ độ lệch < 30 px). Khi app nhớ trạng thái khác (tab, mục chọn)
  giữa hai lần thì ghi rõ "không so được".
- **Tour**: ghi bằng `record()` với chuột thật; phát lại sau khi tải lại, bằng `play()` với chuột thật hoặc `locate(i)` từng bước
  (ghi rõ trong mỗi file). Chi tiết từng bước nằm ở trường `observed` của `testdata/tours/*.json`.

## 3. Số liệu theo màn

Mỗi ô ghi: đúng / **ok-sai** / mơ hồ / không thấy. Cột ms là trung bình / tối đa của `find` khi tự khớp.

| Màn / trạng thái | Layout | N | Tự khớp | Sau tải lại | ms |
|---|---|---|---|---|---|
| /home | mobile | 42 | 41/0/1/0 | 40/**1**/1/0 (*a) | 4.0/20.1 |
| /tc-price, nhóm VN30 (bảng giá) | mobile | 397 | 164/**18**/215/0 | 164/**18**/215/0 | 25.6/60.8 |
| /new-fund (Fundmart, danh sách quỹ) | mobile | 88 | 87/0/1/0 | 85/**1**/1/1 | 1.5/10.1 |
| Hộp thoại chi tiết quỹ | mobile | 18 | 16/0/2/0 | 15/1?/2/0 (*b) | 1.3/1.9 |
| Hộp thoại Nộp tiền (chỉ xem) | mobile | 14 | 14/0/0/0 | 11/2?/0/1 (*b) | 0.6/1.1 |
| /ipower | mobile | 25 | 23/0/2/0 | 23/0/2/0 | 2.6/15.1 |
| Panel Thông báo | mobile | 57 | 57/0/0/0 | 49/**7**/1/0 (*c) | 1.0/11.0 |
| /my-asset | mobile | 19 | 19/0/0/0 | 16/**2**/0/1 (*d) | 4.0/14.2 |
| /lookup (tra cứu lịch sử) | mobile | 12 | 12/0/0/0 | không so được (tab khác) | 1.4/6.6 |
| Datepicker | mobile | 34 | 34/0/0/0 | không so được (tháng khác) | 0.9/2.0 |
| /home | desktop | 131 | 131/0/0/0 | 126/**4**/0/1 | 9.0/42.0 |
| /tc-price/trade-station | desktop | 341 | 338/0/3/0 | 338/0/3/0 (*e) | 9.1/77.6 |
| /tc-price bảng HNX (331/807 phần tử nửa trên) | desktop | 331 | 224/**6**/101/0 | không so được (app về HOSE) | 32.7/111.6 |
| Hộp thoại So sánh quỹ | desktop | 21 | 18/0/3/0 | 18/0/3/0 | 1.1/2.3 |
| /tcw | desktop | 139 | 133/0/6/0 | 133/0/6/0 | 3.6/24.4 |
| Hộp thoại chi tiết kế hoạch | desktop | 85 | 83/0/2/0 | — | 1.7/6.8 |
| /lookup | desktop | 56 | 56/0/0/0 | 51/2?/1/2 (*f) | 2.8/10.4 |
| /bond-v2 (bảng trái phiếu) | desktop | 116 | 116/0/0/0 | 116/0/0/0 | 3.4/27.6 |
| Wizard trái phiếu (bước 1) | desktop | 5 | 5/0/0/0 | 5/0/0/0 | 1.0/2.1 |
| Hộp thoại Báo cáo của tôi | desktop | 109 | 102/0/7/0 | không so được (mẫu khác) | 1.7/6.9 |
| Hộp thoại hồ sơ (mục Thông báo) | desktop | 42 | 41/0/1/0 | không so được (mục khác) | 1.4/2.4 |
| **Tổng tự khớp** | | **2082** | **1714/24/344/0** | | |
| **Tổng sau tải lại (12 màn so được)** | | **1380** | | **1112/32/234/2** | |

Ghi chú:
- (*a) Lần đầu (chưa cuộn) cho 14/1/2/25: các khối dưới màn **chưa được vẽ** (lazy) nên không có trong DOM. Phải cuộn hết trang
  mới ra 40/1/1/0. "Sai" là avatar: fp không nhãn khớp vào khối bọc cả thanh tìm kiếm.
- (*b) "?" là chưa chắc: cùng chữ nhưng vị trí đổi vì khung đã cuộn/accordion khác, có thể vẫn đúng.
- (*c) Lúc quét, một thông báo đang mở rộng ('Xem thêm' đổi thành 'Rút gọn'); sau tải lại nhóm 'Xem thêm' có thêm 1 → 7 cái
  sau đó lệch thứ tự. Đây là sai thật.
- (*d) Lúc quét tab 'iXu' đang chọn, sau tải lại là 'Tổng quan': fp 'iXu' khớp vào thanh tab hoặc nút 'Khác' (ok-sai).
- (*e) 2 phần tử đồng hồ đổi giờ, tính là đúng.
- (*f) 2 "sai" là cùng ô chọn nhưng chữ giá trị đã đổi; 2 "không thấy" là mục danh sách chọn chưa mở.

Ok-sai khi tự khớp tập trung ở ô số **không nhãn** của bảng giá (18 mobile, 6 desktop). `kindGroup` chỉ giữ lớp ngoài cùng; khi
ô bị ghi nằm trong một khối cùng `sig` chứa nhiều ô, `nth` trỏ vào khối đó, rồi vòng chọn lớp bên trong (dòng 424–425) lấy ô
**đầu tiên** đạt điểm cao nhất. Ví dụ: ô '20.40' (x≈532) bị trả thành '20.25' (x≈111), via 'thứ 1/3'.

Mơ hồ tập trung ở ô số không nhãn và mã CK/mã quỹ — nhãn mềm (soft) không được tính là tín hiệu mạnh, xem mục 6.4.

## 4. Kết quả 15 tour

Ký hiệu loại bước: c = click, h = hover, i = info, n = input.

| # | Layout | Bước (loại) | Cách phát | Kết quả từng bước | Hết tour? |
|---|---|---|---|---|---|
| 01 Quảng cáo → Bảng giá → VN30 → bộ lọc | mobile | c c c i i c c c | play + locate | 1 bỏ qua ngay ✓, 2 ✓ (thứ 2/2), 3 ✓, 4 đúng phần tử nhưng **bị chặn** (info) → kẹt, 5 mơ hồ (an toàn), 6 đích là cả thanh chọn sàn (ghi sai gốc), 7 ✓, 8 ✓. Phát lại từ giữa: bước 3 chọn **sai** 'HOSE' ngoài màn (76%) | Không |
| 02 Đầu tư (bottom sheet) → Quỹ → 1Y → quỹ dòng 3 → 3Y → Đặt mua (locate) | mobile | c c i i c i c | play | 1 ✓ (hint), 2 **SAI**: tô 'Phái sinh' thay 'Quỹ' (thứ 8/8; lúc ghi nhóm 10, lúc phát 8), 3 ✓ chữ «1Y» nhưng bị chặn, 4 mơ hồ (8 s), 5 ✓, 6 ✓, 7 ✓ không bấm | Không |
| 03 Menu → ô tìm kiếm → gõ/xoá → Đóng → Nộp tiền → accordion → BIDV | mobile | c i n i i c i c | play | 1 không thấy (need 2/have 1), 2 tô ô tìm kiếm của drawer **đang đóng** (x≈−414); mở drawer rồi phát lại thì ✓ nhưng bị chặn (info); 3–4 bỏ qua; 5 ✓ nhưng bị chặn → bước 6 'không tìm thấy' sau 8.5 s; tự mở Nộp tiền thì tour tiếp; 6–8 ✓ | Sau can thiệp |
| 04 Drawer → Xem thêm → iPower → Nộp/Rút → NỘP TIỀN (locate) | mobile | i i i c | locate | 1 bỏ qua (đã mở rộng) ✓, 2 drawer đóng: ok nhưng x=−631 **ngoài màn**; drawer mở: ✓, 3 ✓, 4 ✓ không bấm | Một phần |
| 05 Chuông → Khác → Quan tâm → Xem thêm (thông báo 2) | mobile | i c c c | play | 1 ✓ nhưng bị chặn (info), 2 tô tab của panel **đang ẩn** (x≈1272) → kẹt; tự mở panel: ✓, 3 ✓, 4 ✓ (thứ 5/12) | Sau can thiệp |
| 06 Tài sản → tiểu khoản → Lịch sử → tab TP → trạng thái → 'Đã hủy' thứ 2 → lịch → tháng trước | mobile | c c c c i c c c c | play | 1–4 ✓, 5 ✓ nhưng bị chặn → tab không đổi, 6–7 bỏ qua (form không hiện), 8 **sai ngữ cảnh**: icon lịch của form khác (88%), 9 ✓; báo 'Xong tour' | Không đúng |
| 07 Rê Quỹ → So sánh → 6M → chú giải VCBFFIF; có quảng cáo lúc phát | desktop | h c c c | play | xem mục 5; sau khi tự đóng quảng cáo: 1–4 ✓ (6M qua chữ, chú giải thứ 3/5) | Sau can thiệp |
| 08 Cơ sở → (quảng cáo lúc ghi) → HNX → mã dòng 3 | desktop | c c c c | play | Lần Phát đầu báo nhầm "đang ở màn cuối của tour" (trang chưa vẽ xong); phát lại: 1 ✓, 2 bỏ qua sau ~2.8 s ✓, 3 ✓ (thứ 2/2), 4 ✓ | Có (sau 1 lần phát lại) |
| 09 /tcw: Đã lưu → ⋮ thẻ 2 → Xem chi tiết → 1Y → X | desktop | i c c c c | locate | 5/5 ✓ (⋮ thứ 2/4 — lỗi vòng 1 đã hết) | Có |
| 10 Ô tìm kiếm → gõ/xoá → Tra cứu lịch sử → Loại báo cáo → Giảm tiền | desktop | c n c c c | play | 5/5 ✓; bước 3 chỉ 76% và 'đang chờ' khi kết quả tìm còn lọc theo chữ đã gõ | Có |
| 11 iBond → 12-18 tháng → ⋮ dòng 2 → Thông tin TP → Tiếp tục (locate) | desktop | c c c c c | locate | 5/5 ✓ (option qua chữ «12-18 tháng»); không bấm Tiếp tục | Có |
| 12 Rê Cổ phiếu → Rút gọn → Xem thêm → Bộ lọc → 2 checkbox | desktop | h c c c c c | play + locate | 6/6 ✓ (checkbox thứ 2/5; checkbox nhãn mềm 100%) | Có |
| 13 Trang chủ → Đang theo dõi → ô chọn → tiêu đề (Alt) | desktop | c c i | play | 3/3 ✓; bước 2 đích dịch chỗ do scrollIntoView sau khi tô sáng | Có |
| 14 Công cụ → Báo cáo của tôi → mẫu 2 → mẫu 1 → quay lại | desktop | c c c c c | play | 5/5 ✓ (mẫu theo thứ tự 2/3, 1/3) | Có |
| 15 Avatar → Hệ thống → Hiển thị & Cài đặt → Thông báo → X | desktop | i c c c c | play | 1 **SAI** (anchor họ tên đã xoá → tô ô tìm kiếm, 100%), 2–5 ✓ | Không đúng |

Tổng 82 bước:
- 68 bước tìm đúng phần tử (ở lượt sạch hoặc sau khi người dùng tự mở drawer/panel);
- 3 bước bỏ qua đúng;
- 4 bước sai phần tử không tự hết (01-6, 02-2, 06-8, 15-1);
- 2 bước mơ hồ (an toàn);
- 4 bước bị bỏ qua sai (03-3, 03-4, 06-6, 06-7);
- 1 bước không thấy (03-1).

Ngoài ra có 4 lần tô sáng sai chỉ tạm thời: 03-2, 04-2, 05-2 (phần tử ngoài màn) và 01-3 khi phát lại từ giữa.

## 5. Ca quảng cáo

Quảng cáo giả: `.cdk-overlay-container > .cdk-global-overlay-wrapper > .cdk-overlay-pane > mat-dialog-container[aria-modal=true]
> app-promo-popup`, nút `Đóng quảng cáo`. `context().dialog` nhận đúng là `app-promo-popup`.

| Ca | Tour | Hành vi quan sát |
|---|---|---|
| Lúc ghi có, lúc phát không (đầu tour) | 01 | `play()` bắt đầu thẳng ở bước 2 trong < 0.6 s ("Bước 2/8: Bấm vào Bảng giá…"). Đạt. |
| Lúc ghi có, lúc phát không (giữa tour) | 08 | Sau bước 1: tooltip "Bước 2/4: đang chờ màn hình…" khoảng 1.4 s, rồi lookahead (1.5 s ổn định) nhảy sang bước 3. Tổng ~2.8 s. Đạt. |
| Lúc ghi không, lúc phát có (có sẵn khi bấm Phát) | 07 | Không bước nào cùng ngữ cảnh (dialog = app-promo-popup) → `goStart()`: phát Esc (popup không đóng), pushState '/home', sau ~3 s `location.assign('/home')` tải lại trang. Thư viện nạp tay thì mất; nạp lại thì RESUME tự phát từ bước 1 (vì sau tải lại không còn popup). Nếu quảng cáo thật hiện lại sau mỗi lần tải thì nhiều khả năng lặp/kẹt — chưa kiểm chứng. Không đạt. |
| Quảng cáo bật lên giữa một bước | 07 | Thư viện vẫn tô sáng 'Quỹ' nằm dưới lớp nền quảng cáo. Cú bấm vào nút Đóng của quảng cáo tới được `window` nhưng bị `gate()` chặn (`stopImmediatePropagation` ở document) → không đóng được, cũng không rê được vào đích. Phải bấm Dừng → đóng quảng cáo → Phát: chạy tiếp đúng bước 1. Không đạt. |

## 6. Lỗi còn lại, theo mức độ

### 6.1 [Cao] Cú bấm có tác dụng bị ghi thành `info`, lúc phát chính cú bấm đó bị chặn

- **Tái hiện**:
  - Mobile /tc-price → bấm "HOSE ▾" → bấm "VN30" trong danh sách → bước VN30 có `kind: "info"`.
  - Phát lại: bấm vào VN30 không có tác dụng, chỉ có nút Tiếp; Tiếp xong thì bước sau chờ mãi.
  - Tương tự với: tiêu đề cột 1Y Fundmart, dòng quỹ (mở hộp thoại), ô tìm kiếm trong drawer, mục "Nộp tiền", chuông thông báo,
    avatar, tab "LS GD Trái phiếu", tab "Đã lưu", "Xem thêm" trong drawer.
  - Tổng cộng 13 bước trong 9 tour.
- **Nguyên nhân**:
  - `commit()` (dòng 626) quyết định `info` ngay khi `!isClickable(el)`.
  - `isClickable` (dòng 636) chỉ xét SEMANTIC hoặc `cursor:pointer`, trong khi app gắn `(click)` trên div/span/tcbs-icon không có pointer.
  - `watchEffect` (dòng 632) chỉ chạy cho `kind === 'click'`, nên tác dụng thật (đổi màn, mở hộp thoại, đổi class) không bao giờ
    nâng bước lên `click`.
  - Lúc phát, `gate()` (dòng 684) chặn cú bấm vào đích khi `st.kind === 'info'`.
- **Gợi ý**: luôn chạy `watchEffect` cho cú bấm không có Alt, và chỉ hạ xuống `info` khi không có tác dụng. Bước `info` không nên
  chặn cú bấm vào chính đích.

### 6.2 [Cao] Phần tử trong drawer/panel đang đóng (ngoài màn) vẫn được coi là thấy và được tô sáng

- **Tái hiện**:
  - Mobile /home, phát tour 03 hoặc 04 → bước trong drawer Menu trả `ok`, rect x = −414 hoặc −631.
  - Tour 05: tab "Khác" của panel thông báo đang ẩn bên phải (x ≈ 1272/800).
  - `play()` còn chọn đúng bước này làm bước bắt đầu (`sure()` = ok).
- **Nguyên nhân**:
  - `visible` (dòng 30) chỉ xét `getClientRects().length`.
  - `reach()` (dòng 384) chỉ nhân hệ số xếp hạng cho 8 ứng viên đầu và không loại; nhánh `nth` (dòng 418–427) bỏ qua hoàn toàn `reach`.
  - `locate()` (dòng 921) trả rect ngoài màn.
- **Gợi ý**: phần tử có rect nằm hẳn ngoài viewport theo chiều ngang (hoặc trong khối `transform` đẩy ra ngoài) phải tính là
  không thấy, và `waitFind` tiếp tục chờ.

### 6.3 [Cao] Quảng cáo/popup lúc phát: kẹt hoặc tải lại trang

- **Tái hiện**: như mục 5, tour 07.
- **Nguyên nhân**:
  - `gate()` (dòng 681–687) chặn mọi cú bấm ngoài `target`, kể cả nút đóng của hộp thoại modal mới xuất hiện.
  - `show()` không theo dõi việc ngữ cảnh đổi (dialog mới) sau khi đã tô sáng.
  - `play()` (dòng 819–839), khi ngữ cảnh hiện tại không khớp bước nào, gọi `goStart()` (dòng 791–808): Esc rồi
    `location.assign` sau 3 s.
- **Gợi ý**: khi `topDialog()` xuất hiện và không thuộc tour thì tạm ngừng chặn (để người dùng đóng), báo "đóng hộp thoại để tiếp
  tục". Đừng tải lại trang chỉ vì đang có một modal lạ.

### 6.4 [Cao] `nth` lệch khi số bản sao thay đổi giữa lúc ghi và lúc phát

- **Tái hiện**:
  - (a) Bottom sheet Đầu tư: ghi "Quỹ" (nhóm 10, nth = 7), phát tô "Phái sinh" (nhóm 8).
  - (b) Panel thông báo: một thông báo đang mở rộng → 7 nút 'Xem thêm' sau đó lệch 1.
  - (c) Bảng giá: ô số không nhãn trả về ô đầu tiên của khối (mục 3).
  - (d) /home desktop: 4 phần tử nth lệch sau tải lại.
- **Nguyên nhân**:
  - Nhóm được dựng theo `sameKind` + `sig` (`kindGroup`, dòng 254–259), gồm cả bản sao ẩn/ngoài màn và phụ thuộc trạng thái.
  - Thứ tự tuyệt đối không kèm chặn trên/dưới nào (ví dụ chữ của mục).
  - Ở (c), `capture` lấy `nth` của khối ngoài (dòng 314), `find` chọn lớp trong bằng vòng `for` lấy cái đầu tiên (dòng 424–425).
  - Ở (a), cú bấm rơi vào icon không chữ nên fp không có nhãn — xem 6.7.
- **Gợi ý**:
  - lọc nhóm theo phần tử thật sự thấy (6.2);
  - lưu thêm chữ của mục làm phân xử phụ;
  - khi lớp trong không duy nhất thì trả `ambiguous`, không lấy cái đầu.

### 6.5 [Trung bình] Nhãn mềm và anchor là dữ liệu (kể cả dữ liệu cá nhân)

- **Tái hiện**:
  - Mã CK (BSR, AMC), mã quỹ (VCBFFIF) thành `soft` → mọi span cùng cột đều 1.00 → mơ hồ (215 trên bảng giá mobile, tour 01-5,
    02-4).
  - Mã 'AMC' có anchor 'ALT' (mã dòng trên).
  - Avatar có **anchor = họ tên khách hàng** (tour 15, đã xoá khỏi file).
- **Nguyên nhân**:
  - Nhãn mềm không phải tín hiệu mạnh (`hasStrong` dòng 381; `score` dòng 352 không trừ điểm khi vắng), nên dòng dữ liệu chỉ còn
    tag/comp/pos.
  - Bộ lọc anchor (dòng 264) chỉ loại chuỗi đã nghe được qua API. Thư viện nạp sau khi app gọi API (như trong test) thì họ tên
    và mã CK chưa nằm trong tập `api.set`. Sau đó `isApiValue('<họ tên>') === true`, nghĩa là nếu nạp trong `<head>` thì có thể đã lọc được.
- **Gợi ý**:
  - dòng dữ liệu nên ghi theo `nth` ngay cả khi có nhãn mềm;
  - không lấy anchor từ khối chứa avatar/tên tài khoản;
  - khi xuất tour, cảnh báo nếu anchor/label giống tên tài khoản.

### 6.6 [Trung bình] `play()` chọn sai bước bắt đầu và báo nhầm "màn cuối"

- **Tái hiện**:
  - (a) Tour 01: sau khi tự chọn VN30 rồi Phát lại → về bước 3 và tô một 'HOSE' khác ngoài màn phía trên (76%), thay vì bước 5.
  - (b) Tour 08: bấm Phát khi bảng giá chưa vẽ xong → "Bạn đang ở màn cuối của tour, bước cuối đã được thực hiện."
  - (c) Tour 05/03: drawer/panel đang mở mà vẫn bắt đầu ở bước 1.
- **Nguyên nhân**:
  - `stopPlay()` (dòng 698) xoá `resumeAt` nên bấm Dừng rồi Phát lại không còn nhớ bước.
  - Vòng `for` trong `play()` (dòng 827–831) lấy bước sớm nhất có đích `ok`.
  - Khi chưa bước nào `ok` và màn là màn của bước cuối (mọi bước cùng path) thì `endNotice()` (dòng 833–836), không chờ trang tải.

### 6.7 [Trung bình] Ghi sai gốc bấm hoặc gốc quá to

- **Tái hiện**:
  - Icon phễu trên bảng giá mobile → fp là cả thanh chọn sàn ('VN#').
  - Icon trong bottom sheet → div không chữ.
  - Triple-click vào ô tìm kiếm → 3 bước input trùng.
  - `dialogKey` của danh sách chọn sàn là 'tcbs-icon'.
  - Tour 15: avatar là div không nhãn, không icon.
- **Nguyên nhân**:
  - `clickableRoot` (dòng 204–218) leo khi cha có `cursor:pointer` và ≤ 1 con có chữ.
  - Chống lặp chỉ 80 ms (dòng 614).
  - `dialogKey` (dòng 170) lấy thẻ custom đầu tiên, kể cả `tcbs-icon`.

### 6.8 [Thấp] Giao diện dẫn

- **Tooltip** luôn đặt ở 12,12 lúc "đang chờ" (dòng 742), che đúng mục VN30 ở góc trên trái. Cú bấm vào mục đó trúng nút Dừng.
  Tooltip cạnh đích cũng che tab "Khác" của panel thông báo.
- **scrollIntoView sau khi tô sáng** (dòng 764) làm đích dịch chỗ ngay khi người dùng định bấm (tour 13).
- **Vị trí thanh ghi** lưu trong sessionStorage (`tourfp:pos`, dòng 505) dùng chung cho mobile và desktop: sau khi đổi layout,
  thanh ghi đè lên tab sổ lệnh desktop. Hai cú bấm của người test trúng "Dừng ghi" và "Xoá" — mất bản ghi.
- **Lời nhắc** cho phần tử không nhãn: "phần tử được tô sáng", "nút ở mục …", "d:…", "arrow_back", "Open calendar".

### 6.9 [Thấp] Phần tử chưa được vẽ

Khối dưới màn của /home mobile chỉ có trong DOM sau khi cuộn tới (lazy). Lúc phát, `waitFind` chờ mà không cuộn → "không tìm
thấy" cho tới khi người dùng tự cuộn.

### Đã sửa so với vòng 1 (đã kiểm chứng)

- Nút ⋮ SVG hình tròn có icon `g:`, chọn đúng theo thứ tự (tour 09).
- MUA bảng trái phiếu 11/11.
- Chữ số giữ nguyên: 1M/1Y/3Y/6M/12-18 tháng qua `exact` (tour 02, 07, 09, 11).
- mat-select không lấy giá trị làm nhãn (06, 10, 11, 13).
- Mơ hồ không tô sáng: tooltip "có nhiều phần tử giống … nên chưa xác định chắc được đích" sau ~8 s, và tiếp tục chờ; người dùng
  tự làm thì tour đi tiếp (02-4).
- Bước rê chuột ghi được (07, 12).
- Không thấy cú bấm nào bị bỏ sót khi ghi (trừ các cú bấm rơi vào lớp loading/khung đang animation).

## 7. Chưa kiểm chứng / giới hạn

- **Chưa thử**:
  - phân trang;
  - carousel (không tìm thấy điều khiển carousel bấm được trên các màn đã xem);
  - radio và toggle (toggle duy nhất gặp là cài đặt tài khoản — không chạm);
  - chế độ `direct`, `ask`;
  - phát tour trên tài khoản/ngày khác;
  - thiết bị cảm ứng thật (mobile là giả lập 700 px với chuột);
  - tìm mã CK trên mobile (ô tìm không trả kết quả mã).
- **Thời điểm nạp thư viện**: luôn nạp SAU khi app đã gọi API, nên bộ lọc giá trị API (nhãn mềm, anchor) hoạt động kém hơn khi
  nạp trong `<head>`. Mục 6.5 có thể nhẹ hơn trong triển khai thật.
- **Cuộn chuột** của công cụ không tác dụng trên khung cuộn của app; phải dùng `scrollTop` trong JS khi ghi tour 13.
- **Ảnh chụp màn hình** của pane có lúc đứng hình; vị trí bấm được tính từ DOM.
- **Thao tác phụ không mong muốn (không gây thay đổi)**:
  - một cú bấm nhầm làm focus vào ô "KL đặt" của thanh đặt lệnh mobile — không gõ gì, đã blur;
  - hai checkbox trong Bộ lọc cổ phiếu (bộ lọc tạm của màn hình, không lưu) đổi trạng thái do cú bấm rơi vào lớp loading — đã
    trả về như cũ;
  - bộ lọc tiểu khoản trên Tài sản đã chọn 'Thường' (bộ lọc xem, app tự trả về 'Tất cả' sau khi tải lại).
- **Rà dữ liệu cá nhân**:
  - Đã rà mọi trường fp trong `testdata/tours/*.json` bằng mắt và bằng biểu thức (họ tên, chuỗi ≥ 6 chữ số, email, số điện thoại);
    chỉ một chỗ (anchor họ tên, tour 15) — đã xoá.
  - Báo cáo này không chứa tên, số tài khoản, số dư, mã lệnh.
