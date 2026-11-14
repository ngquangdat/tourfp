# Kế hoạch kiểm thử tự động hằng ngày các tour TourFP bằng Playwright

Trạng thái: bản kế hoạch, chưa sửa file nào. Dựa trên mã hiện có ở `server/main.py`, `server/runner.py`, `server/static/index.html`, `tourfp.js`, `README.md` và `docs/danh-gia-nhan-dien-0.3.1.md`.

Ghi chú hiện trạng lúc lập kế hoạch:
- `testdata/` đang được tạo song song; kế hoạch giả định định dạng `name, layout, start, covers, steps, expect, notes`.
- `server/runner.py`, `docs/`, `scripts/` chưa được commit, nên CI chỉ chạy được sau khi commit.
- Repo chưa có `.github/`.

## 1. Kiến trúc

**Chọn: giữ runner Python hiện tại, không thêm `@playwright/test` (Node).**

| | Giữ Python (chọn) | Thêm @playwright/test |
|---|---|---|
| An toàn | Một nơi duy nhất giữ `RISKY`/`test_to` | Phải viết lại và giữ đồng bộ hai bản luật an toàn |
| Tích hợp | Dùng luôn SQLite, bộ hẹn giờ, trang admin, profile đăng nhập | Thêm toolchain Node và cầu nối kết quả về server |
| Mất gì | Không có HTML reporter, retry, UI mode dựng sẵn | Có sẵn các thứ đó |

Phần mất được bù bằng `context.tracing` của Playwright Python (xem bằng `playwright show-trace`), retry tự viết khoảng 30 dòng, và báo cáo trên trang admin.

**Ba tầng kiểm thử**

| Tầng | Kiểm gì | Cần TCInvest? | Chạy ở đâu, khi nào |
|---|---|---|---|
| T0 tĩnh | Schema của `testdata/tours`, `default_test_to`, luật RISKY, hàm phân loại nguyên nhân | Không, không cần trình duyệt | GitHub Actions, mỗi commit |
| T1 fixture | Thư viện trên trang mô phỏng DOM, có đáp án đúng | Không | GitHub Actions mỗi commit và hằng ngày; cũng chạy trong lần chạy hằng ngày của server |
| T2 tour thật | Tour trong DB và `testdata/tours` trên môi trường được phép | Có: UAT/staging qua `TOURFP_TARGET`, hoặc production sau khi máy chạy test được đưa vào allowlist | Máy nội bộ có profile đã đăng nhập, hằng ngày |

Khi T2 bị `blocked` hoặc `need_login`, T1 vẫn cho tín hiệu hồi quy của thư viện mỗi ngày. Không dùng bất kỳ kỹ thuật né phát hiện bot nào; `_bot_challenge` giữ nguyên hành vi chỉ chờ rồi báo `blocked`.

**Trang fixture**
- Một mini-SPA JavaScript thuần, không build Angular, tái tạo đúng các class và role mà thư viện dựa vào: `.cdk-overlay-container`, `.cdk-overlay-pane`, `.cdk-global-overlay-wrapper`, `mat-dialog-container`, `[role=menu|dialog|listbox|tab]`.
- Phục vụ bằng `context.route("http://tourfp.test/**")` đọc file từ `testdata/fixtures/`. Không cần mở cổng, và cùng một mã chạy được ở CI lẫn máy cục bộ.
- API giả cũng trả qua route dưới dạng JSON, để bộ lọc "giá trị API" của thư viện hoạt động như trên app thật.
- Đáp án đúng lưu trong thuộc tính JS (`el.__truth = "id"`), không dùng thuộc tính DOM, để thư viện không lấy nó làm tín hiệu nhận diện.
- Bộ chạy so `document.elementFromPoint(tâm rect).__truth` với id mong đợi, nên bắt được lỗi "ok nhưng sai phần tử" mà T2 không thấy.

Các mẫu DOM, bám theo những điểm yếu trong báo cáo đánh giá:

