# ChatGPT login and Codex quota sources

Checked 2026-10-04 against Pi 1.0.2 and official OpenAI documentation.

## Current implementation: local Codex quota

The author confirmed the local Codex quota is the desired value. The extension now queries the official [Codex app-server](https://developers.openai.com/codex/app-server/) `account/rateLimits/read` method through the locally installed CLI, without reading or transferring credentials. It displays returned windows and reset times without a source label and silently hides failures. A live read with Codex CLI 0.160.0 on macOS succeeded. This is independent of Pi's active login and does not establish a SIWC quota-query contract.

## 0.4.0 release decision: quota display unavailable

The current `openai` ChatGPT login uses Sign in with ChatGPT token sharing. A supported programmatic query for that subscription's remaining quota has not been established. The released 0.4.0 Usage Source therefore returned unavailable without reading credentials or sending a request. The legacy `openai-codex` / WHAM implementation has been removed at the author's request. This is a blocked feature, not completed support for new-login quota display.

Users can also review usage at [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). The extension adds no notification or UI link.

## Primary evidence

- [OpenAI models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): this login's supported inference route is the public Responses endpoint; the guidance explicitly excludes ChatGPT backend-api routes for this flow.
- [OpenAI token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference): access-token audience is `https://api.openai.com/v1`, and authentication metadata is opaque. It does not expose the legacy ChatGPT account claim used by the old quota reader.
- [OpenAI accounts and sessions, Tracking usage](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage): the documented usage surface is the settings page. Its plan/app limits must not be inferred from another credential's Codex windows.
- [Pi OAuth source](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/ai/src/auth/oauth/openai-chatgpt.ts): the new flow uses an issued client ID, `resource=https://api.openai.com/v1`, and `toAuth` returns the access token. The same contract was inspected in the exact 1.0.2 distribution.

In Pi 1.0.2, `getApiKeyForProvider("openai")` returns only an API-key string and loses authentication provenance. `getProviderAuth("openai")` preserves the resolution source; a future supported reader must distinguish the trusted built-in subscription OAuth result from ordinary API keys and custom provider replacements. Neither method accepts an auth cancellation signal. Neither is needed for the local Codex CLI reader.

## Gate for querying the Pi SIWC login directly

Before enabling a reader, establish a supported endpoint, token audience/authorization, account semantics and quota meaning. Resolve credentials once through the host, honor cancellation after credential resolution and before request dispatch, and validate the returned payload. Test the complete source-to-status flow using synthetic credentials and mocked transport first. A provider-name substitution or passing parser fixture alone does not establish compatibility.

The registration Interface retains independently tested non-blocking refresh, whole-operation expiry, session invalidation, cooldown and failure-to-hidden behavior. No live SIWC quota request was made during the original investigation; the later successful Codex CLI probe is a separate authentication path.
