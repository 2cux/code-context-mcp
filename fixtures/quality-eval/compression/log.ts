/**
 * Log Fixture — Quality Eval
 *
 * A realistic application log with mixed severity levels.
 *
 * Key facts to preserve:
 *   - Time range: 2026-07-07T08:00:00Z → 2026-07-07T10:15:00Z
 *   - ERROR lines: 5 (connection refused, retries exhausted, OOM, query timeout, shutdown)
 *   - WARN lines: 3 (retry, high mem, deg promotion)
 *   - FATAL lines: 2 (OOM + shutdown)
 *   - Trace IDs: req_abc001, req_abc002, req_abc003
 *   - Exception types: ConnectionRefusedError, OutOfMemoryError, QueryTimeoutError
 *   - File paths: /app/src/db/pool.ts, /app/src/worker/reaper.ts
 *   - Stack traces: 2 (top 5 + bottom 3 frames each)
 *   - Folded INFO: ~50 heartbeat lines
 *   - Folded DEBUG: ~30 debug lines
 */

2026-07-07T08:00:00.123Z INFO  [main] Starting application server v3.2.1
2026-07-07T08:00:00.456Z INFO  [main] Listening on port 8080
2026-07-07T08:00:01.001Z INFO  [db] Connecting to database at postgres://db.internal:5432/main
2026-07-07T08:00:01.250Z INFO  [db] Database connection established
2026-07-07T08:00:02.100Z INFO  [worker] Starting background worker pool (4 workers)
2026-07-07T08:00:02.500Z DEBUG [worker] Worker 1 initialized
2026-07-07T08:00:02.501Z DEBUG [worker] Worker 2 initialized
2026-07-07T08:00:02.502Z DEBUG [worker] Worker 3 initialized
2026-07-07T08:00:02.503Z DEBUG [worker] Worker 4 initialized
2026-07-07T08:00:05.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:01:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:02:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:03:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:04:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:05:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:06:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:07:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:08:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:09:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:10:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:15:00.000Z ERROR [api] req_abc001 ConnectionRefusedError: upstream service at payment.internal:443 refused connection
2026-07-07T08:15:00.001Z ERROR [api] req_abc001   at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1595:16)
2026-07-07T08:15:00.002Z ERROR [api] req_abc001   at ConnectionPool.getConnection (/app/src/db/pool.ts:142:13)
2026-07-07T08:15:00.003Z ERROR [api] req_abc001   at PaymentService.processPayment (/app/src/services/paymentService.ts:45:18)
2026-07-07T08:15:00.004Z ERROR [api] req_abc001   at processTicksAndRejections (node:internal/process/task_queues:95:5)
2026-07-07T08:15:00.005Z ERROR [api] req_abc001 Caused by: previous connection attempts exhausted
2026-07-07T08:15:00.006Z WARN  [api] req_abc001 Retry attempt 1 of 3 (backoff: 2s)
2026-07-07T08:15:02.100Z WARN  [api] req_abc001 Retry attempt 2 of 3 (backoff: 4s)
2026-07-07T08:15:06.500Z WARN  [api] req_abc001 Retry attempt 3 of 3 (backoff: 8s)
2026-07-07T08:15:15.000Z ERROR [api] req_abc001 All retries exhausted for transaction tx_001
2026-07-07T08:20:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:25:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:30:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:35:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:40:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:45:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:50:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T08:55:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T09:00:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T09:05:00.000Z INFO  [healthcheck] Server health: OK
2026-07-07T09:10:00.000Z FATAL [worker] OutOfMemoryError: worker heap usage exceeded 95%
2026-07-07T09:10:00.001Z FATAL [worker]   at WorkerReaper.checkHeapUsage (/app/src/worker/reaper.ts:78:15)
2026-07-07T09:10:00.002Z FATAL [worker]   at WorkerReaper.reap (/app/src/worker/reaper.ts:55:10)
2026-07-07T09:10:00.003Z FATAL [worker]   at processTicksAndRejections (node:internal/process/task_queues:95:5)
2026-07-07T09:10:00.004Z FATAL [worker]   at Timeout._onTimeout (/app/src/worker/scheduler.ts:33:20)
2026-07-07T09:10:00.005Z FATAL [worker]   at listOnTimeout (node:internal/timers:559:17)
2026-07-07T09:10:01.000Z ERROR [main] QueryTimeoutError: query execution exceeded 30s limit
2026-07-07T09:10:01.001Z ERROR [main]   at QueryRunner.execute (/app/src/db/runner.ts:102:15)
2026-07-07T09:10:01.002Z ERROR [main]   at ReportService.generateReport (/app/src/services/reportService.ts:34:12)
2026-07-07T09:10:01.003Z ERROR [main]   at processTicksAndRejections (node:internal/process/task_queues:95:5)
2026-07-07T09:10:01.004Z ERROR [main]   at Timeout._onTimeout (/app/src/worker/scheduler.ts:33:20)
2026-07-07T09:10:01.005Z WARN  [main] Degraded mode auto-promotion triggered
2026-07-07T09:10:02.000Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.001Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.002Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.003Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.004Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.005Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.006Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.007Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:02.008Z FATAL [main] Shutting down server due to critical errors
2026-07-07T09:10:05.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:15:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:20:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:25:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:30:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:35:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:40:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:45:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:50:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T09:55:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T10:00:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T10:05:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T10:10:00.000Z INFO  [healthcheck] Server health: CRITICAL
2026-07-07T10:15:00.000Z INFO  [healthcheck] Server health: CRITICAL
