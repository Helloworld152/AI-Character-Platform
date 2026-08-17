import { useState } from "react";
import { Stage } from "./Stage.jsx";
import { DialogueBox } from "./DialogueBox.jsx";
import { ChoicePanel } from "./ChoicePanel.jsx";
import "./galgame.css";

const DEFAULT_SETTINGS = {
  typewriterMs: 30,
  autoAdvanceMs: 950,
  bounce: true,
};

// Galgame 主视图：立绘全屏舞台 + 底部剧本对话框 + 历史/设置抽屉
export function GalgameView({
  character,
  script,
  thinking,
  onUploadPortrait,
  portraitUploading,
  pendingChoice,
  choiceBusy,
  continueBusy,
  onAnswerChoice,
  onCancelChoice,
  onContinue,
}) {
  const [backlogOpen, setBacklogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [autoMode, setAutoMode] = useState(true);

  const displayName = character?.display_name || "角色";
  const portraitUrl = character?.portrait_url || null;
  const avatarUrl = character?.avatar_url || null;

  const updateSetting = (key, value) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const hasScript = script.length > 0;

  return (
    <div className="gg-view">
      <div className="gg-topbar">
        <div className="gg-title">GALGAME · {displayName}</div>
        <div className="gg-top-actions">
          <label className={`gg-portrait-upload ${portraitUploading ? "uploading" : ""}`}>
            {portraitUploading ? "上传中…" : "上传立绘"}
            <input
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              disabled={portraitUploading}
              onChange={onUploadPortrait}
              type="file"
            />
          </label>
          <button
            className={`gg-tool ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((value) => !value)}
            type="button"
          >
            设置
          </button>
          <button
            className={`gg-tool ${backlogOpen ? "active" : ""}`}
            onClick={() => setBacklogOpen((value) => !value)}
            type="button"
          >
            历史
          </button>
        </div>
      </div>

      <div className="gg-stage">
        <Stage
          avatarUrl={avatarUrl}
          key={`${character?.id || "none"}:${portraitUrl || ""}:${avatarUrl || ""}`}
          portraitUrl={portraitUrl}
          speaking={settings.bounce}
          thinking={thinking}
        />
        {!hasScript && (
          <div className="gg-empty">
            <strong>演出尚未开始</strong>
            <p>点击右下角继续按钮开始推进剧情。自由聊天请切换到「聊天」模式，立绘可以在上方上传。</p>
          </div>
        )}
        {pendingChoice && (
          <ChoicePanel
            busy={choiceBusy}
            choice={pendingChoice}
            onAnswer={onAnswerChoice}
            onCancel={onCancelChoice}
            variant="stage"
          />
        )}
        {character && (
          <div className="gg-stage-overlay">
            <DialogueBox
              autoAdvanceMs={settings.autoAdvanceMs}
              autoMode={autoMode}
              characterName={displayName}
              continueBusy={continueBusy}
              continueDisabled={Boolean(pendingChoice)}
              key={character?.id || "none"}
              onAutoModeChange={setAutoMode}
              onContinue={onContinue}
              script={script}
              typewriterMs={settings.typewriterMs}
            />
          </div>
        )}
      </div>

      {settingsOpen && (
        <div className="gg-mask" onClick={() => setSettingsOpen(false)}>
          <div className="gg-panel narrow" onClick={(event) => event.stopPropagation()}>
            <div className="gg-panel-head">
              <span className="gg-panel-title">演出设置</span>
              <button className="gg-tool" onClick={() => setSettingsOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="gg-panel-body">
              <div className="gg-setting-row">
                <span className="gg-setting-label">打字机速度</span>
                <input
                  className="gg-setting-range"
                  max="120"
                  min="0"
                  onChange={(event) => updateSetting("typewriterMs", Number(event.target.value))}
                  type="range"
                  value={settings.typewriterMs}
                />
                <span className="gg-setting-value">{settings.typewriterMs}ms</span>
              </div>
              <div className="gg-setting-row">
                <span className="gg-setting-label">自动推进间隔</span>
                <input
                  className="gg-setting-range"
                  max="4000"
                  min="200"
                  onChange={(event) => updateSetting("autoAdvanceMs", Number(event.target.value))}
                  step="50"
                  type="range"
                  value={settings.autoAdvanceMs}
                />
                <span className="gg-setting-value">{settings.autoAdvanceMs}ms</span>
              </div>
              <div className="gg-setting-row">
                <span className="gg-setting-label">说话弹跳</span>
                <button
                  aria-checked={settings.bounce}
                  className={`gg-switch${settings.bounce ? "" : " off"}`}
                  onClick={() => updateSetting("bounce", !settings.bounce)}
                  role="switch"
                  type="button"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {backlogOpen && (
        <div className="gg-mask" onClick={() => setBacklogOpen(false)}>
          <div className="gg-panel" onClick={(event) => event.stopPropagation()}>
            <div className="gg-panel-head">
              <span className="gg-panel-title">台词回放</span>
              <button className="gg-tool" onClick={() => setBacklogOpen(false)} type="button">
                关闭
              </button>
            </div>
            <div className="gg-panel-body">
              {script.length === 0 ? (
                <span className="gg-backlog-text">暂无台词</span>
              ) : (
                script.map((turn, index) => (
                  <div className="gg-backlog-turn" key={`${turn.name}-${index}`}>
                    <span className={`gg-backlog-name${turn.speaker === "player" ? " player" : ""}`}>
                      {turn.name}
                    </span>
                    <span className="gg-backlog-text">{turn.chunks.join("\n")}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
