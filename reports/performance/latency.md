# Match-update latency (QR1), 2026-11-13

Node v26.10.0 on darwin/arm64; embeddings off; 40 trials per level; target p95 ≤ 1000 ms.
Latency includes the server's 120 ms debounce. CI = 95% bootstrap confidence interval of the p95.

| Searching users | p50 (ms) | p95 (ms) | p95 95% CI | max (ms) | server recompute p95 (ms) | event-loop delay p99 (ms) | server RSS (MB) | meets target |
|---|---|---|---|---|---|---|---|---|
| 10 | 123.5 | 124.8 | 124.4 – 126.3 | 126.3 | 5.704 | 14.7 | 54.1 | yes |
| 25 | 123.7 | 124.8 | 124.5 – 125.7 | 125.7 | 8.386 | 18.2 | 59.9 | yes |
| 50 | 125.1 | 127 | 126.3 – 127.3 | 127.3 | 14.694 | 23.8 | 55.5 | yes |
| 100 | 129.2 | 131 | 130.4 – 131.8 | 131.8 | 26.191 | 26.4 | 89.5 | yes |
| 200 | 139.7 | 147.4 | 145.8 – 147.7 | 147.7 | 47.395 | 33.4 | 93.1 | yes |
| 400 | 166.1 | 171.2 | 170.7 – 172.2 | 172.2 | 85.47 | 51.9 | 132.8 | yes |
| 800 | 237.7 | 250.6 | 244.4 – 292.7 | 292.7 | 187.891 | 91.4 | 208.8 | yes |
