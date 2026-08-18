# AI Character Platform

## 你可以直接使用的功能

AI Character Platform 当前已经具备从选择角色、开始对话到持续维护角色关系的基本产品闭环。

- **选择和切换角色**：在多个二次元角色之间切换，并分别保留与每个角色的聊天记录。
- **开始聊天和查看历史**：与角色进行日常陪伴、剧情推进和关系互动，随时查看最近的对话。
- **修改和调教角色**：在桌面端打开角色目录，直接编辑 Markdown 人设、性格、说话方式、关系、故事和示例对话，让角色更符合你的期待。
- **导入自己的角色**：上传角色 Markdown 内容包和头像，把原创 OC 或喜欢的角色加入本地角色库。
- **更换角色头像**：为当前角色上传自定义头像，调整角色的视觉形象。
- **查看和管理记忆**：查看系统从对话中沉淀的用户偏好、昵称、约定和关系事件，也可以删除不需要的记忆。
- **配置模型和对话行为**：设置 API Key、模型、温度、思考模式和上下文长度。
- **本地保存和桌面更新**：聊天、角色、头像、记忆和设置保存在本机，并支持检查、下载和安装桌面端更新。

角色会根据自己的资料和记忆回应对话，并在涉及具体剧情、人物关系或世界观时按需读取相关内容。

它适合这类场景：

- 与动漫、游戏、轻小说风格角色进行长期对话
- 为单个角色补充设定、关系、故事线和示例台词
- 在本地维护多角色内容库，而不是依赖单一云端角色模板
- 做偏陪伴、日常互动、剧情推进的角色聊天体验

当前桌面端由三部分组成：

- Python 后端：角色加载、会话、数据库、记忆、工具调用
- React/Vite 前端：聊天、设置、角色导入、更新界面
- Electron 外壳：启动本地后端并提供桌面更新能力
- Tauri 外壳：`AI Character Platform Tauri`，与 Electron 并行并复用同一套前端和 Python 后端

## 适用场景

当前更适合的角色类型：

- 动漫女友 / 男友陪伴型角色
- Galgame / 视觉小说风格角色
- 轻小说、番剧、手游世界观衍生角色
- 原创 OC 角色与长期陪伴角色

### 数据保存位置

用户数据默认保存在系统用户目录，不放在应用安装目录里。

- macOS：`~/Library/Application Support/AI Character Platform/`
- Windows：`%APPDATA%/AI Character Platform/`

这个目录里会保存：

- `runtime.sqlite3`
- `characters/`
- `.env`

也就是说，数据库、导入角色、角色自定义头像和设置都在这里。应用更新只替换程序本体，不应覆盖这些用户数据。

如果你需要指定别的目录，可以设置环境变量：

```bash
AI_CHARACTER_DATA_DIR=/path/to/data
```

### 角色导入格式

当前导入方式是：

- 单独上传头像文件
- 单独上传一个只包含 Markdown 文件的 `.zip`

内容包要求：

- 根目录必须包含 `CHARACTER.md` 和 `INDEX.md`
- 可选目录：`profile/`、`story/`、`relationships/`、`world/`、`examples/`
- zip 中不能包含非 `.md` 文件
- zip 中不能包含绝对路径或 `../` 越界路径
- `manifest.json` 由程序自动生成

内容包适合描述二次元角色的身份、性格、说话方式、关系、背景故事和示例对话。

推荐重点写清这些内容：

- 角色身份与世界观
- 性格与情绪反应
- 对用户的称呼、距离感和互动边界
- 常用语气、口头禅、说话节奏
- 与玩家或主角的关系发展
- 至少一组能体现角色味道的示例对话

### 更新说明

客户端已接入 `electron-updater`，当前更新流程是手动触发：

1. 检查更新
2. 下载更新
3. 重启安装

当前默认更新源为 GitHub Releases，对应仓库：

- `Helloworld152/AI-Character-Platform`

Windows 自动更新主要面向安装版，便携版适合手动下载替换。  
macOS 正式自动更新需要签名和公证；未签名包适合测试，不适合正式分发。

### 模型与 API 配置

项目默认使用 DeepSeek API，也支持其他兼容 OpenAI Chat Completions 格式的模型 API，必须配置 API Key。
修改模型名称、Base URL 和 API Key 即可切换服务商。现有 `DEEPSEEK_*` 环境变量名称为历史兼容配置名，不限制实际使用的模型服务商。

