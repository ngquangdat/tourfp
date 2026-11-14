# Đánh giá độ nhận diện của TourFP 0.3.1 trên tcinvest.tcbs.com.vn

Ngày 14/11/2026. Người thực hiện: một sub-agent (Claude Opus 5.5) ghi và phát lại tour bằng cú bấm thật trong trình duyệt đã đăng nhập.
Không bấm nút giao dịch nào. Các dòng số trong mã nguồn ứng với `tourfp.js` bản 0.3.1.

## 1. Kết luận

TourFP nhận diện đúng phần lớn các phần tử có nhãn chữ cố định: mục menu, tab, nút có chữ, mục trong hộp thoại, ô tìm kiếm.
Các tour điều hướng, hover menu, hộp thoại và mở rộng/thu gọn đều chạy hết khi phát lại. Thư viện tự bỏ qua đúng những bước
mà màn hình đã ở sẵn trạng thái đó.

Thư viện không đáng tin ở bốn nhóm:

- **Phần tử lặp theo dữ liệu**: dòng bảng, nút ⋮ của từng thẻ, nút MUA.
- **Nhãn bị mất**:
  - nhãn có chữ số như 1M/3M/1Y bị lọc mất;
  - nhãn cố định nhưng cũng xuất hiện trong JSON của API cũng bị lọc mất (MUA, Kỹ thuật, Tăng trưởng…).
- **Bản sao ẩn ngoài màn hình** trên mobile.
- **Thứ tự `nth` lệch** giữa lúc ghi và lúc phát.

Ở các nhóm này, `find` thường trả "ok" hoặc "ambiguous" nhưng chỉ vào **sai phần tử**. Khi phát lại, thư viện vẫn tô sáng và
chặn mọi cú bấm khác. Kết quả là người dùng bị dẫn sai, hoặc tour kẹt.

Ngoài ra, lúc ghi có 6 cú bấm thật không được ghi lại. Chưa xác định được nguyên nhân.

## 2. Quét dấu vân tay (không bấm)

Số liệu mỗi ô theo dạng: ok-đúng / **ok-SAI** / mơ hồ (số lần chọn đầu đúng) / không thấy. Cột ms là trung bình/tối đa của `find`.

| Màn / trạng thái | Layout | Số phần tử | Nguyên vẹn | Bỏ tag, pos, role | Bỏ label, segs | Bỏ comp, pos | Bỏ anchor | ms (nguyên vẹn / bỏ tag / bỏ label / bỏ comp / bỏ anchor) |
|---|---|---|---|---|---|---|---|---|
| /home | desktop | 212 | 201/0/11(3)/0 | 203/0/9(1)/0 | 190/**1**/21(11)/0 | 197/0/15(1)/0 | 183/0/29(6)/0 | 7.9/54 · 23.7/86.6 · 13.2/53.5 · 7.4/47.3 · 6.9/27 |
| /home + hover menu Cổ phiếu (cả trang) | desktop | 213 | 202/0/11(3)/0 | 204/0/9(1)/0 | 191/**1**/21(11)/0 | 197/0/16(2)/0 | 184/0/29(6)/0 | 7.5/50.6 · 24.3/86.9 · 13.2/66.7 · 7.3/48.6 · 6.5/16.9 |
| Chỉ các mục trong hover menu (*) | desktop | 7 | 7/0/0/0 | 7/0/0/0 | 7/0/0/0 | 7/0/0/0 | 7/0/0/0 | 8/12.7 · 21.4/27.5 · 6.8/18.5 · 8.5/14.3 · 7.2/10.5 |
| /tc-price/trade-station (bảng giá, sổ lệnh) | desktop | 201 | 151/0/50(2)/0 | 134/0/67(8)/0 | 146/**2**/53(4)/0 | 142/**1**/58(48)/0 | 141/0/60(3)/0 | 8.2/29.9 · 17.6/47.8 · 10.1/30.2 · 7.7/37.1 · 6.4/12.8 |
| /tcw, hộp thoại chi tiết kế hoạch | desktop | 59 | 52/**6**/1(1)/0 | 45/**6**/8(1)/0 | 49/**6**/4(4)/0 | 50/0/9(1)/0 | 51/**6**/2(1)/0 | 2.0/5.2 · 4.0/15.5 · 2.4/4.7 · 1.8/3.9 · 1.4/2.5 |
| Hộp thoại "Bộ lọc" cổ phiếu (có bảng) | desktop | 120 | 99/**6**/15(4)/0 | 91/**6**/23(4)/0 | 56/**35**/29(15)/0 | 97/**1**/22(6)/0 | 98/**4**/18(2)/0 | 2.2/17.4 · 4.9/11.6 · 2.3/6.5 · 1.9/7.5 · 1.5/3.2 |
| /bond-v2 (bảng trái phiếu) | desktop | 139 | 122/0/17(2)/0 | 116/0/23(1)/0 | 119/**1**/19(3)/0 | 121/0/18(1)/0 | 111/0/28(4)/0 | 3.5/11.4 · 12.4/50.7 · 3.2/12.5 · 3.3/9.2 · 2.8/11.1 |
| /home | mobile | 23 | 23/0/0/0 | 23/0/0/0 | 23/0/0/0 | 23/0/0/0 | 21/0/2(0)/0 | 3.7/12.2 · 7.6/13.8 · 4.5/14.2 · 3.0/9.5 · 2.3/7.1 |
| /my-asset | mobile | 20 | 20/0/0/0 | 20/0/0/0 | 19/**1**/0/0 | 20/0/0/0 | 20/0/0/0 | 2.7/11.8 · 5.7/17.2 · 3.8/11.8 · 2.3/9.0 · 2.0/5.4 |
| /global-markets (bảng) | mobile | 12 | 12/0/0/0 | 12/0/0/0 | 12/0/0/0 | 12/0/0/0 | 12/0/0/0 | 2.7/26.4 · 10.7/15.2 · 0.5/3.0 · 1.0/8.9 · 1.3/12.5 |

