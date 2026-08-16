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

function formatUpdateMessage(updateStatus) {
  if (!updateStatus) {
    return "未检查";
  }
  if (updateStatus.state === "disabled") {
    return updateStatus.message || "仅正式安装包支持更新";
  }
  if (updateStatus.state === "checking") {
    return "正在检查更新";
  }
  if (updateStatus.state === "available") {
    return `发现新版本 v${updateStatus.version}`;
  }
  if (updateStatus.state === "not-available") {
    return "已是最新版本";
  }
  if (updateStatus.state === "downloading") {
    return `正在下载 ${updateStatus.percent || 0}%`;
  }
  if (updateStatus.state === "downloaded") {
    return `v${updateStatus.version} 已下载`;
  }
  if (updateStatus.state === "installing") {
    return "正在重启安装";
  }
  if (updateStatus.state === "error") {
    return updateStatus.message || "更新失败";
  }
  return "未检查";
}

const initialImportDraft = {
  character_id: "",
  name: "",
  display_name: "",
  author: "",
  version: "1.0.0",
  avatar: null,
  package: null,
};

function toCharacterId(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized ? `character_${normalized}` : "";
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
  const [characterImporting, setCharacterImporting] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState(null);
  const [updaterBusy, setUpdaterBusy] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState("basic");
  const [importIdEdited, setImportIdEdited] = useState(false);
  const [importDraft, setImportDraft] = useState(initialImportDraft);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("model");
  const [deletingMemoryId, setDeletingMemoryId] = useState(null);
  const messageListRef = useRef(null);
  const updater = window.aiCharacterUpdater;

  useEffect(() => {
    boot();
  }, []);

  useEffect(() => {
    if (!updater) {
      setUpdaterStatus({ state: "disabled", message: "当前环境不支持应用更新" });
      return undefined;
    }
    return updater.onStatus((payload) => {
      setUpdaterStatus(payload);
      setUpdaterBusy(payload.state === "checking" || payload.state === "downloading");
    });
  }, [updater]);

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
    if (settingsOpen && settingsTab === "memory") {
      loadMemories();
    }
  }, [settingsOpen, settingsTab, activeCharacterId]);

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

  function openImportModal() {
    setSettingsOpen(false);
    resetImportDraft();
    setImportOpen(true);
    setImportTab("basic");
  }

  function closeImportModal() {
    if (characterImporting) {
      return;
    }
    setImportOpen(false);
  }

  function resetImportDraft() {
    setImportDraft(initialImportDraft);
    setImportIdEdited(false);
    setImportTab("basic");
  }

  function updateImportField(key, value) {
    setImportDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "name" && !importIdEdited) {
        next.character_id = toCharacterId(value);
      }
      return next;
    });
  }

  function updateImportFile(key, file) {
    setImportDraft((current) => ({ ...current, [key]: file || null }));
  }

  async function checkForUpdates() {
    if (!updater || updaterBusy) {
      return;
    }
    setUpdaterBusy(true);
    setUpdaterStatus({ state: "checking" });
    try {
      const payload = await updater.checkForUpdates();
      setUpdaterStatus((current) => current || payload);
      if (payload.state === "disabled") {
        setUpdaterStatus(payload);
      }
    } catch (error) {
      setUpdaterStatus({ state: "error", message: error.message });
    } finally {
      setUpdaterBusy(false);
    }
  }

  async function downloadUpdate() {
    if (!updater || updaterBusy) {
      return;
    }
    setUpdaterBusy(true);
    try {
      await updater.downloadUpdate();
    } catch (error) {
      setUpdaterStatus({ state: "error", message: error.message });
      setUpdaterBusy(false);
    }
  }

  async function installUpdate() {
    if (!updater) {
      return;
    }
    setUpdaterStatus({ state: "installing" });
    try {
      await updater.installUpdate();
    } catch (error) {
      setUpdaterStatus({ state: "error", message: error.message });
    }
  }

  async function deleteMemory(memoryId) {
    if (deletingMemoryId) {
      return;
    }
    setDeletingMemoryId(memoryId);
    try {
      await requestJson("/api/memories/delete", {
        method: "POST",
        body: JSON.stringify({ memory_id: memoryId }),
      });
      setMemories((current) => current.filter((memory) => memory.id !== memoryId));
      setStatus("记忆已删除");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setDeletingMemoryId(null);
    }
  }

  async function importCharacter(event) {
    event.preventDefault();
    if (characterImporting) {
      return;
    }
    if (!importDraft.character_id || !importDraft.name || !importDraft.display_name || !importDraft.author) {
      setStatus("请先填写完整的角色基础信息");
      setImportTab("basic");
      return;
    }
    if (!importDraft.avatar) {
      setStatus("请上传角色头像");
      setImportTab("basic");
      return;
    }
    if (!importDraft.package) {
      setStatus("请上传 Markdown 内容包");
      setImportTab("package");
      return;
    }

    setCharacterImporting(true);
    setStatus("导入角色");
    try {
      const form = new FormData();
      form.append("character_id", importDraft.character_id.trim());
      form.append("name", importDraft.name.trim());
      form.append("display_name", importDraft.display_name.trim());
      form.append("author", importDraft.author.trim());
      form.append("version", importDraft.version.trim() || "1.0.0");
      form.append("avatar", importDraft.avatar);
      form.append("package", importDraft.package);
      const response = await fetch("/api/characters/import", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "角色导入失败");
      }

      await loadCharacters();
      await loadMessages();
      setStatus(`已导入 ${payload.character.display_name}`);
      resetImportDraft();
      setImportOpen(false);
    } catch (error) {
      setStatus(error.message);
    } finally {
      setCharacterImporting(false);
    }
  }

  async function updateAvatar(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeCharacterId || avatarUploading) {
      return;
    }

    setAvatarUploading(true);
    setStatus("上传头像");
    try {
      const form = new FormData();
      form.append("character_id", activeCharacterId);
      form.append("avatar", file);
      const response = await fetch("/api/characters/avatar", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "头像上传失败");
      }

      const cacheBust = `t=${Date.now()}`;
      const avatarUrl = payload.character.avatar_url.includes("?")
        ? `${payload.character.avatar_url}&${cacheBust}`
        : `${payload.character.avatar_url}?${cacheBust}`;
      const nextCharacter = { ...payload.character, avatar_url: avatarUrl };

      setActiveCharacter((current) => ({
        ...(current || {}),
        ...nextCharacter,
      }));
      setCharacters((current) =>
        current.map((character) =>
          character.id === nextCharacter.id
            ? { ...character, avatar_url: avatarUrl }
            : character
        )
      );
      setStatus("头像已更新");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setAvatarUploading(false);
    }
  }

  return (
    <main className={`app-shell ${leftCollapsed ? "left-collapsed" : ""} ${settingsOpen ? "settings-open" : ""} ${importOpen ? "import-open" : ""}`}>
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
        <div className="rail-footer">
          {leftCollapsed ? (
            <button
              aria-label="打开设置"
              className="ghost-button rail-settings-button rail-settings-icon"
              onClick={() => {
                setImportOpen(false);
                setSettingsOpen(true);
                setSettingsTab("model");
              }}
              title="设置"
              type="button"
            >
              ⚙
            </button>
          ) : (
            <>
              <button className="ghost-button rail-import-button" onClick={openImportModal} type="button">
                导入角色
              </button>
              <button
                className="ghost-button rail-settings-button"
                onClick={() => {
                  setImportOpen(false);
                  setSettingsOpen(true);
                  setSettingsTab("model");
                }}
                type="button"
              >
                设置
              </button>
            </>
          )}
        </div>
      </aside>

      <section className="conversation">
        <header className="conversation-header">
          <div className="active-profile">
            <label className={`avatar-edit ${avatarUploading ? "uploading" : ""}`}>
              {activeCharacter?.avatar_url ? (
                <img alt={activeCharacter.display_name} src={activeCharacter.avatar_url} />
              ) : (
                <div className="avatar-placeholder">?</div>
              )}
              {activeCharacter && (
                <>
                  <span>{avatarUploading ? "上传中" : "更换头像"}</span>
                  <input
                    accept="image/png,image/jpeg,image/webp,image/svg+xml"
                    disabled={avatarUploading}
                    onChange={updateAvatar}
                    type="file"
                  />
                </>
              )}
            </label>
            <div>
              <p>当前角色</p>
              <h2>{activeCharacter?.display_name || "未选择角色"}</h2>
              <small>{activeCharacter?.id || "请选择左侧角色开始"}</small>
            </div>
          </div>
          <div className="header-actions">
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

      <aside className="import-pane">
        <div className="import-backdrop" onClick={closeImportModal} />
        <div className="import-window">
          <div className="settings-head">
            <div>
              <div className="section-title">导入角色</div>
              <p>Program generates manifest.json</p>
            </div>
            <button className="ghost-button" disabled={characterImporting} onClick={closeImportModal} type="button">收起</button>
          </div>
          <div className="settings-body">
            <div className="settings-tabs">
              {[
                ["basic", "基础信息"],
                ["package", "内容包"],
                ["help", "制作说明"],
              ].map(([key, label]) => (
                <button
                  className={importTab === key ? "active" : ""}
                  key={key}
                  onClick={() => setImportTab(key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="settings-content">
              {importTab === "basic" && (
                <form className="settings-panel import-form" onSubmit={importCharacter}>
                  <div className="field-grid">
                    <label>
                      <span>name</span>
                      <input
                        onChange={(event) => updateImportField("name", event.target.value)}
                        placeholder="英文名或标识名"
                        value={importDraft.name}
                      />
                    </label>
                    <label>
                      <span>display_name</span>
                      <input
                        onChange={(event) => updateImportField("display_name", event.target.value)}
                        placeholder="界面显示名称"
                        value={importDraft.display_name}
                      />
                    </label>
                  </div>
                  <div className="field-grid">
                    <label>
                      <span>id</span>
                      <input
                        onChange={(event) => {
                          setImportIdEdited(true);
                          updateImportField("character_id", event.target.value);
                        }}
                        placeholder="character_your_id"
                        value={importDraft.character_id}
                      />
                    </label>
                    <label>
                      <span>author</span>
                      <input
                        onChange={(event) => updateImportField("author", event.target.value)}
                        placeholder="作者名"
                        value={importDraft.author}
                      />
                    </label>
                  </div>
                  <label>
                    <span>version</span>
                    <input
                      onChange={(event) => updateImportField("version", event.target.value)}
                      placeholder="1.0.0"
                      value={importDraft.version}
                    />
                  </label>
                  <label className={`file-drop ${importDraft.avatar ? "filled" : ""}`}>
                    <span>头像文件</span>
                    <strong>{importDraft.avatar?.name || "选择 png / jpg / webp / svg"}</strong>
                    <input
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      onChange={(event) => updateImportFile("avatar", event.target.files?.[0])}
                      type="file"
                    />
                  </label>
                  <button className="save-button" onClick={() => setImportTab("package")} type="button">下一步</button>
                </form>
              )}
              {importTab === "package" && (
                <form className="settings-panel import-form" onSubmit={importCharacter}>
                  <label className={`file-drop ${importDraft.package ? "filled" : ""}`}>
                    <span>Markdown 内容包</span>
                    <strong>{importDraft.package?.name || "选择只包含 .md 文件的 zip"}</strong>
                    <input
                      accept=".zip,application/zip"
                      onChange={(event) => updateImportFile("package", event.target.files?.[0])}
                      type="file"
                    />
                  </label>
                  <div className="import-note">
                    <p>程序会自动生成 `manifest.json`。</p>
                    <p>内容包中至少需要 `CHARACTER.md` 和 `INDEX.md`。</p>
                  </div>
                  <button className="link-row" onClick={() => setImportTab("help")} type="button">
                    如何制作角色包
                  </button>
                  <div className="import-actions">
                    <button className="ghost-button" onClick={() => setImportTab("basic")} type="button">上一步</button>
                    <button className="save-button" disabled={characterImporting} type="submit">
                      {characterImporting ? "导入中" : "开始导入"}
                    </button>
                  </div>
                </form>
              )}
              {importTab === "help" && (
                <section className="settings-panel update-panel import-help">
                  <p>内容包 zip 里只放 Markdown 文件，不要放头像和 manifest.json。</p>
                  <p>根目录至少需要 `CHARACTER.md` 和 `INDEX.md`。</p>
                  <p>可选目录：`profile/`、`story/`、`relationships/`、`world/`、`examples/`。</p>
                  <p>zip 中不允许出现非 `.md` 文件、绝对路径和 `../` 越界路径。</p>
                  <p>下面这是一段示例提示词，可直接发给大模型，让它按本项目格式生成角色 Markdown。</p>
                  <pre className="import-prompt">{`请为我生成一个可直接打包导入 AI Character Platform 的角色 Markdown 内容包。

要求：
1. 只输出 Markdown 文件内容方案，不要输出图片、JSON、压缩包说明或多余解释。
2. 根目录必须包含 CHARACTER.md 和 INDEX.md。
3. 可以按需补充这些目录：profile/、story/、relationships/、world/、examples/。
4. 所有文件都必须是 .md，路径不能包含绝对路径或 ../。
5. 内容要适合角色扮演陪伴场景，重点写清身份、性格、说话风格、关系、背景、示例对话。
6. INDEX.md 需要列出全部文件及用途。
7. CHARACTER.md 需要总结角色核心设定，并说明其余 Markdown 的阅读顺序。
8. 输出时请按“文件路径 + Markdown 内容”的形式逐个给出。

请按以下结构生成：
- CHARACTER.md
- INDEX.md
- profile/identity.md
- profile/personality.md
- profile/speaking_style.md
- profile/preferences.md
- story/first_encounter.md
- story/daily_life_and_growth.md
- relationships/player.md
- world/worldview.md
- examples/dialogues.md

补充要求：
- 角色设定要具体，避免空泛标签。
- 示例对话至少写 8 组，体现语气、情绪变化和互动感。
- 所有内容使用中文输出。
- 保持文件之间设定一致，不要前后冲突。`}</pre>
                  <button className="ghost-button" onClick={() => setImportTab("package")} type="button">返回内容包</button>
                </section>
              )}
            </div>
          </div>
        </div>
      </aside>

      <aside className="settings-pane">
        <div className="settings-backdrop" onClick={() => setSettingsOpen(false)} />
        <div className="settings-window">
          <div className="settings-head">
            <div>
              <div className="section-title">设置</div>
              <p>Runtime controls</p>
            </div>
            <button className="ghost-button" onClick={() => setSettingsOpen(false)} type="button">收起</button>
          </div>
          <div className="settings-body">
            <div className="settings-tabs">
              {[
                ["model", "模型设置"],
                ["memory", "记忆"],
                ["update", "更新"],
              ].map(([key, label]) => (
                <button
                  className={settingsTab === key ? "active" : ""}
                  key={key}
                  onClick={() => setSettingsTab(key)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="settings-content">
              {settingsTab === "model" && (
                <form className="settings-panel" onSubmit={saveSettings}>
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
              )}

              {settingsTab === "memory" && (
                <section className="settings-panel memory-panel">
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
                      <button
                        className="memory-delete"
                        disabled={deletingMemoryId === memory.id}
                        onClick={() => deleteMemory(memory.id)}
                        type="button"
                      >
                        {deletingMemoryId === memory.id ? "删除中" : "删除"}
                      </button>
                    </article>
                  ))
                )}
              </div>
                </section>
              )}

              {settingsTab === "update" && (
                <section className="settings-panel update-panel">
              <div className="memory-head">
                <div>
                  <strong>软件更新</strong>
                  <p>{formatUpdateMessage(updaterStatus)}</p>
                </div>
              </div>
              {updaterStatus?.state === "downloading" && (
                <div className="update-progress">
                  <span style={{ width: `${updaterStatus.percent || 0}%` }} />
                </div>
              )}
              <div className="update-actions">
                <button className="ghost-button" disabled={!updater || updaterBusy} onClick={checkForUpdates} type="button">
                  {updaterBusy && updaterStatus?.state === "checking" ? "检查中" : "检查更新"}
                </button>
                <button
                  className="ghost-button"
                  disabled={!updater || updaterBusy || updaterStatus?.state !== "available"}
                  onClick={downloadUpdate}
                  type="button"
                >
                  下载更新
                </button>
                <button
                  className="ghost-button"
                  disabled={!updater || updaterStatus?.state !== "downloaded"}
                  onClick={installUpdate}
                  type="button"
                >
                  重启安装
                </button>
              </div>
                </section>
              )}
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
