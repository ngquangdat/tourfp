"""TourFP admin: lưu, liệt kê, xoá và chạy thử các tour đã ghi bằng tourfp.js.

Chạy:  uvicorn main:app --app-dir server --port 8000
Cấu hình qua biến môi trường:
  TOURFP_TARGET  trang web mà tour chạy trên đó (mặc định https://tcinvest.tcbs.com.vn)
  TOURFP_DATA    thư mục chứa file SQLite (mặc định server/data)
  TOURFP_AI      off | bedrock | litellm: mô hình dùng cho trợ lý tìm tour (xem ai.py)

Không có đăng nhập: đây là công cụ nội bộ, chỉ nên nghe trên 127.0.0.1.
"""
from __future__ import annotations

import inspect
import json
import os
import sqlite3
import time
import uuid
from contextlib import closing
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field, field_validator

import ai
import assist

BASE = Path(__file__).resolve().parent
LIB = BASE.parent / "tourfp.js"
DATA = Path(os.environ.get("TOURFP_DATA", BASE / "data"))
DB = DATA / "tours.db"
TARGET = os.environ.get("TOURFP_TARGET", "https://tcinvest.tcbs.com.vn").rstrip("/")

KINDS = {"click", "hover", "input", "info"}
MAX_STEPS = 200
MAX_BYTES = 2_000_000  # một tour vài chục bước chỉ khoảng vài chục KB

app = FastAPI(title="TourFP admin", docs_url=None, redoc_url=None)

# Thư viện chạy trên trang đích gọi sang đây để lưu và tải tour.
# Chrome còn hỏi thêm quyền khi một trang công khai gọi vào máy cục bộ ("private network"); chỉ đồng ý cho trang đích.
_cors: dict[str, Any] = {"allow_origins": [TARGET], "allow_methods": ["GET", "POST"], "allow_headers": ["Content-Type"]}
_native_pna = "allow_private_network" in inspect.signature(CORSMiddleware.__init__).parameters
if _native_pna:
    _cors["allow_private_network"] = True
app.add_middleware(CORSMiddleware, **_cors)

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
    return conn


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
    }


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
    return {"target": TARGET, "ai": ad.name if ad else "off", "ai_model": os.environ.get("TOURFP_AI_MODEL", "") if ad else "", "ai_error": err}


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


# ---------- file tĩnh ----------
@app.get("/tourfp.js")
def lib() -> FileResponse:
    return FileResponse(LIB, media_type="text/javascript; charset=utf-8", headers={"Cache-Control": "no-store"})


@app.get("/")
def index() -> FileResponse:
    return FileResponse(BASE / "static" / "index.html", headers={"Cache-Control": "no-store"})
