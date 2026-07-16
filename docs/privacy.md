# Privacy

**Privacy by design.** This fork sends **no background telemetry** about you, your code, or extension usage. The upstream Aptabase sender remains in the source for compatibility/testing, but its production call is disabled. Data leaves your machine only when you deliberately use a network-backed feature such as Grok/Direct API chat or voice input.

## Telemetry

**No telemetry event is currently sent by this fork.** In particular, the upstream anonymous `session_start` Aptabase POST is disconnected in `src/sidebar.ts`.

The `grok.telemetry.enabled` setting is retained so existing user/workspace configuration stays compatible if this fork later introduces its own telemetry project. At present, changing it has no network effect.

## Voice input (Speech-to-Text)

**Voice input** sends data to xAI only when you use it. It is **opt-in per use** — nothing is captured until you click the microphone button. While you dictate, two things go to **xAI's Speech-to-Text endpoint** (`api.x.ai/v1/stt`) to produce the transcript:

- your **audio** (the recording, streamed live or as a clip), and
- an **STT credential** — the dedicated key you configured (`grok.voiceApiKey` / `GROK_VOICE_API_KEY` / `XAI_API_KEY`) if set, otherwise the token from your `grok login` (`~/.grok/auth.json`), reused so voice works without a separate key.

This is core functionality you trigger deliberately, and it goes to xAI (the same provider behind the CLI) — never to us or any third party. If you never use voice, none of this happens. To avoid sending your login token specifically, set a dedicated `grok.voiceApiKey`. Setup + details: [docs/voice-setup.md](voice-setup.md).