| Mẫu | Tham số biến thể |
|---|---|
| Menu rê chuột, có "Xem thêm" và cuộn trong menu | `expanded=0/1` |
| Danh sách/bảng do API sinh, nút lặp theo dòng (MUA, ⋮ chỉ có `circle`) | `order=seed`, `delay=ms` |
| Hộp thoại, drawer, accordion | mở sẵn hoặc đóng |
| Bản sao ẩn ngoài màn hình (thanh dưới mobile, x âm) | `clone=0/1` |
| Popup quảng cáo dạng modal | `ad=0/1` lúc ghi và lúc phát, đủ 4 tổ hợp |
| Nhãn có số (1M/3M/1Y), nhãn đổi theo trạng thái (mat-select) | `value=…` |
| Nút giao dịch giả: bấm vào sẽ đặt `window.__dangerClicked = true` | luôn có |

Mỗi ca chọn thêm cách nạp thư viện: `inject: "init"` (như runner) hoặc `"late"` (như dán vào console). Báo cáo đánh giá nêu hai cách này làm bộ lọc API cho kết quả khác nhau và chưa được đo.

## 2. Dùng `testdata/tours` làm ca kiểm thử

- **Không nhập vào bảng `tours`.** Bộ chạy đọc thẳng file; mã ca là tên file. Nhờ vậy danh sách tour của admin không bị lẫn, và `expect` được quản lý bằng git.
- **T0:** kiểm schema bằng `TourIn.check_steps`, kiểm `start` khớp `steps[0].fp.ctx.path`, và kiểm không có bước RISKY nào nằm trước giới hạn tự bấm.
- **T2:** chạy các file không có `target: "fixture"` cùng với tour trong DB. Ca fixture nằm ở `testdata/fixtures/cases/*.json`, cùng định dạng, thêm `truth` (id đáp án từng bước) và `variant: {record, play, inject}`.
- **So `expect`:** hàm `compare_expect(result, expect)` chỉ so các trường có mặt, gồm `status`, `performed`, `failed_step`, `steps[i].result`. Kết luận là một trong ba:
  - `as_expected`;
  - `regression` (xấu hơn mong đợi): đây là trường hợp cảnh báo;
  - `improved` (tốt hơn mong đợi, ví dụ một lỗi đã biết nay đạt): chỉ nhắc cập nhật `expect`, không báo đỏ.
- Các lỗi đã biết của thư viện được ghi `expect.status: "fail"` kèm `known_issue`, để CI xanh ngay từ đầu và chỉ đỏ khi có thay đổi.
- **Ca popup quảng cáo:**
  - Trên fixture: 4 tổ hợp `ad` lúc ghi và lúc phát, mỗi tổ hợp là một ca có `expect` riêng.
  - Trên T2 popup xuất hiện ngẫu nhiên. Khi `locate` trả `wrong-state` và `context.dialog` khác rỗng mà tour không ghi hộp thoại đó, kết quả được gắn nguyên nhân `popup`, không tính là app đổi giao diện.
  - Tuỳ chọn cho giai đoạn 4: danh sách "bước đóng popup" do admin ghi sẵn dưới dạng dấu vân tay, chạy qua cùng lớp chặn RISKY, thử một lần rồi tìm lại.

## 3. Lịch chạy hằng ngày

| Cơ chế | Dùng cho | Lý do |
|---|---|---|
| GitHub Actions (`push`, `pull_request`, `schedule`, `workflow_dispatch`) | T0 và T1 | Không cần phiên đăng nhập, không chạm TCInvest. Lưu ý: `schedule` có thể trễ và tự tắt sau 60 ngày repo không hoạt động. |
| Bộ hẹn giờ trong server (`scheduler()`) | T2, và T1 chạy ngay trước T2 | Đã có, chỉnh được trên trang admin, đã khoá chung profile qua `test_state`. Giữ làm nguồn lịch duy nhất cho T2. |
| launchd LaunchAgent | Chỉ để giữ uvicorn luôn chạy (`RunAtLoad`, `KeepAlive`) | Bù điểm yếu "server phải đang bật". Không đặt lịch thứ hai ở đây, tránh hai tiến trình tranh một profile. |
| cron | Không dùng | Trên macOS không có phiên giao diện và trùng vai với launchd. |

T2 không chạy trên GitHub Actions vì runner công cộng không có phiên đăng nhập, không nằm trong allowlist, và repo công khai.

**Headless hay headed:** T1 chạy headless bằng Chromium đi kèm Playwright. T2 chạy headless với Chrome thật như hiện nay (`TOURFP_TEST_HEADLESS=1`). Headed chỉ dùng cho cửa sổ đăng nhập và khi gỡ lỗi. Nếu môi trường chặn thì kết quả là `blocked`, không đổi chế độ để lách.

