// Galgame 演出数据适配层（纯函数，无副作用）
// 把聊天消息流转换成「台词剧本」：过滤系统消息、按语义分块。

// 按换行分块；表格 / 代码块 / 列表 / 引用整块不拆
export function splitIntoChunks(text) {
  const lines = String(text || "").split("\n");
  const chunks = [];
  let buffer = [];
  let mode = null; // null | code | table | list | quote

  const flush = () => {
    if (buffer.length) {
      chunks.push(buffer.join("\n"));
      buffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("```")) {
      if (mode === "code") {
        buffer.push(line);
        flush();
        mode = null;
      } else {
        flush();
        mode = "code";
        buffer.push(line);
      }
      continue;
    }
    if (mode === "code") {
      buffer.push(line);
      continue;
    }

    // 表格行（含分隔行）
    if (/^\s*\|.*\|\s*$/.test(trimmed)) {
      if (mode !== "table") {
        flush();
        mode = "table";
      }
      buffer.push(line);
      continue;
    }
    if (mode === "table") {
      flush();
      mode = null;
    }

    // 无序/有序列表
    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      if (mode !== "list") {
        flush();
        mode = "list";
      }
      buffer.push(line);
      continue;
    }
    if (mode === "list") {
      flush();
      mode = null;
    }

    // 引用
    if (/^\s*>/.test(line)) {
      if (mode !== "quote") {
        flush();
        mode = "quote";
      }
      buffer.push(line);
      continue;
    }
    if (mode === "quote") {
      flush();
      mode = null;
    }

    buffer.push(line);
  }
  flush();
  return chunks.filter((item) => item.trim() !== "");
}

// messages: [{ role, content }] → [{ speaker, name, chunks }]
export function toPlayScript(messages, characterDisplayName) {
  return (messages || [])
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      speaker: message.role === "assistant" ? "character" : "player",
      name: message.role === "assistant" ? characterDisplayName || "角色" : "你",
      chunks: splitIntoChunks(message.content),
    }));
}
