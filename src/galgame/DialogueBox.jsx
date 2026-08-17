import { useEffect, useRef, useState } from "react";

// 定位到剧本最后一句（最新消息），完整显示
function resolveInitialPosition(script) {
  const turn = script.length > 0 ? script.length - 1 : 0;
  const chunks = script[turn]?.chunks || [];
  const chunk = chunks.length > 0 ? chunks.length - 1 : 0;
  return { turn, chunk, fullLength: chunks[chunk]?.length || 0 };
}

// 台词对话框：打字机逐字 + 点击推进 + 翻页 + 自动模式
export function DialogueBox({ script, typewriterMs, autoAdvanceMs, autoMode, onAutoModeChange }) {
  const [initialPosition] = useState(() => resolveInitialPosition(script));
  const [turnIndex, setTurnIndex] = useState(initialPosition.turn);
  const [chunkIndex, setChunkIndex] = useState(initialPosition.chunk);
  const [typedCount, setTypedCount] = useState(initialPosition.fullLength);
  const [interacted, setInteracted] = useState(false);
  const boxRef = useRef(null);

  const current = script[Math.min(turnIndex, script.length - 1)];
  const chunk = current?.chunks?.[Math.min(chunkIndex, current.chunks.length - 1)] || "";
  const isLast = turnIndex >= script.length - 1 && chunkIndex >= (current?.chunks?.length || 1) - 1;
  const typing = typedCount < chunk.length;

  const advance = () => {
    if (!current) {
      return;
    }
    if (chunkIndex < current.chunks.length - 1) {
      setChunkIndex((value) => value + 1);
      setTypedCount(0);
    } else if (turnIndex < script.length - 1) {
      setTurnIndex((value) => value + 1);
      setChunkIndex(0);
      setTypedCount(0);
    }
  };

  // 打字机 + 自动推进
  useEffect(() => {
    if (!chunk) {
      return undefined;
    }
    if (typing) {
      const timer = setTimeout(() => setTypedCount((value) => value + 1), typewriterMs);
      return () => clearTimeout(timer);
    }
    if (autoMode && !interacted && !isLast) {
      const timer = setTimeout(advance, autoAdvanceMs);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [chunk, typedCount, autoMode, interacted, isLast]);

  // 新消息到达：自动跟随到最新一句并从打字机开始播放
  const lastScriptLength = useRef(script.length);
  useEffect(() => {
    if (script.length > lastScriptLength.current) {
      setTurnIndex(script.length - 1);
      setChunkIndex(0);
      setTypedCount(0);
      setInteracted(false);
    }
    lastScriptLength.current = script.length;
  }, [script.length]);

  // 滚动跟随
  useEffect(() => {
    const node = boxRef.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
    }
  }, [typedCount, chunkIndex, turnIndex]);

  const handleClick = () => {
    setInteracted(true);
    onAutoModeChange?.(false);
    if (typing) {
      setTypedCount(chunk.length);
    } else if (!isLast) {
      advance();
    }
  };

  const jumpTo = (turn, index) => {
    setTurnIndex(turn);
    setChunkIndex(index);
    setTypedCount(0);
  };

  const showAutoHint = autoMode && !interacted && !isLast;

  return (
    <div className="gg-dialogue-area">
      <div className={`gg-nameplate${current?.speaker === "player" ? " player" : ""}`}>
        {current?.name || "…"}
      </div>
      <div
        className={`gg-dialogue-box${typing ? " gg-dialogue-typing" : ""}`}
        onClick={handleClick}
        ref={boxRef}
        role="button"
        tabIndex={0}
      >
        <div className="gg-dialogue-body">{chunk.slice(0, typedCount)}</div>
        {!chunk && <span className="gg-dialogue-placeholder">（等待下一句…）</span>}
        <div className="gg-controls">
          <button
            aria-label="上一句"
            className="gg-nav"
            disabled={turnIndex === 0 && chunkIndex === 0}
            onClick={() => {
              setInteracted(true);
              onAutoModeChange?.(false);
              if (chunkIndex > 0) {
                jumpTo(turnIndex, chunkIndex - 1);
              } else if (turnIndex > 0) {
                jumpTo(turnIndex - 1, script[turnIndex - 1].chunks.length - 1);
              }
            }}
            type="button"
          >
            ◀
          </button>
          <span className="gg-position">
            {turnIndex + 1}/{script.length}
          </span>
          {showAutoHint ? (
            <span className="gg-auto-hint">自动</span>
          ) : (
            <span className="gg-position">手动</span>
          )}
          <button
            aria-label="下一句"
            className="gg-nav"
            disabled={isLast}
            onClick={() => {
              setInteracted(true);
              onAutoModeChange?.(false);
              advance();
            }}
            type="button"
          >
            ▶
          </button>
        </div>
      </div>
    </div>
  );
}
