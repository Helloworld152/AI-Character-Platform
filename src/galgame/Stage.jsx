// 立绘舞台：立绘层（bottom-center 锚定）+ 说话弹跳 + 思考徽标
export function Stage({ portraitUrl, speaking, thinking }) {
  return (
    <div className="gg-stage">
      <div className={`gg-portrait-wrap${speaking ? " gg-bouncing" : ""}`}>
        {portraitUrl ? (
          <img
            alt="角色立绘"
            className="gg-portrait"
            draggable="false"
            key={portraitUrl}
            src={portraitUrl}
          />
        ) : (
          <div className="gg-portrait-placeholder">
            <span>立绘</span>
            <small>可在上方上传</small>
          </div>
        )}
      </div>
      {thinking && (
        <div className="gg-thinking-badge">
          <span className="gg-thinking-dot" />
          <span className="gg-thinking-dot" />
          <span className="gg-thinking-dot" />
          <span>思考中</span>
        </div>
      )}
      <span className="gg-watermark">AI CHARACTER · GALGAME</span>
    </div>
  );
}
