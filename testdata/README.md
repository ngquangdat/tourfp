# Bộ dữ liệu test TourFP (vòng 2, cập nhật vòng 3)

15 luồng ghi trên tcinvest.tcbs.com.vn ngày 14/11/2026 bằng `tourfp.js` trong thư mục làm việc (chưa phát hành).

**Vòng 3:** tour 01, 05, 07, 08 được ghi lại bằng fp `v:4` (có `sub`, `loose`). Tour 07 đổi luồng sang khối Hiệu quả đầu tư, tour 08 giờ bắt đầu từ /home. Các tour còn lại vẫn là fp `v:3`: trong phiên vòng 3, một số file JS của app trả 403 (hộp thoại tìm kiếm, Fundmart, So sánh quỹ, Nộp tiền, hồ sơ; tải thẳng /tc-price, /my-asset), nên không ghi lại được 02, 03, 04, 06, 15. Mỗi file có ghi chú vòng 3 trong `notes`. Chi tiết ở `docs/danh-gia-nhan-dien-vong-3.md`.
Mỗi file trong `tours/` có dạng:

```json
{ "name": "...", "layout": "desktop|mobile", "start": "/đường-dẫn", "covers": [...], "recorded": "cách ghi",
  "steps": [ { "kind": "click|hover|input|info", "fp": {...}, "after": {...}, "note": "..." } ],
  "expect": ["kết quả mong đợi từng bước"], "observed": ["kết quả đo được khi phát lại"], "notes": "..." }
```

- `steps` lấy nguyên từ `TourFP.export()`, giữ **đủ** các trường. Vòng 2 đã bỏ các trường rỗng, và việc đó làm hỏng file: `sameKind` so `icon` chặt (thiếu `icon` ≠ `''`), còn `hasStrong` gọi `Object.keys(fp.key)`, nên bước `nth` không khớp hoặc `find` ném lỗi. Vòng 3 đã thêm lại các trường mặc định (`role, label, segs, soft, exact, mixed, dyn, cover, key, attr, icon, comp, anchor, anchorSkip, hint`) cho mọi bước. Khi tự sinh file, đừng lược trường.
- Ghi bằng `TourFP.record()` và cú bấm chuột thật. Ngoại lệ: các bước có `note: "Chỉ locate, KHÔNG bấm"` được dựng bằng `TourFP.capture()` vì là nút giao dịch, luôn đặt ở cuối tour.
- `expect` là hành vi đúng mong muốn; `observed` là hành vi thật của bản thư viện lúc test (có cả lỗi). Một bộ chạy kiểm thử nên so với `expect`.
- Quảng cáo trong các tour 01, 07, 08 là hộp thoại giả chèn bằng JS (`.cdk-overlay-container > .cdk-global-overlay-wrapper > mat-dialog-container[aria-modal=true] > app-promo-popup`, nút `button[aria-label="Đóng quảng cáo"]`). Muốn tái hiện cần chèn lại đúng cấu trúc đó.

## Danh sách luồng

| # | File | Layout | Bắt đầu | Số bước | Loại bước | Ghi chú chính |
|---|---|---|---|---|---|---|
| 01 | `01-m-quangcao-banggia-vn30.json` | mobile | /home | 5 (v4) | click, info, nth, loose, after, hộp thoại | Có quảng cáo lúc ghi; dropdown nhóm toàn màn; mã BSR (loose); bỏ bước bộ lọc |
| 02 | `02-m-dautu-bottomsheet-quy.json` | mobile | /home | 7 | click, info, nth, after, hộp thoại | Bottom sheet Đầu tư; kỳ 1Y/3Y (exact); dòng quỹ; Đặt mua chỉ locate |
| 03 | `03-m-menu-timkiem-noptien.json` | mobile | /home | 8 | click, input, info, nth, after, hộp thoại | Drawer Menu, ô tìm kiếm, màn Nộp tiền (chỉ xem), accordion |
| 04 | `04-m-menu-xemthem-ipower.json` | mobile | /home | 4 | info, click, nth | Drawer đã mở; Xem thêm; iPower; NỘP TIỀN chỉ locate |
| 05 | `05-m-thongbao-tab-xemthem.json` | mobile | /home | 4 (v4) | click, nth | Panel thông báo trượt; tab; 'Xem thêm' của thông báo thứ 2 |
| 06 | `06-m-taisan-tieukhoan-lichsu-lich.json` | mobile | /my-asset | 9 | click, info, nth, after, hộp thoại | mat-select, option trùng tên, datepicker |
| 07 | `07-d-hover-quy-sosanh-quangcao-luc-phat.json` | desktop | /home | 4 (v4) | click, nth, exact | Khối Hiệu quả đầu tư: Phái sinh → Cơ sở → 3M → 1Y; quảng cáo lúc phát và giữa bước |
| 08 | `08-d-banggia-quangcao-giua-tour.json` | desktop | /home | 5 (v4) | hover, click, info, nth, after, hộp thoại | Rê Cổ phiếu → Bảng giá; quảng cáo giữa tour lúc ghi, lúc phát tự bỏ qua; HNX; AMC |
| 09 | `09-d-tcw-menu-bacham-chitiet.json` | desktop | /tcw | 5 | info, click, nth, after, hộp thoại | Nút ⋮ (SVG hình tròn) theo thứ tự; ca lỗi vòng 1 |
| 10 | `10-d-timkiem-tracuu-loaibaocao.json` | desktop | /tcw | 5 | click, input, after | Ô tìm kiếm thanh trên → Tra cứu lịch sử → mat-select |
| 11 | `11-d-traiphieu-loc-menu-dong-tieptuc.json` | desktop | /bond-v2 | 5 | click, nth, after, hộp thoại | Option có số (12-18 tháng); ⋮ dòng 2; wizard, Tiếp tục chỉ locate |
| 12 | `12-d-hover-rutgon-xemthem-boloc-checkbox.json` | desktop | /bond-v2 | 6 | hover, click, nth, after, hộp thoại | Rút gọn/Xem thêm trong menu rê chuột; checkbox |
| 13 | `13-d-trangchu-khuyennghi-cuon.json` | desktop | /home | 3 | click, info | Khối phải cuộn; mat-select; Alt+bấm |
| 14 | `14-d-congcu-baocao-cuatoi.json` | desktop | /home | 5 | click, nth, after, hộp thoại | Panel Công cụ; danh sách mẫu báo cáo theo thứ tự |
| 15 | `15-d-avatar-hoso-caidat.json` | desktop | /home | 5 | info, click, after, hộp thoại | Hồ sơ/cài đặt (chỉ xem); anchor họ tên đã xoá |

