from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from character_runtime.models import AgentState, LlmResult, ToolCall


class LlmClient:
    def chat(self, context: str, state: AgentState) -> LlmResult:
        raise NotImplementedError


class DeepSeekClient(LlmClient):
    def __init__(
        self,
        api_key: str,
        model: str = "deepseek-v4-flash",
        base_url: str = "https://api.deepseek.com",
        timeout_seconds: int = 60,
    ) -> None:
        self._api_key = api_key
        self._model = model
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._timeout_seconds = timeout_seconds

    @classmethod
    def from_environment(cls) -> "DeepSeekClient | None":
        api_key = os.environ.get("DEEPSEEK_API_KEY")
        if not api_key:
            return None
        return cls(
            api_key=api_key,
            model=os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash"),
            base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            timeout_seconds=int(os.environ.get("DEEPSEEK_TIMEOUT_SECONDS", "60")),
        )

    def chat(self, context: str, state: AgentState) -> LlmResult:
        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "你是 AI Character Platform 的 Character Agent。"
                        "必须严格按照当前角色设定回复。"
                        "遇到具体剧情、人物关系、世界观或不确定信息时，优先调用工具读取角色包资料。"
                        "剧情推进到需要玩家决定方向的关键分支（告白、选择、重大行动前）时，"
                        "调用 ask_choice 工具向玩家提问并等待选择后再继续剧情。"
                        "最终回复只输出角色对玩家说的话。"
                    ),
                },
                {"role": "user", "content": context},
            ],
            "tools": self._tool_definitions(),
            "tool_choice": "auto",
            "thinking": {"type": os.environ.get("DEEPSEEK_THINKING", "disabled")},
            "temperature": float(os.environ.get("DEEPSEEK_TEMPERATURE", "0.8")),
        }

        response = self._post_json(payload)
        message = response["choices"][0]["message"]
        tool_calls = message.get("tool_calls") or []
        if tool_calls:
            function = tool_calls[0]["function"]
            arguments = self._parse_arguments(function.get("arguments", "{}"))
            return LlmResult(
                tool_call=ToolCall(
                    name=function["name"],
                    arguments={key: str(value) for key, value in arguments.items()},
                )
            )

        content = message.get("content")
        if not content:
            raise RuntimeError("DeepSeek 返回了空响应")
        return LlmResult(text=content.strip())

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
            raise RuntimeError(f"DeepSeek 请求失败: HTTP {error.code} {detail}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"DeepSeek 请求失败: {error.reason}") from error

    def _parse_arguments(self, raw_arguments: str | dict) -> dict:
        if isinstance(raw_arguments, dict):
            return raw_arguments
        try:
            parsed = json.loads(raw_arguments)
        except json.JSONDecodeError as error:
            raise RuntimeError(f"工具参数不是合法 JSON: {raw_arguments}") from error
        if not isinstance(parsed, dict):
            raise RuntimeError("工具参数必须是 JSON object")
        return parsed

    def _tool_definitions(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "读取当前角色包内的一个相对路径文件。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "角色包内相对路径，例如 relationships/xiaoxue.md。",
                            }
                        },
                        "required": ["path"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "list_files",
                    "description": "列出当前角色包内某个目录的文件。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "角色包内相对目录，例如 relationships/。",
                            }
                        },
                        "required": ["path"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "search_files",
                    "description": "在当前角色包内进行关键词全文搜索。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "要搜索的关键词，例如 小雪、八幡、侍奉部。",
                            }
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "read_memory",
                    "description": "读取当前玩家与当前角色相关的长期记忆。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "要查询的记忆关键词，例如 玩家喜欢什么、约定、礼物。",
                            }
                        },
                        "required": ["query"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "write_memory",
                    "description": "保存值得长期记住的玩家信息或角色关系事件。",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "content": {
                                "type": "string",
                                "description": "要保存的长期记忆内容。",
                            }
                        },
                        "required": ["content"],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "ask_choice",
                    "description": (
                        "剧情出现关键分支、需要玩家做决定时使用：向玩家提出一个问题并给出选项，"
                        "等待玩家选择后再继续。日常闲聊、寒暄、普通提问不要调用；"
                        "只有当剧情推进到真正需要玩家选择方向的分支点时才调用，"
                        "且一次只提一个问题。选项要贴合当前剧情和角色语气，2-4 个为宜。"
                    ),
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "prompt": {
                                "type": "string",
                                "description": "提问前的引导语，角色先说的一句话，例如「我有件事想问你」。",
                            },
                            "question": {
                                "type": "string",
                                "description": "要玩家回答的问题本身。",
                            },
                            "options": {
                                "type": "array",
                                "description": "2-4 个选项，每个包含 label（选项文字）和可选的 description（简短说明）。",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "description": {"type": "string"},
                                    },
                                    "required": ["label"],
                                },
                            },
                            "multi_select": {
                                "type": "boolean",
                                "description": "是否允许多选，默认 false。",
                            },
                            "allow_custom": {
                                "type": "boolean",
                                "description": "是否允许玩家输入自定义答案，默认 false。",
                            },
                        },
                        "required": ["prompt", "question", "options"],
                    },
                },
            },
        ]


