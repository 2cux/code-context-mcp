# PRD §12–13：内容路由与压缩策略

> 对应原 PRD.md 第 12–13 节。

---

## §12. ContentRouter 设计

### §12.1 支持内容类型

```text
test_output
log
command_output
code
json
markdown
plain_text
rag_chunk
file_summary
conversation_history
unknown
```

### §12.2 类型识别规则

**test_output** — 识别信号：`FAIL`、`failed`、`AssertionError`、`Expected`、`Received`、`jest`、`vitest`、`pytest`、`mocha`、`unittest`、`test failed`

**log** — 识别信号：`ERROR`、`WARN`、`INFO`、`Exception`、`Traceback`、`stack trace`、`timestamp`、`request id`

**command_output** — 识别信号：`stdout`、`stderr`、`exit code`、`command`、`build failed`、`shell output`

**code** — 识别信号：`import`、`export`、`function`、`class`、`interface`、`type`、`const`、`def`、`public`、`private`、`return`

**json** — 识别信号：以 `{` 或 `[` 开头，可被 JSON.parse

**markdown** — 识别信号：`# heading`、`- list`、fenced code block

**rag_chunk** — 识别信号：`source`、`chunk`、`document`、`metadata`、`score`

### §12.3 输出

```json
{
  "contentType": "test_output",
  "confidence": 0.92,
  "signals": ["FAIL", "AssertionError", "Expected", "Received"]
}
```

---

## §13. 压缩策略设计

### §13.1 总体原则

**必须保留**：错误信息、路径、行号、命令、exit code、stack trace 关键部分、source ref、metadata、originalRef

**不得默认删除**：错误栈、失败测试名称、文件路径、public API、类型定义、用户明确关注内容

### §13.2 test_output 压缩

**保留**：测试命令、测试框架、失败测试文件/名称、Assertion 信息、Expected/Received、stack trace 关键部分、exit code、最后 N 行

**折叠**：通过测试列表、重复日志、大段 snapshot、无关 debug 输出

**输出格式**：
```markdown
## Test Output Summary
- Command:
- Framework:
- Status:
- Failed Tests:
- Key Error:
- Expected:
- Received:
- Stack Trace:
- Exit Code:
- Original Ref:
```

### §13.3 log 压缩

**保留**：ERROR/WARN、异常类型、错误 message、timestamp、trace id/request id、相关文件路径、stack trace 顶部和底部

**折叠**：重复 INFO、重复 heartbeat、重复 debug

### §13.4 command_output 压缩

**保留**：命令、退出码、stderr、失败原因、错误文件、错误行号、最后 N 行

**折叠**：重复进度条、安装日志、无关 warning、成功输出

### §13.5 code 压缩

**保留**：file path、imports、exports、type/interface、function signature、class signature、public methods、TODO/FIXME、error-related block、query-related block、line numbers

**折叠**：无关私有实现、长函数体、重复 boilerplate、生成代码

**禁止**：改写代码语义、删除 public API、删除类型定义、删除错误相关行

**输出格式**：
```markdown
## Code Context Summary
- File:
- Imports:
- Exports:
- Types / Interfaces:
- Public APIs:
- Relevant Blocks:
- Folded Sections:
- Original Ref:
```

### §13.6 json 压缩

**保留**：top-level keys、schema shape、error fields、status fields、id fields、重要 nested path、数组样本

**折叠**：长数组、重复对象、超长文本字段

### §13.7 markdown / plain_text 压缩

**保留**：标题、关键段落、列表结构、代码块摘要、source ref

**折叠**：重复说明、低相关段落、长示例

### §13.8 rag_chunk 压缩

**保留**：source、document title、chunk id、score、key facts、short excerpt、canExpand

**折叠**：重复 chunks、低相关段落、长引用

### §13.9 conversation_history 压缩

**保留**：用户当前目标、已完成步骤、未完成步骤、关键决策、最近错误、需要保留的文件路径

**折叠**：寒暄、重复解释、低价值中间过程、已被 supersede 的上下文
