// @vitest-environment happy-dom
import type { CanvasInteractionInput, CanvasInteractionTools } from './useCanvasInteractions'
import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef } from 'vue'
import { canvasRegion } from '../../../../tests/fixtures/canvas'
import { useCanvasInteractions } from './useCanvasInteractions'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()))

function setup() {
  const input = reactive<CanvasInteractionInput>({
    image: new Image(),
    project: { imageName: 'synthetic.png', imageWidth: 320, imageHeight: 240, regions: [canvasRegion()] },
    selectedRegionId: 'region',
    selectedExclusionId: null,
    zoom: 50,
    regionCandidates: [],
    selectedCandidateId: null,
    printArea: null,
    printAreaEditing: false,
  })
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 240
  canvas.getBoundingClientRect = () => ({ left: 20, top: 30, width: 160, height: 120 } as DOMRect)
  const captured = new Set<number>()
  canvas.setPointerCapture = vi.fn(id => captured.add(id))
  canvas.hasPointerCapture = vi.fn(id => captured.has(id))
  canvas.releasePointerCapture = vi.fn(id => captured.delete(id))
  const tools = reactive<CanvasInteractionTools>({ maskEditing: false, exclusionEditing: false, maskBrushSize: 20, maskBrushMode: 'paint' })
  const actions = {
    addRegion: vi.fn(),
    updateRegionBounds: vi.fn(),
    selectRegion: vi.fn(),
    addMaskStroke: vi.fn(),
    addExclusion: vi.fn(),
    updateExclusion: vi.fn(),
    selectExclusion: vi.fn((id: string | null) => { input.selectedExclusionId = id }),
    selectRegionCandidate: vi.fn((id: string | null) => { input.selectedCandidateId = id }),
    updateRegionCandidateBounds: vi.fn(),
    updatePrintArea: vi.fn(),
  }
  const color = vi.fn(() => '#123456')
  const scope = effectScope()
  scopes.push(scope)
  const interaction = scope.run(() => useCanvasInteractions(input, shallowRef(canvas), tools, actions, color))!
  return { input, canvas, tools, actions, color, scope, interaction }
}

function pointer(x: number, y: number, pointerId = 1, button = 0) {
  return new PointerEvent('pointermove', { clientX: 20 + x / 2, clientY: 30 + y / 2, pointerId, button })
}

type Mode = 'newRegion' | 'region' | 'exclusion' | 'maskStroke' | 'candidate' | 'printArea'
function beginMode(mode: Mode) {
  const state = setup()
  state.input.selectedRegionId = mode === 'newRegion' ? null : 'region'
  state.tools.exclusionEditing = mode === 'exclusion'
  state.tools.maskEditing = mode === 'maskStroke'
  state.input.printAreaEditing = mode === 'printArea'
  if (mode === 'candidate')
    state.input.regionCandidates = [{ id: 'candidate', x: 40, y: 100, width: 200, height: 100, text: 'Synthetic', confidence: 90, selected: true, lines: [] }]
  state.interaction.onPointerDown(pointer(90, 130))
  state.interaction.onPointerMove(pointer(130, 170))
  return state
}

function expectNoWrites(actions: ReturnType<typeof setup>['actions']) {
  for (const [name, action] of Object.entries(actions)) {
    if (!name.startsWith('select'))
      expect(action).not.toHaveBeenCalled()
  }
}

