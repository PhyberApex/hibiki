---
layout: default
title: Scene Sharing
---

## Scene Sharing

Hibiki scenes can be shared with other users as portable `.hibiki.zip` archives. You can install scenes from a direct URL, browse a community registry, or share your own creations.

### Installing community scenes

There are three ways to get scenes from other people:

#### Browse the community registry

1. Open the **Scenes** tab in Hibiki.
2. Click **Browse** in the scene actions bar.
3. A modal opens with all scenes from the community registry. Search by name, author, tag, or description.
4. Click **Install** on any scene. Hibiki downloads the archive and adds the scene to your library.

The registry index is cached for 24 hours. Click **Refresh** in the modal to force-update.

#### Install from a URL

If someone gives you a direct link to a `.hibiki.zip` file (e.g. a GitHub release asset):

1. Open the **Scenes** tab.
2. Click **From URL**.
3. Paste the URL and click **Install**.

#### Import a local file

If you have a `.hibiki.zip` file on disk:

1. Open the **Scenes** tab.
2. Click **Import** and select the zip file.

### Understanding scene packages

A scene package (`.hibiki.zip`) contains:

- **`hibiki-scene.json`** — The scene manifest with metadata (name, author, tags, description) and track definitions.
- **`sounds/`** — Bundled audio files, organized by category (`music/`, `ambience/`, `effects/`). Only present for personal exports; not allowed in the community registry.

#### Reference-only scenes (registry policy)

**The community registry only accepts reference-only scenes** (`audioBundled: false`). This means no audio files (MP3, WAV, OGG, etc.) are distributed through the registry or linked archives. Scene packages in the registry contain only the manifest — a recipe describing which sounds to use, not the sounds themselves.

This is enforced by CI: any PR with `audioBundled: true` will be rejected automatically.

Each track in a reference-only scene includes a `source` block that tells the user where to find the audio:

```json
{
  "soundName": "Crackling Fire",
  "bundled": false,
  "source": {
    "name": "Crackling Fireplace",
    "url": "https://freesound.org/people/example/sounds/12345/",
    "note": "Any fireplace loop works"
  }
}
```

When you install a reference-only scene, tracks appear with a **missing** badge in the scene editor. The badge tooltip shows the source hints. Add matching files to your sound library and the badge goes away.

#### Bundled exports (personal use)

When you export a scene from Hibiki for personal sharing (e.g. sending a zip to a friend), the export includes bundled audio files. This is fine for direct sharing — the registry restriction only applies to scenes submitted to the community registry.

### Creating and sharing a scene

#### 1. Build the scene

Create a scene in Hibiki as you normally would: add music, ambience, and effects tracks, set volumes and loop options.

#### 2. Export

1. Select your scene and click **Export**.
2. Choose a save location. Hibiki creates a `.hibiki.zip` with the manifest and bundled audio.

#### 3. Edit the manifest for registry submission

Since the registry only accepts reference-only scenes, you need to edit `hibiki-scene.json` inside the zip:

1. **Remove bundled audio** — Delete the `sounds/` folder from the zip.
2. **Set `bundled: false`** on every track and add `source` blocks describing where to find the audio.
3. **Fill in metadata** — description, author, tags, etc.

Example manifest:

```json
{
  "formatVersion": 1,
  "name": "dark-tavern",
  "displayName": "Dark Tavern",
  "description": "A moody tavern with crackling fire and distant murmurs.",
  "author": "YourName",
  "version": "1.0.0",
  "tags": ["tavern", "social", "ambient"],
  "category": "environment",
  "scene": {
    "music": [
      {
        "soundName": "Tavern Theme",
        "volume": 70,
        "loop": true,
        "bundled": false,
        "source": {
          "name": "Medieval Tavern Music",
          "url": "https://freesound.org/people/example/sounds/12345/",
          "note": "Any calm tavern music works"
        }
      }
    ],
    "ambience": [],
    "effects": []
  }
}
```

Key fields:
- **`description`** — A short sentence describing the mood/setting.
- **`author`** — Your name or handle.
- **`tags`** — Keywords for discovery (e.g. `combat`, `tavern`, `forest`, `horror`).
- **`source.name`** — The name or title of the audio the user should look for.
- **`source.url`** — A link to where the audio can be found (optional but helpful).
- **`source.note`** — A hint if the exact track doesn't matter (e.g. "any rain loop works").

#### 4. Host the archive

Upload the `.hibiki.zip` as a **GitHub release asset** on your own repo. This gives you a stable download URL like:

```text
https://github.com/yourname/hibiki-scenes/releases/download/v1.0.0/dark-tavern.hibiki.zip
```

#### 5. Submit to the community registry

The community registry lives in the [`registry/`](https://github.com/PhyberApex/hibiki/tree/main/registry) directory of the Hibiki repo. To list your scene:

1. Fork the Hibiki repo.
2. Create a file at `registry/scenes/<your-username>/<scene-slug>.json`:

```json
{
  "name": "Dark Tavern",
  "slug": "dark-tavern",
  "description": "A moody tavern with crackling fire and distant murmurs.",
  "author": "YourName",
  "version": "1.0.0",
  "tags": ["tavern", "social", "ambient"],
  "category": "environment",
  "downloadUrl": "https://github.com/yourname/hibiki-scenes/releases/download/v1.0.0/dark-tavern.hibiki.zip",
  "audioBundled": false,
  "createdAt": "2026-03-18T00:00:00Z",
  "updatedAt": "2026-03-18T00:00:00Z"
}
```

3. Open a pull request against the Hibiki repo. The **Registry** CI workflow validates your entry automatically (schema check, slug uniqueness, download URL reachable).
4. Once merged, the index is rebuilt and the scene appears in the **Browse** modal for all Hibiki users.

### Manifest reference

The `hibiki-scene.json` manifest has this structure:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `formatVersion` | `1` | Yes | Always `1` for this format |
| `name` | string | Yes | URL-safe slug (e.g. `dark-tavern`) |
| `displayName` | string | Yes | Human-readable name |
| `description` | string | Yes | Short description |
| `author` | string | Yes | Creator name or handle |
| `version` | string | Yes | Semver (e.g. `1.0.0`) |
| `tags` | string[] | Yes | Keywords for search |
| `category` | string | Yes | E.g. `environment`, `combat`, `social` |
| `license` | string | No | SPDX identifier for the scene definition |
| `homepage` | string | No | Link to source repo or website |
| `scene.music` | array | Yes | Music track definitions |
| `scene.ambience` | array | Yes | Ambience track definitions |
| `scene.effects` | array | Yes | Effect definitions |

Each track in `scene.music`, `scene.ambience`, or `scene.effects`:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `soundName` | string | Yes | Display name of the track |
| `volume` | number | No | 0-100, default 80 |
| `bundled` | boolean | Yes | Whether audio is included in the zip |
| `bundledPath` | string | No | Path within zip (when bundled) |
| `enabled` | boolean | No | For ambience: whether it starts active |
| `loop` | boolean | No | For music: whether it loops |
| `source` | object | No | Where to find audio when not bundled |
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
- Download URL uses HTTPS and is reachable
- No duplicate slugs across the registry
