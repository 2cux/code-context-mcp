# PRD §21–23：性能目标、CLI 设计与开发阶段规划

> 对应原 PRD.md 第 21–23 节。

---

## §21. 性能目标

| 操作 | MVP 目标 |
|------|---------|
| current_scope | < 300ms |
| compress_context 小文本 | < 1000ms |
| compress_context 长日志 | < 5000ms |
| retrieve_original | < 1000ms |
| remember_context | < 500ms |
| recall_context | < 1000ms |
| forget_context | < 500ms |
| list_context | < 500ms |

**MVP 数据规模**：

```text
单 repo 1000 条 compressed contexts
单 repo 1000 条 memories
本地总计 10000 条 records
单次输入默认最大 1MB
单条 memory content 默认最大 32KB
原文默认保留 30 天
```

---

## §22. CLI 设计

### §22.1 命令

```bash
code-context scope
code-context compress ./test-output.log --type test_output
code-context retrieve orig_01HXYZ
code-context list-compressions --type test_output
code-context remember --type project_rule --content "本项目使用 pnpm"
code-context recall "package manager"
code-context forget mem_01HXYZ --mode supersede --by mem_02HXYZ
code-context list-context --type project_rule --status active
code-context receipt rcp_01HXYZ
code-context stats
code-context cleanup --originals
```

### §22.2 CLI 价值

```text
不依赖 Agent 也能调试
方便写自动化测试
方便作品集演示
方便用户审计本地状态
```

---

## §23. 开发阶段规划

### Phase 0：产品边界与基础文档
产出：README.md、MVP_SPEC.md、MCP_TOOLS.md、DATA_MODEL.md、ARCHITECTURE.md、SECURITY.md

### Phase 1：基础设施
实现：MCP Server、SQLite 初始化、current_scope、Receipt Service 基础、Token Counter、CLI skeleton
验收：MCP Server 可启动、current_scope 可返回稳定 scopeId、receipt 表可写入

### Phase 2：上下文压缩核心
实现：ContentRouter、compress_context、test_output/command_output/log/plain_text compressor、CCR、OriginalContentStore、compression_receipt
验收：长测试日志可压缩，返回 originalRef、token 统计、receipt

### Phase 3：安全兜底和大输入保护
实现：timeout、size limit、chunking、fail-open、retrieve_original、delete_original、cleanup_originals
验收：超时返回原文、大输入不会卡死、原文可取回可删除

### Phase 4：代码、JSON、Markdown、RAG 压缩
实现：code/json/markdown/rag_chunk/conversation_history compressor
验收：代码压缩保留 imports/exports/signatures，RAG chunks 保留 source/key facts/canExpand

### Phase 5：项目记忆服务闭环
实现：remember_context、recall_context、forget_context、list_context、MemoryRecord、Memory lifecycle、SQLite FTS5、retrieval_receipt
验收：保存项目规则、后续可 recall、旧记忆可 supersede、list_context 可审计

### Phase 6：Profile 分层与压缩记忆融合
实现：repo_profile.static、repo_profile.dynamic、save_compression_as_memory、recall_context 返回 relatedCompressedContexts、sourceRef 关联
验收：recall_context 返回 static + dynamic + top-k memories + related compressed contexts

### Phase 7：演示与作品集包装
产出：demo repo、fixtures、README screenshots、DEMO.md、演示脚本
演示：压缩长测试日志、retrieve 原文、保存/recall 项目规则、supersede 旧记忆、repo scope 隔离、receipt 审计