## 4. Kết quả và cảnh báo

**Lưu lịch sử**
- Thêm bảng `test_results`, mỗi ca mỗi lần chạy một dòng: `run_id, day, tier, case_id, name, status, verdict, cause, failed_step, attempts, duration_ms`.
- Thêm cột cho `test_runs`: `tier, target, lib_version, lib_sha`.
- Giữ 90 ngày, thay cho giới hạn 60 lần chạy hiện nay.

**Phân loại nguyên nhân** (hàm `classify`)

| `cause` | Điều kiện |
|---|---|
| `infra` | `blocked`, `need_login`, không mở được trình duyệt, `goto` quá hạn, tour quá 3 phút, thư viện không nạp được |
| `library` | Bất kỳ `regression` nào ở T1 (DOM cố định nên chỉ thư viện thay đổi); hoặc T2 lỗi mà T1 cùng ngày cũng đỏ |
| `app_changed` | T2 lỗi, T1 xanh, và `lib_sha` trùng với lần gần nhất tour đó đạt |
| `popup` | `wrong-state` kèm hộp thoại ngoài dự kiến |
| `unknown` | T2 lỗi, T1 xanh, nhưng `lib_sha` đã đổi: cần người xem trace |

**Chống flaky**
- Ca lỗi được chạy lại tối đa 2 lần trên trang mới. Chỉ chạy lại với `fail`, `error` và `warn`; không chạy lại với `blocked` hay `need_login`.
- Đạt ở lần chạy lại thì ghi `flaky`: tính là đạt, lưu `attempts`.
- Ngưỡng: một ca `flaky` từ 3 lần trong 7 ngày thì đưa vào cảnh báo mức "lưu ý".
- Bước `not-found` do danh sách tải chậm: giữ `STEP_TIMEOUT_MS = 8000`, không tăng.

**Ảnh chụp và trace**
- Bật `context.tracing.start(screenshots=True, snapshots=True)` cho từng tour. Chỉ lưu khi kết quả không như mong đợi, còn lại huỷ. Không quay video.
- Lưu tại `server/data/artifacts/<run_id>/<case_id>/{fail.png, trace.zip}`; thư mục này đã được gitignore.
- Xoá sau 14 ngày hoặc khi tổng dung lượng vượt 500 MB, xoá cũ trước, thực hiện cuối mỗi lần chạy.
- CI chỉ tải lên artifact của T1, vốn không có dữ liệu cá nhân. Artifact của T2 không bao giờ rời máy.

**Thông báo**
- Webhook chung, tương thích Slack incoming webhook (`{"text": …}`), gửi bằng `urllib`, không thêm thư viện. Địa chỉ đặt ở biến môi trường `TOURFP_NOTIFY_WEBHOOK`, không lưu DB hay repo.
- Nội dung chỉ có số liệu, tên ca, số bước, nguyên nhân và đường dẫn trang admin cục bộ. Không gửi ảnh hay trace.
- Quy tắc gửi:
  - `regression` đã xác nhận sau khi chạy lại: gửi ngay trong ngày.
  - `need_login`: gửi khi chuyển trạng thái, rồi nhắc mỗi ngày tới khi có người đăng nhập lại qua `/api/tests/login`.
  - `blocked`: gửi khi chuyển trạng thái, rồi nhắc mỗi tuần.
  - Hồi phục: gửi một lần.
  - Bộ hẹn giờ không chạy quá 26 giờ: cảnh báo trên trang admin.
- Với CI: dùng thông báo lỗi workflow sẵn có của GitHub. Slack qua secret là tuỳ chọn.

**Trang admin**
- Hai dải kết quả tách riêng: "Thư viện (fixture)" và "Tour thật".
- Mỗi ca hiện nhãn nguyên nhân, số lần thử, liên kết ảnh và trace.
- Dải xu hướng 30 ngày theo ngày (đạt / flaky / lỗi / hạ tầng), và tỉ lệ đạt 30 ngày của từng tour.

## 5. Siết an toàn (làm trước mọi việc khác)

Lỗ hổng hiện tại: `default_test_to` chỉ xét tên bước. Nút MUA có thể được ghi với nhãn rỗng, khi đó tên bước không khớp `RISKY`. Thư viện cũng có thể chỉ nhầm sang một nút khác.

