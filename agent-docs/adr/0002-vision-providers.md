# 0002. Vision Providers: Claude plus one OpenAI-compatible endpoint

## Status

Accepted

## Context

ADR-0001 shipped Vision to Vibe with Claude (Anthropic) as the only vision provider and deferred multi-provider support to issue #335. GMs without an Anthropic account are locked out of the feature entirely.

The `VisionProvider` interface (`analyzeImage(image) → VibeAnalysis`) is already provider-agnostic, but everything around it assumes a single provider: one stored key, one env var, no provider selection, and Settings copy that names Anthropic.

This ADR records the decisions reached (via `/triage` on #335) on which providers to support and how a GM configures them.

## Decision

- **Providers**: two Vision Providers — `claude` (unchanged, the default) and `openai-compatible`. The second is a single adapter speaking the OpenAI Chat Completions wire format against a configurable base URL, rather than one named adapter per vendor. It covers OpenAI itself plus any compatible gateway or local server (OpenRouter, Ollama, LM Studio, ...).
- **Selection**: the GM picks the active Vision Provider in Settings. Selection is stored in `app-config.json`; there is no env var for it.
- **Keys**: stored per provider and retained independently, so switching providers never discards or re-prompts for a key. The existing stored key remains the Claude key — no migration.
- **Env vars**: namespaced. `HIBIKI_VISION_API_KEY` stays the Anthropic key; `HIBIKI_VISION_OPENAI_API_KEY` is the key for the OpenAI-compatible provider. Each env key wins over its stored counterpart, as today.
- **Model**: Claude's model stays pinned in code. The OpenAI-compatible provider has Base URL and Model settings, prefilled with OpenAI's endpoint and a pinned default vision-capable model, both editable.
- **Gating**: the scene-editor entry point requires the toggle on *and* the selected provider configured. Claude is configured when its key is set. The OpenAI-compatible provider is configured when its key is set *or* its base URL differs from the OpenAI default (local servers need no key).

## Consequences

- One adapter reaches many backends, at the cost of two extra Settings fields and no guarantee that an arbitrary endpoint or model supports image input or structured output. Failures there surface as analysis-time errors rather than being prevented up front.
- Gemini has no native adapter; it is reachable only through an OpenAI-compatible endpoint.
- The image now goes to whichever endpoint the GM configured, so the consent copy in Settings must name the selected destination rather than Anthropic.
- The `config` IPC domain grows additively (provider selection, per-provider key, base URL, model); `vision.analyzeImageVibe` is unchanged.
- Issue #412 (encrypting secrets at rest) now has more than one Vision key to cover.
