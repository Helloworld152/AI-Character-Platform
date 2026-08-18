const state = {
  activeCharacterId: null,
  activeName: "",
  activeAvatarUrl: null,
  busy: false,
};

const characterList = document.querySelector("#characterList");
const activeName = document.querySelector("#activeName");
const activeAvatar = document.querySelector("#activeAvatar");
const statusEl = document.querySelector("#status");
const messages = document.querySelector("#messages");
const form = document.querySelector("#chatForm");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const settingsForm = document.querySelector("#settingsForm");
const apiKey = document.querySelector("#apiKey");
const apiKeyPreview = document.querySelector("#apiKeyPreview");
const model = document.querySelector("#model");
const baseUrl = document.querySelector("#baseUrl");
const recentMessages = document.querySelector("#recentMessages");
const toolResults = document.querySelector("#toolResults");
const temperature = document.querySelector("#temperature");
const timeoutSeconds = document.querySelector("#timeoutSeconds");
const thinking = document.querySelector("#thinking");

function setStatus(text) {
  statusEl.textContent = text;
}

function formatMessageTime(timestampSeconds) {
  const date = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function addMessage(role, text, timestampSeconds = null) {
  const node = document.createElement("div");
  node.className = `message ${role}`;
  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = text;
  node.appendChild(content);

  if (role !== "system") {
    const time = document.createElement("time");
    time.className = "message-time";
    time.dateTime = new Date((timestampSeconds || Date.now() / 1000) * 1000).toISOString();
    time.textContent = formatMessageTime(timestampSeconds);
    node.appendChild(time);
  }

  messages.appendChild(node);
  messages.scrollTop = messages.scrollHeight;
}

function renderMessages(records) {
  messages.innerHTML = "";
  if (!records.length) {
    addMessage("system", "还没有聊天记录。发一句话开始这段会话。");
    return;
  }

  for (const message of records) {
    addMessage(message.role, message.content, message.created_at);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "请求失败");
  }
  return payload;
}

async function loadCharacters() {
  const payload = await requestJson("/api/characters");
  state.activeCharacterId = payload.active_character_id;
  characterList.innerHTML = "";

  for (const character of payload.characters) {
    const button = document.createElement("button");
    button.className = `character-button${character.active ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<img alt=""><div><strong></strong><span></span></div>`;
    button.querySelector("img").src = character.avatar_url || "";
    button.querySelector("img").alt = character.display_name;
    button.querySelector("strong").textContent = character.display_name;
    button.querySelector("span").textContent = `${character.id} · v${character.version}`;
    button.addEventListener("click", () => switchCharacter(character.id));
    characterList.appendChild(button);

    if (character.active) {
      state.activeName = character.display_name;
      state.activeAvatarUrl = character.avatar_url;
      activeName.textContent = character.display_name;
      activeAvatar.src = character.avatar_url || "";
      activeAvatar.alt = character.display_name;
    }
  }

  setStatus("就绪");
}

async function loadMessages() {
  const payload = await requestJson("/api/messages");
  state.activeName = payload.character.display_name;
  state.activeAvatarUrl = payload.character.avatar_url;
  activeName.textContent = state.activeName;
  activeAvatar.src = state.activeAvatarUrl || "";
  activeAvatar.alt = state.activeName;
  renderMessages(payload.messages);
}

async function loadSettings() {
  const payload = await requestJson("/api/settings");
  const settings = payload.settings;
  apiKey.value = "";
  apiKeyPreview.textContent = settings.api_key_configured
    ? `已保存：${settings.api_key_preview}`
    : "未配置";
  model.value = settings.model;
  baseUrl.value = settings.base_url;
  recentMessages.value = settings.recent_messages;
  toolResults.value = settings.tool_results;
  temperature.value = settings.temperature;
  timeoutSeconds.value = settings.timeout_seconds;
  thinking.value = settings.thinking;
}

async function switchCharacter(characterId) {
  if (state.busy || characterId === state.activeCharacterId) {
    return;
  }
  setStatus("切换中");
  try {
    const payload = await requestJson("/api/switch", {
      method: "POST",
      body: JSON.stringify({ character_id: characterId }),
    });
    state.activeCharacterId = payload.character.id;
    state.activeName = payload.character.display_name;
    activeName.textContent = state.activeName;
    await loadCharacters();
    await loadMessages();
    addMessage("system", `已切换到 ${state.activeName}`);
  } catch (error) {
    addMessage("system", error.message);
    setStatus("错误");
  }
}

async function sendMessage(text) {
  state.busy = true;
  sendButton.disabled = true;
  input.disabled = true;
  setStatus("生成中");
  addMessage("user", text);

  try {
    const payload = await requestJson("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: text }),
    });
    addMessage("assistant", payload.reply);
    setStatus("就绪");
  } catch (error) {
    addMessage("system", error.message);
    setStatus("错误");
  } finally {
    state.busy = false;
    sendButton.disabled = false;
    input.disabled = false;
    input.focus();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || state.busy) {
    return;
  }
  input.value = "";
  sendMessage(text);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

settingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("保存设置");
  try {
    await requestJson("/api/settings", {
      method: "POST",
      body: JSON.stringify({
        settings: {
          api_key: apiKey.value.trim(),
          model: model.value.trim(),
          base_url: baseUrl.value.trim(),
          recent_messages: recentMessages.value,
          tool_results: toolResults.value,
          temperature: temperature.value,
          timeout_seconds: timeoutSeconds.value,
          thinking: thinking.value,
        },
      }),
    });
    apiKey.value = "";
    await loadSettings();
    setStatus("设置已保存");
  } catch (error) {
    addMessage("system", error.message);
    setStatus("错误");
  }
});

loadCharacters()
  .then(loadMessages)
  .then(loadSettings)
  .catch((error) => {
    addMessage("system", error.message);
    setStatus("错误");
  });
