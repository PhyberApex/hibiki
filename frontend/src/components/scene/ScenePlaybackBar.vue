<script setup lang="ts">
import type { Scene } from '@/api/scenes'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'
import { usePlayerStore } from '@/stores/player'
import { SCENE_START_FLASH, useScenePlaybackStore } from '@/stores/scene-playback'
import { libraryName } from './scene-format'

// Master volume, Output Target and Play/Stop for the open Scene, plus the
// one-line now-playing summary the compact layout shows in place of the cards.
const props = defineProps<{
  scene: Scene
  /** Play stays disabled while any of the Scene's sounds is missing from the library. */
  hasAnySoundMissing: boolean
}>()

const player = usePlayerStore()
const playback = useScenePlaybackStore()
const { masterVolume, playingMusicId, playingAmbienceIds, musicSounds } = storeToRefs(playback)
const { sceneTransitionFlash } = playback

const isScenePlayingHere = computed(() => player.playingSceneId === props.scene.id)

const playTitle = computed(() => {
  if (props.hasAnySoundMissing)
    return 'Some sounds are missing — add them to your library first'
  if (!player.canPlay)
    return 'Join a voice channel first'
  return player.isLocalActive
    ? 'Play this scene through your speakers'
    : 'Stream this scene to your Discord voice channel'
})

// Gated on the scene-level playing flag (not just "is a track currently
// audible") so this never contradicts the Play/Stop button next to it — a
// track can end naturally (onended clears playingMusicId) while the scene is
// still "started" and Stop is still the right action.
const nowPlayingLabel = computed(() => {
  if (!isScenePlayingHere.value)
    return 'Nothing playing'
  const parts: string[] = []
  // Backend-decoded Music (ADR-0003) is reported by GuildAudioManager and
  // survives a renderer reload, so it's preferred over the local ref here —
  // see CONTEXT.md on "now playing" sourcing.
  const backendTrack = player.activeTargetState?.track
  if (backendTrack && backendTrack.category === 'music') {
    parts.push(backendTrack.name)
  }
  else if (playingMusicId.value) {
    const musicItem = props.scene.music.find(m => m.soundId === playingMusicId.value)
    parts.push(musicItem?.soundName ?? libraryName(musicSounds.value, playingMusicId.value))
  }
  if (playingAmbienceIds.value.size > 0)
    parts.push(`${playingAmbienceIds.value.size} ambience`)
  return parts.length > 0
    ? parts.join(' · ')
    : 'Scene playing'
})
</script>

<template>
  <div
    class="scene-playback-bar"
    :class="{ 'pulse pulse-flash': sceneTransitionFlash.has(SCENE_START_FLASH) }"
  >
    <label class="global-volume">
      <span class="volume-icon" aria-hidden="true">🔊</span>
      <input
        v-model.number="masterVolume"
        type="range"
        min="0"
        max="100"
        class="volume-slider"
        aria-label="Global volume"
        @change="playback.saveMasterVolume()"
      >
    </label>
    <div class="target-toggle" role="group" aria-label="Output Target">
      <button
        type="button"
        class="btn btn-ghost target-option"
        :class="{ 'target-option-active': !player.isLocalActive }"
        :aria-pressed="!player.isLocalActive"
        title="Play to your Discord voice channel"
        @click="playback.switchTarget('discord')"
      >
        Discord
      </button>
      <button
        type="button"
        class="btn btn-ghost target-option"
        :class="{ 'target-option-active': player.isLocalActive }"
        :aria-pressed="player.isLocalActive"
        title="Play through this computer's speakers"
        @click="playback.switchTarget('local')"
      >
        Local
      </button>
    </div>
    <div class="playback-actions">
      <template v-if="isScenePlayingHere">
        <button
          type="button"
          class="btn btn-stop-scene"
          @click="playback.stopScene()"
        >
          Stop
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          class="btn btn-primary btn-play-scene"
          :title="playTitle"
          :disabled="!player.canPlay || hasAnySoundMissing"
          @click="playback.playScene(scene)"
        >
          Play
        </button>
      </template>
    </div>
  </div>

  <p class="now-playing-line">
    {{ nowPlayingLabel }}
  </p>
</template>

<style scoped>
.scene-playback-bar {
  --pulse-color: var(--color-accent);
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
  padding: 0.75rem 1rem;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.global-volume {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.volume-icon {
  font-size: 1rem;
}

.volume-slider {
  width: 120px;
  accent-color: var(--color-accent);
}

.playback-actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}

.target-toggle {
  display: inline-flex;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.target-option {
  border: none;
  border-radius: 0;
  font-size: 0.8rem;
}

.target-option-active {
  background: var(--color-accent-muted);
  color: var(--color-text);
}

.btn-play-scene {
  padding: 0.5rem 1.5rem;
  font-size: 1rem;
  box-shadow: var(--shadow-accent-sm);
}

.btn-play-scene:hover:not(:disabled) {
  box-shadow: var(--shadow-accent-md);
}

.btn-stop-scene {
  padding: 0.5rem 1.5rem;
  font-size: 1rem;
  background: var(--color-error-muted);
  color: var(--color-error);
  border: 1px solid var(--color-error);
  border-radius: var(--radius-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.btn-stop-scene:hover {
  background: var(--color-error);
  color: var(--color-on-accent-bg);
}

.now-playing-line {
  display: none;
  margin: 0.5rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

/* Compact session layout (899.98px, not 900px: see App.vue; keep in sync
   with it and the other components/scene files):
   the summary stands in for the hidden Ambience and Music cards. */
@media (max-width: 899.98px) {
  .now-playing-line {
    display: block;
  }
}

@media (max-width: 560px) {
  .scene-playback-bar {
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
  }

  .playback-actions {
    margin-left: 0;
    justify-content: flex-end;
  }
}
</style>
