# Current ChatGPT usage-query gate

Checked 2026-10-04 against Pi 1.0.2 and official OpenAI documentation.

## Decision: quota display unavailable

The current `openai` ChatGPT login uses Sign in with ChatGPT token sharing. A supported programmatic query for that subscription's remaining quota has not been established. The default Usage Source therefore returns unavailable without reading credentials or sending a request. The legacy `openai-codex` / WHAM implementation has been removed at the author's request. This is a blocked feature, not completed support for new-login quota display.

Users can review usage at [ChatGPT Settings → Usage](https://chatgpt.com/settings/usage). The extension adds no notification or UI link; it stays hidden.

## Primary evidence

- [OpenAI models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference): this login's supported inference route is the public Responses endpoint; the guidance explicitly excludes ChatGPT backend-api routes for this flow.
- [OpenAI token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference): access-token audience is `https://api.openai.com/v1`, and authentication metadata is opaque. It does not expose the legacy ChatGPT account claim used by the old quota reader.
- [OpenAI accounts and sessions, Tracking usage](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions#tracking-usage): the documented usage surface is the settings page. Its plan/app limits must not be inferred from another credential's Codex windows.
- [Pi OAuth source](https://github.com/earendil-works/pi/blob/200387122ca450d6387f033949423114a270b96c/packages/ai/src/auth/oauth/openai-chatgpt.ts): the new flow uses an issued client ID, `resource=https://api.openai.com/v1`, and `toAuth` returns the access token. The same contract was inspected in the exact 1.0.2 distribution.

In Pi 1.0.2, `getApiKeyForProvider("openai")` returns only an API-key string and loses authentication provenance. `getProviderAuth("openai")` preserves the resolution source; a future supported reader must distinguish the trusted built-in subscription OAuth result from ordinary API keys and custom provider replacements. Neither method accepts an auth cancellation signal. No credential resolution is needed while the query itself is unavailable.

## Reopening the gate

Before enabling a reader, establish a supported endpoint, token audience/authorization, account semantics and quota meaning. Resolve credentials once through the host, honor cancellation after credential resolution and before request dispatch, and validate the returned payload. Test the complete source-to-status flow using synthetic credentials and mocked transport first. A provider-name substitution or passing parser fixture alone does not establish compatibility.

The existing registration Interface retains independently tested non-blocking refresh, whole-operation expiry, session invalidation, cooldown and failure-to-hidden behavior. Offline tests of that lifecycle do not claim a live quota query succeeded. No live quota request or credential access was made during this investigation.
