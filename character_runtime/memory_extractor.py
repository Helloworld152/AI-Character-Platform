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

    def extract(
        self,
        user_message: str,
        assistant_message: str,
        character_name: str,
        existing_facts: list[str] | None = None,
    ) -> dict | None:
        fact_result = self._extract_fact(
            user_message=user_message,
            assistant_message=assistant_message,
            existing_facts=existing_facts or [],
        )
        if fact_result is None:
            return None

        diary = self._generate_diary(
            character_name=character_name,
            user_message=user_message,
            assistant_message=assistant_message,
            fact=fact_result["fact"],
        )
        if not diary:
            return None
        return {
            "fact": fact_result["fact"],
            "diary": diary,
            "importance": fact_result["importance"],
        }

    def _extract_fact(
        self,
        user_message: str,
        assistant_message: str,
        existing_facts: list[str],
    ) -> dict | None:
        facts_text = (
            "\n".join(f"- {fact}" for fact in existing_facts)
            if existing_facts
            else "(当前没有客观事实记忆)"
        )
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是长期记忆事实提取器。只输出 JSON，不要输出解释。"
                        "从本轮对话中提取用户明确表达、值得长期保存的稳定事实。"
                        "只保存稳定事实、长期偏好、昵称、重要约定、关系事件。"
                        "不要保存寒暄、短暂情绪、重复内容、角色自己的设定或模型回复。"
                        "用户原话是唯一的事实来源，角色回复只能作为语境，不能补充、替换或推测用户事实。"
                        "先逐项比较已有客观事实与用户本轮明确表达的事实。"
                        "相似主题不等于事实完整覆盖；已有事实只覆盖一部分时，仍要写入尚未覆盖的部分。"
                        "如果已有事实已经覆盖本轮全部核心事实，should_write 必须为 false。"
                        "如果事实被用户删除后只残留在聊天记录里，也必须视为不存在；只能依据提供的客观事实列表判断。"
                        "例如已有事实只有‘用户喜欢 JRPG’，本轮说‘喜欢玩主机游戏、看番，是个二次元’，仍需写入缺失事实，不能把主机游戏擅自等同为 JRPG。"
                        "fact 字段必须是简洁、客观、第三方视角的事实，不要写情绪，不要写角色日记。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        "当前客观事实记忆（仅依据此列表判断长期记忆是否存在）:\n"
                        f"{facts_text}\n\n"
                        f"用户: {user_message}\n"
                        f"角色回复: {assistant_message}\n\n"
                        "输出 JSON schema:\n"
                        "{\"should_write\": boolean, \"fact\": string, \"importance\": number}\n"
                        "fact 请完整保留用户本轮需要新增的稳定事实；importance 范围 0 到 1。"
                    ),
                },
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
            "thinking": {"type": "disabled"},
        }
        parsed = self._parse_json_response(self._post_json(payload))
        if not parsed or not parsed.get("should_write"):
            return None
        fact = str(parsed.get("fact", "")).strip()
        if not fact:
            return None
        importance = float(parsed.get("importance", 0.5))
        return {
            "fact": fact,
            "importance": max(0.0, min(1.0, importance)),
        }

    def _generate_diary(
        self,
        character_name: str,
        user_message: str,
        assistant_message: str,
        fact: str,
    ) -> str | None:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是角色的私人日记生成器。只输出 JSON，不要输出解释。"
                        "根据已经确认的客观事实，写一段角色第一人称的短日记。"
                        "日记只服务于角色本人，不是给用户看的总结，也不要提到记忆系统。"
                        "可以写角色当下真实、克制的情绪，但情绪必须来自本轮对话语境，不能凭空添加剧情、暧昧或伤感。"
                        "必须完整保留 fact 的信息，不要把事实改成更窄的例子，也不要引入 fact 之外的用户信息。"
                        "不要使用‘所以我记住了’、‘以后可以多聊聊’、‘我会记得’、‘值得记录’等元话语。"
                        "不要写成第三方报告、数据库标签或客服总结。"
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f"角色名: {character_name}\n"
                        f"已确认的客观事实: {fact}\n"
                        f"用户原话: {user_message}\n"
                        f"角色回复（只用于理解情绪语境）: {assistant_message}\n\n"
                        "输出 JSON schema: {\"diary\": string}\n"
                        "diary 写成 1 到 3 句自然的角色私人日记，要有一点情绪和余韵，但保持克制。"
                    ),
                },
            ],
            "temperature": 0.4,
            "response_format": {"type": "json_object"},
            "thinking": {"type": "disabled"},
        }
        parsed = self._parse_json_response(self._post_json(payload))
        diary = str(parsed.get("diary", "")).strip() if parsed else ""
        return diary or None

    @staticmethod
    def _parse_json_response(response: dict) -> dict | None:
        content = response["choices"][0]["message"].get("content", "")
        if not content:
            return None
        parsed = json.loads(content)
        return parsed if isinstance(parsed, dict) else None

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