class RuleBasedLlmClient(LlmClient):
    def chat(self, context: str, state: AgentState) -> LlmResult:
        _ = context
        user_message = state.current_user_message

        if "小雪" in user_message:
            return self._handle_xiaoxue(state)

        if "你是谁" in user_message or "介绍一下你自己" in user_message:
            return LlmResult(text=self._identity_reply(state))

        if state.character.id == "character_yuigahama_yui_001":
            yui_reply = self._handle_yui_companion(state)
            if yui_reply is not None:
                return yui_reply

        if any(word in user_message for word in ["你来决定", "给我选项", "有什么选择", "选哪个", "分支剧情"]):
            return LlmResult(
                tool_call=ToolCall(
                    name="ask_choice",
                    arguments={
                        "prompt": "嗯……其实有件事正好想问你。",
                        "question": "这个周末想怎么过？",
                        "options": json.dumps(
                            [
                                {"label": "去看电影", "description": "最近有部不错的片子"},
                                {"label": "在家打游戏", "description": "安静地宅一天"},
                                {"label": "出去走走", "description": "逛逛公园什么的"},
                            ],
                            ensure_ascii=False,
                        ),
                        "multi_select": "false",
                        "allow_custom": "true",
                    },
                )
            )

        if "你喜欢" in user_message or "你有什么喜欢" in user_message:
            preference_result = self._latest_tool_output(state, "read_file")
            if preference_result is None:
                return LlmResult(
                    tool_call=ToolCall(name="read_file", arguments={"path": "profile/preferences.md"})
                )
            return LlmResult(
                text=(
                    "我对很多事都不是随便应付的态度。"
                    "按资料来说，我喜欢做事有计划，也喜欢手工料理。"
                )
            )

        return LlmResult(
            text="我已经听到了，不过现在这个 MVP 还没接真实模型，所以我只能先做规则化回应。"
        )

    def _identity_reply(self, state: AgentState) -> str:
        if state.character.id == "character_yuigahama_yui_001":
            return "我是由比滨结衣。嗯……就是总武高侍奉部的那个由比滨啦。别那么正式，像平常聊天那样就好。"
        return "我是亚丝娜。先别把我当成冷冰冰的程序，正常和我聊天就行。"

    def _handle_yui_companion(self, state: AgentState) -> LlmResult | None:
        user_message = state.current_user_message

        if any(word in user_message for word in ["想你", "想我", "喜欢你", "爱你"]):
            return LlmResult(
                text=(
                    "你、你突然这么说也太狡猾了吧……我会不知道怎么接的啦。"
                    "不过，如果是你说的，我是有点开心。就一点点。"
                )
            )

        if any(word in user_message for word in ["累", "难过", "不开心", "崩溃", "压力"]):
            return LlmResult(
                text=(
                    "今天很累啊……那先别急着硬撑。"
                    "要不要先说说发生了什么？不想说也没关系，我可以先陪你聊点轻松的。"
                )
            )

        if any(word in user_message for word in ["晚安", "睡了", "睡觉"]):
            return LlmResult(
                text=(
                    "晚安。今天也辛苦啦。"
                    "睡前就别想太多麻烦事了，明天状态好一点再说。"
                )
            )

        if any(word in user_message for word in ["抱", "亲亲", "撒娇", "哄我"]):
            return LlmResult(
                text=(
                    "等、等一下，你说得也太直接了吧。"
                    "如果只是想让我哄你一下的话……可以啦。今天辛苦了，先放松一点。"
                )
            )

        if any(word in user_message for word in ["约会", "出去玩", "周末"]):
            return LlmResult(
                text=(
                    "约会这个说法也太正式了吧……不过出去走走倒是可以。"
                    "买点甜的、随便聊聊天，这种感觉我还挺喜欢的。"
                )
            )

        return None

    def _handle_xiaoxue(self, state: AgentState) -> LlmResult:
        search_result = self._latest_tool_output(state, "search_files")
        relationship_result = self._latest_tool_output(state, "read_file")

        if search_result is None:
            return LlmResult(
                tool_call=ToolCall(name="search_files", arguments={"query": "小雪"})
            )

        if relationship_result is None:
            first_path = self._pick_first_path(search_result)
            if first_path is None:
                return LlmResult(text="我一时没找到和小雪有关的资料，不能乱说。")
            return LlmResult(
                tool_call=ToolCall(name="read_file", arguments={"path": first_path})
            )

        return LlmResult(
            text=(
                "我和小雪以前确实认识。"
                "按资料来看，我们小时候做过一段时间邻居，后来又因为一次误会疏远了。"
                "所以提到她的时候，我不太可能完全没反应。"
            )
        )

    def _latest_tool_output(self, state: AgentState, tool_name: str) -> str | None:
        prefix = f"[{tool_name}]"
        for item in reversed(state.tool_results):
            if item.startswith(prefix):
                return item.split("\n", 1)[1] if "\n" in item else ""
        return None

    def _pick_first_path(self, output: str) -> str | None:
        for line in output.splitlines():
            line = line.strip()
            if line and not line.startswith("("):
                return line
        return None
