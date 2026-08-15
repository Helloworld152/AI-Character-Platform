# AI Character Platform

基于设计文档实现的 Python MVP 骨架，当前重点是验证这条链路：

`Character Package -> Tool System -> Agent Loop -> Conversation Engine -> CLI`

## 当前能力

- 加载本地角色包目录
- 读取 `manifest.json`、`CHARACTER.md`、`INDEX.md`
- 提供 `read_file`、`list_files`、`search_files` 三个工具
- 使用 SQLite 持久化 sessions、messages、memories
- 提供 `read_memory`、`write_memory` 工具
- 支持 DeepSeek API；没有 API Key 时回退到本地规则型 `LLM Client`
- 提供终端聊天入口

## 运行

```bash
python3 main.py
```

## 网页端

```bash
python3 web_server.py
```

然后打开：

```text
http://127.0.0.1:8787
```

## Electron 客户端

首次运行需要安装前端和打包依赖：

```bash
npm install
npm run electron
```

Electron 会自动启动 Python 后端，并打开桌面窗口。客户端支持：

- 角色头像与角色切换
- SQLite 历史聊天记录显示
- DeepSeek API Key、模型、上下文参数配置
- 本地规则模型与真实模型切换

## 前端开发

前端已迁移到 React + Vite，源码在 `src/`。

开发前端：

```bash
npm run dev
```

构建前端：

```bash
npm run build:web
```

生产构建输出到：

```text
dist-web/
```

## 打包客户端

生成 macOS 客户端：

```bash
npm run dist
```

当前打包产物：

```text
release/AI Character Platform-0.1.0-arm64.dmg
```

当前没有配置应用图标和 Apple Developer ID 签名，所以 electron-builder 会使用默认图标并跳过 macOS 签名。

## 角色音色

角色包可通过 `voice/voice.json` 声明音色配置：

```json
{
  "enabled": false,
  "provider": "authorized_tts",
  "voice_id": "replace_with_licensed_cv_voice_id",
  "display_name": "授权音色",
  "speed": 1.02,
  "pitch": 0.0,
  "volume": 1.0,
  "requires_authorized_voice": true
}
```

如果目标是现实 CV/声优音色，只能使用已授权的 voice_id、官方合作 TTS 或自有授权声音模型。
当前后端已提供 `GET /api/voice` 读取当前角色音色配置，实际 TTS 合成接口暂未接入。

## SQLite 数据

运行后会自动创建用户级数据库：

```text
~/Library/Application Support/AI Character Platform/runtime.sqlite3
```

如果你设置了 `AI_CHARACTER_DATA_DIR`，会改用这个目录：

```bash
AI_CHARACTER_DATA_DIR=/path/to/data python3 web_server.py
```

开发目录里也可能存在旧数据库：

```text
data/runtime.sqlite3
```

首次切换到用户级数据库时，程序会尝试从旧开发目录数据库复制一份过去。

当前会持久化：

- `users`
- `characters`
- `installed_packs`
- `sessions`
- `messages`
- `memories`
- `licenses`

客户端启动时默认只显示最近 30 条聊天记录，完整历史仍保存在 SQLite 中。

聊天回复完成后会尝试调用小模型做后台记忆提取。默认复用 `DEEPSEEK_API_KEY`，也可以独立配置：

```bash
MEMORY_EXTRACTOR_ENABLED=true
MEMORY_EXTRACTOR_MODEL=deepseek-v4-flash
MEMORY_EXTRACTOR_TIMEOUT_SECONDS=30
```

如果没有 API Key，自动记忆提取会跳过，不影响聊天。

## 使用 DeepSeek

不要把 API Key 写进仓库文件。运行前在当前终端设置环境变量：

```bash
export DEEPSEEK_API_KEY="你的 key"
export DEEPSEEK_MODEL="deepseek-v4-flash"
python3 main.py
```

也可以在项目根目录创建 `.env`，程序启动时会自动读取：

```bash
DEEPSEEK_API_KEY=你的 key
DEEPSEEK_MODEL=deepseek-v4-flash
```

可选环境变量：

- `DEEPSEEK_BASE_URL` 默认 `https://api.deepseek.com`
- `DEEPSEEK_TIMEOUT_SECONDS` 默认 `60`
- `DEEPSEEK_THINKING` 默认 `disabled`，可改为 `enabled`
- `DEEPSEEK_TEMPERATURE` 默认 `0.8`
- `CONTEXT_RECENT_MESSAGES` 默认 `40`
- `CONTEXT_TOOL_RESULTS` 默认 `8`

如果没有设置 `DEEPSEEK_API_KEY`，程序会自动回退到本地规则型演示客户端。

开发调试时可以强制使用本地规则客户端：

```bash
AI_CHARACTER_LLM=rulebased python3 main.py
```

## 终端命令

- `:quit` 退出
- `:characters` 查看已安装角色
- `:switch <character_id>` 切换角色

## 当前限制

- 还没有 `.character` 压缩包导入，仅支持直接读取目录
- Memory 已有基础读写表和工具，自动记忆提取还没接入
