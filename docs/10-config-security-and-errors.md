# PRD §18–20：配置项、安全与隐私、错误处理

> 对应原 PRD.md 第 18–20 节。

---

## §18. 配置项

```json
{
  "storagePath": "~/.code-context-mcp/code-context.sqlite",
  "originalsRetentionDays": 30,
  "defaultKeepOriginal": true,
  "maxInputBytes": 1048576,
  "maxOutputTokens": 2000,
  "compressionTimeoutMs": 5000,
  "recallTimeoutMs": 3000,
  "retrieveChunkSize": 10000,
  "failOpen": true,
  "defaultRecallLimit": 5,
  "maxRecallLimit": 20,
  "enableEmbeddings": false,
  "enableProxy": false,
  "defaultCompressionStrategy": "conservative"
}
```

---

## §19. 安全与隐私

### §19.1 本地优先

默认不上传：项目代码、测试日志、构建输出、命令输出、原文缓存、压缩结果、记忆内容、receipt。

### §19.2 不处理模型 API key

第一版不做透明代理，所以不处理 OpenAI / Anthropic / Google 或其他 provider key。

### §19.3 原文缓存风险

原文可能包含 API key、环境变量、用户数据、内部接口、私有代码、错误堆栈。

必须支持：
- 配置原文保留时间
- `delete_original`
- `cleanup_originals`
- 关闭 `keepOriginal`
- 查看原文保存位置

### §19.4 scope 访问限制

必须保证：
- repo A 的 originalRef 不能在 repo B retrieve
- repo A 的 memory 不能在 repo B recall
- repo A 的 profile 不能污染 repo B

---

## §20. 错误处理

### §20.1 压缩失败
返回原文、compressed=false、failed=true、errorReason、receiptId。

### §20.2 recall 失败
返回空 memories、空 related contexts、profile 可为空、failed=true、errorReason、receiptId。

### §20.3 scope 解析失败
fallback：`scopeId = hash(cwd)`，`scopeStrategy = cwdFallback`。

### §20.4 原文不存在
返回 failed=true、errorReason=original_not_found。

### §20.5 SQLite 写入失败
不影响 Agent 主流程，返回 warning，尽可能返回压缩或 recall 结果。
