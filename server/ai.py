"""Lớp nối tới mô hình AI. Mỗi adaptor chỉ làm một việc: nhận lời nhắc hệ thống và câu của người dùng, trả về văn bản.

Chọn adaptor bằng biến môi trường TOURFP_AI:
  off      (mặc định) không gọi AI; trợ lý tìm tour bằng so khớp từ khoá
  bedrock  Amazon Bedrock, qua API Converse của boto3
  litellm  LiteLLM proxy (hoặc bất kỳ máy chủ nào nói giao thức chat/completions kiểu OpenAI)

Chung:
  TOURFP_AI_MODEL       tên mô hình. Bắt buộc khi bật AI; không có giá trị mặc định vì mỗi tài khoản được cấp mô hình khác nhau.
  TOURFP_AI_MAX_TOKENS  giới hạn độ dài câu trả lời (mặc định 1024)
  TOURFP_AI_TIMEOUT     số giây chờ tối đa (mặc định 30)

Bedrock:  AWS_REGION (hoặc AWS_DEFAULT_REGION) và thông tin đăng nhập AWS theo cách thông thường của boto3.
          Cần cài thêm:  pip install boto3
LiteLLM:  TOURFP_LITELLM_URL  địa chỉ proxy, ví dụ http://localhost:4000
          TOURFP_LITELLM_KEY  khoá của proxy (nếu proxy yêu cầu)
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Protocol


class AIError(RuntimeError):
    """Không gọi được mô hình, hoặc mô hình trả về thứ không dùng được."""


class Adapter(Protocol):
    name: str

    def complete(self, system: str, user: str) -> str:
        """Trả về văn bản mô hình sinh ra. Ném AIError nếu thất bại."""
        ...


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


class BedrockAdapter:
    name = "bedrock"

    def __init__(self, model: str, region: str | None, max_tokens: int, timeout: int) -> None:
        try:
            import boto3
            from botocore.config import Config
        except ImportError as e:  # boto3 không nằm trong requirements.txt để máy chủ vẫn nhẹ khi không dùng Bedrock
            raise AIError("Chưa cài boto3. Chạy: pip install boto3") from e
        self.model, self.max_tokens = model, max_tokens
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(read_timeout=timeout, connect_timeout=10, retries={"max_attempts": 2}),
        )

    def complete(self, system: str, user: str) -> str:
        try:
            # Không gửi temperature/top_p: nhiều mô hình mới từ chối các tham số này.
            r = self.client.converse(
                modelId=self.model,
                system=[{"text": system}],
                messages=[{"role": "user", "content": [{"text": user}]}],
                inferenceConfig={"maxTokens": self.max_tokens},
            )
        except Exception as e:  # botocore ném nhiều loại lỗi; với người gọi thì đều là "không gọi được"
            raise AIError(f"Bedrock: {type(e).__name__}: {e}") from e
        parts = (r.get("output", {}).get("message", {}).get("content")) or []
        text = "".join(p.get("text", "") for p in parts if isinstance(p, dict))
        if not text.strip():
            raise AIError(f"Bedrock không trả về văn bản (stopReason={r.get('stopReason')})")
        return text


class LiteLLMAdapter:
    name = "litellm"

    def __init__(self, model: str, base_url: str, api_key: str | None, max_tokens: int, timeout: int) -> None:
        base = base_url.rstrip("/")
        self.url = base + ("/chat/completions" if base.endswith("/v1") else "/v1/chat/completions")
        self.model, self.api_key, self.max_tokens, self.timeout = model, api_key, max_tokens, timeout

    def complete(self, system: str, user: str) -> str:
        body = json.dumps(
            {
                "model": self.model,
                "max_tokens": self.max_tokens,
                "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            }
        ).encode()
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = e.read().decode("utf-8", "replace")[:300]
            raise AIError(f"LiteLLM trả về HTTP {e.code}: {detail}") from e
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            raise AIError(f"LiteLLM: {type(e).__name__}: {e}") from e
        try:
            text = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as e:
            raise AIError("LiteLLM trả về dữ liệu không đúng dạng chat/completions") from e
        if not isinstance(text, str) or not text.strip():
            raise AIError("LiteLLM không trả về văn bản")
        return text


def from_env() -> Adapter | None:
    """Adaptor theo cấu hình, hoặc None khi AI đang tắt. Ném AIError nếu cấu hình thiếu."""
    kind = os.environ.get("TOURFP_AI", "off").strip().lower()
    if kind in ("", "off", "none", "0"):
        return None
    model = os.environ.get("TOURFP_AI_MODEL", "").strip()
    if not model:
        raise AIError("Thiếu TOURFP_AI_MODEL (tên mô hình)")
    max_tokens, timeout = _env_int("TOURFP_AI_MAX_TOKENS", 1024), _env_int("TOURFP_AI_TIMEOUT", 30)
    if kind == "bedrock":
        region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
        return BedrockAdapter(model, region, max_tokens, timeout)
    if kind == "litellm":
        url = os.environ.get("TOURFP_LITELLM_URL", "").strip()
        if not url:
            raise AIError("Thiếu TOURFP_LITELLM_URL (địa chỉ LiteLLM proxy)")
        return LiteLLMAdapter(model, url, os.environ.get("TOURFP_LITELLM_KEY") or None, max_tokens, timeout)
    raise AIError(f"TOURFP_AI={kind!r} không hợp lệ. Chọn: off, bedrock, litellm")
