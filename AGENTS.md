# Completion recovery

When changing completion recovery, keep these rules executable in `tests/empty-turn-recovery.test.ts`.

| Rule | Enforcement |
| --- | --- |
| Fresh status text must not bypass reassessment. | Two-worker incident test checks four requests, the exact trigger receipt and successful built-in read contents. |
| Each completion gets at most one retry, including legacy receipts. | Paraphrase, duplicate-handler, reload, restore, sibling and terminal-receipt tests. |
| Tool activity belongs to the current response segment. | Successful and failed tool tests cover initial responses, reassessments and pre-retry activity. |
| Missing projected evidence, waits, cancellation and foreign work suppress recovery. | Projection-gap, source-tool, wait, queue, abort and settle-proposal tests. |

The reminder is not a permission check or proof of task completion. Keep permission enforcement with the host.
