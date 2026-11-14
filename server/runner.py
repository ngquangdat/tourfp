"""Kiểm thử tự động: mở một trình duyệt thật, đi qua từng bước của mỗi tour và ghi lại bước nào tìm thấy đích.

Cách chạy một tour:
  - mở màn bắt đầu của tour trong Chrome (qua Playwright), thư viện tourfp.js được nạp sẵn trước mã của trang;
  - với từng bước, hỏi thư viện toạ độ của đích (TourFP.locate), rồi rê hoặc bấm vào đó bằng chuột thật để sang bước sau;
  - dừng ở bước đầu tiên không tìm thấy đích, và ghi lại lý do.

Bộ chạy bấm thật trên trang và đi hết mọi bước của tour: tour được kiểm duyệt lúc tạo, nên không giới hạn số bước tự bấm.
Bước "input" chỉ kiểm tra tìm thấy ô, không gõ gì vào.

Chống bot: nếu trang đích hiện màn xác minh chống bot, lần chạy được ghi là "blocked". Bộ chạy không tìm cách vượt qua;
muốn kiểm thử tự động thì cần một địa chỉ (môi trường thử, hoặc danh sách cho phép) không chặn trình duyệt tự động.

Đăng nhập: trình duyệt dùng một hồ sơ riêng (thư mục profile). Người dùng tự đăng nhập một lần qua open_login();
bộ chạy không bao giờ nhập tài khoản hay mật khẩu. Hết phiên đăng nhập thì lần chạy báo "cần đăng nhập".

Cần cài:  pip install playwright   (dùng Chrome có sẵn trên máy; không có Chrome thì chạy thêm: playwright install chromium)
"""
from __future__ import annotations

import asyncio
import re
import time
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, Callable

VIEWPORT = {"desktop": {"width": 1280, "height": 800}, "mobile": {"width": 390, "height": 844}}
STEP_TIMEOUT_MS = 8000


class RunnerError(RuntimeError):
    pass


def step_name(step: dict[str, Any]) -> str:
    if step.get("title"):
        return str(step["title"]).strip()
    fp = step.get("fp") or {}
    segs = fp.get("segs") or []
    return str(segs[0] if segs else fp.get("label") or fp.get("icon") or fp.get("tag") or "").strip()


def _same_ctx(a: dict[str, Any] | None, b: dict[str, Any] | None) -> bool:
    return bool(a and b) and all((a.get(k) or "") == (b.get(k) or "") for k in ("path", "dialog", "step"))


async def _launch(pw: Any, profile: Path, headless: bool, lib: Path | None, player: bool = True, fixed_size: bool = True) -> Any:
    profile.mkdir(parents=True, exist_ok=True)
    options: dict[str, Any] = dict(user_data_dir=str(profile), headless=headless, bypass_csp=True)
    if fixed_size:
        options["viewport"] = VIEWPORT["desktop"]
    else:  # cửa sổ tự do co giãn: kéo hẹp cửa sổ là có bố cục mobile
        options["no_viewport"] = True
    try:
        ctx = await pw.chromium.launch_persistent_context(channel="chrome", **options)
    except Exception as first:  # không có Chrome: thử Chromium đi kèm Playwright
        try:
            ctx = await pw.chromium.launch_persistent_context(**options)
        except Exception as e:
            raise RunnerError(f"Không mở được trình duyệt. Chrome: {first}. Chromium: {e}") from e
    if lib is not None:
        # nạp thư viện trước mã của trang, ở chế độ chỉ phát (không hiện thanh ghi tour); chỉ ở khung trên cùng
        code = lib.read_text(encoding="utf-8")
        flag = "window.TOURFP_PLAYER = true;\n" if player else ""
        await ctx.add_init_script("if (window === window.top) { " + flag + code + "\n}")
    return ctx


async def _needs_login(page: Any) -> bool:
    if re.search(r"/(login|dang-nhap|signin|sign-in)\b", page.url, re.I):
        return True
    try:
        return await page.locator("input[type=password]").count() > 0
    except Exception:
        return False


async def _bot_challenge(page: Any) -> bool:
    """Trang đang hiện màn xác minh chống bot (ví dụ Cloudflare "Just a moment…") thay vì ứng dụng."""
    try:
        return bool(await page.evaluate(
            """() => /^just a moment/i.test(document.title)
                 || !!document.querySelector('#challenge-form, #challenge-running, .cf-turnstile, iframe[src*="challenges.cloudflare.com"], script[src*="challenges.cloudflare.com"]')"""
        ))
    except Exception:
        return False


