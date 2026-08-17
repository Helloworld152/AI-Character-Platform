import { useState } from "react";

// 立绘舞台内容层：立绘（bottom-center 锚定）+ 说话弹跳 + 思考徽标 + 水印
// 注意：本组件不渲染 .gg-stage（由 GalgameView 提供舞台容器），
// 避免两层 .gg-stage 嵌套导致定位/裁剪异常。
// 显示优先级：立绘 → 头像兜底 → 占位符；立绘加载失败自动降级
export function Stage({ portraitUrl, avatarUrl, speaking, thinking }) {
  const [portraitBroken, setPortraitBroken] = useState(false);
  const src = !portraitBroken && portraitUrl ? portraitUrl : avatarUrl;

  return (
    <>
      <div className={`gg-portrait-wrap${speaking ? " gg-bouncing" : ""}`}>
        {src ? (
          <img
            alt="角色立绘"
            className="gg-portrait"
            draggable="false"
            key={src}
            onError={() => setPortraitBroken(true)}
            src={src}
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
    </>
  );
}
