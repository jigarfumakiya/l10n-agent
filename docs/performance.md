# Performance checks

Run `npm run benchmark` (2,000 strings per target) or `npm run benchmark -- 10000`.
The benchmark creates temporary Android XML and Apple String Catalog files with eight locales,
loads them from disk, builds a batch, validates the project, checks a 100-entry submission without
writing, and makes 1,000 plural-specification lookups. It reports milliseconds and process peak
RSS, then deletes its temporary directory. No model calls or API keys are used.

The batch measurement excludes source-code usage indexing. The submission measurement excludes
locking and writes because it is a dry run. Use real projects for code scanning, write throughput,
network latency, model costs, and translation quality. The input has ordinary text entries;
plural lookup cost is measured separately. Peak RSS includes catalog generation and runtime overhead.

Illustrative single runs on the same machine, Node v24.14.0, 2,000 strings per target, eight locales
(32,000 translations total), before and after plural caching on 2026-10-17:

| Measurement | Before | After |
|---|---:|---:|
| Load | 130.33 ms | 98.73 ms |
| Build batch | 52.27 ms | 58.56 ms |
| Validate | 397.86 ms | 408.67 ms |
| Check 100 submissions | 60.68 ms | 14.91 ms |
| 1,000 plural lookups | 847.55 ms | 0.53 ms |
| Peak RSS | 332 MiB | 380 MiB |

These are single observations, not statistical benchmarks or end-to-end speedup claims. The
plural lookup measurement uses a warm cache after preceding operations. Validation and memory
did not improve in these runs. Repeat in fresh processes with the same Node/ICU version and
machine, and compare several runs before drawing conclusions. There are no timing thresholds
in CI; correctness tests verify reduced reads and preserved plural semantics without depending
on machine speed.

Request cancellation uses Node's [AbortSignal APIs](https://nodejs.org/api/globals.html#class-abortsignal).
Write coordination uses [exclusive file creation](https://nodejs.org/api/fs.html#file-system-flags)
on local filesystems; see the reference for scope and crash recovery limitations.
