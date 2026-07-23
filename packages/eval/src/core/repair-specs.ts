// packages/eval/src/core/repair-specs.ts
// project-free canonical specs shared by suites & repair benchmarks

import { loadModelsFromText } from '@scratch-agent/model'
import type { Step } from '@scratch-agent/runner'

import type { TestSpec } from './test.js'

const STATE_GAME_MODEL = JSON.stringify([
  {
    id: 'stategame',
    usage: 'program',
    startNodeId: 'start',
    stopAllNodeIds: [],
    nodes: [
      { id: 'start', label: 'start' },
      { id: 'playing', label: 'playing' },
      { id: 'won', label: 'won' },
      { id: 'lost', label: 'lost' },
    ],
    edges: [
      {
        id: 'e_start',
        label: 'green flag -> playing',
        from: 'start',
        to: 'playing',
        conditions: [
          { name: 'VarComp', args: ['Stage', 'state', '==', 'playing'] },
        ],
      },
      {
        id: 'e_win',
        label: 'score 10 -> won',
        from: 'playing',
        to: 'won',
        conditions: [{ name: 'VarComp', args: ['Stage', 'score', '>=', 10] }],
        effects: [{ name: 'VarComp', args: ['Stage', 'state', '==', 'won'] }],
      },
      {
        id: 'e_lose',
        label: 'no lives -> lost',
        from: 'playing',
        to: 'lost',
        conditions: [{ name: 'VarComp', args: ['Stage', 'lives', '<=', 0] }],
        effects: [{ name: 'VarComp', args: ['Stage', 'state', '==', 'lost'] }],
      },
      {
        id: 'e_collect',
        label: 'space collects a point',
        from: 'playing',
        to: 'playing',
        conditions: [
          { name: 'Key', args: ['space'] },
          { name: 'VarComp', args: ['Stage', 'score', '<', 10] },
        ],
        effects: [{ name: 'VarChange', args: ['Stage', 'score', '+'] }],
      },
    ],
  },
  {
    id: 'endwin',
    usage: 'end',
    startNodeId: 's',
    stopAllNodeIds: [],
    nodes: [
      { id: 's', label: 'check' },
      { id: 'checked', label: 'checked' },
    ],
    edges: [
      {
        id: 'e_end',
        label: 'ended in won',
        from: 's',
        to: 'checked',
        conditions: [],
        effects: [{ name: 'VarComp', args: ['Stage', 'state', '==', 'won'] }],
      },
    ],
  },
])

const collect: Step[] = Array.from({ length: 10 }, () => ({
  do: 'tapKey',
  key: 'space',
}))

export const stateWinSpec: TestSpec = {
  name: 'state-game: collect ten points to win (model FSM)',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      ...collect,
      { do: 'wait', ticks: 3 },
      { do: 'snapshot', label: 'end' },
    ],
  },
  asserts: [
    {
      at: 'end',
      probe: { on: 'var', name: 'score' },
      match: { kind: 'equals', value: 10 },
    },
    {
      at: 'end',
      probe: { on: 'var', name: 'state' },
      match: { kind: 'equals', value: 'won' },
    },
  ],
  model: loadModelsFromText(STATE_GAME_MODEL),
}

export const stateResetSpec: TestSpec = {
  name: 'state game resets on a second flag',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'tapKey', key: 'space' },
      { do: 'tapKey', key: 'space' },
      { do: 'tapKey', key: 'space' },
      { do: 'snapshot', label: 'dirty' },
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'reset' },
    ],
  },
  asserts: [
    {
      at: 'reset',
      probe: { on: 'var', name: 'score' },
      match: { kind: 'equals', value: 0 },
    },
    {
      at: 'reset',
      probe: { on: 'var', name: 'lives' },
      match: { kind: 'equals', value: 3 },
    },
    {
      at: 'reset',
      probe: { on: 'var', name: 'state' },
      match: { kind: 'equals', value: 'playing' },
    },
  ],
}

export const stateLossSpec: TestSpec = {
  name: 'state game loses only after three damage inputs',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'start' },
      { do: 'tapKey', key: 'd' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'damage-1' },
      { do: 'tapKey', key: 'd' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'damage-2' },
      { do: 'tapKey', key: 'd' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'damage-3' },
    ],
  },
  asserts: [
    {
      at: 'start',
      probe: { on: 'var', name: 'lives' },
      match: { kind: 'equals', value: 3 },
    },
    {
      at: 'start',
      probe: { on: 'var', name: 'state' },
      match: { kind: 'equals', value: 'playing' },
    },
    {
      at: 'damage-1',
      probe: { on: 'var', name: 'lives' },
      match: { kind: 'equals', value: 2 },
    },
    {
      at: 'damage-1',
      probe: { on: 'var', name: 'state' },
      match: { kind: 'equals', value: 'playing' },
    },
    {
      at: 'damage-2',
      probe: { on: 'var', name: 'lives' },
      match: { kind: 'equals', value: 1 },
    },
    {
      at: 'damage-2',
      probe: { on: 'var', name: 'state' },
      match: { kind: 'equals', value: 'playing' },
    },
    {
      at: 'damage-3',
      probe: { on: 'var', name: 'lives' },
      match: { kind: 'equals', value: 0 },
    },
    {
      at: 'damage-3',
      probe: { on: 'var', name: 'state' },
      match: { kind: 'equals', value: 'lost' },
    },
  ],
}

export const relayMovementSpec: TestSpec = {
  name: 'broadcast-relay: a broadcast moves the receiver sprite',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 2 },
      { do: 'snapshot', label: 'after' },
    ],
  },
  asserts: [
    {
      at: 'after',
      probe: { on: 'prop', sprite: 'Receiver', prop: 'x' },
      match: { kind: 'equals', value: 10 },
    },
  ],
}

export const collectorRendererSpec: TestSpec = {
  name: 'collector: falling item scores on touch (renderer-only)',
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 2 },
      { do: 'snapshot', label: 'start' },
      { do: 'wait', ticks: 33 },
      { do: 'snapshot', label: 'caught' },
    ],
  },
  asserts: [
    {
      at: 'caught',
      probe: { on: 'var', name: 'score', sprite: 'Item' },
      match: { kind: 'equals', value: 0 },
      note: 'headless vm cannot detect the touch',
    },
  ],
  visual: [
    {
      at: 'caught',
      probe: { on: 'var', name: 'score', sprite: 'Item' },
      match: { kind: 'equals', value: 1 },
      note: 'collision only detected with a renderer',
    },
    {
      at: 'start',
      probe: {
        on: 'spriteInRegion',
        sprite: 'Item',
        region: { x: 180, y: 0, width: 120, height: 120 },
      },
      match: { kind: 'equals', value: true },
    },
    {
      at: 'start',
      probe: {
        on: 'spriteInRegion',
        sprite: 'Player',
        region: { x: 180, y: 280, width: 120, height: 80 },
      },
      match: { kind: 'equals', value: true },
    },
    {
      at: 'start',
      probe: { on: 'notBlank' },
      match: { kind: 'equals', value: true },
    },
    {
      at: 'caught',
      probe: {
        on: 'regionChanged',
        from: 'start',
        region: { x: 200, y: 0, width: 80, height: 360 },
      },
      match: { kind: 'gt', value: 0 },
    },
  ],
}
