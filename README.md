# AI Character Platform

AI Character Platform 是一个面向二次元角色陪伴与长期互动的角色聊天项目。它把角色 Markdown 内容包、本地记忆、对话引擎和桌面客户端整合到一起，目标是让用户能够与自己喜欢的二次元角色持续聊天、扩展角色设定，并在本地保存会话与记忆。

它适合这类场景：

- 与动漫、游戏、轻小说风格角色进行长期对话
- 为单个角色补充设定、关系、故事线和示例台词
- 在本地维护多角色内容库，而不是依赖单一云端角色模板
- 做偏陪伴、日常互动、剧情推进的角色聊天体验

当前桌面端由三部分组成：

- Python 后端：角色加载、会话、数据库、记忆、工具调用
- React/Vite 前端：聊天、设置、角色导入、更新界面
- Electron 外壳：启动本地后端并提供桌面更新能力

## 面向用户

### 你可以做什么

- 选择二次元角色并开始聊天
- 查看最近聊天记录
- 为当前角色更换头像
- 导入新的角色 Markdown 内容包
- 配置模型、API Key、上下文参数
- 检查、下载并安装桌面端更新

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

默认支持 DeepSeek API。未配置 API Key 时，会回退到本地规则型客户端。

可配置项包括：

- `DEEPSEEK_API_KEY`
- `DEEPSEEK_MODEL`
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_TIMEOUT_SECONDS`
- `DEEPSEEK_THINKING`
- `DEEPSEEK_TEMPERATURE`
- `CONTEXT_RECENT_MESSAGES`
- `CONTEXT_TOOL_RESULTS`
- `AI_CHARACTER_LLM`

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
src/                React + Vite 桌面前端源码
web/                简单静态 Web 客户端
web_server.py       本地 HTTP API 和静态文件服务
main.py             终端聊天入口
```

### 本地运行

终端聊天：

```bash
python3 main.py
```

启动本地 Web 服务：

```bash
python3 web_server.py
```

然后打开：

```text
http://127.0.0.1:8787
```

启动 Electron 客户端：

```bash
npm install
npm run electron
```

### 前端开发

启动 Vite 开发服务器：

```bash
npm run dev
```

构建生产前端：

```bash
npm run build:web
```

输出目录：

```text
dist-web/
```

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
AI_CHARACTER_LLM=auto
AI_CHARACTER_DATA_DIR=/path/to/data
```

强制使用本地规则客户端：

```bash
AI_CHARACTER_LLM=rulebased python3 main.py
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