(*) `TourFP.clickables()` gom cả menu thành **1 phần tử**, vì khung menu có `cursor:pointer`. Các mục được liệt kê lại theo
logic của `clickableRoot`. Vì cùng lý do, số phần tử ở các dòng khác (nhất là mobile) thấp hơn thực tế.

Trường hợp riêng: 11 nút **MUA** trên /bond-v2 (chỉ `capture`/`find`, không bấm). 5 nút đúng, 6 nút mơ hồ. Trên toàn màn
/bond-v2, chỉ 2/17 lần mơ hồ có lựa chọn đầu đúng.

## 3. Các tour

| Tour | Layout | Các bước (loại: đích) | Kết quả phát lại theo bước | Chạy hết? |
|---|---|---|---|---|
| T1 | desktop | hover: Cổ phiếu → click: "Bảng giá cổ phiếu" (nth) → click: tab "Điều kiện" → click: dòng mã "AAN" | Lượt bắt đầu giữa tour (từ trade-station): bắt đầu đúng ở bước 3. Bước 4 lúc đầu "not-found" do danh sách chưa tải, sau đó đúng. Lượt đầy đủ từ /home: 4/4 đúng. | Có (cả 2 lượt) |
| T2 | desktop | click: tab Nháp / Đang thực hiện / Đã lưu → click: ⋮ thẻ kế hoạch thứ 2 (icon SVG) → click: "Xem chi tiết" (mở hộp thoại) → click: "1Y" (trong hộp thoại) → click: thu gọn "Lợi nhuận dự kiến" → info: "Danh mục được chọn". Cú bấm X đóng hộp thoại **không được ghi**. | Bước 1–3 đúng. **Bước 4 sai phần tử**: "ambiguous", khớp 100%, tô sáng icon ✓ "Của tôi". Bước 5 chờ 8 s rồi báo "không tìm thấy" và không thử lại dù menu mở sau đó. Bấm `play()` lại thì quay về bước 1 dù menu đang mở. Mở hộp thoại tay rồi `play()`: bắt đầu đúng ở bước 6; bước 6–8 đúng. | Không (lượt 1); có khi tiếp tục từ hộp thoại |
| T3 | desktop | click: mat-select Kịch bản → click: mat-option "Tích cực" → input: ô "Tìm kế hoạch" → click: icon phễu → click: chip Hưu trí, Cần điều chỉnh, "Tất cả" (twins=2, phân biệt bằng tiêu đề nhóm) → click: icon Close → click: "Thêm kế hoạch" (hộp thoại) → click: "Cho người khác" → input: radio Nữ → click: icon X → click: "THOÁT" (huỷ bản nháp chưa lưu) | 13/13 đúng. Phát lại khi select đang hiện "Tích cực": vẫn tìm đúng nhưng chỉ khớp **67%**, lời nhắc vẫn ghi "Cơ bản". | Có |
| T4 | desktop | hover: Cổ phiếu → click: "Xem thêm" → click: "Bộ lọc" (phải cuộn trong menu; mở hộp thoại) → click: tab "Kỹ thuật" → click: li "Tăng trưởng" → click: mat-icon close (nth) | Bước 2 tự bỏ qua vì app nhớ menu đã mở rộng. Bước 3 tự cuộn trong menu, đúng. Bước 4–6 đúng, nhưng 2 bước tab/li mất nhãn nên lời nhắc chỉ ghi "button"/"li". | Có |
| T5 | desktop | hover: Trái phiếu → click: "Giao dịch trái phiếu iBond" (→ /bond-v2) → click: tab "Dòng tiền" | Bắt đầu từ /tcw (không có trong tour): tự về /home bằng điều hướng SPA, 3/3 đúng. Chế độ `direct` từ /tcw: tự vào /bond-v2 và bấm "Dòng tiền", báo "Đã đưa bạn tới nơi" sau khoảng 1 s. | Có (guide và direct) |
| T6 | mobile | click: "Tài sản" ở thanh dưới (nth) → click: tab Trái phiếu (role=tab) → click: menuitem "Tiết kiệm TCB" → click: nút mở dropdown (nhãn ghi được là "Tiết kiệm TCB") → click: menuitem iXu. Cú bấm mở dropdown "Khác" lần đầu **không được ghi**. | Từ /home: **bước 1 sai**, tô sáng bản sao thanh dưới nằm ngoài màn (x=-280), "thứ 2/4", khớp 72% → kẹt. Bắt đầu giữa tour từ /my-asset: bước 2 đúng. Bước 3 không có (menu chưa mở) nên sau khoảng 1.5 s nhảy sang bước 4, khớp nút "Khác" ở **61%** (đúng phần tử). Bước 5 đúng, 93%. | Không (từ đầu); có (từ giữa) |
| T7 | mobile | click: "Menu" thanh dưới (nth) → info: chip "Tiện ích" (thực ra cú bấm có cuộn trang) → info: tiêu đề "Tiện ích" → info bằng Alt+click: mục "Thị trường" → click: "Xem thêm" (twins 8, có anchor) → click: "Thị trường" (→ /global-markets) | Tải mới: **bước 1 sai** (Menu ngoài màn, x=-80, "thứ 2/4") → kẹt. Khi drawer đã mở, `play()` vẫn bắt đầu từ bước 1 nhưng lúc này chọn đúng. Bước 2–4 đúng, bước 5 tự bỏ qua (đã mở rộng), bước 6 đúng. | Không (lượt 1); có (lượt 2) |
| T8 | mobile | click: thanh tìm kiếm (đích bị leo thành cả `app-toolbar`) → input: ô "Tìm tính năng, mã CK..." → click: kết quả "Bảng giá Fundmart" (→ /new-fund) | Bước 1 khớp 100% nhưng `app-toolbar` có kích thước 0 nên **không thấy vùng tô sáng**; lời nhắc che đúng ô tìm kiếm, bấm xuyên qua vẫn được. Bước 2 đúng (qua hint). Bước 3 đúng 93% dù vị trí đổi. | Có |

