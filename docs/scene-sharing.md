---
layout: default
title: Scene Sharing
description: Share and discover Hibiki scenes through the community registry or portable .hibiki.zip archives.
---

## Scene Sharing

Hibiki scenes can be shared with other users through a community registry or as portable `.hibiki.zip` archives. You can browse community scenes, import a zip from a friend, or share your own creations.

### Installing community scenes

#### Browse the community registry

1. Open the **Scenes** tab in Hibiki.
2. Click **Browse** in the scene actions bar.
3. A modal opens with all scenes from the community registry. Search by name, author, tag, or description.
4. Click **Install** on any scene. Hibiki creates the scene in your library with all track references.

Since registry scenes are reference-only (no bundled audio), installed tracks will show a **missing** badge until you add matching sound files to your library. Hover over the badge to see source hints for where to find the audio.

The registry index is cached for 24 hours. Click **Refresh** in the modal to force-update.

#### Import a local file

If someone sends you a `.hibiki.zip` file:

1. Open the **Scenes** tab.
2. Click **Import** and select the zip file.

---

### How the registry works

The community registry lives in the [`registry/`](https://github.com/PhyberApex/hibiki/tree/main/registry) directory of the Hibiki repo. Each scene is a single JSON file containing the full scene definition — track names, volumes, and source references. **No audio files are stored or distributed.**

When you click **Install** in the Browse modal, Hibiki reads the scene definition directly from the registry and creates a local scene. There is no zip download — the JSON entry *is* the scene.

<div class="callout">
<p><strong>Reference-only policy.</strong> The registry only accepts reference-only scenes (<code>audioBundled: false</code>). No audio files (MP3, WAV, OGG, etc.) are distributed through the registry. Scene entries are recipes describing which sounds to use, not the sounds themselves.</p>
<p>This is enforced by schema validation and CI: any PR with bundled audio will be rejected automatically.</p>
</div>

Each track includes a `source` block that tells the user where to find the audio:

```json
{
  "soundName": "Crackling Fire",
  "source": {
    "name": "Crackling Fireplace",
    "url": "https://freesound.org/people/example/sounds/12345/",
    "note": "Any fireplace loop works"
  }
}
```

#### Bundled exports (personal use)

When you export a scene from Hibiki for personal sharing (e.g. sending a zip to a friend), the export includes bundled audio files. This is fine for direct sharing — the registry restriction only applies to scenes submitted to the community registry.

---

### Creating and sharing a scene

#### 1. Build the scene

Create a scene in Hibiki as you normally would: add music, ambience, and effects tracks, set volumes and loop options.

#### 2. Create the registry entry

Create a JSON file with your scene definition. Each track needs a `source` block describing where to find the audio.

Example entry:

```json
{
  "name": "Dark Tavern",
  "slug": "dark-tavern",
  "description": "A moody tavern with crackling fire and distant murmurs.",
  "author": "YourName",
  "version": "1.0.0",
  "tags": ["tavern", "social", "ambient"],
  "category": "environment",
  "audioBundled": false,
  "createdAt": "2026-03-18T00:00:00Z",
  "updatedAt": "2026-03-18T00:00:00Z",
  "scene": {
    "music": [
      {
        "soundName": "Tavern Theme",
        "volume": 70,
        "loop": true,
        "source": {
          "name": "Medieval Tavern Music",
          "url": "https://freesound.org/people/example/sounds/12345/",
          "note": "Any calm tavern music works"
        }
      }
    ],
    "ambience": [
      {
        "soundName": "Crackling Fire",
        "volume": 50,
        "enabled": true,
        "source": {
          "name": "Fireplace Crackle Loop",
          "url": "https://freesound.org/people/example/sounds/67890/",
          "note": "Any fireplace or campfire loop"
        }
      }
    ],
    "effects": []
  }
}
```

Key fields:
- **`slug`** — URL-safe identifier, must match the filename (e.g. `dark-tavern.json`).
- **`description`** — A short sentence describing the mood/setting.
- **`author`** — Your name or handle.
- **`tags`** — Keywords for discovery (e.g. `combat`, `tavern`, `forest`, `horror`).
- **`source.name`** — The name or title of the audio the user should look for.
- **`source.url`** — A link to where the audio can be found (optional but helpful).
- **`source.note`** — A hint if the exact track doesn't matter (e.g. "any rain loop works").

#### 3. Submit to the community registry

1. Fork the Hibiki repo.
2. Create a file at `registry/scenes/<your-username>/<scene-slug>.json` with your scene entry.
3. Open a pull request against the Hibiki repo. The **Registry** CI workflow validates your entry automatically (schema check, slug uniqueness, track source blocks).
4. Once merged, the index is rebuilt and the scene appears in the **Browse** modal for all Hibiki users.

---

### Example scene

The registry includes a reference example at [`registry/scenes/PhyberApex/cozy-tavern.json`](https://github.com/PhyberApex/hibiki/blob/main/registry/scenes/PhyberApex/cozy-tavern.json). It demonstrates all required fields and shows how to structure tracks with source blocks across music, ambience, and effects. Use it as a template when creating your own submission.

### Registry entry reference

#### Scene fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Human-readable scene name |
| `slug` | string | Yes | URL-safe identifier (lowercase, hyphens only) |
| `description` | string | Yes | Short description |
| `author` | string | Yes | Creator name or handle |
| `version` | string | Yes | Semver (e.g. `1.0.0`) |
| `tags` | string[] | Yes | Keywords for search |
| `category` | string | Yes | E.g. `environment`, `combat`, `social` |
| `license` | string | No | SPDX identifier for the scene definition |
| `audioBundled` | `false` | Yes | Must be `false` |
| `createdAt` | string | Yes | ISO 8601 timestamp |
| `updatedAt` | string | Yes | ISO 8601 timestamp |
| `scene.music` | array | Yes | Music track definitions |
| `scene.ambience` | array | Yes | Ambience track definitions |
| `scene.effects` | array | Yes | Effect definitions |

#### Track fields

Each track in `scene.music`, `scene.ambience`, or `scene.effects`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `soundName` | string | Yes | Display name of the track |
| `volume` | number | No | 0-100, default 80 |
| `enabled` | boolean | No | For ambience: whether it starts active |
| `loop` | boolean | No | For music: whether it loops |
| `source` | object | Yes | Where to find the audio |
| `source.name` | string | Yes | Name/title of the original audio |
| `source.url` | string | No | Link to the audio source |
| `source.note` | string | No | Free-text hint (e.g. "any rain loop works") |

### Registry validation

The registry has a JSON Schema at [`registry/schema/scene-entry.schema.json`](https://github.com/PhyberApex/hibiki/blob/main/registry/schema/scene-entry.schema.json) that all entries must conform to. You can validate locally before submitting:

```bash
pnpm registry:validate
```

CI runs this automatically on PRs that touch `registry/scenes/`. It checks:
- All required fields present and correctly typed
- `audioBundled` is `false` (no bundled audio allowed)
- Slug matches the filename and is URL-safe
- Version is valid semver
- Every track has a `source` block with at least a `name`
- Scene has at least one track
- No duplicate slugs across the registry
