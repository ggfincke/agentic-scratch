// packages/eval/src/core/suite.ts
// the canonical VM test suite: projects + scenarios + assertions that exercise the runner

import { buildCat, buildClicker, buildMovement } from '@scratch-agent/ir'

import {
  buildAsker,
  buildClock,
  buildGlider,
  buildRelay,
  buildSayer,
  buildWaitTimer,
} from './fixtures.js'
import { relayMovementSpec } from './repair-specs.js'
import type { TestCase } from './test.js'

// clicker: green flag zeroes score; each sprite click increments it
const clicker: TestCase = {
  name: 'clicker: clicking the sprite increments score',
  project: buildClicker(),
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'flag' },
      { do: 'clickSprite', sprite: 'Sprite1' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'click1' },
      { do: 'clickSprite', sprite: 'Sprite1' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'click2' },
    ],
  },
  asserts: [
    {
      at: 'flag',
      probe: { on: 'var', name: 'score', sprite: 'Sprite1' },
      match: { kind: 'equals', value: 0 },
    },
    {
      at: 'click1',
      probe: { on: 'var', name: 'score', sprite: 'Sprite1' },
      match: { kind: 'equals', value: 1 },
    },
    {
      at: 'click2',
      probe: { on: 'var', name: 'score', sprite: 'Sprite1' },
      match: { kind: 'equals', value: 2 },
    },
  ],
}

// movement: the right/left arrow keys nudge x by +/-10
const movement: TestCase = {
  name: 'movement: arrow keys nudge x by +/-10',
  project: buildMovement(),
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'start' },
      { do: 'tapKey', key: 'right' },
      { do: 'snapshot', label: 'right1' },
      { do: 'tapKey', key: 'right' },
      { do: 'snapshot', label: 'right2' },
      { do: 'tapKey', key: 'left' },
      { do: 'snapshot', label: 'left1' },
    ],
  },
  asserts: [
    {
      at: 'start',
      probe: { on: 'prop', sprite: 'Mover', prop: 'x' },
      match: { kind: 'equals', value: 0 },
    },
    {
      at: 'right1',
      probe: { on: 'prop', sprite: 'Mover', prop: 'x' },
      match: { kind: 'equals', value: 10 },
    },
    {
      at: 'right2',
      probe: { on: 'prop', sprite: 'Mover', prop: 'x' },
      match: { kind: 'equals', value: 20 },
    },
    {
      at: 'left1',
      probe: { on: 'prop', sprite: 'Mover', prop: 'x' },
      match: { kind: 'equals', value: 10 },
    },
  ],
}

// cat-loop: green flag -> forever move 10 advances x by 10 each tick
const catLoop: TestCase = {
  name: 'cat-loop: forever-move advances x by 10 per tick',
  project: buildCat(),
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 't1' },
      { do: 'wait', ticks: 4 },
      { do: 'snapshot', label: 't5' },
    ],
  },
  asserts: [
    {
      at: 't1',
      probe: { on: 'prop', sprite: 'Cat', prop: 'x' },
      match: { kind: 'closeTo', value: 10, eps: 0.001 },
    },
    {
      at: 't5',
      probe: { on: 'prop', sprite: 'Cat', prop: 'x' },
      match: { kind: 'closeTo', value: 50, eps: 0.001 },
    },
  ],
}

// wait-timer: a 1s wait fires at a deterministic tick & the project timer advances
const waitTimer: TestCase = {
  name: 'wait-timer: a 1s wait fires deterministically while the timer advances',
  project: buildWaitTimer(),
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 30 },
      { do: 'snapshot', label: 'mid' },
      { do: 'wait', ticks: 40 },
      { do: 'snapshot', label: 'after' },
    ],
  },
  asserts: [
    {
      at: 'mid',
      probe: { on: 'var', name: 'done', sprite: 'Waiter' },
      match: { kind: 'equals', value: 0 },
    },
    { at: 'mid', probe: { on: 'timer' }, match: { kind: 'lt', value: 1 } },
    {
      at: 'after',
      probe: { on: 'var', name: 'done', sprite: 'Waiter' },
      match: { kind: 'equals', value: 1 },
    },
    { at: 'after', probe: { on: 'timer' }, match: { kind: 'gt', value: 1 } },
  ],
}

// broadcast-relay: the sender's green-flag broadcast moves the receiver
const relay: TestCase = {
  project: buildRelay(),
  ...relayMovementSpec,
}

// say: green flag shows the speech-bubble text
const sayBubble: TestCase = {
  name: 'say: green flag shows the say text',
  project: buildSayer(),
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'said' },
    ],
  },
  asserts: [
    {
      at: 'said',
      probe: { on: 'said', sprite: 'Sayer' },
      match: { kind: 'equals', value: 'hello' },
    },
  ],
}

// ask-answer: a typed answer is captured by sensing answer
const askAnswer: TestCase = {
  name: 'ask-answer: a typed answer is captured',
  project: buildAsker(),
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'typeAnswer', text: 'Ada' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'answered' },
    ],
  },
  asserts: [
    {
      at: 'answered',
      probe: { on: 'answer' },
      match: { kind: 'equals', value: 'Ada' },
    },
  ],
}

// calendar: the sensing year is deterministic under a fixed date (2021-06-15)
const calendar: TestCase = {
  name: 'calendar: sensing year is deterministic under a fixed date',
  project: buildClock(),
  scenario: {
    fixedDateMs: 1623758400000,
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 1 },
      { do: 'snapshot', label: 'read' },
    ],
  },
  asserts: [
    {
      at: 'read',
      probe: { on: 'var', name: 'yr', sprite: 'Clock' },
      match: { kind: 'equals', value: 2021 },
    },
  ],
}

// glide: a 1s glide to x=100 progresses mid-flight & lands deterministically
const glide: TestCase = {
  name: 'glide: deterministic glide reaches x=100 over 1s',
  project: buildGlider(),
  scenario: {
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 30 },
      { do: 'snapshot', label: 'mid' },
      { do: 'wait', ticks: 50 },
      { do: 'snapshot', label: 'end' },
    ],
  },
  asserts: [
    {
      at: 'mid',
      probe: { on: 'prop', sprite: 'Glider', prop: 'x' },
      match: { kind: 'gt', value: 0 },
    },
    {
      at: 'mid',
      probe: { on: 'prop', sprite: 'Glider', prop: 'x' },
      match: { kind: 'lt', value: 100 },
    },
    {
      at: 'end',
      probe: { on: 'prop', sprite: 'Glider', prop: 'x' },
      match: { kind: 'closeTo', value: 100, eps: 0.5 },
    },
  ],
}

export const vmTestSuite: TestCase[] = [
  clicker,
  movement,
  catLoop,
  waitTimer,
  relay,
  sayBubble,
  askAnswer,
  calendar,
  glide,
]