async def _settle(page: Any, ms: int = 8000) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=ms)
    except Exception:
        pass  # trang có kết nối kéo dài (giá realtime) thì không bao giờ "yên": cứ đi tiếp


async def run_tour(page: Any, tour: dict[str, Any], target: str) -> dict[str, Any]:
    steps: list[dict[str, Any]] = tour["steps"]
    n = len(steps)
    t0 = time.time()
    rows: list[dict[str, Any]] = [
        {"n": i + 1, "kind": s.get("kind"), "name": step_name(s), "result": "not-run", "note": ""} for i, s in enumerate(steps)
    ]
    out: dict[str, Any] = {
        "tour_id": tour["id"], "name": tour["name"], "layout": tour.get("layout") or "", "total": n,
        "status": "pass", "failed_step": None, "message": "", "steps": rows,
    }

    def done(status: str, message: str, failed: int | None = None) -> dict[str, Any]:
        out.update(status=status, message=message, failed_step=failed, duration_ms=int((time.time() - t0) * 1000))
        out["performed"] = sum(1 for r in rows if r["result"] in ("done", "skipped"))
        return out

    await page.set_viewport_size(VIEWPORT.get(tour.get("layout") or "", VIEWPORT["desktop"]))
    try:
        await page.goto(target + tour["start_path"], wait_until="domcontentloaded", timeout=30000)
    except Exception as e:
        return done("error", f"Không mở được màn bắt đầu: {type(e).__name__}")
    await _settle(page)
    # Màn xác minh chống bot đôi khi tự qua sau vài giây ở trình duyệt thường: chờ một lúc, không làm gì để vượt qua nó.
    for _ in range(8):
        if not await _bot_challenge(page):
            break
        await page.wait_for_timeout(1000)
    else:
        return done("blocked", "Trang chặn trình duyệt tự động bằng màn xác minh chống bot, nên không kiểm thử được ở địa chỉ này.")
    if await _needs_login(page):
        return done("need_login", "Phiên đăng nhập đã hết. Hãy đăng nhập lại trong trình duyệt kiểm thử.")
    try:
        await page.wait_for_function("() => !!window.TourFP", timeout=10000)
        await page.evaluate("steps => TourFP.load(steps)", steps)
    except Exception as e:
        return done("error", f"Thư viện không nạp được trên trang: {type(e).__name__}")
    try:  # phiên bản trang lúc kiểm thử, để so với lúc ghi
        out["app"] = await page.evaluate("() => TourFP.appVersion ? TourFP.appVersion() : null")
    except Exception:
        out["app"] = None

    warnings: list[str] = []
    i = 0
    while i < n:
        step, row = steps[i], rows[i]
        try:
            loc = await page.evaluate("([i, t]) => TourFP.locate(i, { timeout: t })", [i, STEP_TIMEOUT_MS])
        except Exception as e:  # trang tải lại giữa chừng làm mất thư viện, hoặc lỗi trong trang
            if await _needs_login(page):
                return done("need_login", "Phiên đăng nhập đã hết giữa lúc chạy.")
            row.update(result="error", note=type(e).__name__)
            return done("error", f"Bước {i + 1} «{row['name']}»: lỗi khi tìm đích ({type(e).__name__})", i + 1)
        row.update(score=loc.get("score"), via=loc.get("via"), ms=loc.get("ms"), waited=loc.get("waited"))
        status = loc.get("status")
        if status == "skipped":  # bước đã được làm sẵn (ví dụ menu đã mở rộng từ trước)
            row.update(result="skipped", note="đã được làm sẵn")
            i = int(loc["skipTo"])
            continue
        if status != "ok":  # kể cả "ambiguous": lúc phát thật thư viện cũng không dẫn người dùng tới một đích chưa chắc chắn
            why = {
                "not-found": "không tìm thấy đích trên màn hình",
                "wrong-screen": "trang đang ở màn khác với lúc ghi",
                "wrong-state": "màn hình đang ở trạng thái khác với lúc ghi (hộp thoại hoặc bước khác)",
                "ambiguous": "có nhiều phần tử giống nhau, không xác định chắc được đích",
            }.get(str(status), str(status))
            here = loc.get("context") or {}
            row.update(result="fail", note=why)
            return done("fail", f"Bước {i + 1} «{row['name']}»: {why}. Đang ở {here.get('path', '?')}" + (f" › {here['dialog']}" if here.get("dialog") else ""), i + 1)
        if loc.get("drift"):  # đích lấy theo thứ tự mà danh sách đã đổi số lượng so với lúc ghi: có thể không còn là mục cũ
            warnings.append(f"bước {i + 1} lấy theo thứ tự ({loc.get('via')}), nên kiểm lại bằng mắt")

        rect = loc["rect"]
        vp = page.viewport_size or VIEWPORT["desktop"]
        x = min(max(rect["x"] + rect["w"] / 2, 1), vp["width"] - 1)
        y = min(max(rect["y"] + rect["h"] / 2, 1), vp["height"] - 1)
        kind = step.get("kind")
        if kind == "hover":
            await page.mouse.move(x - 12, y - 8)
            await page.mouse.move(x, y, steps=6)
        elif kind == "click":
            await page.mouse.move(x, y, steps=4)
            await page.mouse.click(x, y)
        # bước "info" chỉ để xem; bước "input" chỉ cần tìm thấy ô, không gõ gì vào
        row["result"] = "done"
        await page.wait_for_timeout(450)
        after = step.get("after")
        if kind == "click" and after:
            try:
                await page.wait_for_function(
                    "a => { const c = TourFP.context(); return c.path === a.path && c.dialog === (a.dialog || '') && c.step === (a.step || ''); }",
                    arg=after, timeout=5000,
                )
            except Exception:
                try:
                    now = await page.evaluate("() => TourFP.context()")
                except Exception:
                    now = None
                if not _same_ctx(now, after):
                    warnings.append(f"sau bước {i + 1}, màn hình không giống lúc ghi")
                    row["note"] = (row["note"] + "; " if row["note"] else "") + "sau cú bấm, màn hình không giống lúc ghi"
        i += 1

    msg = f"Đạt {n}/{n} bước"
    if warnings:
        return done("warn", msg + ". Lưu ý: " + "; ".join(warnings))
    return done("pass", msg)


