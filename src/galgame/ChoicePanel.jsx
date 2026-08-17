import { useState } from "react";

// 提问选择框
// variant: "inline"（聊天模式内联卡片） | "stage"（Galgame 极简视觉小说风选项）
export function ChoicePanel({ choice, variant = "inline", busy = false, onAnswer, onCancel }) {
  const [selected, setSelected] = useState([]);
  const [custom, setCustom] = useState("");
  const [error, setError] = useState(null);

  if (!choice) {
    return null;
  }
  const multi = choice.multi_select === true;
  const allowCustom = variant === "stage" || choice.allow_custom === true;
  const options = Array.isArray(choice.options) ? choice.options : [];
  const customText = custom.trim();

  const toggleOption = (label) => {
    if (busy) {
      return;
    }
    setError(null);
    if (multi) {
      setSelected((current) =>
        current.includes(label) ? current.filter((item) => item !== label) : [...current, label]
      );
    } else {
      setSelected([label]);
    }
  };

  const handleCustom = (value) => {
    setCustom(value);
    if (multi) {
      setSelected([]);
    }
  };

  const submit = () => {
    if (busy) {
      return;
    }
    if (selected.length === 0 && customText === "") {
      setError("请选择一个选项或填写自定义答案");
      return;
    }
    setError(null);
    onAnswer(selected, customText);
  };

  const chooseStageOption = (label) => {
    if (busy) {
      return;
    }
    if (multi) {
      toggleOption(label);
      return;
    }
    onAnswer([label], "");
  };

  const cancel = () => {
    if (!busy) {
      onCancel?.();
    }
  };

  // ===== Galgame 极简版（真正的视觉小说选项） =====
  if (variant === "stage") {
    return (
      <div className="gg-choice-simple">
        <div className="gg-choice-q">
          {multi ? "（可多选）" : ""}
          {choice.question}
        </div>
        <div className="gg-choice-list">
          {options.map((option) => {
            const label = typeof option === "string" ? option : option?.label || "";
            const description = typeof option === "object" && option ? option.description : undefined;
            const isSelected = selected.includes(label);
            return (
              <button
                aria-checked={isSelected}
                className={`gg-choice-item${isSelected ? " selected" : ""}`}
                disabled={busy}
                key={label}
                onClick={() => chooseStageOption(label)}
                type="button"
              >
                <span className="gg-choice-label">{label}</span>
                {description ? <span className="gg-choice-desc">{description}</span> : null}
              </button>
            );
          })}
        </div>
        {allowCustom && (
          <div className="gg-choice-custom-wrap">
            <textarea
              className="gg-choice-custom"
              disabled={busy}
              onChange={(event) => handleCustom(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              placeholder="或者自己输入回答或行动…"
              rows={2}
              value={custom}
            />
          </div>
        )}
        {(multi || allowCustom) && (
          <div className="gg-choice-actions">
            {multi && (
              <button className="gg-choice-cancel" disabled={busy} onClick={cancel} type="button">
                取消
              </button>
            )}
            <button
              className="gg-choice-ok"
              disabled={busy || (selected.length === 0 && customText === "")}
              onClick={submit}
              type="button"
            >
              {busy ? "…" : "确定"}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ===== 聊天模式内联卡片版 =====
  return (
    <div className="choice-card" role="dialog" aria-modal="true">
      {choice.prompt && <div className="choice-prompt">{choice.prompt}</div>}
      <div className="choice-header">
        <div className="choice-eyebrow">分支抉择</div>
        <div className="choice-title">{choice.question}</div>
      </div>
      <div className="choice-body">
        {options.length > 0 && (
          <div className="choice-options" role={multi ? "group" : "radiogroup"}>
            {options.map((option) => {
              const label = typeof option === "string" ? option : option?.label || "";
              const description = typeof option === "object" && option ? option.description : undefined;
              const isSelected = selected.includes(label);
              return (
                <button
                  aria-checked={isSelected}
                  className={`choice-option${isSelected ? " selected" : ""}`}
                  disabled={busy}
                  key={label}
                  onClick={() => toggleOption(label)}
                  role={multi ? "checkbox" : "radio"}
                  type="button"
                >
                  <span className="choice-option-label">
                    {multi ? (isSelected ? "☑ " : "☐ ") : isSelected ? "● " : "○ "}
                    {label}
                  </span>
                  {description ? <span className="choice-option-desc">{description}</span> : null}
                </button>
              );
            })}
          </div>
        )}
        {allowCustom && (
          <textarea
            className="choice-custom"
            disabled={busy}
            onChange={(event) => handleCustom(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="或者输入自定义答案…"
            rows={options.length > 0 ? 1 : 3}
            value={custom}
          />
        )}
      </div>
      {error && (
        <p className="choice-error" role="status">
          {error}
        </p>
      )}
      <div className="choice-footer">
        <button className="choice-cancel" disabled={busy} onClick={cancel} type="button">
          取消
        </button>
        <button
          className="choice-submit"
          disabled={busy || (selected.length === 0 && customText === "")}
          onClick={submit}
          type="button"
        >
          {busy ? "发送中…" : "提交"}
        </button>
      </div>
    </div>
  );
}
