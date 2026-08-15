from __future__ import annotations

import json
import os
import urllib.error
import urllib.request


class MemoryExtractor:
    def __init__(
        self,
        api_key: str,
        model: str = "deepseek-v4-flash",
        base_url: str = "https://api.deepseek.com",
        timeout_seconds: int = 30,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(cls) -> "MemoryExtractor | None":
        if os.environ.get("MEMORY_EXTRACTOR_ENABLED", "true").strip().lower() == "false":
            return None
        api_key = os.environ.get("MEMORY_EXTRACTOR_API_KEY") or os.environ.get("DEEPSEEK_API_KEY")
        if not api_key:
            return None
        return cls(
            api_key=api_key,
            model=os.environ.get("MEMORY_EXTRACTOR_MODEL", os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")),
            base_url=os.environ.get("MEMORY_EXTRACTOR_BASE_URL", os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")),
            timeout_seconds=int(os.environ.get("MEMORY_EXTRACTOR_TIMEOUT_SECONDS", "30")),
        )

    def extract(self, user_message: str, assistant_message: str, character_name: str) -> dict | None:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是长期记忆提取器。只输出 JSON，不要输出解释。"
                        "从一轮用户与角色对话中判断是否有值得长期保存的玩家记忆。"
                        "只保存稳定事实、长期偏好、昵称、重要约定、关系事件。"
                        "不要保存寒暄、短暂情绪、重复内容、角色自己的设定或模型回复。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"角色名: {character_name}\n"
                        f"用户: {user_message}\n"
                        f"角色回复: {assistant_message}\n\n"
                        "输出 JSON schema:\n"
                        "{"
                        "\"should_write\": boolean,"
                        "\"memory\": string,"
                        "\"importance\": number"
                        "}\n"
                        "importance 范围 0 到 1。"
                    ),
                },
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "thinking": {"type": "disabled"},
        }
        response = self._post_json(payload)
        content = response["choices"][0]["message"].get("content", "")
        if not content:
            return None
        parsed = json.loads(content)
        if not isinstance(parsed, dict) or not parsed.get("should_write"):
            return None
        memory = str(parsed.get("memory", "")).strip()
        if not memory:
            return None
        importance = float(parsed.get("importance", 0.5))
        return {
            "memory": memory,
            "importance": max(0.0, min(1.0, importance)),
        }

    def _post_json(self, payload: dict) -> dict:
        request = urllib.request.Request(
            self._url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self._api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"MemoryExtractor 请求失败: HTTP {error.code} {detail}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"MemoryExtractor 请求失败: {error.reason}") from error

