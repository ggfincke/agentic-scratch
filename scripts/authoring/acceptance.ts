// scripts/authoring/acceptance.ts
// exercise separate CLI builds, exact exports, marked replay & retained comparison views

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import {
  createDevelopmentServiceV1,
  type DevelopmentArtifactRefV1,
  type DevelopmentOperatorPermissionsV1,
} from '@scratch-agent/runner'
import { createDevelopmentToolHostV1 } from '@scratch-agent/mcp'
import { prepareGenericAuthoringAcceptanceV1 } from './acceptance-fixture.js'

const root = resolve(
  'runs',
  `workbench-acceptance-${new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')}`
)
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex')

async function cli(
  script: string,
  args: readonly string[],
  label: string,
  input?: string
)
{
  const child = spawn(process.execPath, ['--import', 'tsx', script, ...args], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const stdout: Buffer[] = [],
    stderr: Buffer[] = []
  let size = 0
  const timer = setTimeout(() => child.kill('SIGKILL'), 180000)
  function append(target: Buffer[], raw: Buffer): void
  {
    size += raw.byteLength
    if (size > 4 * 1024 * 1024) child.kill('SIGKILL')
    else target.push(raw)
  }
  const commands = input?.trim().split('\n').filter(Boolean)
  let pendingOutput = ''
  let responses = 0
  let nextCommand = 0
  child.stdout.on('data', (value: Buffer) =>
  {
    append(stdout, value)
    if (!commands) return
    pendingOutput += value.toString('utf8')
    let newline: number
    while ((newline = pendingOutput.indexOf('\n')) >= 0)
    {
      const line = pendingOutput.slice(0, newline)
      pendingOutput = pendingOutput.slice(newline + 1)
      if (!line.trim()) continue
      responses++
      if (responses === nextCommand + 2)
      {
        if (nextCommand < commands.length)
          child.stdin.write(`${commands[nextCommand++]}\n`)
        else child.stdin.end()
      }
    }
  })
  child.stderr.on('data', (value: Buffer) => append(stderr, value))
  if (!commands) child.stdin.end()
  const status = await new Promise<number | null>((done, reject) =>
  {
    child.once('error', reject)
    child.once('close', done)
  }).finally(() => clearTimeout(timer))
  await writeFile(join(root, `${label}.stdout.jsonl`), Buffer.concat(stdout), {
    flag: 'wx',
    mode: 0o600,
  })
  await writeFile(join(root, `${label}.stderr.txt`), Buffer.concat(stderr), {
    flag: 'wx',
    mode: 0o600,
  })
  assert.equal(status, 0, `${label}: ${Buffer.concat(stderr).toString('utf8')}`)
  return Buffer.concat(stdout)
    .toString('utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

async function build(
  fixture: Awaited<ReturnType<typeof prepareGenericAuthoringAcceptanceV1>>,
  label: string
)
{
  const host = ['--host-config', fixture.hostConfigPath]
  const script = 'scripts/authoring/cli.ts'
  const opened = (
    await cli(
      script,
      ['open', ...host, '--manifest', fixture.manifestPath],
      `${label}-open`
    )
  )[0]!
  const workspaceId = String(opened.workspaceId)
  const selected = [...host, '--workspace', workspaceId]
  const planned = (
    await cli(script, ['plan', ...selected], `${label}-plan`)
  )[0]!
  const built = (
    await cli(
      script,
      ['build', ...selected, '--plan', String(planned.planId)],
      `${label}-build`
    )
  )[0]!
  const buildId = String(built.buildId)
  const evaluated = (
    await cli(
      script,
      ['evaluate', ...selected, '--build', buildId],
      `${label}-evaluate`
    )
  )[0]!
  assert.equal(
    evaluated.disposition,
    'accepted',
    JSON.stringify(evaluated.issues)
  )
  const destination = join(fixture.output, `${label}.sb3`)
  const exported = (
    await cli(
      script,
      ['export', ...selected, '--build', buildId, '--output', destination],
      `${label}-export`
    )
  )[0]!
  assert.equal(hash(await readFile(destination)), built.candidateSha256)
  assert.equal(exported.candidateSha256, built.candidateSha256)
  for (const pass of [1, 2])
  {
    const replay = (
      await cli(
        script,
        ['replay', ...selected, '--build', buildId],
        `${label}-replay-${pass}`
      )
    )[0]!
    assert.equal(replay.disposition, 'matched')
    assert.equal(replay.replayWrites, 0)
    assert.equal(replay.candidateSha256, built.candidateSha256)
  }
  return { workspaceId, buildId, destination, built, evaluated }
}

async function sourceHashes(path: string)
{
  return Promise.all(
    ['scratch-workspace.json', 'actor.png', 'player1.json', 'player2.json'].map(
      async (name) => [name, hash(await readFile(join(path, name)))]
    )
  ).then(Object.fromEntries)
}

async function main()
{
  await mkdir(root, { recursive: true, mode: 0o700 })
  const first = await prepareGenericAuthoringAcceptanceV1(join(root, 'first'))
  const second = await prepareGenericAuthoringAcceptanceV1(join(root, 'second'))
  const secondScriptPath = join(second.sources, 'player1.json')
  const secondScript = (await readFile(secondScriptPath, 'utf8')).replace(
    '"value":3',
    '"value":6'
  )
  assert.notEqual(secondScript, await readFile(secondScriptPath, 'utf8'))
  await writeFile(secondScriptPath, secondScript, { mode: 0o600 })
  const originalFirst = await sourceHashes(first.sources),
    originalSecond = await sourceHashes(second.sources)
  const firstBuild = await build(first, 'first'),
    secondBuild = await build(second, 'second')
  assert.notEqual(
    firstBuild.built.candidateSha256,
    secondBuild.built.candidateSha256
  )
  const permissions: DevelopmentOperatorPermissionsV1 = {
    sourceRoots: [first.output, first.evidence, second.output, second.evidence],
    evidenceRoot: join(root, 'development-evidence'),
  }
  await mkdir(permissions.evidenceRoot, { recursive: true, mode: 0o700 })
  const configPath = join(root, 'development-host.json')
  await writeFile(
    configPath,
    JSON.stringify({ schemaVersion: 1, permissions }),
    { flag: 'wx', mode: 0o600 }
  )
  const hostFlags = ['--host-config', configPath]
  const service = await createDevelopmentServiceV1({ permissions })
  const host = createDevelopmentToolHostV1(service)
  const sessions: string[] = [],
    reproductions: Record<string, unknown>[] = []
  for (const [label, selected, runtime, tickRate] of [
    ['official30', firstBuild, 'scratch-official', 30],
    ['turboWarp60', firstBuild, 'turbowarp', 60],
    ['comparison30', secondBuild, 'scratch-official', 30],
  ] as const)
  {
    const commands = [
      { kind: 'advance', ticks: 2 },
      { kind: 'input', input: { device: 'keyboard', key: 'd', isDown: true } },
      { kind: 'input', input: { device: 'keyboard', key: 'l', isDown: true } },
      { kind: 'advance', ticks: 4 },
      { kind: 'input', input: { device: 'keyboard', key: 'd', isDown: false } },
      { kind: 'input', input: { device: 'keyboard', key: 'l', isDown: false } },
      { kind: 'advance', ticks: 2 },
      { kind: 'mark', label: 'Two local players moved' },
      { tool: 'close' },
    ]
    const responses = await cli(
      'scripts/development/cli.ts',
      [
        'debug',
        ...hostFlags,
        '--input',
        selected.destination,
        '--profile',
        JSON.stringify({
          schemaVersion: 1,
          runtime,
          scheduler: 'deterministic',
          tickRate,
        }),
      ],
      `${label}-play`,
      commands.map((value) => JSON.stringify(value)).join('\n') + '\n'
    )
    assert.ok(responses.every((value) => value.ok !== false))
    const sessionId = String(responses[0]!.sessionId)
    const mark = responses.find((value) => typeof value.markId === 'string')!
    assert.ok(mark)
    const retained = await service.retainedTrace({ sessionId })
    assert.equal(retained.status.status, 'closed')
    const frame = retained.trace.marks[0]!.frame
    assert.equal(
      frame.targets.find((value) => value.name === 'Player1')!.x,
      label === 'comparison30' ? 24 : 12
    )
    assert.equal(frame.targets.find((value) => value.name === 'Player2')!.x, 12)
    const reproduced = (
      await cli(
        'scripts/development/cli.ts',
        [
          'reproduce',
          ...hostFlags,
          '--session',
          sessionId,
          '--mark',
          String(mark.markId),
        ],
        `${label}-reproduce`
      )
    )[0]!
    assert.equal(
      reproduced.disposition,
      'matched',
      JSON.stringify(reproduced.issues)
    )
    assert.ok((reproduced.frames as unknown[]).length > 0)
    sessions.push(sessionId)
    reproductions.push(reproduced)
  }
  const clipSource = firstBuild.built.developmentClips as {
    path: string
    sha256: string
  }
  const imported = await host.call('development_command', {
    sessionId: sessions[0],
    command: {
      kind: 'importClip',
      sourcePath: clipSource.path,
      expectedSha256: clipSource.sha256,
    },
  })
  const clipArtifact = imported.clip as DevelopmentArtifactRefV1
  assert.ok(clipArtifact?.key, JSON.stringify(imported))
  const overlays = [
    {
      id: 'player1-collision',
      label: 'Game-declared collision',
      purpose: 'declared-collision',
      kind: 'rectangle',
      x: { probe: { targetIndex: 1, property: 'x' } },
      y: { probe: { targetIndex: 1, property: 'y' } },
      width: 16,
      height: 16,
    },
  ]
  const reproductionRef = reproductions[0]!.result as DevelopmentArtifactRefV1
  const viewed = (
    await cli(
      'scripts/development/cli.ts',
      [
        'view',
        ...hostFlags,
        '--session',
        sessions[0]!,
        '--compare-session',
        sessions[2]!,
        '--overlays',
        JSON.stringify(overlays),
        '--clip-artifact',
        clipArtifact.key,
        '--reproduction-artifact',
        reproductionRef.key,
      ],
      'comparison-view'
    )
  )[0]!
  const viewer = viewed.viewer as DevelopmentArtifactRefV1
  const parts: Buffer[] = []
  let offset = 0
  for (;;)
  {
    const chunk = await service.readArtifact({
      sessionId: sessions[0]!,
      key: viewer.key,
      offset,
      maxBytes: 1024 * 1024,
    })
    parts.push(Buffer.from(chunk.bytes))
    if (chunk.nextOffset === null) break
    offset = chunk.nextOffset
  }
  const viewerBytes = Buffer.concat(parts)
  assert.equal(hash(viewerBytes), viewer.sha256)
  const viewerPath = join(root, 'comparison-view.html')
  await writeFile(viewerPath, viewerBytes, { flag: 'wx', mode: 0o600 })
  const browser = await chromium.launch({ headless: true })
  let smoke: unknown
  try
  {
    const page = await browser.newPage(),
      errors: string[] = [],
      requests: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) =>
    {
      if (/^https?:/u.test(request.url())) requests.push(request.url())
    })
    await page.goto(`file://${viewerPath}`)
    await page.locator('#history-range').waitFor()
    await page.locator('#next-frame').click()
    await page.locator('#previous-frame').click()
    await page.getByText('Animation preview', { exact: true }).waitFor()
    await page.screenshot({
      path: join(root, 'comparison-view.png'),
      fullPage: true,
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(requests, [])
    smoke = {
      errors,
      externalRequests: requests,
      heading: await page.locator('h1').textContent(),
      retainedHistory: true,
      animationPreview: true,
    }
  }
  finally
  {
    await browser.close()
    await host.closeAll?.()
  }
  assert.deepEqual(await sourceHashes(first.sources), originalFirst)
  assert.deepEqual(await sourceHashes(second.sources), originalSecond)
  const result = {
    schemaVersion: 1,
    kind: 'workbench-acceptance-v1',
    disposition: 'accepted',
    root,
    firstBuild,
    secondBuild,
    sessions,
    reproductions,
    viewer,
    smoke,
    sourcePreservation: true,
  }
  await writeFile(join(root, 'result.json'), JSON.stringify(result, null, 2), {
    flag: 'wx',
    mode: 0o600,
  })
  console.log(
    JSON.stringify({
      disposition: 'accepted',
      root,
      result: join(root, 'result.json'),
      viewer: viewerPath,
    })
  )
}

main().catch((error: unknown) =>
{
  console.error(
    JSON.stringify({
      disposition: 'failed',
      root,
      message: error instanceof Error ? error.message : String(error),
    })
  )
  process.exitCode = 1
})