可配置项包括：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_TIMEOUT_SECONDS`
- `DEEPSEEK_THINKING`
- `DEEPSEEK_TEMPERATURE`
- `CONTEXT_RECENT_MESSAGES`
- `CONTEXT_TOOL_RESULTS`

## 面向开发者

这个项目的核心不是通用聊天壳，而是“角色内容 + 记忆 + 长期互动”的组合。开发和扩展时，优先保证以下几点：

- 角色设定一致性
- 长期对话中的人设稳定
- 角色内容包导入和扩展成本低
- 桌面端本地存档安全，不因更新覆盖用户数据

### 项目结构

```text
character_runtime/  Python 角色运行时、数据库、Agent、工具、记忆
characters/         内置角色包
electron/           Electron 主进程和 preload
src-tauri/          Tauri Rust 外壳、后端进程生命周期和打包配置
src/                React + Vite 桌面前端源码
web/                简单静态 Web 客户端
web_server.py       本地 HTTP API 和静态文件服务
main.py             终端聊天入口
```

### 本地运行

#### 快速构建 Web 应用

首次运行或依赖发生变化时，先安装依赖并构建生产前端：

```bash
npm ci
npm run build:web
```

然后启动本地 Web 服务：

```bash
npm run web
```

浏览器访问：

```text
http://127.0.0.1:8787
```

`npm run build:web` 会生成 `dist-web/` 前端产物；`npm run web` 会启动 Python 后端，并优先提供 `dist-web/` 中的生产前端页面。

终端聊天：

```bash
python3 main.py
```

启动 Electron 客户端：

```bash
npm install
npm run electron
```

启动 Tauri 开发客户端（与 Electron 并行）：

```bash
npm run tauri:dev
```

构建 Tauri 桌面包：

```bash
npm run tauri:build
```

Tauri 层会复用 `dist-web/`、`web_server.py`、`character_runtime/` 和内置 `characters/`。本机开发和当前打包方案需要 Python 3 在 PATH 中；Electron 的更新能力仍由 Electron 链路独立维护。

按平台发布 Tauri 包（Android、Windows、macOS 产物统一带 `Tauri` 后缀，Electron 名称保持原样）：

```bash
npm run tauri:release:android
npm run tauri:release:windows
npm run tauri:release:macos
```

Android 构建前先执行一次 `npm run tauri:android:init`，并安装 Android Studio、SDK、NDK、Java 和对应 Rust targets。Android 端默认不启动桌面 Python 后端；如需可用聊天 API，在构建时设置 `VITE_API_BASE_URL` 指向移动端可访问的服务地址。Windows/macOS 继续使用随 Tauri 资源启动的本地 Python 后端。

### 数据与运行时设计

当前运行时有两个根目录概念：

- `app root`：程序代码和内置角色所在目录
- `data root`：用户数据所在目录

运行时实际读取和写入的数据都应放在 `data root`，包括：

- SQLite 数据库
- 导入角色
- 自定义头像
- `.env` 设置

首次运行时，如果 `data root/characters/` 为空，程序会把应用内置角色复制过去一份作为初始内容。

### 环境变量

常用环境变量：

```bash
DEEPSEEK_API_KEY=your-api-key
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_TIMEOUT_SECONDS=60
DEEPSEEK_THINKING=disabled
DEEPSEEK_TEMPERATURE=0.8
CONTEXT_RECENT_MESSAGES=40
CONTEXT_TOOL_RESULTS=8
AI_CHARACTER_DATA_DIR=/path/to/data
```

记忆提取可单独配置：

```bash
MEMORY_EXTRACTOR_ENABLED=true
MEMORY_EXTRACTOR_MODEL=deepseek-v4-flash
MEMORY_EXTRACTOR_TIMEOUT_SECONDS=30
```

### 打包

macOS：

```bash
npm run dist
```

macOS DMG + ZIP：

```bash
npm run dist:dmg
```

以上 macOS 打包命令默认只生成本地产物，不会自动发布到 GitHub Releases。

Windows 安装版 + 便携版：

```powershell
npm run dist:win
```

只构建 Windows 便携版：

```bash
npm run dist:win:portable
```

打包输出目录：

```text
release/
```

### 发布与自动更新

当前 `package.json` 已配置 GitHub Releases 作为更新源：

```json
"publish": [
  {
    "provider": "github",
    "owner": "Helloworld152",
    "repo": "AI-Character-Platform"
  }
]
```

发布一个新版本的基本步骤：

1. 更新 `package.json` 版本号
2. 构建目标平台产物
3. 创建 GitHub Release
4. 上传安装包和自动更新元数据

macOS 通常至少需要：

```text
AI Character Platform-<version>-arm64-mac.zip
AI Character Platform-<version>-arm64-mac.zip.blockmap
latest-mac.yml
```

如果 DMG 构建成功，也可以一起上传：

```text
AI Character Platform-<version>-arm64.dmg
```

Windows 通常需要：

```text
AI Character Platform Setup <version>.exe
AI Character Platform <version>.exe
latest.yml
```

注意：

- 自动更新依赖 `latest*.yml`
- 版本号必须递增
- 不要覆盖同一个版本的 release 来模拟更新

### macOS 正式分发

正式分发 macOS 应用需要：

- Apple Developer Program 账号
- `Developer ID Application` 证书
- notarization 公证凭证

常见环境变量：

```bash
export CSC_LINK="/path/to/DeveloperIDApplication.p12"
export CSC_KEY_PASSWORD="p12-password"
export APPLE_ID="you@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="ABCDE12345"
```

没有签名和公证时：

- 可以本地测试
- 不适合正式发布
- macOS 自动更新可靠性也会受影响

### 终端命令

- `:quit` 退出
- `:characters` 查看角色
- `:switch <character_id>` 切换角色

## 当前限制

- 角色导入当前要求头像和 Markdown 内容包分开上传
- 重复角色 ID 会拒绝导入，不会覆盖更新
- 角色内容格式目前仍以 Markdown 目录结构为主，不支持单一 `.character` 包格式
- macOS 自动更新在正式环境中仍依赖签名与公证
- Windows 正式分发建议补代码签名，否则可能遇到 SmartScreen 警告
