# 好感度系统设计方案

> 状态：设计定稿，待实现
> 适用范围：AI Character Platform（AICP）
> 关联机制：记忆系统（`memory_extractor.py`）、剧情选择框（`ask_choice` + `choices.json`）、角色包（`manifest.json` / `choices.json`）

## 1. 概述

给每个角色增加 0~100 的好感度：**对话中玩家的言行改变数值 → 数值影响角色语气（上下文注入）与剧情解锁（分支门槛）→ 界面显示 ❤ 数值、等级与变化飘字**。

核心原则（与记忆系统一致）：

- **只看玩家的行为**：加分/减分只依据玩家明确说了什么、做了什么；角色自己的回复、撒娇、示好不能作为加分依据。
- **判定失败静默降级**：任何一层判定器超时/解析失败都降级到下一层，最终无结果则 delta 0，绝不阻塞对话。
- **数值克制**：每轮最多一次判定，delta 范围 ±5，数值 clamp 到 [0, 100]。

## 2. 总体架构

```
┌──────────────────────────────────────────────────┐
│ 数据层  affection 表（SQLite，用户×角色 主键隔离）    │
│        affection_log 表（变化日志）                 │
└───────────────────────┬──────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────┐
│ 判定层  AffectionEvaluator（每轮对话后调用一次）       │
│   通道① 角色包规则（affection.json，最优先）           │
│   通道② 模型判定（可选，仿 memory_extractor）          │
│   通道③ 关键词规则兜底（无 Key 也能跑）                 │
└───────────────────────┬──────────────────────────┘
                        ▼
┌──────────────────────────────────────────────────┐
│ 消费层                                                 │
│   ① 上下文注入  [AFFECTION] 块 → 模型按等级演角色       │
│   ② 分支门槛    choices.json 的 min_affection 解锁      │
│   ③ 前端展示    ❤ 数值 + 等级名 + 变化飘字               │
└──────────────────────────────────────────────────┘
```

## 3. 数据模型（`database.py`）

```sql
CREATE TABLE IF NOT EXISTS affection (
    user_id      TEXT NOT NULL,
    character_id TEXT NOT NULL,
    value        INTEGER NOT NULL DEFAULT 30,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS affection_log (
    id           INTEGER PRIMARY KEY,
    user_id      TEXT NOT NULL,
    character_id TEXT NOT NULL,
    delta        INTEGER NOT NULL,
    reason       TEXT,
    channel      TEXT NOT NULL,        -- 'rule' | 'model' | 'preset'
    created_at   INTEGER NOT NULL
);
```

方法（追加到 `Database`）：

```python
def get_affection(self, user_id, character_id) -> int
    # 无记录返回默认 30

def add_affection(self, user_id, character_id, delta,
                  reason=None, channel="rule") -> int
    # clamp 到 [0, 100]，写 affection 表 + 插 log，返回新值
```

建表挂进现有 `_migrate()` 的 `executescript`（幂等，重启自动生效）。

## 4. 等级分段（默认，可被角色包覆盖）

| 数值 | 等级名 | 角色表现方向 |
|---|---|---|
| 0–19 | 陌生 | 客气、疏离 |
| 20–39 | 初识 | 礼貌但保留 |
| 40–59 | 熟悉 | 自然亲近、可开玩笑 |
| 60–79 | 亲密 | 主动关心、害羞 |
| 80–100 | 恋人 | 专属称呼、亲密互动 |

## 5. 判定层（新文件 `character_runtime/affection.py`）

### 类结构

```python
class AffectionEvaluator:
    def __init__(self, api_key=None, model=..., base_url=..., timeout_seconds=30): ...
    # api_key 为空 → 只走规则通道（零成本模式）

    @classmethod
    def from_environment(cls) -> "AffectionEvaluator":
        # AFFECTION_EVALUATOR_ENABLED（默认 true）
        # API Key / MODEL / BASE_URL 环境变量，缺省回落 DEEPSEEK_* 配置

    def evaluate(self, character, user_message,
                 assistant_message, current_value) -> dict:
        # 返回 {"delta": int, "reason": str, "channel": str}
```