it.each(['newRegion', 'region', 'exclusion', 'candidate', 'printArea'] as const)('clears a lost %s capture without committing on later movement/release', (mode) => {
  const { interaction, actions, canvas } = beginMode(mode)
  interaction.onLostPointerCapture(pointer(130, 170))
  interaction.onPointerMove(pointer(140, 180))
  interaction.onPointerUp(pointer(140, 180))
  expect(interaction.drafts.value[mode]).toBeNull()
  expect(canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
  expectNoWrites(actions)
})

it.each(['newRegion', 'region', 'exclusion', 'maskStroke', 'candidate', 'printArea'] as const)('releases and discards %s on scope disposal and ignores delayed events', (mode) => {
  const { interaction, actions, canvas, scope } = beginMode(mode)
  scope.stop()
  interaction.onLostPointerCapture(pointer(130, 170))
  interaction.onPointerMove(pointer(140, 180))
  interaction.onPointerUp(pointer(140, 180))
  interaction.onPointerDown(pointer(90, 130))
  interaction.onPointerMove(pointer(140, 180))
  interaction.onPointerUp(pointer(140, 180))
  expect(interaction.drafts.value[mode]).toBeNull()
  expect(canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
  expectNoWrites(actions)
})

it.each(['image', 'project', 'selection', 'mode', 'zoom', 'candidates'] as const)('rejects a stale %s before watchers flush and does not apply the old region gesture', (change) => {
  const { interaction, input, tools, actions, canvas } = beginMode('region')
  if (change === 'image')
    input.image = new Image()
  if (change === 'project')
    input.project = { ...input.project }
  if (change === 'selection')
    input.selectedRegionId = null
  if (change === 'mode')
    tools.maskEditing = true
  if (change === 'zoom')
    input.zoom = 100
  if (change === 'candidates')
    input.regionCandidates = [...input.regionCandidates]
  interaction.onPointerUp(pointer(130, 170))
  expect(interaction.drafts.value.region).toBeNull()
  expect(canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
  expectNoWrites(actions)
})

it('discards a stale brush on capture loss instead of applying it to another card with the same region ID', async () => {
  const { interaction, input, actions } = beginMode('maskStroke')
  input.project = { ...input.project, regions: [canvasRegion()] }
  interaction.onLostPointerCapture(pointer(130, 170))
  expectNoWrites(actions)
  const pending = beginMode('printArea')
  pending.input.printAreaEditing = false
  await nextTick()
  expect(pending.interaction.drafts.value.printArea).toBeNull()
  expect(pending.canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
})

it('ignores secondary pointer down, movement, cancellation, release and capture loss', () => {
  const { interaction, actions, canvas } = beginMode('region')
  const draft = { ...interaction.drafts.value.region }
  interaction.onPointerDown(pointer(20, 20, 2))
  interaction.onPointerMove(pointer(200, 200, 2))
  interaction.onPointerCancel(pointer(200, 200, 2))
  interaction.onPointerUp(pointer(200, 200, 2))
  interaction.onLostPointerCapture(pointer(200, 200, 2))
  expect(interaction.drafts.value.region).toEqual(draft)
  expect(canvas.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1)
  expectNoWrites(actions)
  interaction.onPointerUp(pointer(130, 170))
  expect(actions.updateRegionBounds).toHaveBeenCalledExactlyOnceWith('region', draft)
})

it('rejects a changed candidate/exclusion selection immediately and releases normal captures only once', () => {
  const candidate = beginMode('candidate')
  candidate.input.selectedCandidateId = null
  candidate.interaction.onPointerUp(pointer(130, 170))
  expectNoWrites(candidate.actions)
  const exclusion = setup()
  exclusion.interaction.onPointerDown(pointer(225, 170))
  exclusion.interaction.onPointerMove(pointer(240, 180))
  exclusion.input.selectedExclusionId = null
  exclusion.interaction.onPointerUp(pointer(240, 180))
  expectNoWrites(exclusion.actions)
  const normal = beginMode('region')
  normal.interaction.onPointerUp(pointer(130, 170))
  normal.interaction.onLostPointerCapture(pointer(130, 170))
  expect(normal.actions.updateRegionBounds).toHaveBeenCalledOnce()
  expect(normal.canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1)
})

it('creates a region only once on release and samples the committed image coordinates', () => {
  const { interaction, actions, color } = setup()
  interaction.onPointerDown(pointer(10, 10))
  for (let x = 20; x <= 110; x += 10) interaction.onPointerMove(pointer(x, 80))
  expect(actions.addRegion).not.toHaveBeenCalled()
  expect(interaction.drafts.value.newRegion).toEqual({ x: 10, y: 10, width: 100, height: 70 })
  interaction.onPointerUp(pointer(110, 80))
  interaction.onPointerUp(pointer(110, 80))
  expect(actions.addRegion).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 10, width: 100, height: 70 }, '#123456')
  expect(color).toHaveBeenCalledOnce()
  expect(interaction.drafts.value.newRegion).toBeNull()
})

it('keeps committed bounds unchanged during movement and suppresses unchanged updates', () => {
  const { input, interaction, actions } = setup()
  interaction.onPointerDown(pointer(90, 130))
  interaction.onPointerMove(pointer(110, 140))
  expect(input.project.regions[0]).toMatchObject({ x: 40, y: 100 })
  interaction.onPointerUp(pointer(110, 140))
  expect(actions.updateRegionBounds).toHaveBeenCalledExactlyOnceWith('region', { x: 60, y: 110, width: 240, height: 100 })
  interaction.onPointerDown(pointer(90, 130))
  interaction.onPointerUp(pointer(90, 130))
  expect(actions.updateRegionBounds).toHaveBeenCalledOnce()
  interaction.onPointerDown(pointer(280, 200))
  interaction.onPointerMove(pointer(300, 220))
  interaction.onPointerUp(pointer(300, 220))
  expect(actions.updateRegionBounds).toHaveBeenLastCalledWith('region', { x: 40, y: 100, width: 260, height: 120 })
})

it('prioritizes candidate edge resizing and leaves its recognition lines unchanged', () => {
  const { input, interaction, actions } = setup()
  const line = { x: 50, y: 30, width: 200, height: 50, text: 'Synthetic', confidence: 80 }
  input.regionCandidates = [{ ...line, id: 'candidate', selected: true, lines: [line] }]
  input.selectedCandidateId = 'candidate'
  interaction.onPointerDown(pointer(150, 30))
  interaction.onPointerMove(pointer(150, 20))
  interaction.onPointerUp(pointer(150, 20))
  expect(actions.updateRegionCandidateBounds).toHaveBeenCalledExactlyOnceWith('candidate', { x: 50, y: 20, width: 200, height: 60 })
  expect(input.regionCandidates[0]!.lines).toEqual([line])
  expect(actions.updateRegionBounds).not.toHaveBeenCalled()
  interaction.onPointerDown(pointer(0, 0))
  expect(actions.selectRegionCandidate).toHaveBeenLastCalledWith(null)
})

it('creates exclusions in local coordinates and does not fall through outside the selected region', () => {
  const { tools, interaction, actions } = setup()
  tools.exclusionEditing = true
  interaction.onPointerDown(pointer(100, 130))
  interaction.onPointerMove(pointer(150, 160))
  interaction.onPointerUp(pointer(150, 160))
  expect(actions.addExclusion).toHaveBeenCalledExactlyOnceWith('region', { x: 60, y: 30, width: 50, height: 30 })
  interaction.onPointerDown(pointer(10, 10))
  interaction.onPointerMove(pointer(50, 50))
  interaction.onPointerUp(pointer(50, 50))
  expect(actions.addExclusion).toHaveBeenCalledOnce()
  expect(actions.addRegion).not.toHaveBeenCalled()
})

it('moves existing exclusions and clamps them within the owning region', () => {
  const { interaction, actions } = setup()
  interaction.onPointerDown(pointer(225, 170))
  interaction.onPointerMove(pointer(319, 239))
  interaction.onPointerUp(pointer(319, 239))
  expect(actions.updateExclusion).toHaveBeenCalledExactlyOnceWith('region', 'area', { x: 215, y: 80, width: 25, height: 20 })
})

it('commits a brush stroke once on capture loss, ignoring other pointer points and later release', () => {
  const { input, tools, interaction, actions } = setup()
  tools.maskEditing = true
  tools.maskBrushMode = 'erase'
  interaction.onPointerDown(pointer(50, 130))
  interaction.onPointerMove(pointer(100, 140, 2))
  interaction.onPointerMove(pointer(100, 140))
  interaction.onLostPointerCapture(pointer(100, 140))
  interaction.onPointerUp(pointer(100, 140))
  expect(actions.addMaskStroke).toHaveBeenCalledExactlyOnceWith('region', { brushSize: 20, mode: 'erase', points: [{ x: 10, y: 30 }, { x: 60, y: 40 }] })
  expect(input.project.regions[0]!.manualMaskStrokes).toHaveLength(1)
})

it('retains the first print-area click after normal capture loss and commits on the second click', async () => {
  const { input, interaction, actions } = setup()
  input.printAreaEditing = true
  await nextTick()
  interaction.onPointerDown(pointer(10, 10))
  interaction.onPointerUp(pointer(10, 10))
  interaction.onLostPointerCapture(pointer(10, 10))
  interaction.onPointerMove(pointer(200, 80))
  expect(actions.updatePrintArea).not.toHaveBeenCalled()
  interaction.onPointerDown(pointer(200, 80))
  interaction.onPointerUp(pointer(200, 80))
  expect(actions.updatePrintArea).toHaveBeenCalledExactlyOnceWith({ x: 10, y: 10, width: 190, height: 70 })
  expect(actions.addRegion).not.toHaveBeenCalled()
  interaction.onPointerDown(pointer(10, 10))
  input.printAreaEditing = false
  await nextTick()
  expect(interaction.drafts.value.printArea).toBeNull()
})

it.each(['newRegion', 'region', 'exclusion', 'maskStroke', 'candidate', 'printArea'] as const)('discards the %s draft on pointercancel without committing', (mode) => {
  const { input, tools, interaction, actions } = setup()
  input.selectedRegionId = mode === 'newRegion' ? null : 'region'
  tools.exclusionEditing = mode === 'exclusion'
  tools.maskEditing = mode === 'maskStroke'
  input.printAreaEditing = mode === 'printArea'
  if (mode === 'candidate')
    input.regionCandidates = [{ id: 'candidate', x: 40, y: 100, width: 200, height: 100, text: 'Synthetic', confidence: 90, selected: true, lines: [] }]
  interaction.onPointerDown(pointer(90, 130))
  interaction.onPointerMove(pointer(130, 170))
  expect(interaction.drafts.value[mode]).not.toBeNull()
  interaction.onPointerCancel()
  interaction.onPointerUp(pointer(130, 170))
  expect(interaction.drafts.value).toEqual({ region: null, newRegion: null, exclusion: null, creatingExclusion: false, candidate: null, maskStroke: null, printArea: null })
  for (const [name, action] of Object.entries(actions)) {
    if (!name.startsWith('select'))
      expect(action).not.toHaveBeenCalled()
  }
})
