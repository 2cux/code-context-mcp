# PRD §24–28：MVP 验收用例、演示场景、技术架构与文档

> 对应原 PRD.md 第 24–28 节。

---

## §24. MVP 验收用例

### §24.1 压缩测试日志
- 输入：长 pnpm test 输出
- 预期：识别为 test_output，压缩失败测试，保留 stack trace，返回 originalRef，tokensAfter < tokensBefore，生成 receipt

### §24.2 原文取回
- 输入：`retrieve_original(originalRef)`
- 预期：返回完整原文，retrieveCount + 1，生成 receipt

### §24.3 压缩失败兜底
- 模拟压缩超时
- 预期：返回原文，compressed=false，failed=true，Agent 不受影响

### §24.4 保存和召回项目规则
- 保存"本项目使用 pnpm"，recall "package manager"
- 预期：返回 pnpm 规则，receipt 生成

### §24.5 旧记忆 supersede
- 保存 npm → 保存 pnpm → forget npm mode=supersede → recall package manager
- 预期：默认只返回 pnpm，list_context 可看到 npm 为 superseded

### §24.6 repo scope 隔离
- repo A 保存 pnpm，repo B 保存 uv，repo A recall
- 预期：只返回 repo A 的 pnpm，不返回 repo B 的 uv

### §24.7 压缩结果转记忆
- 压缩测试失败日志 → 保存 test_failure memory（sourceRef=ccrId）→ recall
- 预期：返回 test_failure memory + related compressed context，可 retrieve 原文

---

## §25. README 演示场景

### Demo 1：压缩长测试日志
```bash
code-context compress ./fixtures/vitest-long-output.log --type test_output
```
展示：tokensBefore、tokensAfter、tokensSaved、compressionRatio、originalRef、receiptId

### Demo 2：取回原文
```bash
code-context retrieve orig_01HXYZ
```
展示：完整日志可恢复

### Demo 3：保存项目规则并召回
```bash
code-context remember --type project_rule --content "本项目使用 pnpm，不要使用 npm。"
code-context recall "install dependency package manager"
```
展示：返回 pnpm 规则

### Demo 4：旧记忆替换
```bash
code-context forget mem_old --mode supersede --by mem_new
```
展示：旧记忆不再默认 recall，list_context 可审计

### Demo 5：scope 隔离
```bash
cd repo-a && code-context remember --type project_rule --content "本项目使用 pnpm"
cd ../repo-b && code-context recall "package manager"
```
展示：repo-b 不返回 repo-a 的记忆

---

## §26. 技术架构

### §26.1 架构图

```text
AI Coding Agent
    ↓ MCP
CodeContext MCP Server
    ├── Scope Resolver
    ├── ContentRouter
    ├── Compression Engine
    │   ├── Test Output Compressor
    │   ├── Log Compressor
    │   ├── Command Output Compressor
    │   ├── Code Compressor
    │   ├── JSON Compressor
    │   ├── Markdown Compressor
    │   └── RAG Chunk Compressor
    ├── Original Content Store
    ├── Compressed Context Store
    ├── Memory Service
    │   ├── remember_context
    │   ├── recall_context
    │   ├── forget_context
    │   ├── list_context
    │   └── lifecycle
    ├── Profile Service
    │   ├── repo_profile.static
    │   └── repo_profile.dynamic
    ├── Receipt Service
    ├── Token Stats Service
    ├── Safety Layer
    │   ├── Timeout
    │   ├── Size Limit
    │   ├── Chunking
    │   └── Fail-open
    └── SQLite Storage
```

### §26.2 模块职责

**Scope Resolver** — 识别 git root、读取 remote/branch、生成 scopeId、fallback 到 cwd

**ContentRouter** — 识别内容类型、给出分类置信度、选择压缩策略

**Compression Engine** — 执行类型化压缩、生成 compressedContent、记录 token 变化

**Original Content Store** — 保存原文、生成 originalRef、支持 retrieve/delete/cleanup

**Memory Service** — 保存/召回/遗忘/列出记忆、维护生命周期

**Profile Service** — 维护 static facts 和 dynamic context，recall 时合并返回

**Receipt Service** — 记录 compress/retrieve/remember/recall/forget 及失败原因

**Safety Layer** — timeout、size limit、chunking、fail-open

---

## §27. 推荐目录结构

```text
code-context-mcp/
  src/
    index.ts
    mcp/
      server.ts
      tools/
        currentScope.ts
        compressContext.ts
        retrieveOriginal.ts
        getReceipt.ts
        listCompressions.ts
        rememberContext.ts
        recallContext.ts
        forgetContext.ts
        listContext.ts
    scope/
      resolveScope.ts
      git.ts
    router/
      contentRouter.ts
      detectors/ (testOutputDetector.ts, logDetector.ts, codeDetector.ts, ...)
    compression/
      compressionEngine.ts
      strategies/ (testOutput.ts, log.ts, commandOutput.ts, ...)
    originals/originalStore.ts
    compressed/compressedStore.ts
    memory/ (memoryService.ts, recallEngine.ts, lifecycle.ts, types.ts)
    profile/profileService.ts
    receipts/receiptService.ts
    stats/tokenStats.ts
    safety/ (timeout.ts, sizeLimit.ts, chunking.ts, failOpen.ts)
    storage/ (db.ts, migrations.ts, schema.sql)
    cli/index.ts
    utils/ (hash.ts, tokenCount.ts, time.ts)
  tests/
  fixtures/
  docs/ (MVP_SPEC.md, MCP_TOOLS.md, DATA_MODEL.md, ARCHITECTURE.md, SECURITY.md, DEMO.md)
  README.md
  package.json
  tsconfig.json
```

---

## §28. 文档要求

必须提供：README.md、MVP_SPEC.md、MCP_TOOLS.md、DATA_MODEL.md、ARCHITECTURE.md、SECURITY.md、DEMO.md

**README.md 必须说明**：项目解决什么问题、为什么双核心、开发顺序、安装配置、各工具用法、第一版不做什么。

**SECURITY.md 必须说明**：本地优先、原文缓存敏感信息风险、如何清理、如何关闭 keepOriginal、不上传数据、不处理 API key、scope 隔离规则。
