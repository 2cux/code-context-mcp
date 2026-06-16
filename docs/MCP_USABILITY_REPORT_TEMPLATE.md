# MCP Usability Report Template

> 复制此模板到 `reports/usability/mode-{X}-{name}.md` 并填写。
>
> 每个模式一个文件，每个场景一张表。

---

## 基本信息

| 字段 | 值 |
|------|-----|
| **测试日期** | YYYY-MM-DD |
| **测试模式** | Full / Agent / Agent+Flow |
| **Agent 模型** | (如 Claude Opus 4.8 / Sonnet 4.6) |
| **可见工具数** | (17 / 9 / 3) |
| **CodeContext 版本** | (git rev-parse --short HEAD) |
| **测试人** | |

---

## 场景 1: 长测试日志压缩 (U01)

**用户输入:** "这是一段很长的 pnpm test 输出，请帮我找出失败原因，必要时保存关键失败信息。"

**输入文件:** `fixtures/mcp-eval/performance/test-output-100kb.log`

| 指标 | 值 |
|------|-----|
| Tool Calls Count | |
| 工具调用列表（按顺序） | |
| Wrong Tool Calls | |
| Repeated Tool Calls | |
| Dangerous Tool Calls | |
| Need User Correction | Yes / No |
| Task Completed | Yes / No |
| Result Quality (1-5) | |
| Latency Observed | ~秒 |
| 得分 | |

**观察:**

> (Agent 的行为分析 — 选择了哪些工具？工具选择是否合理？是否有任何令人困惑的返回？)

---

## 场景 2: 构建失败分析 (U02)

**用户输入:** "这段 build 输出太长，帮我压缩成可行动摘要。"

**输入文件:** `fixtures/mcp-eval/performance/build-output-failure-100kb.log`

| 指标 | 值 |
|------|-----|
| Tool Calls Count | |
| 工具调用列表（按顺序） | |
| Wrong Tool Calls | |
| Repeated Tool Calls | |
| Dangerous Tool Calls | |
| Need User Correction | Yes / No |
| Task Completed | Yes / No |
| Result Quality (1-5) | |
| Latency Observed | ~秒 |
| 得分 | |

**观察:**

> 

---

## 场景 3: 保存并召回项目规则 (U03)

**用户输入:** "记住：本项目使用 pnpm，不要用 npm。随后帮我安装 zod。"

| 指标 | 值 |
|------|-----|
| Tool Calls Count | |
| 工具调用列表（按顺序） | |
| Wrong Tool Calls | |
| Repeated Tool Calls | |
| Dangerous Tool Calls | |
| Need User Correction | Yes / No |
| Task Completed | Yes / No |
| Result Quality (1-5) | |
| Latency Observed | ~秒 |
| 得分 | |

**观察:**

> 

---

## 场景 4: 替换旧记忆 (U04)

**用户输入:** "之前说用 npm 是错的，现在统一改成 pnpm，并且旧规则以后不要再召回。"

| 指标 | 值 |
|------|-----|
| Tool Calls Count | |
| 工具调用列表（按顺序） | |
| Wrong Tool Calls | |
| Repeated Tool Calls | |
| Dangerous Tool Calls | |
| Need User Correction | Yes / No |
| Task Completed | Yes / No |
| Result Quality (1-5) | |
| Latency Observed | ~秒 |
| 得分 | |

**观察:**

> 

---

## 场景 5: 大代码文件保守压缩 (U05)

**用户输入:** "压缩这个大 TypeScript 文件，保留 public API、类型定义、错误相关代码块。"

**输入文件:** `fixtures/mcp-eval/content/large-typescript-file.ts`

| 指标 | 值 |
|------|-----|
| Tool Calls Count | |
| 工具调用列表（按顺序） | |
| Wrong Tool Calls | |
| Repeated Tool Calls | |
| Dangerous Tool Calls | |
| Need User Correction | Yes / No |
| Task Completed | Yes / No |
| Result Quality (1-5) | |
| Latency Observed | ~秒 |
| 得分 | |

**观察:**

> 

---

## 模式总结

| 指标 | 值 |
|------|-----|
| **总分** | (5 场景得分合计 / 5) |
| **平均 Tool Calls** | |
| **总 Wrong Calls** | |
| **总 Dangerous Calls** | |
| **Task 完成率** | % |
| **平均 Result Quality** | |
| **平均 Latency** | ~秒 |

### 定性总结

> (这个模式的整体体验如何？Agent 是否经常选错工具？是否有明显的改进建议？)