## Bảng phủ thao tác

| Thao tác / phần tử | Luồng |
|---|---|
| click | tất cả |
| hover (menu rê chuột) | 08, 12 |
| input (ô nhập) | 03, 10 |
| info (Tiếp/Kết thúc, gồm Alt+bấm) | 01–06, 09, 13, 15 |
| bước có `after` đổi màn/đổi hộp thoại | 01–03, 06, 07, 09–12, 14, 15 |
| bước trong hộp thoại | 01, 02, 03, 06, 07, 09, 10, 11, 12, 14, 15 |
| bước theo thứ tự (`nth`) | 01, 02, 03, 04, 05, 06, 07, 08, 09, 11, 12, 14 |
| phần tử phải cuộn / trong khung cuộn | 02, 04, 11, 13 |
| tab | 01, 05, 06, 08, 09, 13 |
| mat-select / dropdown / option | 01, 06, 10, 11, 13 |
| checkbox | 12 (radio/toggle: không — xem báo cáo) |
| menu bấm (⋮, panel) | 09, 11, 14, 15 |
| bottom sheet | 02 |
| drawer mobile | 03, 04 |
| accordion "Xem thêm"/"Rút gọn" | 03, 04, 05, 12 |
| dòng danh sách/bảng do API sinh | 01, 02, 08, 11, 14 |
| nút chỉ có icon | 01, 05, 06, 09, 11, 14, 15 |
| nhãn có chữ số (`exact`) | 01, 02, 07, 09, 11 |
| quảng cáo lúc ghi / lúc phát / giữa tour | 01 / 07 / 08 |
| nút giao dịch chỉ locate (bước cuối) | 02, 04, 11 |
| ≥3 tour mobile | 01–06 |

Không có trong bộ: phân trang, carousel, radio, toggle (xem `docs/danh-gia-nhan-dien-vong-2.md`, mục "Chưa kiểm chứng").

## Nhập vào máy chủ admin

```sh
for f in testdata/tours/*.json; do
  python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(json.dumps({"name": d["name"], "description": d.get("notes","")[:500], "steps": d["steps"]}, ensure_ascii=False))' "$f" \
  | curl -s -X POST http://127.0.0.1:8000/api/tours -H 'Content-Type: application/json' --data-binary @-
done
```

## Kết quả phát lại vòng 3 (fp v4)

| Tour | Kết quả |
|---|---|
| 01 | Chạy hết, không can thiệp (vòng 2: kẹt ở VN30) |
| 05 | Chạy hết, không can thiệp (vòng 2: kẹt ở chuông, tô bản ngoài màn) |
| 07 | Chạy hết; cả 2 ca quảng cáo (lúc phát, giữa bước 2) tự chờ rồi tự tiếp tục |
| 08 | Chạy hết; bước quảng cáo tự bỏ qua; HNX đúng tab sàn |
| 12, 13, 14 (v3) | Chỉ kiểm `find` các bước trên /home: đúng 100% |
| 15 (v3) | Bước avatar trỏ vào cả khối thanh trên (xem `notes`) |

## Rà dữ liệu cá nhân

Đã rà mọi trường của mọi `fp` (`label`, `segs`, `soft`, `exact`, `anchor`, `attr`, `key`, `hint`) bằng mắt và bằng biểu thức tìm tên, số tài khoản (chuỗi ≥ 6 chữ số), email, số điện thoại. Kết quả: một chỗ — `anchor` bước 1 của tour 15 là họ tên khách hàng — đã xoá (`"anchor": ""`). Không có số dư, mã lệnh, số tài khoản. Mã cổ phiếu/trái phiếu/quỹ (BSR, AMC, VCBFFIF…) là dữ liệu thị trường công khai, được giữ.

Vòng 3: rà lại toàn bộ file bằng cùng biểu thức — không có họ tên, số tài khoản, email, số điện thoại, số dư, mã lệnh. Lưu ý: `scrub()` của thư viện KHÔNG tự xoá được anchor họ tên ở thanh trên nếu phản hồi API hồ sơ đến trước khi thư viện được nạp, nên vẫn phải rà tay trước khi commit.