## 4. Theo loại thao tác

1. **Điều hướng (sidebar/thanh dưới/menu): chạy được trên desktop, lỗi ở thanh dưới mobile.** T1, T5, T7 bước 6 đúng. Nút Tài sản/Menu ở thanh dưới mobile chọn trúng bản sao ngoài màn (T6, T7).
2. **Hover menu → mục: chạy được.** T1, T4, T5 đúng; bước hover tự sang bước sau khi menu hiện.
3. **Chuyển tab: chạy được.** T1 Điều kiện, T2, T4 Kỹ thuật, T5 Dòng tiền, T6 Trái phiếu đều đúng.
4. **Dropdown/select: chạy được nhưng mong manh.** mat-select/mat-option đúng (T3). Nút mở dropdown có nhãn đổi theo giá trị đang chọn, nên điểm tụt xuống 0.67 và 0.61, sát ngưỡng 0.6. Có một lần cú bấm mở mat-menu không được ghi.
5. **Mở rộng/thu gọn: chạy được.** Thu gọn accordion (T2), "Xem thêm" (T4, T7) đúng; bước tự bỏ qua khi đã mở rộng sẵn.
6. **Hộp thoại: chạy được.** Nhận đúng `ctx.dialog`, bắt đầu giữa tour trong hộp thoại đúng (T2, T3, T4). Drawer bộ lọc trượt ra không được coi là hộp thoại (`dialog` rỗng); không gây lỗi.
7. **Mục trong danh sách/bảng: lỗi.** Nút ⋮ thẻ kế hoạch sai (T2). Các quét có 6 + 6 lần "ok nhưng sai" đi qua `nth`. MUA mơ hồ 6/11. Dòng mã "AAN" (T1) chỉ đúng vì nhãn là chính mã cổ phiếu.
8. **Nút chỉ có icon: chạy được với icon có tên hoặc có `path`, lỗi với SVG chỉ có `circle`.** Close/close/X/phễu đúng (T3, T4); ⋮ toàn `circle` nên `icon=''` → sai.
9. **Phần tử không bấm được → info: chạy được.** "Danh mục được chọn" thành info, nút Tiếp/Kết thúc hoạt động; Alt+click ghi info và chặn chuyển trang. Một cú bấm chỉ làm cuộn trang (chip mobile) bị hạ nhầm thành info.
10. **Ô nhập (search): chạy được.** T3 và T8 đúng. Radio cũng bị ghi là `input`, nên người dùng phải bấm Tiếp.
11. **Cuộn trong khung cuộn: chạy được.** Mục "Bộ lọc" trong menu dài (T4), "1Y" trong thân hộp thoại (T2), mục trong drawer mobile (T7): `scrollIntoView` đưa vào tầm nhìn và chọn đúng.
12. **Mục trong drawer mobile: phần lớn chạy được.** Các mục bên trong drawer đúng; riêng bước mở drawer ("Menu") sai khi trang vừa tải.

