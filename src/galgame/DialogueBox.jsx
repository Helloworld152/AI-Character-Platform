import { useEffect, useRef, useState } from "react";

// 定位到剧本最后一句（最新消息），完整显示
function resolveInitialPosition(script) {
  const turn = script.length > 0 ? script.length - 1 : 0;
  const chunks = script[turn]?.chunks || [];
  const chunk = chunks.length > 0 ? chunks.length - 1 : 0;
  return { turn, chunk, fullLength: chunks[chunk]?.length || 0 };
}

// 台词对话框：打字机逐字 + 点击推进 + 翻页 + 自动模式
export function DialogueBox({
  script,
  typewriterMs,
  autoAdvanceMs,
  autoMode,
  onAutoModeChange,
  characterName = "角色",
  onContinue,
  continueBusy = false,
  continueDisabled = false,
}) {
  const [initialPosition] = useState(() => resolveInitialPosition(script));
  const [turnIndex, setTurnIndex] = useState(initialPosition.turn);
  const [chunkIndex, setChunkIndex] = useState(initialPosition.chunk);
  const [typedCount, setTypedCount] = useState(initialPosition.fullLength);
  const [typewriterTurn, setTypewriterTurn] = useState(false);
  const [interacted, setInteracted] = useState(false);
  const boxRef = useRef(null);

  const lastTurnIndex = Math.max(script.length - 1, 0);
  const safeTurnIndex = Math.min(Math.max(turnIndex, 0), lastTurnIndex);
  const current = script[safeTurnIndex];
  const lastChunkIndex = Math.max((current?.chunks?.length || 1) - 1, 0);
  const safeChunkIndex = Math.min(Math.max(chunkIndex, 0), lastChunkIndex);
  const chunk = current?.chunks?.[safeChunkIndex] || "";
  const isLast = script.length === 0 || (safeTurnIndex >= lastTurnIndex && safeChunkIndex >= lastChunkIndex);
  const typing = typewriterTurn && typedCount < chunk.length;

  const advance = () => {
    if (!current) {
      return;
    }
    if (safeChunkIndex < current.chunks.length - 1) {
      const nextChunk = current.chunks[safeChunkIndex + 1] || "";
      setChunkIndex(safeChunkIndex + 1);
      setTypedCount(typewriterTurn ? 0 : nextChunk.length);
    } else if (safeTurnIndex < lastTurnIndex) {
      const nextTurn = script[safeTurnIndex + 1];
      const nextChunk = nextTurn?.chunks?.[0] || "";
      setTurnIndex(safeTurnIndex + 1);
      setChunkIndex(0);
      setTypewriterTurn(false);
      setTypedCount(nextChunk.length);
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

  // 新消息到达：仅当前角色会话的第一次角色回复播放打字机
  const lastScriptLength = useRef(script.length);
  const scriptInitialized = useRef(script.length > 0);
  const hasPlayedGeneration = useRef(false);
  useEffect(() => {
    if (!scriptInitialized.current) {
      if (script.length > 0) {
        const nextTurn = script[script.length - 1];
        const nextChunk = nextTurn?.chunks?.[0] || "";
        const shouldType = nextTurn?.speaker === "character" && !hasPlayedGeneration.current;
        if (nextTurn?.speaker === "character") {
          hasPlayedGeneration.current = true;
        }
        lastScriptLength.current = script.length;
        scriptInitialized.current = true;
        setTurnIndex(script.length - 1);
        setChunkIndex(0);
        setTypewriterTurn(shouldType);
        setTypedCount(shouldType ? 0 : nextChunk.length);
        setInteracted(false);
      }
      return;
    }
    if (script.length < lastScriptLength.current) {
      const position = resolveInitialPosition(script);
      setTurnIndex(position.turn);
      setChunkIndex(position.chunk);
      setTypewriterTurn(false);
      setTypedCount(position.fullLength);
    }
    if (script.length > lastScriptLength.current) {
      const nextTurn = script[script.length - 1];
      const nextChunk = nextTurn?.chunks?.[0] || "";
      const shouldType = nextTurn?.speaker === "character" && !hasPlayedGeneration.current;
      if (nextTurn?.speaker === "character") {
        hasPlayedGeneration.current = true;
      }
      setTurnIndex(script.length - 1);
      setChunkIndex(0);
      setTypewriterTurn(shouldType);
      setTypedCount(shouldType ? 0 : nextChunk.length);
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
    const targetTurn = Math.min(Math.max(turn, 0), lastTurnIndex);
    const targetLastChunk = Math.max((script[targetTurn]?.chunks?.length || 1) - 1, 0);
    const targetIndex = Math.min(Math.max(index, 0), targetLastChunk);
    const targetChunk = script[targetTurn]?.chunks?.[targetIndex] || "";
    setTurnIndex(targetTurn);
    setChunkIndex(targetIndex);
    setTypewriterTurn(false);
    setTypedCount(targetChunk.length);
  };

  const showAutoHint = autoMode && !interacted && !isLast;

  return (
    <div className="gg-dialogue-area">
      <div className={`gg-nameplate${current?.speaker === "player" ? " player" : ""}`}>
        {current?.name || characterName}
      </div>
      <div
        className={`gg-dialogue-box${typing ? " gg-dialogue-typing" : ""}`}
        onClick={handleClick}
        role="button"
        tabIndex={0}
      >
        <div className="gg-dialogue-scroll" ref={boxRef}>
          <div className="gg-dialogue-body">{chunk.slice(0, typedCount)}</div>
          {!chunk && <span className="gg-dialogue-placeholder">（等待下一句…）</span>}
        </div>
        <div className="gg-controls">
          <button
            aria-label={continueBusy ? "正在推进剧情" : "继续剧情"}
            className="gg-continue"
            disabled={continueBusy || continueDisabled}
            onClick={(event) => {
              event.stopPropagation();
              onContinue?.();
            }}
            title={continueBusy ? "正在推进剧情" : continueDisabled ? "请先完成当前选择" : "继续剧情"}
            type="button"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24">
              <path d="M8 5.5v13L18.5 12 8 5.5Z" />
            </svg>
          </button>
          <button
            aria-label="上一句"
            className="gg-nav"
            disabled={safeTurnIndex === 0 && safeChunkIndex === 0}
            onClick={(event) => {
              event.stopPropagation();
              setInteracted(true);
              onAutoModeChange?.(false);
              if (safeChunkIndex > 0) {
                jumpTo(safeTurnIndex, safeChunkIndex - 1);
              } else if (safeTurnIndex > 0) {
                jumpTo(safeTurnIndex - 1, (script[safeTurnIndex - 1]?.chunks?.length || 1) - 1);
              }
            }}
            type="button"
          >
            ◀
          </button>
          <span className="gg-position">
            {safeTurnIndex + 1}/{script.length}
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
            onClick={(event) => {
              event.stopPropagation();
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
