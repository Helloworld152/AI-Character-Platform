import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

const initialSettings = {
  api_key_configured: false,
  api_key_preview: "",
  model: "deepseek-v4-flash",
  base_url: "https://api.deepseek.com",
  timeout_seconds: "60",
  thinking: "disabled",
  temperature: "0.8",
  recent_messages: "40",
  tool_results: "8",
  llm_mode: "auto",
};

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

function formatMessageTime(timestampSeconds) {
  const date = timestampSeconds ? new Date(timestampSeconds * 1000) : new Date();
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function App() {
  const [characters, setCharacters] = useState([]);
  const [activeCharacterId, setActiveCharacterId] = useState("");
  const [activeCharacter, setActiveCharacter] = useState(null);
  const [messages, setMessages] = useState([]);
  const [settings, setSettings] = useState(initialSettings);
  const [memories, setMemories] = useState([]);
  const [apiKey, setApiKey] = useState("");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("启动中");
  const [busy, setBusy] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const messageListRef = useRef(null);

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  }, [messages]);

  useEffect(() => {
    if (settingsOpen) {
      loadMemories();
    }
  }, [settingsOpen, activeCharacterId]);

  async function boot() {
    try {
      await loadCharacters();
      await loadSettings();
      setStatus("就绪");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function loadCharacters() {
    const payload = await requestJson("/api/characters");
    setCharacters(payload.characters);
    setActiveCharacterId(payload.active_character_id || "");
    setActiveCharacter(payload.characters.find((item) => item.active) || null);
  }

  async function loadMessages() {
    const payload = await requestJson("/api/messages?limit=30");
    if (!payload.character) {
      setMessages([]);
      return;
    }
    setActiveCharacter((current) => ({
      ...(current || {}),
      ...payload.character,
    }));
    setMessages(payload.messages);
  }

  async function loadSettings() {
    const payload = await requestJson("/api/settings");
    setSettings(payload.settings);
  }

  async function loadMemories() {
    setMemoryLoading(true);
    try {
      const payload = await requestJson("/api/memories?limit=120");
      setMemories(payload.memories);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setMemoryLoading(false);
    }
  }

  async function switchCharacter(characterId) {
    if (busy || characterId === activeCharacterId) {
      return;
    }
    setStatus("切换中");
    try {
      await requestJson("/api/switch", {
        method: "POST",
        body: JSON.stringify({ character_id: characterId }),
      });
      await loadCharacters();
      await loadMessages();
      setStatus("就绪");
    } catch (error) {
      setStatus(error.message);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    const text = input.trim();
    if (!text || busy || !activeCharacterId) {
      return;
    }

    setBusy(true);
    setStatus("生成中");
    setInput("");
    setMessages((current) => [
      ...current,
      { id: `local-${Date.now()}`, role: "user", content: text, created_at: Math.floor(Date.now() / 1000) },
    ]);

    try {
      const payload = await requestJson("/api/chat", {
        method: "POST",
        body: JSON.stringify({ message: text }),
      });
      setMessages((current) => [
        ...current,
        { id: `assistant-${Date.now()}`, role: "assistant", content: payload.reply, created_at: Math.floor(Date.now() / 1000) },
      ]);
      setStatus("就绪");
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: `error-${Date.now()}`, role: "system", content: error.message },
      ]);
      setStatus("错误");
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    setStatus("保存设置");
    try {
      await requestJson("/api/settings", {
        method: "POST",
        body: JSON.stringify({
          settings: {
            api_key: apiKey.trim(),
            model: settings.model,
            base_url: settings.base_url,
            recent_messages: settings.recent_messages,
            tool_results: settings.tool_results,
            temperature: settings.temperature,
            timeout_seconds: settings.timeout_seconds,
            thinking: settings.thinking,
            llm_mode: settings.llm_mode,
          },
        }),
      });
      setApiKey("");
      await loadSettings();
      setStatus("设置已保存");
    } catch (error) {
      setStatus(error.message);
    }
  }

  function updateSetting(key, value) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  return (
    <main className={`app-shell ${leftCollapsed ? "left-collapsed" : ""} ${settingsOpen ? "settings-open" : ""}`}>
      <aside className="rail">
        <div className="brand">
          <div className="brand-mark">ACP</div>
          <div className="brand-copy">
            <h1>AI Character</h1>
            <p>Desktop Runtime</p>
          </div>
          <button
            aria-label={leftCollapsed ? "展开侧边栏" : "收起侧边栏"}
            className="ghost-button rail-toggle"
            onClick={() => setLeftCollapsed((value) => !value)}
            type="button"
          >
            {leftCollapsed ? "›" : "‹"}
          </button>
        </div>
        <div className="section-title">角色</div>
        <div className="character-list">
          {characters.map((character) => (
            <button
              className={`character-item ${character.id === activeCharacterId ? "active" : ""}`}
              key={character.id}
              onClick={() => switchCharacter(character.id)}
              type="button"
            >
              <img alt={character.display_name} src={character.avatar_url || ""} />
              <span>
                <strong>{character.display_name}</strong>
                <small>{character.name} · v{character.version}</small>
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="conversation">
        <header className="conversation-header">
          <div className="active-profile">
            {activeCharacter?.avatar_url ? (
              <img alt={activeCharacter.display_name} src={activeCharacter.avatar_url} />
            ) : (
              <div className="avatar-placeholder">?</div>
            )}
            <div>
              <p>当前角色</p>
              <h2>{activeCharacter?.display_name || "未选择角色"}</h2>
              <small>{activeCharacter?.id || "请选择左侧角色开始"}</small>
            </div>
          </div>
          <div className="header-actions">
            <button
              className="ghost-button"
              onClick={() => setLeftCollapsed((value) => !value)}
              type="button"
            >
              {leftCollapsed ? "展开角色" : "收起角色"}
            </button>
            <button
              className="ghost-button"
              onClick={() => setSettingsOpen((value) => !value)}
              type="button"
            >
              {settingsOpen ? "隐藏设置" : "设置"}
            </button>
            <span className="status">{status}</span>
          </div>
        </header>

        {!activeCharacter ? (
          <div className="select-state">
            <div>
              <p>选择一个角色后，会加载最近聊天记录并定位到最新消息。</p>
              <h3>当前没有进入任何会话</h3>
              <span>左侧角色栏可收起，设置面板默认隐藏。</span>
            </div>
          </div>
        ) : (
          <div className="message-list" ref={messageListRef}>
            {messages.length === 0 ? (
              <div className="empty-state">还没有聊天记录。发一句话开始这段会话。</div>
            ) : (
              messages.map((message) => (
                <article className={`bubble ${message.role}`} key={message.id}>
                  <div className="bubble-content">{message.content}</div>
                  {message.role !== "system" && (
                    <time>{formatMessageTime(message.created_at)}</time>
                  )}
                </article>
              ))
            )}
          </div>
        )}

        {activeCharacter ? (
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              disabled={busy}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="输入你想说的话"
              rows={2}
              value={input}
            />
            <button disabled={busy || !input.trim()} type="submit">
              发送
            </button>
          </form>
        ) : (
          <div className="composer-placeholder">选择角色后可开始聊天</div>
        )}
      </section>

      <aside className="settings-pane">
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)} />
        <form onSubmit={saveSettings}>
          <div className="settings-head">
            <div>
              <div className="section-title">模型设置</div>
              <p>Runtime configuration</p>
            </div>
            <button className="ghost-button" onClick={() => setSettingsOpen(false)} type="button">收起</button>
          </div>
          <section className="memory-panel">
            <div className="memory-head">
              <div>
                <strong>记忆库</strong>
                <p>{activeCharacter ? `当前：${activeCharacter.display_name}` : "未选择角色，显示全部记忆"}</p>
              </div>
              <button className="ghost-button" disabled={memoryLoading} onClick={loadMemories} type="button">
                {memoryLoading ? "刷新中" : "刷新"}
              </button>
            </div>
            <div className="memory-list">
              {memories.length === 0 ? (
                <div className="memory-empty">还没有提取到记忆。多聊几轮后，小模型会逐步沉淀重要信息。</div>
              ) : (
                memories.map((memory) => (
                  <article className="memory-card" key={memory.id}>
                    <div className="memory-meta">
                      <span>{memory.type_label}</span>
                      <time>{formatMessageTime(memory.created_at)}</time>
                    </div>
                    {memory.character_display_name && (
                      <small>{memory.character_display_name}</small>
                    )}
                    <p>{memory.content}</p>
                  </article>
                ))
              )}
            </div>
          </section>
          <label>
            <span>模式</span>
            <select value={settings.llm_mode} onChange={(event) => updateSetting("llm_mode", event.target.value)}>
              <option value="auto">自动</option>
              <option value="rulebased">本地规则</option>
            </select>
          </label>
          <label>
            <span>DeepSeek API Key</span>
            <input
              autoComplete="off"
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="不显示已保存 key"
              type="password"
              value={apiKey}
            />
          </label>
          <div className="hint">
            {settings.api_key_configured ? `已保存：${settings.api_key_preview}` : "未配置"}
          </div>
          <label>
            <span>模型</span>
            <input value={settings.model} onChange={(event) => updateSetting("model", event.target.value)} />
          </label>
          <label>
            <span>Base URL</span>
            <input value={settings.base_url} onChange={(event) => updateSetting("base_url", event.target.value)} />
          </label>
          <div className="field-grid">
            <label>
              <span>历史消息</span>
              <input min="10" max="200" step="10" type="number" value={settings.recent_messages} onChange={(event) => updateSetting("recent_messages", event.target.value)} />
            </label>
            <label>
              <span>工具结果</span>
              <input min="1" max="30" type="number" value={settings.tool_results} onChange={(event) => updateSetting("tool_results", event.target.value)} />
            </label>
          </div>
          <div className="field-grid">
            <label>
              <span>温度</span>
              <input min="0" max="2" step="0.1" type="number" value={settings.temperature} onChange={(event) => updateSetting("temperature", event.target.value)} />
            </label>
            <label>
              <span>超时秒数</span>
              <input min="10" max="180" type="number" value={settings.timeout_seconds} onChange={(event) => updateSetting("timeout_seconds", event.target.value)} />
            </label>
          </div>
          <label>
            <span>Thinking</span>
            <select value={settings.thinking} onChange={(event) => updateSetting("thinking", event.target.value)}>
              <option value="disabled">disabled</option>
              <option value="enabled">enabled</option>
            </select>
          </label>
          <button className="save-button" type="submit">保存设置</button>
        </form>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
