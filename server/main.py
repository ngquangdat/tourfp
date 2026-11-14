"""TourFP admin: lưu, liệt kê, xoá và chạy thử các tour đã ghi bằng tourfp.js.

Chạy:  uvicorn main:app --app-dir server --port 8000
Cấu hình qua biến môi trường:
  TOURFP_TARGET  trang web mà tour chạy trên đó (mặc định https://tcinvest.tcbs.com.vn)
  TOURFP_DATA    thư mục chứa file SQLite (mặc định server/data)
  TOURFP_AI      off | bedrock | litellm: mô hình dùng cho trợ lý tìm tour (xem ai.py)
  TOURFP_TEST_HEADLESS  mặc định ban đầu cho việc hiện cửa sổ Chrome khi kiểm thử: 1 chạy ẩn, 0 hiện cửa sổ (mặc định: hiện).
                        Sau đó chỉnh bằng ô "Hiện cửa sổ Chrome" trên trang quản trị.

  TOURFP_ADMIN_PASSWORD mật khẩu khi vào trang từ xa (qua tên miền, Cloudflare Tunnel…). Không đặt thì đọc file
                        <TOURFP_DATA>/admin-password.txt. Tên đăng nhập: admin.

Đăng nhập: truy cập thẳng trên máy (localhost) thì không hỏi. Truy cập từ xa (có header của Cloudflare, hoặc tên miền
khác localhost) thì phải nhập mật khẩu; chưa đặt mật khẩu thì từ chối hẳn. Máy chủ chỉ nên nghe trên 127.0.0.1.
"""
from __future__ import annotations

import asyncio
import base64
import secrets
import datetime
import inspect
import json
import re
import os
import sqlite3
import time
import uuid
from contextlib import asynccontextmanager, closing
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator

import ai
import versions
import assist
import runner

BASE = Path(__file__).resolve().parent
LIB = BASE.parent / "tourfp.js"
DATA = Path(os.environ.get("TOURFP_DATA", BASE / "data"))
DB = DATA / "tours.db"
TARGET = os.environ.get("TOURFP_TARGET", "https://tcinvest.tcbs.com.vn").rstrip("/")
PROFILE = DATA / "browser-profile"  # hồ sơ Chrome riêng của kiểm thử tự động, giữ phiên đăng nhập
# mặc định mở Chrome có cửa sổ để thấy được bộ chạy đang làm gì; người quản trị đổi được trên trang (lưu trong settings)
SHOW_DEFAULT = os.environ.get("TOURFP_TEST_HEADLESS", "0") == "0"

KINDS = {"click", "hover", "input", "info"}
MAX_STEPS = 200
MAX_BYTES = 2_000_000  # một tour vài chục bước chỉ khoảng vài chục KB

@asynccontextmanager
async def lifespan(_: FastAPI):
    task = asyncio.create_task(scheduler())  # lịch chạy kiểm thử hằng ngày
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="TourFP admin", docs_url=None, redoc_url=None, lifespan=lifespan)

# Thư viện chạy trên trang đích gọi sang đây để lưu và tải tour.
# Chrome còn hỏi thêm quyền khi một trang công khai gọi vào máy cục bộ ("private network"); chỉ đồng ý cho trang đích.
_cors: dict[str, Any] = {"allow_origins": [TARGET], "allow_methods": ["GET", "POST"], "allow_headers": ["Content-Type"]}
_native_pna = "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters
if _native_pna:
    _cors["allow_private_network"] = True
app.add_middleware(CORSMiddleware, **_cors)

# ---------- đăng nhập khi truy cập từ xa ----------
# Trang quản trị điều khiển được Chrome đã đăng nhập tài khoản thật trên máy này, nên ai vào từ xa cũng phải có mật khẩu.
_LOCAL_HOSTS = {"127.0.0.1", "localhost", "[::1]", "::1"}


def _admin_password() -> str:
    env = os.environ.get("TOURFP_ADMIN_PASSWORD", "").strip()
    if env:
        return env
    try:
        return (DATA / "admin-password.txt").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _is_remote(request: Request) -> bool:
    if any(h in request.headers for h in ("cf-ray", "cf-connecting-ip", "x-forwarded-for")):
        return True  # đi qua Cloudflare hoặc một proxy: coi là từ xa
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].lower()
    return host not in _LOCAL_HOSTS


