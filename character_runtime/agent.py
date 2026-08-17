from __future__ import annotations

import json

from character_runtime.context_builder import ContextBuilder
from character_runtime.llm import LlmClient
from character_runtime.models import AgentState, Message
from character_runtime.tools import ToolRegistry


class CharacterAgent:
    def __init__(self, llm: LlmClient, tools: ToolRegistry, max_tool_calls: int = 8) -> None:
        self._llm = llm
        self._tools = tools
        self._context_builder = ContextBuilder()
        self._max_tool_calls = max_tool_calls

    def respond(self, state: AgentState) -> str:
        tool_calls = 0

        while True:
            context = self._context_builder.build(state)
            result = self._llm.chat(context, state)

            if result.tool_call is None:
                if result.text is None:
                    raise RuntimeError("LLM 返回了空响应")
                state.recent_messages.append(Message(role="assistant", content=result.text))
                return result.text

            # 终止型工具：ask_choice 挂起回合，等待玩家选择，不再继续循环
            if result.tool_call.name == "ask_choice":
                return self._handle_choice(state, result.tool_call.arguments)

            if tool_calls >= self._max_tool_calls:
                raise RuntimeError("超过最大工具调用次数")

            tool_result = self._tools.execute(
                state.character,
                result.tool_call.name,
                result.tool_call.arguments,
                user_id=state.user_id,
            )
            state.tool_results.append(f"[{tool_result.name}]\n{tool_result.output}")
            tool_calls += 1

    def _handle_choice(self, state: AgentState, arguments: dict[str, str]) -> str:
        options_raw = arguments.get("options", "[]")
        try:
            options = json.loads(options_raw) if isinstance(options_raw, str) else options_raw
        except json.JSONDecodeError:
            options = []
        if not isinstance(options, list):
            options = []

        state.pending_choice = {
            "question": str(arguments.get("question", "")).strip(),
            "prompt": str(arguments.get("prompt", "")).strip(),
            "options": options,
            "multi_select": str(arguments.get("multi_select", "false")).lower() == "true",
            "allow_custom": str(arguments.get("allow_custom", "false")).lower() == "true",
        }
        return state.pending_choice["prompt"] or "……"
