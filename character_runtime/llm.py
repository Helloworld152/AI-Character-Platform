from __future__ import annotations

import json
import os
import urllib.error
import urllib.request

from character_runtime.models import AgentState, LlmResult, ToolCall


class LlmClient:
    def chat(self, context: str, state: AgentState) -> LlmResult:
        raise NotImplementedError


class OpenAICompatibleClient(LlmClient):
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
    def from_environment(cls) -> "OpenAICompatibleClient":
        return cls(
            api_key=os.environ.get("DEEPSEEK_API_KEY", ""),
            model=os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash"),
            base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            timeout_seconds=int(os.environ.get("DEEPSEEK_TIMEOUT_SECONDS", "60")),
        )

    def chat(self, context: str, state: AgentState) -> LlmResult:
        if not os.environ.get("DEEPSEEK_API_KEY", self._api_key):
            raise RuntimeError("未配置模型 API Key，请先在设置中填写模型 API Key。")

        if state.interaction_mode == "chat":
            system_prompt = (
                "你是 AI Character Platform 的 Character Agent。"
                "必须严格按照当前角色设定回复。"
                "遇到具体剧情、人物关系、世界观或不确定信息时，优先调用工具读取角色包资料。"
                "普通聊天默认只回复 1-2 句、尽量不超过 50 字；除非用户要求详细解释，否则不要展开、总结或复述。"
                "最终回复只输出角色对玩家说的话。"
            )
        else:
            mode_prompt = (
                "当前是 Galgame 剧本模式。玩家是主角和第一视角行动者；当前角色只说自己的台词、"
                f"表现自己的反应并描述场景，不能替玩家做决定。强制要求：描述 {state.character.display_name} 的动作、"
                "神态和心理时必须使用角色名或第三人称，绝不能用第一人称‘我’；内心活动同样必须使用第三人称。"
                "只有角色真正说出口、并放在中文引号中的台词可以使用‘我’。"
                f"错误示例：‘（我抱着盒子，望着你）我没想到你会这么说。’；正确示例：‘（{state.character.display_name}抱着盒子，望着你，"
                f"没想到你会这么说。）’。未放在引号中的第一人称句子一律禁止。"
                "需要玩家决定时调用 ask_choice，"
                "每个选项必须是完整、明确、可执行的玩家动作或回答，不能写角色会做什么。"
            )
            phase_prompt = ""
            if state.turn_phase == "choice_response":
                phase_prompt = (
                    "玩家刚完成一个选择，本轮只生成当前角色对该选择的自然回应，不要调用 ask_choice；"
                    "下一轮选项等玩家点击继续后再生成。"
                )
            elif state.turn_phase == "continue":
                phase_prompt = (
                    "玩家点击了继续。请自然承接上一段剧情并生成一小段角色台词；"
                    "到达下一个分支时必须调用 ask_choice，提供 2-4 个明确的玩家动作或回答选项。"
                )
            system_prompt = (
                "你是 AI Character Platform 的 Character Agent。"
                "必须严格按照当前角色设定回复。"
                "遇到具体剧情、人物关系、世界观或不确定信息时，优先调用工具读取角色包资料。"
                + mode_prompt
                + phase_prompt
                + "调用 ask_choice 时必须提供 2-4 个具体、互相区分、可立即执行的玩家行动或回答选项。"
                "每个选项都要写完整，最好以‘我……’或明确动词开头；不要只写‘继续吗’、‘好/不好’、"
                "‘你来决定’等模糊短句，也不能把角色的动作或决定写成选项。"
                "最终回复只输出角色对玩家说的话。"
            )

        tool_definitions = self._tool_definitions()
        if state.interaction_mode == "chat":
            tool_definitions = [
                tool for tool in tool_definitions if tool["function"]["name"] != "ask_choice"
            ]

        payload = {
            "model": self._model,
            "messages": [
                {
                    "role": "system",
                    "content": system_prompt,
                },
                {"role": "user", "content": context},
            ],
            "tools": tool_definitions,
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
                    arguments={
                        key: json.dumps(value, ensure_ascii=False)
                        if key == "options" and isinstance(value, list)
                        else str(value)
                        for key, value in arguments.items()
                    },
                )
            )

        content = message.get("content")
        if not content:
            raise RuntimeError("模型 API 返回了空响应")
        return LlmResult(text=content.strip())

    def _post_json(self, payload: dict) -> dict:
        api_key = os.environ.get("DEEPSEEK_API_KEY", self._api_key)
        if not api_key:
            raise RuntimeError("未配置模型 API Key，请先在设置中填写模型 API Key。")
        request = urllib.request.Request(
            self._url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self._timeout_seconds) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"模型 API 请求失败: HTTP {error.code} {detail}") from error
        except urllib.error.URLError as error:
            raise RuntimeError(f"模型 API 请求失败: {error.reason}") from error

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
                        "玩家是主角，选项必须是玩家可以执行的行动或回答，角色不能替玩家做决定。"
                        "必须提供 2-4 个具体选项，等待玩家选择后再继续。"
                        "日常闲聊、寒暄、普通提问不要调用；"
                        "只有当剧情推进到真正需要玩家选择方向的分支点时才调用，"
                        "且一次只提一个问题。question 必须直接问玩家，选项要贴合当前剧情和角色语气，"
                        "每项都要是完整、明确的玩家动作或回答，不能写角色会做什么。"
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
                                "description": "2-4 个玩家选项。每个 label 都必须是完整、明确的玩家动作或回答，而不是角色动作、模糊态度或反问句。",
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
