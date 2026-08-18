import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import { GalgameView } from "./galgame/GalgameView.jsx";
import { toPlayScript } from "./galgame/adapter.js";
import { ChoicePanel } from "./galgame/ChoicePanel.jsx";

// 打字机文本：新回复逐字显示，点击跳过，变化时通知滚动
function TypewriterText({ text, skip = false, speed = 25, onProgress, onComplete }) {
  const [count, setCount] = useState(() => (skip ? text.length : 0));

  useEffect(() => {
    setCount(skip ? text.length : 0);
  }, [text, skip]);

  useEffect(() => {
    if (skip || count >= text.length) {
      return undefined;
    }
    const timer = setTimeout(() => setCount((value) => value + 1), speed);
    return () => clearTimeout(timer);
  }, [count, skip, text]);

  useEffect(() => {
    onProgress?.();
    if (count >= text.length) {
      onComplete?.();
    }
  }, [count]);

  return (
    <>
      {text.slice(0, count)}
      {count < text.length && <span className="typing-caret" />}
    </>
  );
}

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
  const [characterSwitching, setCharacterSwitching] = useState(false);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [characterImporting, setCharacterImporting] = useState(false);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [openingCharacterDirectory, setOpeningCharacterDirectory] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState(null);
  const [updaterBusy, setUpdaterBusy] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importTab, setImportTab] = useState("basic");
  const [importIdEdited, setImportIdEdited] = useState(false);
  const [importDraft, setImportDraft] = useState(initialImportDraft);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState("model");
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [expandedMemoryId, setExpandedMemoryId] = useState(null);
  const [deletingMemoryId, setDeletingMemoryId] = useState(null);
  const [deleteCharacterOpen, setDeleteCharacterOpen] = useState(false);
  const [deleteCharacterConfirmOpen, setDeleteCharacterConfirmOpen] = useState(false);
  const [deletingCharacter, setDeletingCharacter] = useState(false);
  const [galgameMode, setGalgameMode] = useState(false);
  const [portraitUploading, setPortraitUploading] = useState(false);
  const [backgroundUploading, setBackgroundUploading] = useState(false);
  const [pendingChoice, setPendingChoice] = useState(null);
  const [choiceBusy, setChoiceBusy] = useState(false);
  const [continueBusy, setContinueBusy] = useState(false);
  const [skipTypingId, setSkipTypingId] = useState(null);
  const [typingAssistantId, setTypingAssistantId] = useState(null);
  const messageListRef = useRef(null);
  const updater = window.aiCharacterUpdater;
  const desktop = window.aiCharacterDesktop;
  const pendingForActive =
    pendingChoice && pendingChoice.characterId === activeCharacterId ? pendingChoice : null;

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

  useLayoutEffect(() => {
    const list = messageListRef.current;
    if (!list) {
      return;
    }
    const scrollToBottom = () => {
      list.scrollTop = list.scrollHeight;
    };
    scrollToBottom();
    const frame = requestAnimationFrame(scrollToBottom);
    return () => cancelAnimationFrame(frame);
  }, [messages, busy, choiceBusy, pendingForActive, typingAssistantId, skipTypingId, galgameMode]);

  useEffect(() => {
    if (diaryOpen) {
      loadMemories();
    }
  }, [diaryOpen, activeCharacterId]);

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
      setActiveCharacter(null);
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

  function openDiary() {
    setSettingsOpen(false);
    setImportOpen(false);
    setExpandedMemoryId(null);
    setDiaryOpen(true);
  }

  function closeDiary() {
    setDiaryOpen(false);
    setExpandedMemoryId(null);
  }

  function openDeleteCharacter() {
    setDiaryOpen(false);
    setDeleteCharacterOpen(true);
  }

  function continueDeleteCharacter() {
    setDeleteCharacterOpen(false);
    setDeleteCharacterConfirmOpen(true);
  }

  async function deleteCharacter() {
    if (!activeCharacter || deletingCharacter) {
      return;
    }
    setDeletingCharacter(true);
    setStatus("删除角色");
    try {
      await requestJson("/api/characters/delete", {
        method: "POST",
        body: JSON.stringify({ character_id: activeCharacter.id }),
      });
      setDeleteCharacterConfirmOpen(false);
      setMemories([]);
      await loadCharacters();
      await loadMessages();
      setStatus("角色已删除");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setDeletingCharacter(false);
    }
  }

  async function switchCharacter(characterId) {
    if (busy || choiceBusy || continueBusy || characterSwitching || characterId === activeCharacterId) {
      return;
    }
    setCharacterSwitching(true);
    setStatus("切换中");
    try {
      await requestJson("/api/switch", {
        method: "POST",
        body: JSON.stringify({ character_id: characterId }),
      });
      setPendingChoice(null);
      setMessages([]);
      setInput("");
      setSkipTypingId(null);
      setTypingAssistantId(null);
      await loadCharacters();
      await loadMessages();
      setStatus("就绪");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setCharacterSwitching(false);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    await sendMessageText(input.trim());
  }

  async function sendMessageText(text) {
    if (!text || busy || continueBusy || characterSwitching || !activeCharacterId || pendingForActive) {
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
      const assistantId = `assistant-${Date.now()}`;
      const hasAssistantReply = messages.some((message) => message.role === "assistant");
      if (!galgameMode && !hasAssistantReply) {
        setTypingAssistantId(assistantId);
      }
      setMessages((current) => [
        ...current,
        { id: assistantId, role: "assistant", content: payload.reply, created_at: Math.floor(Date.now() / 1000) },
      ]);
      if (payload.pending_choice) {
        setPendingChoice({ ...payload.pending_choice, characterId: activeCharacterId });
      }
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

  async function answerChoice(selected, custom) {
    if (!pendingForActive || choiceBusy || continueBusy) {
      return;
    }
    setChoiceBusy(true);
    setStatus("发送选择");
    const answerText = custom.trim() || selected.join("、");
    const answerTime = Math.floor(Date.now() / 1000);
    setMessages((current) => [
      ...current,
      { id: `user-choice-${Date.now()}`, role: "user", content: `[选择] ${answerText}`, created_at: answerTime },
    ]);
    try {
      const payload = await requestJson("/api/chat/answer", {
        method: "POST",
        body: JSON.stringify({
          choice_id: pendingForActive.choice_id,
          selected,
          custom,
          galgame_mode: galgameMode,
        }),
      });
      const assistantId = `assistant-${Date.now()}`;
      const hasAssistantReply = messages.some((message) => message.role === "assistant");
      if (!galgameMode && !hasAssistantReply) {
        setTypingAssistantId(assistantId);
      }
      setMessages((current) => [
        ...current,
        { id: assistantId, role: "assistant", content: payload.reply, created_at: Math.floor(Date.now() / 1000) },
      ]);
      if (payload.pending_choice) {
        setPendingChoice({ ...payload.pending_choice, characterId: activeCharacterId });
      } else {
        setPendingChoice(null);
      }
      setStatus("就绪");
    } catch (error) {
      setStatus(error.message);
      setPendingChoice(null);
    } finally {
      setChoiceBusy(false);
    }
  }

  async function continueStory() {
    if (!galgameMode || busy || choiceBusy || continueBusy || !activeCharacterId || pendingForActive) {
      return;
    }
    setContinueBusy(true);
    setStatus("推进剧情");
    try {
      const payload = await requestJson("/api/chat/continue", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (payload.reply) {
        setMessages((current) => [
          ...current,
          {
            id: `assistant-${Date.now()}`,
            role: "assistant",
            content: payload.reply,
            created_at: Math.floor(Date.now() / 1000),
          },
        ]);
      }
      if (payload.pending_choice) {
        setPendingChoice({ ...payload.pending_choice, characterId: activeCharacterId });
      } else {
        setPendingChoice(null);
      }
      setStatus("就绪");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setContinueBusy(false);
    }
  }

  async function cancelChoice() {
    if (!pendingForActive) {
      return;
    }
    try {
      await requestJson("/api/chat/answer", {
        method: "POST",
        body: JSON.stringify({ choice_id: pendingForActive.choice_id, cancelled: true }),
      });
    } catch (error) {
      setStatus(error.message);
    } finally {
      setPendingChoice(null);
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

  async function updatePortrait(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeCharacterId || portraitUploading) {
      return;
    }

    setPortraitUploading(true);
    setStatus("上传立绘");
    try {
      const form = new FormData();
      form.append("character_id", activeCharacterId);
      form.append("portrait", file);
      const response = await fetch("/api/characters/portrait", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "立绘上传失败");
      }

      const cacheBust = `t=${Date.now()}`;
      const portraitUrl = payload.character.portrait_url.includes("?")
        ? `${payload.character.portrait_url}&${cacheBust}`
        : `${payload.character.portrait_url}?${cacheBust}`;
      const nextCharacter = { ...payload.character, portrait_url: portraitUrl };

      setActiveCharacter((current) => ({
        ...(current || {}),
        ...nextCharacter,
      }));
      setCharacters((current) =>
        current.map((character) =>
          character.id === nextCharacter.id
            ? { ...character, portrait_url: portraitUrl }
            : character
        )
      );
      setStatus("立绘已更新");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setPortraitUploading(false);
    }
  }

  async function updateBackground(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !activeCharacterId || backgroundUploading) {
      return;
    }

    setBackgroundUploading(true);
    setStatus("上传背景");
    try {
      const form = new FormData();
      form.append("character_id", activeCharacterId);
      form.append("background", file);
      const response = await fetch("/api/characters/background", {
        method: "POST",
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "背景上传失败");
      }

      const cacheBust = `t=${Date.now()}`;
      const backgroundUrl = payload.character.background_url.includes("?")
        ? `${payload.character.background_url}&${cacheBust}`
        : `${payload.character.background_url}?${cacheBust}`;
      const nextCharacter = { ...payload.character, background_url: backgroundUrl };

      setActiveCharacter((current) => ({
        ...(current || {}),
        ...nextCharacter,
      }));
      setCharacters((current) =>
        current.map((character) =>
          character.id === nextCharacter.id
            ? { ...character, background_url: backgroundUrl }
            : character
        )
      );
      setStatus("背景已更新");
    } catch (error) {
      setStatus(error.message);
    } finally {
      setBackgroundUploading(false);
    }
  }

  async function openCharacterDirectory() {
    if (!activeCharacterId || openingCharacterDirectory) {
      return;
    }
    if (!desktop) {
      setStatus("当前环境不支持打开角色目录");
      return;
    }

    setOpeningCharacterDirectory(true);
    try {
      await desktop.openCharacterDirectory(activeCharacterId);
      setStatus("已打开角色目录");
    } catch (error) {
      setStatus(error.message || "打开角色目录失败");
    } finally {
      setOpeningCharacterDirectory(false);
    }
  }

  return (
    <main className={`app-shell ${leftCollapsed ? "left-collapsed" : ""} ${settingsOpen ? "settings-open" : ""} ${importOpen ? "import-open" : ""} ${diaryOpen ? "diary-open" : ""}`}>
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
        <div className="view-tabs">
          <button
            className={!galgameMode ? "active" : ""}
            onClick={() => setGalgameMode(false)}
            type="button"
          >
            聊天
          </button>
          <button
            className={galgameMode ? "active" : ""}
            onClick={() => {
              setTypingAssistantId(null);
              setGalgameMode(true);
            }}
            type="button"
          >
            Galgame
          </button>
        </div>
        {galgameMode ? (
          <GalgameView
            backgroundUploading={backgroundUploading}
            backgroundUrl={activeCharacter?.background_url || null}
            character={activeCharacter}
            choiceBusy={choiceBusy}
            continueBusy={continueBusy}
            onAnswerChoice={answerChoice}
            onCancelChoice={cancelChoice}
            onSendMessage={sendMessageText}
            onUploadBackground={updateBackground}
            onContinue={continueStory}
            onUploadPortrait={updatePortrait}
            pendingChoice={pendingForActive}
            portraitUploading={portraitUploading}
            script={toPlayScript(messages, activeCharacter?.display_name)}
            thinking={busy || choiceBusy || continueBusy}
          />
        ) : (
          <div className="chat-view">
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
            {activeCharacter && (
              <button
                aria-label={openingCharacterDirectory ? "正在打开角色目录" : "修改当前角色"}
                className="icon-button"
                disabled={!desktop || openingCharacterDirectory}
                onClick={openCharacterDirectory}
                title={desktop ? "打开当前角色目录" : "当前环境不支持打开角色目录"}
                type="button"
              >
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M4 20h4.5L19 9.5 14.5 5 4 15.5V20Z" />
                  <path d="M13 6.5 17.5 11" />
                  <path d="M4 15.5 8.5 20" />
                </svg>
                <span className="sr-only">{openingCharacterDirectory ? "打开中" : "修改角色"}</span>
              </button>
            )}
            {activeCharacter && (
              <>
                <button
                  aria-label="打开角色日记"
                  className={`icon-button ${diaryOpen ? "active" : ""}`}
                  onClick={openDiary}
                  title="角色日记"
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M6 3.5h10.5A2.5 2.5 0 0 1 19 6v14.5H8.5A2.5 2.5 0 0 1 6 18V3.5Z" />
                    <path d="M6 6H4.5v12A2.5 2.5 0 0 0 7 20.5h12" />
                    <path d="M10 8h5M10 11.5h5M10 15h3" />
                  </svg>
                  <span className="sr-only">角色日记</span>
                </button>
                <button
                  aria-label="删除当前角色"
                  className="icon-button danger-icon"
                  onClick={openDeleteCharacter}
                  title="删除当前角色"
                  type="button"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24">
                    <path d="M5 7h14M10 4h4l1 3H9l1-3ZM8 7l.8 13h6.4L16 7M10.5 10.5v6M13.5 10.5v6" />
                  </svg>
                  <span className="sr-only">删除当前角色</span>
                </button>
              </>
            )}
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
              messages.map((message) => {
                // 仅对本次会话新生成的回复（本地 id）启用打字机，历史消息直接显示
                const isTyping =
                  message.role === "assistant" &&
                  typeof message.id === "string" &&
                  message.id === typingAssistantId;
                return (
                  <article
                    className={`bubble ${message.role}${isTyping ? " typing" : ""}`}
                    key={message.id}
                    onClick={isTyping ? () => setSkipTypingId(message.id) : undefined}
                    title={isTyping ? "点击跳过打字" : undefined}
                  >
                    <div className="bubble-content">
                      {isTyping ? (
                        <TypewriterText
                          onProgress={() => {
                            const node = messageListRef.current;
                            if (node) {
                              node.scrollTop = node.scrollHeight;
                            }
                          }}
                          onComplete={() => setTypingAssistantId(null)}
                          skip={skipTypingId === message.id}
                          text={message.content}
                        />
                      ) : (
                        message.content
                      )}
                    </div>
                    {message.role !== "system" && (
                      <time>{formatMessageTime(message.created_at)}</time>
                    )}
                  </article>
                );
              })
            )}
            {(busy || choiceBusy) && (
              <article aria-label="角色正在生成回复" className="bubble assistant generating" role="status">
                <div aria-hidden="true" className="bubble-content generating-content">
                  <span className="generating-dot" />
                  <span className="generating-dot" />
                  <span className="generating-dot" />
                </div>
              </article>
            )}
            {pendingForActive && (
              <div className="choice-slot">
                <ChoicePanel
                  busy={choiceBusy}
                  choice={pendingForActive}
                  onAnswer={answerChoice}
                  onCancel={cancelChoice}
                />
              </div>
            )}
          </div>
        )}

        {activeCharacter ? (
          <form className="composer" onSubmit={sendMessage}>
            <textarea
              disabled={busy || characterSwitching || Boolean(pendingForActive)}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder={pendingForActive ? "请先回答上面的问题…" : "输入你想说的话"}
              rows={2}
              value={input}
            />
            <button disabled={busy || characterSwitching || !input.trim() || Boolean(pendingForActive)} type="submit">
              发送
            </button>
          </form>
        ) : (
          <div className="composer-placeholder">选择角色后可开始聊天</div>
        )}
          </div>
        )}
      </section>

      <aside className="diary-pane">
        <div className="diary-backdrop" onClick={closeDiary} />
        <section aria-label="角色日记" className="diary-window" role="dialog">
          <div className="settings-head">
            <div>
              <div className="section-title">角色日记</div>
              <p>{activeCharacter ? `当前：${activeCharacter.display_name}` : "未选择角色"}</p>
            </div>
            <button className="ghost-button" onClick={closeDiary} type="button">收起</button>
          </div>
          <div className="diary-body">
            <div className="memory-head">
              <p>这里记录角色对你们相处细节的感受。</p>
              <button className="ghost-button" disabled={memoryLoading} onClick={loadMemories} type="button">
                {memoryLoading ? "刷新中" : "刷新"}
              </button>
            </div>
            <div className="memory-list">
              {memories.length === 0 ? (
                <div className="memory-empty">还没有角色日记。多聊几轮后，角色会逐步记下重要的相处细节。</div>
              ) : (
                memories.map((memory) => (
                  <article className="memory-card" key={memory.id}>
                    <div className="memory-meta">
                      <span>{memory.type_label}</span>
                      <time>{formatMessageTime(memory.created_at)}</time>
                    </div>
                    {memory.character_display_name && <small>{memory.character_display_name}</small>}
                    <p>{memory.content}</p>
                    <div className="memory-actions">
                      <button
                        aria-expanded={expandedMemoryId === memory.id}
                        className="memory-link"
                        onClick={() => setExpandedMemoryId((current) => current === memory.id ? null : memory.id)}
                        type="button"
                      >
                        {expandedMemoryId === memory.id ? "收起关联记忆" : "关联记忆"}
                      </button>
                      <button
                        aria-label="删除这条角色日记"
                        className="icon-button danger-icon memory-delete"
                        disabled={deletingMemoryId === memory.id}
                        onClick={() => deleteMemory(memory.id)}
                        title="删除这条角色日记"
                        type="button"
                      >
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M6.5 6l1 14h9l1-14" />
                          <path d="M10 10v6" />
                          <path d="M14 10v6" />
                        </svg>
                        <span className="sr-only">{deletingMemoryId === memory.id ? "删除中" : "删除"}</span>
                      </button>
                    </div>
                    {expandedMemoryId === memory.id && (
                      <div className="memory-fact">
                        <span>客观事实</span>
                        <p>{memory.fact_content || "这条日记暂无关联事实。"}</p>
                      </div>
                    )}
                  </article>
                ))
              )}
            </div>
          </div>
        </section>
      </aside>

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
                <span>模型 API Key</span>
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
                <span>模型（默认 DeepSeek）</span>
                <input value={settings.model} onChange={(event) => updateSetting("model", event.target.value)} />
              </label>
              <label>
                <span>Base URL（支持 OpenAI 兼容接口）</span>
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

      {deleteCharacterOpen && (
        <div className="confirm-layer">
          <div className="confirm-backdrop" onClick={() => setDeleteCharacterOpen(false)} />
          <section aria-label="删除角色提醒" className="confirm-dialog" role="dialog">
            <div className="confirm-icon danger-icon">!</div>
            <h3>删除角色</h3>
            <p>删除“{activeCharacter?.display_name}”后，该角色的聊天记录和角色日记都会被删除，无法恢复。</p>
            <div className="confirm-actions">
              <button className="ghost-button" onClick={() => setDeleteCharacterOpen(false)} type="button">取消</button>
              <button className="danger-button" onClick={continueDeleteCharacter} type="button">继续删除</button>
            </div>
          </section>
        </div>
      )}

      {deleteCharacterConfirmOpen && (
        <div className="confirm-layer">
          <div className="confirm-backdrop" onClick={() => setDeleteCharacterConfirmOpen(false)} />
          <section aria-label="确认删除角色" className="confirm-dialog" role="dialog">
            <div className="confirm-icon danger-icon">!</div>
            <h3>最后确认</h3>
            <p>确定永久删除“{activeCharacter?.display_name}”吗？聊天记录、角色日记和关联事实都会一起删除。</p>
            <div className="confirm-actions">
              <button className="ghost-button" disabled={deletingCharacter} onClick={() => setDeleteCharacterConfirmOpen(false)} type="button">取消</button>
              <button className="danger-button" disabled={deletingCharacter} onClick={deleteCharacter} type="button">
                {deletingCharacter ? "删除中" : "永久删除"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