async def run_all(
    tours: list[dict[str, Any]],
    target: str,
    profile: Path,
    lib: Path,
    headless: bool = True,
    progress: Callable[[int, int, str], None] | None = None,
) -> list[dict[str, Any]]:
    """Chạy lần lượt mọi tour. Gặp "cần đăng nhập" thì dừng luôn: các tour còn lại cũng sẽ như vậy."""
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise RunnerError("Chưa cài Playwright. Chạy: pip install playwright") from e
    results: list[dict[str, Any]] = []
    async with async_playwright() as pw:
        ctx = await _launch(pw, profile, headless, lib)
        try:
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            page.on("dialog", lambda d: asyncio.ensure_future(d.dismiss()))  # hộp "rời trang?" và các hộp thoại của trình duyệt
            for k, tour in enumerate(tours):
                if progress:
                    progress(k, len(tours), tour["name"])
                try:
                    res = await asyncio.wait_for(run_tour(page, tour, target), timeout=180)
                except asyncio.TimeoutError:
                    res = {"tour_id": tour["id"], "name": tour["name"], "layout": tour.get("layout") or "", "total": len(tour["steps"]),
                           "status": "error", "message": "Quá 3 phút cho một tour", "failed_step": None, "steps": [], "performed": 0}
                results.append(res)
                if res["status"] in ("need_login", "blocked"):  # các tour còn lại cũng sẽ gặp đúng tình trạng này: dừng luôn
                    why = "cần đăng nhập" if res["status"] == "need_login" else "trang chặn trình duyệt tự động"
                    for rest in tours[k + 1:]:
                        results.append({"tour_id": rest["id"], "name": rest["name"], "layout": rest.get("layout") or "", "total": len(rest["steps"]),
                                        "status": res["status"], "message": f"Chưa chạy: {why}", "failed_step": None, "steps": [], "performed": 0})
                    break
        finally:
            await ctx.close()
    return results


async def open_login(target: str, profile: Path, wait_seconds: int = 600) -> None:
    """Mở cửa sổ Chrome của hồ sơ kiểm thử để người dùng tự đăng nhập. Trả về khi họ đóng cửa sổ, hoặc hết thời gian chờ."""
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise RunnerError("Chưa cài Playwright. Chạy: pip install playwright") from e
    async with async_playwright() as pw:
        ctx = await _launch(pw, profile, headless=False, lib=None)
        closed = asyncio.Event()
        ctx.on("close", lambda *_: closed.set())
        try:
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            page.on("close", lambda *_: closed.set())
            await page.goto(target, wait_until="domcontentloaded", timeout=30000)
            try:
                await asyncio.wait_for(closed.wait(), timeout=wait_seconds)
            except asyncio.TimeoutError:
                pass
        finally:
            try:
                await ctx.close()
            except Exception:
                pass


