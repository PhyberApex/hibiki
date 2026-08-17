<script setup lang="ts">
import type { SoundFile } from '@/api/sounds'
import type { VibeAnalysis, VibeMatch, VibeMatches } from '@/api/vision'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { openFileDialog } from '@/api/config'
import { getPathForFile } from '@/api/electron'
import { analyzeImageVibe, matchVibe } from '@/api/vision'

type MatchCategory = 'music' | 'ambience'

const props = defineProps<{
  musicSounds: SoundFile[]
  ambienceSounds: SoundFile[]
  musicInScene: string[]
  ambienceInScene: string[]
}>()

const emit = defineEmits<{
  add: [category: MatchCategory, sound: SoundFile]
  close: []
}>()

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']

const stage = ref<'pick' | 'analyzing' | 'results'>('pick')
const analysis = ref<VibeAnalysis | null>(null)
const matches = ref<VibeMatches | null>(null)
const error = ref<string | null>(null)
const imageName = ref<string | null>(null)
const dragOver = ref(false)

interface MatchColumn {
  category: MatchCategory
  label: string
  matches: VibeMatch[]
  hasTaggedSounds: boolean
  inScene: string[]
  noMatchHint: string
}

function hasAnyTags(sounds: SoundFile[]): boolean {
  return sounds.some(s => (s.tags?.length ?? 0) > 0)
}

const columns = computed<MatchColumn[]>(() => [
  {
    category: 'music',
    label: 'Music',
    matches: matches.value?.music ?? [],
    hasTaggedSounds: hasAnyTags(props.musicSounds),
    inScene: props.musicInScene,
    noMatchHint: 'No Music matched these tags. Try tagging more tracks with moods and settings.',
  },
  {
    category: 'ambience',
    label: 'Ambience',
    matches: matches.value?.ambience ?? [],
    hasTaggedSounds: hasAnyTags(props.ambienceSounds),
    inScene: props.ambienceInScene,
    noMatchHint: 'No Ambience matched these tags. Try tagging more loops with moods and settings.',
  },
])

function fileNameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function hasImageExtension(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return IMAGE_EXTENSIONS.includes(ext)
}

async function analyze(imagePath: string) {
  stage.value = 'analyzing'
  error.value = null
  imageName.value = fileNameOf(imagePath)
  try {
    const result = await analyzeImageVibe(imagePath)
    analysis.value = result
    matches.value = await matchVibe(result.tags)
    stage.value = 'results'
  }
  catch (err) {
    error.value = err instanceof Error ? err.message : 'Couldn\'t analyze this image. Try another one.'
    stage.value = 'pick'
  }
}

async function pickImage() {
  const path = await openFileDialog({
    title: 'Choose an image for Vision to Vibe',
    filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
  })
  if (path)
    await analyze(path)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  dragOver.value = false
  if (stage.value === 'analyzing')
    return
  const file = e.dataTransfer?.files?.[0]
  if (!file)
    return
  if (!hasImageExtension(file.name)) {
    error.value = 'That doesn\'t look like an image. Drop a PNG, JPEG, GIF, or WebP file.'
    return
  }
  const path = getPathForFile(file)
  if (!path) {
    error.value = 'Couldn\'t read that file\'s location. Use "Choose image" instead.'
    return
  }
  analyze(path)
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
  if (e.dataTransfer)
    e.dataTransfer.dropEffect = 'copy'
  dragOver.value = true
}

function reset() {
  stage.value = 'pick'
  analysis.value = null
  matches.value = null
  error.value = null
  imageName.value = null
}

