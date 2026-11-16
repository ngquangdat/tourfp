# Ghi lại lượt chạy tour của khách

Đã duyệt ngày 2026-11-16. Mỗi lần khách chạy một tour (dẫn từng bước hoặc vào thẳng) là một **lượt chạy**, thư viện gửi về
máy chủ quản trị khi lượt kết thúc: bản thư viện, bản build của app, từng bước tới đâu, kẹt ở bước nào và vì sao.

Quyết định:
- Ghi cả lượt thành công lẫn lượt lỗi (để tính tỷ lệ kẹt theo bản build).
- Ẩn danh: không nhận diện khách, không ghi chữ trên trang, không ghi query string.
- Không ghi câu hỏi gửi trợ lý (`ask`).
- Giữ 90 ngày (`TOURFP_RUNS_DAYS`).
- Trang quản trị: thanh trên cùng có menu luôn hiện (Danh sách tour · Kiểm thử tự động · Lượt chạy), đang ở màn nào thì sáng nút đó.

## Một lượt chạy

| Nhóm | Trường |
|---|---|
| Định danh | `id` (thư viện sinh), `tour_id` (khi chạy bằng `run(id)`), `tour_name`, `tour_hash` (băm các bước, nhận ra tour khi app `load()` thẳng) |
| Phiên bản | `lib` (`TourFP.version`), `app` (`build`, `builtAt`, `version`, `ng` từ `appVersion()`) |
| Môi trường | `layout`, cỡ cửa sổ, trình duyệt + hệ điều hành rút gọn, đường dẫn bắt đầu (pathname) |
| Lượt | `mode` guide/direct, `to`, `started_at`, `finished_at`, `status`, `failed_step` |
| Từng bước | thứ tự, loại, tên, kết quả, thời gian chờ, điểm khớp, cách tìm thấy, cờ danh sách đổi số lượng, màn đang đứng |

`status`: `done` · `stopped` (khách bấm Dừng) · `stuck` (vào thẳng không tới được) · `waiting` (dẫn từng bước chờ quá 30 s)
· `wrong-layout` · `left` (rời trang giữa chừng, gửi bằng sendBeacon) · `error`.

## Máy chủ
- Bảng `tour_runs`; `POST /api/runs` mở cho khách (giới hạn tần suất như `/api/assist`, thân ≤ 32 KB, ghi đè theo `id`).
- `GET /api/runs` (lọc tour, build, trạng thái, ngày), `GET /api/runs/{id}`, `GET /api/runs/summary` (tour × build × trạng thái, bước kẹt nhiều nhất) — cần mật khẩu.

## Thư viện
- Gom `trace` trong lượt; gửi một lần khi kết thúc, hoặc ở `pagehide` với `status: left`.
- Tắt bằng `window.TOURFP_LOG = false`. Không ghi khi ghi tour hay chạy thử từ trang quản trị.
- Bắn `tourfp:run` để app ghi log riêng nếu muốn.

## Trang quản trị
- Màn «Lượt chạy» (`#runs`): dòng trạng thái, khối lọc, danh sách mở chi tiết từng bước, khối «Lỗi theo bước».