@app.middleware("http")
async def remote_login(request: Request, call_next):
    if not _is_remote(request):
        return await call_next(request)
    password = _admin_password()
    if not password:
        return Response("Chưa đặt mật khẩu quản trị nên không cho truy cập từ xa.", status_code=403, media_type="text/plain; charset=utf-8")
    auth = request.headers.get("authorization", "")
    if auth.startswith("Basic "):
        try:
            user, _, given = base64.b64decode(auth[6:]).decode("utf-8").partition(":")
        except (ValueError, UnicodeDecodeError):
            user, given = "", ""
        if secrets.compare_digest(user.encode(), b"admin") and secrets.compare_digest(given.encode(), password.encode()):
            return await call_next(request)
    return Response("Cần đăng nhập", status_code=401, media_type="text/plain; charset=utf-8",
                    headers={"WWW-Authenticate": 'Basic realm="TourFP", charset="UTF-8"'})


if not _native_pna:  # Starlette cũ chưa có tuỳ chọn trên: tự thêm header

    @app.middleware("http")
    async def allow_private_network(request: Request, call_next):
        response = await call_next(request)
        if request.headers.get("access-control-request-private-network") and request.headers.get("origin") == TARGET:
            response.headers["Access-Control-Allow-Private-Network"] = "true"
        return response


# ---------- lưu trữ ----------
def db() -> sqlite3.Connection:
    DATA.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute(
        """CREATE TABLE IF NOT EXISTS tours (
               id TEXT PRIMARY KEY,
               name TEXT NOT NULL,
               description TEXT NOT NULL DEFAULT '',
               start_path TEXT NOT NULL,
               layout TEXT NOT NULL DEFAULT '',
               step_count INTEGER NOT NULL,
               steps TEXT NOT NULL,
               created_at REAL NOT NULL
           )"""
    )
    conn.execute(
        """CREATE TABLE IF NOT EXISTS test_runs (
               id TEXT PRIMARY KEY, started_at REAL NOT NULL, finished_at REAL, trigger TEXT NOT NULL,
               status TEXT NOT NULL, results TEXT NOT NULL DEFAULT '[]'
           )"""
    )
    conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    return conn


def get_setting(conn: sqlite3.Connection, key: str, default: Any = None) -> Any:
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_setting(conn: sqlite3.Connection, key: str, value: Any) -> None:
    conn.execute("INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", (key, json.dumps(value)))


def summary(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "name": row["name"],
        "description": row["description"],
        "start_path": row["start_path"],
        "start_url": TARGET + row["start_path"],
        "layout": row["layout"],
        "step_count": row["step_count"],
        "created_at": row["created_at"],
        "app_version": versions.label(_first_app(row)),  # phiên bản trang đích lúc ghi tour
    }


def _first_app(row: sqlite3.Row) -> dict[str, Any] | None:
    try:
        steps = json.loads(row["steps"])
        return steps[0].get("app") if steps else None
    except (ValueError, IndexError, AttributeError):
        return None


