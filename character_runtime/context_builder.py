from __future__ import annotations

import os

from character_runtime.models import AgentState


class ContextBuilder:
    def __init__(self) -> None:
        self._recent_message_limit = int(os.environ.get("CONTEXT_RECENT_MESSAGES", "40"))
        self._tool_result_limit = int(os.environ.get("CONTEXT_TOOL_RESULTS", "8"))

    def build(self, state: AgentState) -> str:
        history = "\n".join(
            f"{message.role}: {message.content}"
            for message in state.recent_messages[-self._recent_message_limit :]
        )
        tools = (
            "\n\n".join(state.tool_results[-self._tool_result_limit :])
            if state.tool_results
            else "(none)"
        )
        return (
            "[RUNTIME_RULES]\n"
            "- 像真实聊天一样回复，不要像设定说明、客服总结或百科条目。\n"
            "- 不要提到你读取了 CHARACTER、INDEX、资料文件或工具结果。\n"
            "- 优先回应用户这一句话的情绪和意图，再补少量信息。\n"
            "- 默认短回复；除非用户要求详细解释，否则不要长篇展开。\n"
            "- 可以自然追问，但不要每轮都追问。\n\n"
            f"[CHARACTER]\n{state.character.character_md}\n\n"
            f"[INDEX]\n{state.character.index_md}\n\n"
            f"[RECENT_MESSAGES]\n{history}\n\n"
            f"[TOOL_RESULTS]\n{tools}\n\n"
            f"[USER]\n{state.current_user_message}"
        )
