from __future__ import annotations

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
