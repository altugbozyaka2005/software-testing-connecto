# Match-update latency (QR1), 2026-11-13

Node v26.10.0 on darwin/arm64; embeddings off; 40 trials per level; target p95 ≤ 1000 ms.
Latency includes the server's 120 ms debounce. CI = 95% bootstrap confidence interval of the p95.

| Searching users | p50 (ms) | p95 (ms) | p95 95% CI | max (ms) | server recompute p95 (ms) | event-loop delay p99 (ms) | server RSS (MB) | meets target |
|---|---|---|---|---|---|---|---|---|
| 10 | 123 | 129.3 | 127.2 – 132.6 | 132.6 | 2.694 | 18.4 | 53.5 | yes |
| 25 | 123.4 | 125.4 | 124 – 126.5 | 126.5 | 8.109 | 19.4 | 54.8 | yes |
| 50 | 125 | 126.7 | 126.3 – 127.5 | 127.5 | 14.969 | 24.5 | 55.3 | yes |
| 100 | 128.3 | 131.5 | 130.3 – 131.6 | 131.6 | 25.48 | 27 | 80.2 | yes |
| 200 | 138 | 148.2 | 144.3 – 148.9 | 148.9 | 44.917 | 33.8 | 90.7 | yes |
| 400 | 148.4 | 155.2 | 150.1 – 160.4 | 160.4 | 64.758 | 47.2 | 153.3 | yes |