function scoreLabel(match: VibeMatch): string {
  return `${match.score} ${match.score === 1 ? 'tag' : 'tags'} in common`
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape')
    emit('close')
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="vibe-overlay" @click.self="emit('close')">
    <div class="vibe-modal" role="dialog" aria-label="Vision to Vibe">
      <header class="vibe-header">
        <div>
          <h2 class="vibe-title">
            Vision to Vibe
          </h2>
          <p class="vibe-subtitle">
            Drop in a battle map or mood board — get matching sounds from your tagged library.
          </p>
        </div>
        <button type="button" class="btn-close" aria-label="Close" @click="emit('close')">
          ×
        </button>
      </header>

      <div class="vibe-body">
        <p v-if="error" class="vibe-error" role="alert">
          {{ error }}
        </p>

        <div
          v-if="stage !== 'results'"
          class="drop-zone"
          :class="{ 'drop-zone-active': dragOver, 'drop-zone-busy': stage === 'analyzing' }"
          @drop="onDrop"
          @dragover="onDragOver"
          @dragleave="dragOver = false"
        >
          <template v-if="stage === 'analyzing'">
            <span class="drop-spinner" aria-hidden="true" />
            <p class="drop-title">
              Reading the vibe of <strong>{{ imageName }}</strong>…
            </p>
            <p class="drop-hint">
              This usually takes a few seconds.
            </p>
          </template>
          <template v-else>
            <p class="drop-title">
              Drag an image here
            </p>
            <p class="drop-hint">
              or
            </p>
            <button type="button" class="btn btn-primary" data-testid="vibe-pick-image" @click="pickImage">
              Choose image…
            </button>
            <p class="drop-privacy">
              The image is sent to Anthropic's Claude API for analysis and isn't kept afterwards.
            </p>
          </template>
        </div>

        <template v-else-if="analysis && matches">
          <section class="vibe-analysis">
            <p class="vibe-image-name">
              {{ imageName }}
            </p>
            <p class="vibe-description">
              {{ analysis.description }}
            </p>
            <ul class="vibe-tags" aria-label="Vibe tags">
              <li v-for="tag in analysis.tags" :key="tag" class="vibe-tag">
                {{ tag }}
              </li>
            </ul>
          </section>

          <div class="match-columns">
            <section
              v-for="column in columns"
              :key="column.category"
              class="match-column"
              :class="`match-column-${column.category}`"
              :data-testid="`vibe-${column.category}-matches`"
            >
              <h3 class="match-title">
                {{ column.label }}
              </h3>
              <ul v-if="column.matches.length" class="match-list">
                <li v-for="match in column.matches" :key="match.sound.id" class="match-item">
                  <div class="match-info">
                    <span class="match-name" :title="match.sound.name">{{ match.sound.name }}</span>
                    <span class="match-score">{{ scoreLabel(match) }}</span>
                  </div>
                  <button
                    type="button"
                    class="btn-add-match"
                    :disabled="column.inScene.includes(match.sound.id)"
                    @click="emit('add', column.category, match.sound)"
                  >
                    {{ column.inScene.includes(match.sound.id) ? '✓ Added' : '+ Add' }}
                  </button>
                </li>
              </ul>
              <p v-else-if="!column.hasTaggedSounds" class="match-empty" :data-testid="`vibe-${column.category}-empty`">
                Tag your {{ column.label }} sounds to enable Vision-to-Vibe matching.
                <RouterLink to="/media" class="match-link">
                  Open the sound library
                </RouterLink>
              </p>
              <p v-else class="match-empty" :data-testid="`vibe-${column.category}-empty`">
                {{ column.noMatchHint }}
              </p>
            </section>
          </div>

          <footer class="vibe-footer">
            <button type="button" class="btn btn-ghost" @click="reset">
              Analyze another image
            </button>
            <button type="button" class="btn btn-primary" @click="emit('close')">
              Done
            </button>
          </footer>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.vibe-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-backdrop);
  backdrop-filter: blur(4px);
}

.vibe-modal {
  display: flex;
  flex-direction: column;
  width: min(640px, 92vw);
  max-height: 88vh;
  background: var(--color-bg-card);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.vibe-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--color-border);
}

.vibe-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--color-text);
}

.vibe-subtitle {
  margin: 0.2rem 0 0;
  font-size: 0.8rem;
  color: var(--color-text-muted);
}

.btn-close {
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.25rem;
  line-height: 1;
  flex-shrink: 0;
}

.btn-close:hover {
  color: var(--color-text);
}

.vibe-body {
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  overflow-y: auto;
  min-height: 0;
}

.vibe-error {
  margin: 0;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-sm);
  background: var(--color-error-muted);
  color: var(--color-error);
  font-size: 0.85rem;
}

/* ── Drop zone ── */

.drop-zone {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 2.5rem 1.5rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-md);
  text-align: center;
  transition: background var(--transition), border-color var(--transition);
}

.drop-zone-active {
  background: var(--color-accent-muted);
  border-color: var(--color-accent);
}

.drop-zone-busy {
  border-style: solid;
}

.drop-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 500;
  color: var(--color-text);
}

.drop-hint {
  margin: 0;
  font-size: 0.8rem;
  color: var(--color-text-dim);
}

.drop-privacy {
  margin: 0.75rem 0 0;
  max-width: 28rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.drop-spinner {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 50%;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-accent);
  animation: vibe-spin 0.8s linear infinite;
}

@keyframes vibe-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .drop-spinner {
    animation: none;
  }
}

/* ── Analysis ── */

.vibe-analysis {
  padding: 0.85rem 1rem;
  background: var(--color-bg);
  border-radius: var(--radius-md);
}

.vibe-image-name {
  margin: 0 0 0.25rem;
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-dim);
}

.vibe-description {
  margin: 0 0 0.6rem;
  font-size: 0.9rem;
  line-height: 1.5;
  color: var(--color-text);
}

.vibe-tags {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
}

.vibe-tag {
  font-size: 0.75rem;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  background: var(--color-accent-muted);
  color: var(--color-accent-hover);
}

/* ── Matches ── */

.match-columns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.match-column {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 0;
}

.match-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-left: 0.5rem;
  border-left: 3px solid var(--color-music);
  color: var(--color-text-muted);
}

.match-column-ambience .match-title {
  border-left-color: var(--color-ambience);
}

.match-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.match-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.6rem;
  border-radius: var(--radius-sm);
  background: var(--color-bg);
}

.match-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.match-name {
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-score {
  font-size: 0.7rem;
  color: var(--color-text-dim);
}

.btn-add-match {
  flex-shrink: 0;
  padding: 0.25rem 0.55rem;
  font-size: 0.75rem;
  font-weight: 600;
  background: var(--color-accent);
  color: var(--color-accent-text);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background var(--transition);
}

.btn-add-match:hover:not(:disabled) {
  background: var(--color-accent-hover);
}

.btn-add-match:disabled {
  background: transparent;
  color: var(--color-success);
  cursor: default;
}

.match-empty {
  margin: 0;
  padding: 0.75rem;
  border: 1px dashed var(--color-border);
  border-radius: var(--radius-sm);
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--color-text-muted);
}

.match-link {
  display: block;
  margin-top: 0.25rem;
  color: var(--color-accent);
  text-decoration: none;
}

.match-link:hover {
  text-decoration: underline;
}

.vibe-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

@media (max-width: 560px) {
  .match-columns {
    grid-template-columns: 1fr;
  }
}
</style>
