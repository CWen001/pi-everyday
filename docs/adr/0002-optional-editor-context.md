# ADR-0002: Keep Editor Context behind one optional Pi Module

## Context

The author uses VS Code → integrated terminal → Herdr → Pi for LaTeX and views that same live Pi through WezTerm. Most other Pi work happens outside VS Code. The existing Bridge already supplies the desired selection workflow. The personal companion has now been authorized for package integration.

## Decision

Editor Context is one Module with the registration Interface `registerEditorContext(pi)`. Its Implementation owns discovery, socket lifetime, validated current context, per-session attachment state and native status. Tests exercise Pi's tool/event Seam using temporary workspace state and real loopback sockets. No public connection manager or test-only configuration surface is introduced.

This capability explicitly depends on the existing VS Code Pi Agent Bridge protocol. It stays unavailable when no matching editor exists and never changes Bridge files or settings automatically. ADR-0001 continues to govern Path Rendering: the overlay remains independent of other extensions. Editor Context's documented optional protocol dependency is a separate, author-approved integration.

The existing Pi commands and tools remain stable. Same-project clients keep independent connections; there is no exclusive writing session or routing layer. Herdr remains responsible for sharing the same live terminal between viewers.

Use Node's bundled SQLite in a short, bounded child for saved Bridge state on macOS/Windows. This avoids an extra SQLite install and keeps its experimental warning out of the interactive process. Live workspace validation applies even to inherited explicit ports. Node 22.19+ is already the package minimum.

## Trade-offs

A separate owned VS Code plugin and a shared protocol package would add installation and release work without improving the author's current selection flow. Retaining Bridge also retains its unauthenticated loopback, pause-state and broadcast limitations, documented prominently in the README. This decision makes no stronger sharing-control guarantee.

The child lookup is synchronous and bounded per matching database; it is used on discovery/reconnect, not on every editor update. Native status replaces no footer. Source-level tests prove socket/state behavior; real Herdr handoff and screen layout remain manual checks.

## Migration

One Pi-side implementation is active at a time. Disable Bridge companion auto-install, preserve the old companion outside extension directories, and update the configured Git package. Package code performs none of these user-file operations itself. Preserve the upstream MIT notice with derived source.
