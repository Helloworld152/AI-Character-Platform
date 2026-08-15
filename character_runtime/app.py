from __future__ import annotations

from character_runtime.runtime import create_runtime


class Application:
    def __init__(self) -> None:
        runtime = create_runtime()
        self._character_manager = runtime.character_manager
        self._conversation = runtime.conversation

    def run(self) -> int:
        active = self._character_manager.active()
        print("AI Character Platform Python MVP")
        print(f"当前角色: {active.display_name} ({active.id})")
        print("输入 :quit 退出，:characters 查看角色，:switch <id> 切换角色")

        while True:
            user_input = input("\n你> ").strip()
            if not user_input:
                continue
            if user_input == ":quit":
                return 0
            if user_input == ":characters":
                for character in self._character_manager.list_characters():
                    print(f"- {character.id}: {character.display_name}")
                continue
            if user_input.startswith(":switch "):
                character_id = user_input.split(" ", 1)[1].strip()
                active = self._character_manager.activate(character_id)
                print(f"已切换到 {active.display_name} ({active.id})")
                continue

            active = self._character_manager.active()
            response = self._conversation.send_message(active, user_input)
            print(f"{active.display_name}> {response}")
