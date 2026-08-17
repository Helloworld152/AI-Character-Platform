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
        if state.interaction_mode == "chat":
            return (
                "[RUNTIME_RULES]\n"
                "- 像真实聊天一样回复，不要像设定说明、客服总结或百科条目。\n"
                "- 不要提到你读取了 CHARACTER、INDEX、资料文件或工具结果。\n"
                "- 优先回应用户这一句话的情绪和意图，再补少量信息。\n"
                "- 普通聊天默认只回复 1-2 句、尽量不超过 50 字；除非用户要求详细解释，否则不要展开、总结或复述。\n"
                "- 可以自然追问，但不要每轮都追问。\n\n"
                f"[CHARACTER]\n{state.character.character_md}\n\n"
                f"[INDEX]\n{state.character.index_md}\n\n"
                f"[RECENT_MESSAGES]\n{history}\n\n"
                f"[TOOL_RESULTS]\n{tools}\n\n"
                f"[USER]\n{state.current_user_message}"
            )
        mode_rules = self._mode_rules(state)
        phase_rules = self._phase_rules(state)
        roles = self._roles(state)
        return (
            "[RUNTIME_RULES]\n"
            "- 像真实聊天一样回复，不要像设定说明、客服总结或百科条目。\n"
            "- 不要提到你读取了 CHARACTER、INDEX、资料文件或工具结果。\n"
            "- 优先回应用户这一句话的情绪和意图，再补少量信息。\n"
            "- 默认短回复；除非用户要求详细解释，否则不要长篇展开。\n"
            f"{mode_rules}\n"
            f"{phase_rules}\n"
            f"{roles}\n"
            f"[CHARACTER]\n{state.character.character_md}\n\n"
            f"[INDEX]\n{state.character.index_md}\n\n"
            f"[RECENT_MESSAGES]\n{history}\n\n"
            f"[TOOL_RESULTS]\n{tools}\n\n"
            f"[USER]\n{state.current_user_message}"
        )

    @staticmethod
    def _mode_rules(state: AgentState) -> str:
        if state.interaction_mode == "galgame":
            return (
                "[GALGAME_MODE]\n"
                "- 这是视觉小说式剧本模式，玩家/‘你’是主角和第一视角行动者。\n"
                "- 当前角色只说自己的台词、表现自己的反应并描述场景，不能替玩家决定行动。\n"
                f"- 强制视角规则：描述 {state.character.display_name} 的动作、神态和心理时，必须使用角色名或第三人称，"
                "绝不能用第一人称‘我’。只有角色真正说出口的台词可以自然使用‘我’。\n"
                f"- 内心活动也必须使用第三人称：‘我没想到你会这么说’、‘我感到有些慌乱’、"
                f"‘我有点不知道怎么办’都不允许出现在旁白中，必须改成‘{state.character.display_name}没想到你会这么说’、"
                f"‘{state.character.display_name}感到有些慌乱’、‘{state.character.display_name}有点不知道怎么办’。\n"
                f"- 错误示例：‘（我抱着盒子，望着你）我没想到你会这么说。’；正确示例：‘（{state.character.display_name}抱着盒子，望着你，"
                f"没想到你会这么说。）’。\n"
                "- 输出格式：动作、神态、心理和场景是第三人称旁白；角色说话必须放在中文引号中。未放在引号中的第一人称句子一律禁止。\n"
                "- 需要玩家决定时调用 ask_choice；每个选项必须是完整、明确、可执行的玩家动作或回答。\n"
                "- 选项要具体说明玩家会做什么，避免‘继续吗’、‘好/不好’、‘你来决定’等模糊短句。"
            )
        return (
            "[CHAT_MODE]\n"
            "- 这是普通聊天模式，玩家可以自由输入，角色自然回应。\n"
            "- 不要把普通聊天强行写成剧本，也不要每轮主动生成选项。\n"
            "- 只有剧情确实出现关键分支且需要玩家决定时，才调用 ask_choice。"
        )

    @staticmethod
    def _phase_rules(state: AgentState) -> str:
        if state.turn_phase == "choice_response":
            return (
                "[GALGAME_CHOICE_RESPONSE]\n"
                "- 玩家刚刚完成了一个选择。现在只生成当前角色对这个选择的自然回应和台词。\n"
                "- 不要在这一轮调用 ask_choice；下一轮选项等玩家点击继续后再生成。"
            )
        if state.turn_phase == "continue":
            return (
                "[GALGAME_CONTINUE]\n"
                "- 玩家点击了继续。自然承接上一段剧情并让当前角色说一小段新的台词。\n"
                "- 到达下一个需要玩家决定的分支时，必须调用 ask_choice，并提供 2-4 个明确的玩家选项。"
            )
        return ""

    @staticmethod
    def _roles(state: AgentState) -> str:
        if state.interaction_mode == "galgame":
            return (
                "[STORY_ROLES]\n"
                "- 玩家主角：你（由玩家决定行动、态度和回答）\n"
                f"- 当前角色：{state.character.display_name}（只描述自己的反应、台词和所处场景）"
            )
        return (
            "[CHAT_PARTICIPANTS]\n"
            "- 玩家：当前对话的用户，可以自由表达和提问。\n"
            f"- 当前角色：{state.character.display_name}（按照角色设定自然回应用户）"
        )