Các kiểm tra bổ sung:

- **Bắt đầu giữa tour:** đúng ở T1, T2 (hộp thoại), T6. Sai khi đích của một bước trước vẫn còn hiện: T2 và T7 quay về bước 1.
- **Bắt đầu ngoài tour:** đúng (T5 tự về /home).
- **`direct`:** đúng (T5).
- **Phát lại khi trạng thái đã đổi:**
  - menu đã mở rộng: bỏ qua đúng (T4, T7);
  - select đổi giá trị: vẫn đúng phần tử nhưng điểm thấp;
  - vị trí cuộn khác: vẫn đúng.

## 5. Lỗi và chọn sai, theo mức nghiêm trọng

1. **Bộ lọc "giá trị API" xoá cả nhãn cố định.** `isApiValue` (dòng 65–70) so khớp chính xác và cả chuỗi con với mọi chuỗi trong mọi JSON. Khi đó `capture` (dòng 237–240) bỏ nhãn, nên:
   - nút MUA trên /bond-v2 có `label=''`, `twins=0`, anchor là mã trái phiếu đã bỏ số ("Trái phiếu: VHM", trùng giữa nhiều dòng) → mơ hồ hoặc chọn sai dòng. Nếu một tour có bước MUA, người dùng có thể bị dẫn tới nút MUA của **dòng khác**;
   - "% Mua CĐ (%)" trả "ok" nhưng là phần tử khác, điểm 1.00;
   - tab "Kỹ thuật" và "Tăng trưởng" mất nhãn.

   Đã kiểm tra: tập giá trị API có chứa "mua", "kỹ thuật", "tăng trưởng", "% mua cđ".
2. **Thứ tự `nth` lệch giữa lúc ghi và lúc phát.**
   - Lúc ghi, `twinsOf` (dòng 215–225) loại cha/con của chính đích và yêu cầu `labelScore ≥ 0.9`.
   - Lúc phát, nhánh `nth` của `find` (dòng 394–399) lấy mọi ứng viên có điểm ≥ 0.6 và cùng `sig`. Nhóm này gồm cả các khung bọc lồng nhau và bản sao ngoài màn. Nhánh này cũng bỏ qua `reach()`, còn `visible()` chỉ xét `getClientRects` (dòng 30).

   Hậu quả:
   - 6 "ok nhưng sai" trong hộp thoại kế hoạch (nhãn cột "… tr");
   - 4 trong hộp thoại Bộ lọc ("% EPS 1 năm" thành "% DT 1 năm");
   - Tài sản/Menu ở thanh dưới mobile chọn bản sao ngoài màn → tour kẹt (T6, T7).
3. **Kết quả "ambiguous" vẫn được dùng để dẫn.** `show()` (dòng 655–666) tô sáng `r.el` bất kể trạng thái, chỉ thêm "⚠ mơ hồ"; `gate()` chặn mọi cú bấm khác. Ví dụ: T2 bước 4 tô sáng icon ✓ thay vì ⋮.
4. **Nhãn có chữ số bị mất.**
   - `pieces`/`stripNum` bỏ chữ số và các mẩu dưới 2 ký tự, nên 1M/3M/6M/1Y không còn nhãn: trên /home có 11 lần mơ hồ, 8 lần chọn đầu sai (đều chọn 1M). Khi các nút cùng một cha thì `pos` cứu được (T2 "1Y" đúng).
   - "% EPS 1 năm" và "% EPS 5 năm" thành bản sao của nhau.
   - Nhãn bỏ số còn làm anchor trùng nhau, ví dụ "Gia tăng tài sản -" khi ngày bị xoá.