### 通道① 角色包规则（最高优先）

角色包 `affection.json` 声明的关键词规则，命中即用、不再走模型/规则。

### 通道② 模型判定 prompt（完整中文，仿 memory_extractor）

```text
你是好感度判定器。只输出 JSON，不要输出解释。
根据玩家对角色【{display_name}】的本轮言行，判定好感度变化。
只依据玩家明确的行为：主动关心、尊重、夸赞、送礼物、共情 → 加分；
冒犯、贬低、敷衍、冷淡、恶意 → 减分。
角色自己的回复、撒娇、示好都不能作为加分依据。
寒暄、重复内容、与好感无关的日常 → delta 0。
数值克制：普通互动 ±1，明显关心/冒犯 ±2~3，重大事件 ±4~5。
现有好感度 {current}/100，不能把同一行为反复算分。
```

调用参数：`temperature 0`、`response_format {"type": "json_object"}`、`thinking disabled`。
输出：`{"delta": number(-5..5), "reason": string}`。

### 通道③ 关键词规则兜底

```python
RULE_UP = {
    "谢谢": 2, "辛苦了": 2, "喜欢你": 3, "夸": 2, "关心": 2,
    "抱抱": 2, "想你": 2, "礼物": 3, "道歉": 1, "对不起": 1,
}
RULE_DOWN = {
    "滚": -3, "讨厌你": -3, "烦": -2, "蠢": -2, "敷衍": -2,
    "闭嘴": -2, "无聊": -1, "再见": -1,
}
# 只取用户消息第一个命中词；每轮最多一次判定
```

## 6. 角色包扩展：`affection.json`（自动发现，仿 choices.json）

```json
{
  "initial": 30,
  "levels": {
    "0": "陌生", "20": "初识", "40": "熟悉",
    "60": "亲密", "80": "恋人"
  },
  "disposition": "远坂凛是傲娇大小姐：对玩家好感提升时，语气从矜持逐渐变软，但不会主动承认。",
  "rules": [
    { "keywords": ["宝石", "魔术", "学费"], "delta": 2, "reason": "提到凛关心的话题" },
    { "keywords": ["土狼"], "delta": -1, "reason": "踩到雷区" }
  ]
}
```

- `character_manager.py` 新增 `_load_affection(root)`，挂到 `Character.affection_config`（缺省用内置默认）。
- 每个内置角色放一份示例（凛、十香优先）。

## 7. 上下文注入（`context_builder.py`）

在 `[RUNTIME_RULES]` 与 `[CHARACTER]` 之间插入：

```
[AFFECTION]
玩家对【{display_name}】的好感度等级：{level_name}（{value}/100）。
角色倾向：{disposition}
请让语气、称呼、亲密度、身体距离符合这个等级。
好感度高时更主动、更软、更亲密；低时更客气、更疏离。
绝不能提及好感度数值、等级名或"好感度"这个词本身。
```

- `AgentState` 增加 `affection_value: int | None`。
- `conversation.send_message` 构造 state 时从 DB 读当前好感度填入。

## 8. 分支门槛（`choices.json` 扩展 + `conversation.py`）

```json
{
  "triggers": ["告白"],
  "min_affection": 70,
  "prompt": "……有些话，我一直没说出口。",
  "question": "可以听我说吗？",
  "options": [...]
}
```

- `_match_preset_choice(character, message)` 改为 `_match_preset_choice(character, message, affection)`：命中 trigger 且 `affection >= min_affection`（缺省不限）才触发。
- 低于门槛 → 不触发，走正常对话；模型侧也看不到该分支（有解锁感）。

## 9. API 契约（`web_server.py`）