1. **Kiểm tra phần tử thật trước mỗi cú bấm.** Trong `run_tour`, trước `page.mouse.click`, đọc chữ, `aria-label` và `title` của `elementFromPoint(x, y)` cùng `button`/`a` gần nhất, rồi so với `RISKY`. Nếu khớp thì không bấm, ghi `found` với ghi chú "dừng: đích là nút giao dịch", và kết thúc tour.
2. **Danh sách cấm cứng `HARD_DENY`**: mua, bán, đặt lệnh, xác nhận, chuyển tiền, rút tiền, nộp tiền, thanh toán, ký, buy, sell, confirm, pay, transfer. `test_to` do admin đặt không vượt qua được danh sách này.
3. `default_test_to` xét thêm `fp.label` và mọi phần tử của `fp.segs`, không chỉ `segs[0]`.
4. Ca fixture "nút giao dịch giả" khẳng định `__dangerClicked` luôn là `false`. Ca này chạy mỗi commit, nên luật an toàn có test hồi quy.
5. Giữ nguyên: bước `input` không gõ gì; không tự đăng nhập.

## 6. Thay đổi theo file

| File | Thay đổi |
|---|---|
| `server/runner.py` (sửa) | `_launch(profile=None)` tạo context không lưu profile cho T1. Thêm `HARD_DENY`, `_risky_at(page, x, y)` và gọi trong `run_tour`. Mở rộng `default_test_to`. `run_tour` nhận `artifacts_dir` và `truth`, chụp ảnh khi lỗi, ghi `context.dialog` vào kết quả. `run_all` nhận `tier`, `retries`, bật và tắt tracing theo tour. |
| `server/fixtures.py` (mới) | `install(ctx, root)` đăng ký route cho `http://tourfp.test`. `load_cases(dir)`, `compare_expect(result, expect)`, `validate_case(case)`. |
| `server/results.py` (mới) | `migrate(conn)` dùng `ALTER TABLE` và tạo `test_results`. `save_run(...)`, `classify(result, tier, fixture_green, lib_sha, last_pass_sha)`, `trend(conn, days)`, `prune(conn, artifacts_root)`. |
| `server/notify.py` (mới) | `should_notify(prev, cur)` và `send(summary)`. |
| `server/checks.py` (mới) | CLI `python server/checks.py --tier static\|fixture [--json out]`. Mã thoát khác 0 khi có `regression`. Ghi bảng tóm tắt vào `$GITHUB_STEP_SUMMARY`. |
| `server/main.py` (sửa) | `db()` gọi `migrate`. `do_test_run` chạy T1 rồi T2, phân loại, chạy lại, lưu, dọn, thông báo. Đổi câu `INSERT INTO test_runs VALUES (?,…)` sang ghi rõ tên cột, vì thêm cột sẽ làm hỏng câu hiện tại. Bỏ câu xoá giữ 60 lần chạy. `_counts` thêm `flaky`. Thêm `GET /api/tests/trend?days=30` và `GET /api/tests/runs/{id}/artifacts/{case}/{file}` có chặn path traversal. `tests_overview` trả thêm `tiers` và `last_schedule_at`. |
| `server/static/index.html` (sửa) | `renderTests()` tách hai tầng, thêm nhãn nguyên nhân, số lần thử, liên kết artifact, dải xu hướng. `T_LABEL` thêm `flaky`. |
| `testdata/fixtures/` (mới) | `app/index.html`, `app/app.js`, `api/*.json`, `cases/*.json`. |
| `tests/test_static.py` (mới) | `unittest` cho `default_test_to`, `HARD_DENY`, `classify`, `compare_expect`, schema của `testdata/tours`. |
| `.github/workflows/tests.yml` (mới) | Python 3.12, `pip install -r server/requirements.txt`, `playwright install --with-deps chromium`, chạy T0 và T1, tải artifact T1 khi lỗi. Lịch `cron: '30 23 * * *'`, tức 06:30 giờ Việt Nam. |
| `scripts/com.tourfp.server.plist` (mới) | Mẫu LaunchAgent giữ uvicorn chạy trên `127.0.0.1`. |
| `README.md` (sửa) | Mục Kiểm thử tự động: ba tầng, CLI, biến môi trường mới, chính sách lưu và xoá. |
| `tourfp.js` | Không đổi trong kế hoạch này. Lỗi thư viện do T1 phát hiện được sửa riêng. |