5. **`iconOf` chỉ đọc `use`/`path`** (dòng 108–110). Icon SVG chỉ gồm `circle` (⋮) có `icon=''`, nên mọi `tcbs-icon` trong thẻ đều khớp 100%.
6. **Ghi sót cú bấm.** 6 trong khoảng 45 cú bấm thật không thành bước: chevron accordion, X hộp thoại (lần đầu), 2 cú bấm trong drawer bộ lọc, "Cho chính bạn", nút "Khác" mở mat-menu. Các cú bấm đó vẫn có tác dụng trên app. Console không có lỗi từ thư viện, và bấm lại cùng phần tử thì có lúc ghi được. **Nguyên nhân chưa xác định.** Hậu quả: thiếu bước nên tour chờ mãi (T6 được cứu nhờ cơ chế nhảy bước).
7. **Không thử lại sau khi hết giờ chờ.** `waitFind` chờ 8 s rồi dừng ở "không tìm thấy" dù đích xuất hiện sau đó (T2 bước 5). Khi `play()` lại, `play`/`startIndex` (dòng 679–688, 724–729) chọn bước **sớm nhất** tìm thấy trong cùng màn, nên quay lại bước 1.
8. **Nhãn phụ thuộc trạng thái.** mat-select và nút mở mat-menu lấy giá trị đang chọn làm nhãn → điểm 0.67 và 0.61, và lời nhắc hiển thị sai chữ.
9. **`clickableRoot` leo quá cao.** Ô tìm kiếm mobile thành `app-toolbar` có kích thước 0, nên không có vùng tô sáng (T8). `clickables()` gom cả menu hoặc trang thành vài phần tử (dòng 411–413), làm số liệu quét thấp hơn thực tế.
10. **Thuộc tính `name` sinh tự động** như "mat-radio-group-0" được lưu làm khoá (KEY), vì bộ lọc chỉ loại giá trị có từ 3 chữ số. Lần này đúng do bộ đếm trùng; sẽ lệch ở phiên khác.
11. **Phân loại sai và lời nhắc kém.**
    - Cú bấm chỉ gây cuộn trang bị hạ thành info, vì `watchEffect` không theo dõi cuộn.
    - Lời nhắc khi không có nhãn: "Bấm vào d:1xgdtqw", "button", "li", "div", "Nhập vào ô mat-radio-group-0".
12. **Anchor lấy từ dữ liệu.** Tên kế hoạch, mã trái phiếu, mã cổ phiếu dòng trên ("AAM") bị dùng làm anchor; thứ tự dữ liệu đổi là chọn sai.

Hiệu năng: `find` trung bình 1.4–24 ms, tối đa 86.9 ms (bỏ `tag` trên /home, vì phải quét `*`). Không có trường hợp nào quá chậm.

## 6. Chưa kiểm tra được và lý do

- **Không bấm bất kỳ nút giao dịch hay đồng ý nào:** MUA, BÁN, Đặt lệnh, Lập kế hoạch, Lưu bộ lọc, Áp dụng, "ĐỒNG Ý" (màn Tiết kiệm TCB), Chép JSON. Vì vậy không có tour nào chứa bước giao dịch; rủi ro chọn nhầm nút MUA chỉ được đo bằng `find`.
- **Bấm dòng mã trong Trade Station** có làm URL thêm `mode=placing&price=…`, nhưng không đặt lệnh nào.
- **Mobile chỉ giả lập** độ rộng 700 px với cú bấm chuột; chưa thử thiết bị thật hay sự kiện chạm.
- **Chưa thử:**
  - `start({to:n})`;
  - chế độ `direct` cho tour phải rê chuột (`hoverOn` tổng hợp), vì T5 đi thẳng bằng URL;
  - phát tour desktop trên layout mobile;
  - dropdown cài đặt tài khoản (cố ý tránh).
- **Popup "walkthrough" của app** không xuất hiện trong phiên này.
- **Thư viện được nạp sau khi app đã gọi API**, nên bộ lọc giá trị API không thấy các phản hồi đầu tiên. Ví dụ "AAN" vẫn được giữ làm nhãn. Nếu nạp trong `<head>`, các mã cổ phiếu sẽ bị lọc và dòng bảng sẽ phải dựa vào `nth` (mục 5.2) — điều này chưa đo.
- **Nguyên nhân ghi sót cú bấm** (mục 5.6) chưa xác định.