| 接口 | 说明 |
|---|---|
| `GET /api/affection` | 当前角色：`{affection: {value, level, level_name, disposition}}` |
| `POST /api/chat` | 返回追加 `affection: {value, level_name, delta}`（delta 供飘字） |
| `POST /api/chat/answer` | 同上 |
| `POST /api/characters`（列表） | 每项带 `affection: {value, level_name}` |
| 删除角色 | `delete_character_data` 同步清理 affection 记录 |

## 10. 前端 UI（`App.jsx` + `styles.css`）

- **header 显示**：角色名旁 `❤ 58 · 亲密`，等级变色：
  - 0–39 灰 `#9aa1a9` / 40–59 橙 `#f59e0b` / 60–79 粉 `#ef6a8c` / 80–100 深红 + 心跳动画
- **变化飘字**：`/api/chat` 返回 delta ≠ 0 时，在 ❤ 上浮起 `+2`（绿）/ `-1`（红），1.5s 渐隐上飘。
- 角色列表卡片：小 ❤ 数值（可选开关）。

## 11. 数据流时序（完整回合）

```
用户: "最近辛苦了"
  → conversation.send_message
      → 查好感度(58) → 填 AgentState.affection_value
      → agent.respond（上下文含 [AFFECTION] 亲密层）
      → 回复落库
      → AffectionEvaluator.evaluate(用户消息, 回复, 58)
          → 通道① 凛的 affection.json 无命中
          → 通道② 模型判定 {"delta": 2, "reason": "玩家体谅角色"}
          → add_affection(58 → 60) → 升级到"亲密"
      → 返回 {reply, pending_choice, affection: {value: 60, level: "亲密", delta: +2}}
  → 前端追加消息 + ❤ 飘字 "+2" + 等级变"亲密"
```

## 12. 边界与防刷

| 场景 | 处理 |
|---|---|
| 每轮多个触发词 | 只取第一个命中，delta clamp ±5 |
| 连发"谢谢"刷分 | 模型通道有"不能反复算同一行为"约束；规则通道靠每轮一次 + clamp 兜底 |
| 判定器 API 超时/解析失败 | 降级规则通道 → 无命中则 delta 0（不阻塞对话） |
| 数值越界 | `add_affection` 内 clamp [0, 100] |
| 多角色 | 主键 `(user_id, character_id)` 天然隔离 |
| 切换角色 | 好感度各自独立（与选择框隔离逻辑一致） |
| 删除角色 | 同步删除 affection / affection_log 记录 |
| 规则型（无 Key） | 通道③ 可用，但数值偏单调 → 建议配 Key 体验完整 |

## 13. 实施步骤与工作量

| 步骤 | 内容 | 工作量 |
|---|---|---|
| 1 | `database.py`：表 + CRUD + 迁移 | ~20 分钟 |
| 2 | `affection.py`：Evaluator（规则 + 模型 + 角色包规则） | ~1 小时 |
| 3 | `models.py` AgentState 加字段 + `character_manager.py` 加载 affection.json | ~15 分钟 |
| 4 | `conversation.py` / `context_builder.py` / `runtime.py` 接线 | ~30 分钟 |
| 5 | choices `min_affection` 门槛 + 删角色清理 | ~15 分钟 |
| 6 | `web_server.py` API + `App.jsx`/css 显示与飘字 | ~40 分钟 |
| 7 | 凛/十香 `affection.json` 示例 + 联调验证 | ~20 分钟 |

总计约 **3 小时**。

## 14. 环境变量（新增，`.env.example`）

```bash
AFFECTION_EVALUATOR_ENABLED=true
AFFECTION_EVALUATOR_MODEL=deepseek-v4-flash
AFFECTION_EVALUATOR_TIMEOUT_SECONDS=30
```

## 15. 待确认决策

- [ ] 判定器默认开模型判定还是只开规则？（建议：有 Key 默认开模型，规则兜底）
- [ ] 初始值 30 是否合适
- [ ] 是否存变化日志表（建议存，飘字与调试需要）
