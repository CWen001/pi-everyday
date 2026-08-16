# ADR-0001: Keep cross-extension Path Rendering additive and fail-open

## Decision

Ordinary assistant Path Rendering remains the authoritative interface for relative, home-relative, and absolute paths. Cross-extension custom Markdown receives absolute-path-only Path Rendering through a feature-detected overlay on the host's shared Markdown renderer; it never guesses a working directory or scans for one.

The overlay composes an existing Markdown transform and is installed at most once. Shared state retains the original renderer and an owner-token set. Each Pi Everyday instance releases only its own token at shutdown; the patch is never restored, and it delegates directly to the original renderer while the owner set is empty. Incompatible private host shapes and Path Rendering failures delegate unchanged.

Pi and OMP remain direct display adapters. Pi Everyday does not modify or depend on independently updated extensions such as `pi-subagents`.
