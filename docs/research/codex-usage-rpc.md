# Codex usage RPC investigation

Checked 2026-10-04.

## Findings

- Released pi-everyday 0.4.0 deliberately returned unavailable from `src/usage-status/openai-source.ts`. The current reader uses Codex RPC instead; the direct WHAM reader remains absent.
- OpenAI documents `account/rateLimits/read` in [Codex app-server](https://developers.openai.com/codex/app-server/). Initialize the stdio connection, send `initialized`, then request `account/rateLimits/read`. It exposes quota buckets, percentage used, window duration in minutes, and reset timestamps in Unix seconds. Prefer the multi-bucket response when present; do not merge unrelated buckets into one allowance.
- A read-only probe with locally installed Codex CLI 0.160.0 successfully initialized and returned a Codex quota bucket with a weekly window. No inference/thread was started. Only allowlisted quota fields were printed, stderr was suppressed, and the owned process was terminated. No credential file was inspected or copied. This establishes availability for the local Codex login, not account equivalence with Pi.
- A missing five-hour window is not zero remaining and must not be synthesized. Render only returned windows, using their actual duration.
- [SIWC models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference) specifies the public Responses endpoint and says not to use ChatGPT backend-api endpoints for that flow.
- [SIWC token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference) specifies the api.openai.com/v1 audience and opaque account metadata. Do not reinterpret these as legacy account-ID claims.
- [SIWC accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions) points usage tracking to ChatGPT Settings. It says the shared five-hour app allowance applies to Plus, not Pro. These pages do not establish a supported programmatic quota-read endpoint for SIWC.
- App-server's documented external ChatGPT auth mode requires an account ID. Its existence alone does not establish compatibility with SIWC credentials, nor authorize copying tokens between clients.

## Confirmed scope

The author confirmed the local Codex value is accurate for their personal use: show remaining quota and reset time without a source label; silently hide unavailable results. No new configuration, diagnostic command or account-matching machinery.

Codex CLI installation/login is an optional dependency of quota display, not a requirement for the rest of the package. The implementation reuses the existing non-blocking lifecycle and stops its subprocess on completion, timeout, cancellation and session replacement. There is no direct legacy credential fallback.

## Limits

No Pi-account/Codex-account equivalence was tested. No successful SIWC quota query is claimed. The implementation was verified locally; no release was made.
