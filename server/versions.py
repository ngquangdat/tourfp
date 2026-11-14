"""So phiên bản trang đích lúc ghi tour với lúc kiểm thử, để báo tương thích xuôi, ngược hay không tương thích.

Phiên bản (do tourfp.js đọc trên trang): {"version": số phiên bản trang tự khai báo, "build": "main-XXXX",
"builtAt": thời điểm build (ms, từ /ngsw.json), "ng": phiên bản Angular}. Tour cũ chưa có thông tin này.
"""
from __future__ import annotations

import datetime
import re
from typing import Any

Info = dict[str, Any] | None


def label(a: Info) -> str:
    if not a:
        return ""
    parts = []
    if a.get("version"):
        parts.append(str(a["version"]))
    if a.get("builtAt"):
        parts.append("build " + datetime.datetime.fromtimestamp(a["builtAt"] / 1000).strftime("%d/%m/%Y %H:%M"))
    if a.get("build") and not a.get("version"):
        parts.append(str(a["build"]))
    return " · ".join(parts)


def _semver(v: str) -> tuple[int, ...] | None:
    m = re.fullmatch(r"v?(\d+(?:\.\d+){0,3})", (v or "").strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else None


def relation(rec: Info, now: Info) -> str:
    """same | newer (lúc kiểm thử mới hơn lúc ghi) | older | different (khác nhưng không biết bản nào mới hơn) | unknown."""
    if not rec or not now or not any(rec.get(k) for k in ("version", "build", "builtAt")) or not any(now.get(k) for k in ("version", "build", "builtAt")):
        return "unknown"
    if rec.get("version") and now.get("version"):
        a, b = _semver(rec["version"]), _semver(now["version"])
        if rec["version"] == now["version"]:
            return "same"
        if a and b:
            return "newer" if b > a else "older"
    if rec.get("build") and rec.get("build") == now.get("build"):
        return "same"
    if rec.get("builtAt") and now.get("builtAt"):
        if rec["builtAt"] == now["builtAt"]:
            return "same"
        return "newer" if now["builtAt"] > rec["builtAt"] else "older"
    return "different"


def compat(rec: Info, now: Info, status: str) -> dict[str, str] | None:
    """Kết luận tương thích cho một tour sau một lần kiểm thử. None khi lần chạy không nói được gì (bị chặn, cần đăng nhập…)."""
    if status not in ("pass", "warn", "fail"):
        return None
    rel, ok = relation(rec, now), status in ("pass", "warn")
    out = {"relation": rel, "recorded": label(rec), "tested": label(now)}
    if rel == "unknown":
        known = lambda a: bool(a) and any(a.get(k) for k in ("version", "build", "builtAt"))
        out.update(kind="unknown", text="Tour chưa có phiên bản trang lúc ghi (ghi lại tour để có)" if not known(rec)
                   else "Không đọc được phiên bản trang lúc kiểm thử")
    elif rel == "same":
        out.update(kind="same", text="Cùng phiên bản lúc ghi")
    elif not ok:
        out.update(kind="incompatible", text="Không tương thích: tour lỗi trên bản " + ("mới hơn" if rel == "newer" else "cũ hơn" if rel == "older" else "khác") + " lúc ghi")
    elif rel == "newer":
        out.update(kind="forward", text="Tương thích xuôi: tour ghi ở bản cũ vẫn chạy trên bản mới hơn")
    elif rel == "older":
        out.update(kind="backward", text="Tương thích ngược: tour ghi ở bản mới vẫn chạy trên bản cũ hơn")
    else:
        out.update(kind="compatible", text="Tương thích với bản khác lúc ghi")
    return out