def _window_gone(exc: BaseException, ctx: Any, closed: asyncio.Event) -> bool:
    """Lỗi chỉ vì người dùng đã đóng cửa sổ Chrome (đóng sớm là bình thường, không phải lỗi)."""
    return closed.is_set() or not ctx.pages or type(exc).__name__ == "TargetClosedError" or "has been closed" in str(exc)


async def _wait_until_closed(ctx: Any, closed: asyncio.Event, wait_seconds: int) -> None:
    t0 = time.time()
    while not closed.is_set() and time.time() - t0 < wait_seconds:
        await asyncio.sleep(1)
        if not ctx.pages:  # người dùng đã đóng hết các tab
            break


async def open_recorder(target: str, profile: Path, lib: Path, on_save: Callable[[str], None], wait_seconds: int = 3 * 3600) -> None:
    """Mở Chrome (hồ sơ kiểm thử, đã đăng nhập) với thanh ghi tour nạp sẵn ở mọi trang.

    Người dùng tự ghi; bấm "Gửi" trên thanh ghi thì tour được chuyển về qua on_save(json), không cần mạng hay clipboard.
    Trả về khi người dùng đóng hết các tab, hoặc hết thời gian chờ. Người dùng đóng cửa sổ sớm thì không coi là lỗi.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise RunnerError("Chưa cài Playwright. Chạy: pip install playwright") from e
    async with async_playwright() as pw:
        ctx = await _launch(pw, profile, headless=False, lib=lib, player=False, fixed_size=False)
        closed = asyncio.Event()
        ctx.on("close", lambda *_: closed.set())
        try:
            await ctx.expose_binding("__tourfpHost", lambda _source, data: on_save(str(data)))
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await page.goto(target, wait_until="domcontentloaded", timeout=30000)
            await _wait_until_closed(ctx, closed, wait_seconds)
        except Exception as e:
            if not _window_gone(e, ctx, closed):
                raise
        finally:
            try:
                await ctx.close()
            except Exception:
                pass


async def open_player(url: str, profile: Path, lib: Path, steps: list[dict[str, Any]], start: dict[str, Any], layout: str = "",
                      wait_seconds: int = 3 * 3600) -> None:
    """Mở Chrome (hồ sơ kiểm thử) tại màn bắt đầu của tour và phát tour ngay, để xem tour chạy mà không phải dán mã.

    start: {"mode": "guide" | "direct", "to": x}. Trả về khi người dùng đóng hết các tab, hoặc hết thời gian chờ.
    Trang tự chuyển hướng hay tải lại ngay sau khi mở (đăng nhập, trang kiểm tra trình duyệt) thì chờ trang ổn định rồi phát;
    người dùng đóng cửa sổ sớm thì không coi là lỗi.
    """
    try:
        from playwright.async_api import async_playwright
    except ImportError as e:
        raise RunnerError("Chưa cài Playwright. Chạy: pip install playwright") from e
    async with async_playwright() as pw:
        ctx = await _launch(pw, profile, headless=False, lib=lib, player=True)
        closed = asyncio.Event()
        ctx.on("close", lambda *_: closed.set())
        try:
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()
            await page.set_viewport_size(VIEWPORT.get(layout or "", VIEWPORT["desktop"]))
            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
            started, t0, want = False, time.time(), urlparse(url).path
            while not started and not closed.is_set() and time.time() - t0 < 120:
                try:
                    if await _bot_challenge(page):  # trang kiểm tra trình duyệt: chờ người dùng qua bước đó, không tự vượt
                        await asyncio.sleep(2)
                        continue
                    if urlparse(page.url).path != want and time.time() - t0 < 12:  # trang còn đang chuyển hướng: chờ về đúng màn bắt đầu
                        await asyncio.sleep(0.5)
                        continue
                    await page.wait_for_function("() => !!window.TourFP", timeout=15000)
                    await _settle(page, 4000)
                    await page.evaluate("([s, o]) => { TourFP.load(s); TourFP.start(o); }", [steps, start])
                    started = True
                except Exception as e:
                    if _window_gone(e, ctx, closed):
                        return
                    await asyncio.sleep(1)  # trang vừa chuyển hướng hoặc tải lại giữa chừng: thử lại trên trang mới
                    page = ctx.pages[-1] if ctx.pages else page
            await _wait_until_closed(ctx, closed, wait_seconds)
        except Exception as e:
            if not _window_gone(e, ctx, closed):
                raise
        finally:
            try:
                await ctx.close()
            except Exception:
                pass