## 7. Giai đoạn

| GĐ | Nội dung | Công | Tiêu chí hoàn thành |
|---|---|---|---|
| 0 | Siết an toàn (mục 5), `_launch(profile=None)`, T0 | 0,5–1 ngày | `tests/test_static.py` xanh; bước có nhãn rỗng trỏ vào nút "MUA" không bị bấm |
| 1 | Fixture, từ 12 ca trở lên phủ 7 mẫu DOM, `checks.py`, workflow CI | 2,5–3 ngày | CI xanh trên `push` và theo lịch; cố ý làm hỏng `find` thì CI đỏ; `__dangerClicked` luôn `false`; mỗi lỗi đã biết có ca `known_issue` |
| 2 | Lịch sử, phân loại, chạy lại, ảnh và trace, dọn dữ liệu | 1,5–2 ngày | Lần chạy hằng ngày lưu `test_results`; một ca lỗi có ảnh và trace mở được; dữ liệu quá 14 ngày tự xoá; DB cũ nâng cấp không mất dữ liệu |
| 3 | Thông báo và trang admin (hai tầng, xu hướng) | 1–1,5 ngày | Webhook nhận đúng một tin khi chuyển trạng thái; trang admin hiện xu hướng 30 ngày và nguyên nhân |
| 4 | T2 trên môi trường được phép, `testdata/tours`, launchd, bước đóng popup (tuỳ chọn) | 1–1,5 ngày, cộng thời gian chờ cấp quyền | 5 ngày liên tiếp có kết quả T2 không `blocked`; hết phiên thì có tin `need_login` trong ngày; không có cú bấm nào vào nút giao dịch (kiểm trong trace) |

Tổng khoảng 7–9 ngày công. Giai đoạn 0–3 không phụ thuộc TCInvest. Giai đoạn 4 bị chặn bởi câu hỏi 1 bên dưới.

## 8. Rủi ro

- **Fixture không giống app thật.** T1 xanh không bảo đảm T2 xanh. Giảm thiểu: mỗi lỗi T2 do thư viện gây ra phải thêm một ca fixture tái hiện trước khi sửa.
- **Dữ liệu cá nhân trong `testdata/tours`.** Anchor có thể chứa tên kế hoạch, mã trái phiếu. T0 cần thêm kiểm tra chuỗi nghi là dữ liệu tài khoản, và người phải rà trước khi commit.
- **Phiên đăng nhập ngắn.** Nếu phiên TCInvest hết sau vài giờ, T2 sẽ `need_login` mỗi ngày và cần tài khoản test hoặc môi trường có phiên dài.
- **Chạy lại che lỗi thật.** Vì vậy phải lưu `attempts` và có ngưỡng flaky.
- **Máy ngủ lúc tới giờ.** Bộ hẹn giờ đã chạy bù khi server bật lại; việc đặt máy tự thức do người dùng tự cấu hình.
- **Lớp chặn theo chữ có thể sót nút chỉ có icon.** Xem câu hỏi 3.

## 9. Câu hỏi cần quyết

1. T2 chạy ở đâu: có địa chỉ UAT/staging của TCInvest không, hay xin allowlist cho máy nào (IP cố định)? Ai là đầu mối bên vận hành/an ninh?
2. T2 dùng tài khoản nào: tài khoản test riêng hay tài khoản thật của một người? Phiên đăng nhập kéo dài bao lâu?
3. Có muốn thêm lớp chặn mạng không: nếu có mẫu đường dẫn API đặt lệnh và chuyển tiền, bộ chạy sẽ huỷ các request đó ở tầng `context.route`.
4. Kênh thông báo: Slack, webhook khác, hay email? Ai nhận?
5. Thời hạn giữ ảnh và trace: 14 ngày, 500 MB có phù hợp không?
6. Máy nào chạy T2 hằng ngày: máy Mac này hay một máy nội bộ luôn bật?
7. Lỗi đã biết của thư viện: ghi `known_issue` để CI xanh ngay (đề xuất), hay để CI đỏ tới khi sửa xong?
8. `testdata/tours` có được commit lên repo công khai không, hay để trong `server/data/`?