def get_row(conn: sqlite3.Connection, tour_id: str) -> sqlite3.Row:
    row = conn.execute("SELECT * FROM tours WHERE id = ?", (tour_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "Không có tour này")
    return row


# ---------- dữ liệu vào ----------
class TourIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    steps: list[dict[str, Any]] = Field(min_length=1, max_length=MAX_STEPS)

    @field_validator("name", "description")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()

    @field_validator("name")
    @classmethod
    def not_blank(cls, v: str) -> str:
        if not v:
            raise ValueError("Tên tour không được để trống")
        return v

    @field_validator("steps")
    @classmethod
    def check_steps(cls, steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
        for i, step in enumerate(steps, 1):
            if step.get("kind") not in KINDS:
                raise ValueError(f"Bước {i}: 'kind' phải là một trong {sorted(KINDS)}")
            fp = step.get("fp")
            ctx = fp.get("ctx") if isinstance(fp, dict) else None
            if not isinstance(ctx, dict) or not isinstance(ctx.get("path"), str) or not ctx["path"].startswith("/"):
                raise ValueError(f"Bước {i}: thiếu dấu vân tay hoặc đường dẫn màn hình (fp.ctx.path)")
        return steps


# ---------- API ----------
_adapter: ai.Adapter | None = None
_adapter_ready = False


def adapter() -> tuple[ai.Adapter | None, str | None]:
    """Adaptor AI theo cấu hình (tạo một lần), kèm lỗi cấu hình nếu có."""
    global _adapter, _adapter_ready
    if not _adapter_ready:
        try:
            _adapter = ai.from_env()
        except ai.AIError as e:
            return None, str(e)  # cấu hình sai: lần gọi sau thử lại, phòng khi vừa được sửa
        _adapter_ready = True
    return _adapter, None


@app.get("/api/config")
def config() -> dict[str, Any]:
    ad, err = adapter()
    m = re.search(r"TourFP (\d+\.\d+\.\d+)", LIB.read_text(encoding="utf-8")[:200])
    # version: bản thư viện, để nút TourFP (dấu trang) nạp đúng bản đó từ CDN
    return {"target": TARGET, "version": m.group(1) if m else "", "ai": ad.name if ad else "off", "ai_model": os.environ.get("TOURFP_AI_MODEL", "") if ad else "", "ai_error": err}


@app.get("/api/tours")
def list_tours() -> list[dict[str, Any]]:
    with closing(db()) as conn:
        rows = conn.execute("SELECT * FROM tours ORDER BY created_at DESC").fetchall()
    return [summary(r) for r in rows]


@app.post("/api/tours", status_code=201)
def create_tour(tour: TourIn) -> dict[str, Any]:
    steps_json = json.dumps(tour.steps, ensure_ascii=False)
    if len(steps_json.encode()) > MAX_BYTES:
        raise HTTPException(413, "Tour quá lớn")
    first = tour.steps[0]["fp"]["ctx"]
    row = (
        uuid.uuid4().hex[:12],
        tour.name,
        tour.description,
        first["path"],
        str(first.get("layout") or ""),
        len(tour.steps),
        steps_json,
        time.time(),
    )
    with closing(db()) as conn, conn:
        conn.execute("INSERT INTO tours VALUES (?, ?, ?, ?, ?, ?, ?, ?)", row)
        return summary(get_row(conn, row[0]))


@app.get("/api/tours/{tour_id}")
def get_tour(tour_id: str) -> dict[str, Any]:
    with closing(db()) as conn:
        row = get_row(conn, tour_id)
    return {**summary(row), "steps": json.loads(row["steps"])}


class TourPatch(BaseModel):
    """Sửa tên, mô tả, hoặc tên hiển thị của từng bước. Trường nào không gửi thì giữ nguyên."""

    name: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=500)
    # tên hiển thị cho từng bước, theo đúng thứ tự bước; chuỗi rỗng hoặc null = dùng lại tên tự lấy từ giao diện
    titles: list[str | None] | None = Field(default=None, max_length=MAX_STEPS)


@app.patch("/api/tours/{tour_id}")
def update_tour(tour_id: str, patch: TourPatch) -> dict[str, Any]:
    with closing(db()) as conn, conn:
        row = get_row(conn, tour_id)
        if patch.name is not None:
            name = patch.name.strip()
            if not name:
                raise HTTPException(422, "Tên tour không được để trống")
            conn.execute("UPDATE tours SET name = ? WHERE id = ?", (name, tour_id))
        if patch.description is not None:
            conn.execute("UPDATE tours SET description = ? WHERE id = ?", (patch.description.strip(), tour_id))
        if patch.titles is not None:
            steps = json.loads(row["steps"])
            if len(patch.titles) != len(steps):
                raise HTTPException(422, f"Cần đúng {len(steps)} tên, mỗi bước một tên")
            for step, title in zip(steps, patch.titles):
                title = (title or "").strip()[:80]
                if title:
                    step["title"] = title
                else:
                    step.pop("title", None)
            conn.execute("UPDATE tours SET steps = ? WHERE id = ?", (json.dumps(steps, ensure_ascii=False), tour_id))
        row = get_row(conn, tour_id)
    return {**summary(row), "steps": json.loads(row["steps"])}


@app.delete("/api/tours/{tour_id}", status_code=204)
def delete_tour(tour_id: str) -> Response:
    with closing(db()) as conn, conn:
        get_row(conn, tour_id)
        conn.execute("DELETE FROM tours WHERE id = ?", (tour_id,))
    return Response(status_code=204)


class AssistIn(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    layout: Literal["desktop", "mobile"] | None = None

    @field_validator("query")
    @classmethod
    def not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Hãy nhập màn hình bạn muốn tới")
        return v


@app.post("/api/assist")
def assist_route(body: AssistIn) -> dict[str, Any]:
    """Người dùng nói muốn tới màn hình nào; trả về tour phù hợp, bước cần dừng và hai cách đi (dẫn từng bước, vào thẳng)."""
    with closing(db()) as conn:
        rows = conn.execute("SELECT * FROM tours ORDER BY created_at DESC").fetchall()
    tours = [{**summary(r), "steps": json.loads(r["steps"])} for r in rows]
    ad, err = adapter()
    result = assist.find_tour(body.query, body.layout, tours, ad, TARGET)
    if err:
        result["ai_error"] = err
    return result


@app.get("/api/tours/{tour_id}/snippet.js")
def snippet(tour_id: str, mode: Literal["guide", "direct"] = "guide", to: int | None = None) -> Response:
    """Mã chạy thử: cả thư viện lẫn tour trong một đoạn, dán vào console của trang đích là phát ngay.

    mode=guide dẫn từng bước, mode=direct tự đưa tới nơi; to=x dừng sau bước x (mặc định: hết tour).
    """
    with closing(db()) as conn:
        row = get_row(conn, tour_id)
    last = min(max(to or row["step_count"], 1), row["step_count"])
    start = json.dumps({"mode": mode, "to": last})
    # TOURFP_PLAYER: chỉ phát, không hiện thanh ghi tour. Xoá cờ ngay sau khi nạp để lần nạp thư viện sau không bị ảnh hưởng.
    code = (
        "window.TOURFP_PLAYER=true;\n"
        f"{LIB.read_text(encoding='utf-8')}\n"
        f";delete window.TOURFP_PLAYER;TourFP.load({row['steps']});TourFP.start({start});\n"
    )
    return Response(code, media_type="text/javascript; charset=utf-8", headers={"Cache-Control": "no-store"})


# ---------- kiểm thử tự động ----------
# Trạng thái lần chạy đang diễn ra (chỉ một lần chạy tại một thời điểm, vì chúng dùng chung một hồ sơ trình duyệt).
test_state: dict[str, Any] = {"running": False, "login_open": False, "record_open": False, "play_open": False, "current": "", "done": 0, "total": 0, "error": None,
              "record_error": None, "play_error": None}  # lỗi riêng của cửa sổ ghi tour và chạy thử
# tour vừa ghi trong Chrome do trang quản trị mở, chờ người dùng đặt tên và lưu ở hộp Thêm tour
record_draft: dict[str, Any] = {"steps": None, "at": 0.0}


def _browser_busy() -> bool:
    """Hồ sơ trình duyệt chỉ mở được ở một nơi: đang kiểm thử, hoặc đang mở cửa sổ đăng nhập, ghi tour hay chạy thử."""
    return bool(test_state["running"] or test_state["login_open"] or test_state["record_open"] or test_state["play_open"])
_tasks: set[asyncio.Task] = set()  # giữ tham chiếu để tác vụ nền không bị thu hồi giữa chừng


def _spawn(coro: Any) -> None:
    task = asyncio.create_task(coro)
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


def _all_tours(conn: sqlite3.Connection) -> list[dict[str, Any]]:
    rows = conn.execute("SELECT * FROM tours ORDER BY created_at DESC").fetchall()
    return [{**summary(r), "steps": json.loads(r["steps"])} for r in rows]


def _counts(results: list[dict[str, Any]]) -> dict[str, int]:
    c = {"pass": 0, "warn": 0, "fail": 0, "error": 0, "need_login": 0, "blocked": 0}
    for r in results:
        c[r["status"]] = c.get(r["status"], 0) + 1
    return c


async def do_test_run(trigger: str) -> None:
    """Chạy kiểm thử mọi tour và lưu kết quả. trigger: 'manual' (bấm nút) hoặc 'schedule' (lịch hằng ngày)."""
    if _browser_busy():
        return
    with closing(db()) as conn:
        tours = _all_tours(conn)
        show = bool(get_setting(conn, "test_show_browser", SHOW_DEFAULT))
    run_id, started = uuid.uuid4().hex[:12], time.time()
    test_state.update(running=True, current="", done=0, total=len(tours), error=None)

    def progress(done: int, total: int, name: str) -> None:
        test_state.update(done=done, total=total, current=name)

    status, results = "done", []
    try:
        results = await runner.run_all(tours, TARGET, PROFILE, LIB, not show, progress)
        # so phiên bản trang lúc ghi (bước đầu của tour) với lúc kiểm thử
        recorded = {t["id"]: (t["steps"][0].get("app") if t["steps"] else None) for t in tours}
        for r in results:
            r["compat"] = versions.compat(recorded.get(r["tour_id"]), r.get("app"), r["status"])
        if any(r["status"] == "blocked" for r in results):
            status = "blocked"
        elif any(r["status"] == "need_login" for r in results):
            status = "need_login"
    except Exception as e:  # không mở được trình duyệt, chưa cài Playwright…
        status = "error"
        test_state["error"] = f"{type(e).__name__}: {e}"[:400]
    finally:
        with closing(db()) as conn, conn:
            conn.execute(
                "INSERT INTO test_runs VALUES (?, ?, ?, ?, ?, ?)",
                (run_id, started, time.time(), trigger, status, json.dumps({"results": results, "error": test_state["error"]}, ensure_ascii=False)),
            )
            conn.execute("DELETE FROM test_runs WHERE id NOT IN (SELECT id FROM test_runs ORDER BY started_at DESC LIMIT 60)")
        test_state.update(running=False, current="", done=len(results))


async def do_login() -> None:
    if _browser_busy():
        return
    test_state.update(login_open=True, error=None)
    try:
        await runner.open_login(TARGET, PROFILE)
    except Exception as e:
        test_state["error"] = f"{type(e).__name__}: {e}"[:400]
    finally:
        test_state["login_open"] = False


def _receive_recording(data: str) -> None:
    try:
        steps = json.loads(data)
    except ValueError:
        return
    if isinstance(steps, list) and steps:
        record_draft.update(steps=steps, at=time.time())


async def do_record() -> None:
    if _browser_busy():
        return
    test_state.update(record_open=True, record_error=None)
    try:
        await runner.open_recorder(TARGET, PROFILE, LIB, _receive_recording)
    except Exception as e:
        test_state["record_error"] = f"{type(e).__name__}: {e}"[:400]
    finally:
        test_state["record_open"] = False


async def do_play(url: str, steps: list[dict[str, Any]], start: dict[str, Any], layout: str) -> None:
    if _browser_busy():
        return
    test_state.update(play_open=True, play_error=None)
    try:
        await runner.open_player(url, PROFILE, LIB, steps, start, layout)
    except Exception as e:
        test_state["play_error"] = f"{type(e).__name__}: {e}"[:400]
    finally:
        test_state["play_open"] = False


async def scheduler() -> None:
    """Mỗi nửa phút xem đã tới giờ chạy hằng ngày chưa. Mỗi ngày chạy một lần; máy chủ bật muộn hơn giờ hẹn thì chạy bù ngay."""
    while True:
        await asyncio.sleep(30)
        try:
            with closing(db()) as conn:
                sched = get_setting(conn, "test_schedule", {"enabled": False, "time": "08:30"})
                last = get_setting(conn, "test_schedule_last", "")
            now = datetime.datetime.now()
            today = now.strftime("%Y-%m-%d")
            if sched["enabled"] and last != today and now.strftime("%H:%M") >= sched["time"] and not (_browser_busy()):
                with closing(db()) as conn, conn:
                    set_setting(conn, "test_schedule_last", today)
                _spawn(do_test_run("schedule"))
        except Exception:
            pass  # lỗi đọc cấu hình không được làm chết vòng lặp lịch


def _run_view(row: sqlite3.Row, full: bool) -> dict[str, Any]:
    data = json.loads(row["results"])
    results = data.get("results", [])
    out = {"id": row["id"], "started_at": row["started_at"], "finished_at": row["finished_at"], "trigger": row["trigger"],
           "status": row["status"], "counts": _counts(results), "error": data.get("error")}
    if full:
        out["results"] = results
    return out


@app.get("/api/tests")
async def tests_overview() -> dict[str, Any]:
    try:
        import playwright  # noqa: F401
        available = True
    except ImportError:
        available = False
    with closing(db()) as conn:
        runs = conn.execute("SELECT * FROM test_runs ORDER BY started_at DESC LIMIT 14").fetchall()
        sched = get_setting(conn, "test_schedule", {"enabled": False, "time": "08:30"})
        show = bool(get_setting(conn, "test_show_browser", SHOW_DEFAULT))
    return {
        "available": available, **test_state, "schedule": sched, "show_browser": show,
        "last": _run_view(runs[0], True) if runs else None,
        "history": [_run_view(r, False) for r in runs],
    }


@app.post("/api/tests/run", status_code=202)
async def tests_run() -> dict[str, Any]:
    if _browser_busy():
        raise HTTPException(409, "Đang có một lần chạy hoặc cửa sổ đăng nhập đang mở")
    _spawn(do_test_run("manual"))
    return {"started": True}


class PlayIn(BaseModel):
    mode: Literal["guide", "direct"] = "guide"
    to: int | None = Field(default=None, ge=1, le=MAX_STEPS)


@app.post("/api/tours/{tour_id}/play", status_code=202)
async def tour_play(tour_id: str, body: PlayIn) -> dict[str, Any]:
    """Chạy thử: máy chủ mở Chrome tại màn bắt đầu của tour và phát tour ngay."""
    if _browser_busy():
        raise HTTPException(409, "Chrome của máy chủ đang được dùng (kiểm thử, đăng nhập, ghi tour hoặc chạy thử)")
    with closing(db()) as conn:
        row = get_row(conn, tour_id)
    last = min(body.to or row["step_count"], row["step_count"])
    _spawn(do_play(TARGET + row["start_path"], json.loads(row["steps"]), {"mode": body.mode, "to": last}, row["layout"] or ""))
    return {"opened": True}


@app.get("/api/play")
async def play_status() -> dict[str, Any]:
    return {"open": test_state["play_open"], "error": test_state["play_error"]}


@app.post("/api/record", status_code=202)
async def record_open() -> dict[str, Any]:
    """Mở Chrome có sẵn thanh ghi tour. Ghi xong bấm "Gửi" trên thanh ghi, tour hiện ở hộp Thêm tour."""
    if _browser_busy():
        raise HTTPException(409, "Chrome của máy chủ đang được dùng (kiểm thử, đăng nhập hoặc đang ghi tour)")
    _spawn(do_record())
    return {"opened": True}


@app.get("/api/record")
async def record_status() -> dict[str, Any]:
    steps = record_draft["steps"]
    return {"open": test_state["record_open"], "error": test_state["record_error"], "steps": steps, "at": record_draft["at"],
            "layout": ((steps[0].get("fp") or {}).get("ctx") or {}).get("layout", "") if steps else ""}


@app.delete("/api/record", status_code=204)
async def record_clear() -> Response:
    record_draft.update(steps=None, at=0.0)
    return Response(status_code=204)


@app.post("/api/tests/login", status_code=202)
async def tests_login() -> dict[str, Any]:
    if _browser_busy():
        raise HTTPException(409, "Đang có một lần chạy hoặc cửa sổ đăng nhập đang mở")
    _spawn(do_login())
    return {"opened": True}


class ScheduleIn(BaseModel):
    enabled: bool
    time: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


@app.put("/api/tests/schedule")
async def tests_schedule(body: ScheduleIn) -> dict[str, Any]:
    with closing(db()) as conn, conn:
        set_setting(conn, "test_schedule", {"enabled": body.enabled, "time": body.time})
    return {"enabled": body.enabled, "time": body.time}


class ShowBrowserIn(BaseModel):
    show: bool


@app.put("/api/tests/show-browser")
async def tests_show_browser(body: ShowBrowserIn) -> dict[str, Any]:
    """Bật/tắt việc mở Chrome có cửa sổ khi kiểm thử (áp dụng từ lần chạy sau)."""
    with closing(db()) as conn, conn:
        set_setting(conn, "test_show_browser", body.show)
    return {"show_browser": body.show}


# ---------- file tĩnh ----------
@app.get("/tourfp.js")
def lib() -> FileResponse:
    return FileResponse(LIB, media_type="text/javascript; charset=utf-8", headers={"Cache-Control": "no-store"})


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE / "static" / "index.html", headers={"Cache-Control": "no-store"})
