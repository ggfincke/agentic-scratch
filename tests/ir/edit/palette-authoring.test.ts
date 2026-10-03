// tests/ir/edit/palette-authoring.test.ts
// protect composed standard gameplay, scoped procedures & versioned refusals

import assert from 'node:assert/strict'
import test from 'node:test'
import { blankProject, ProjectIR } from '@scratch-agent/ir'
import { runScenario } from '@scratch-agent/runner'
import {
  STANDARD_AUTHORING_CATALOG_EVIDENCE_V2,
  STANDARD_AUTHORING_DESCRIPTORS_V2,
  StandardBlockLowererV2,
  applyProcedureOperationV1,
  applyBlockStructuralOperationV1,
  assertApprovedA0SemanticAuthorityV1,
  assertStandardAuthoringAuthorityV2,
  assertStandardProcedureGraphOwnershipV2,
  blockFieldFingerprintV1,
  canonicalProcedureSignatureV1,
  commitGraphAllocatorV1,
  createStandardOperationAdaptersV2,
  installGraphClosureV1,
  parseKnownProcedureMutations,
  planGraphClosureV1,
  resolveProcedureRecordV1,
  standardProcedureSignatureSha256V2,
  validateStandardClosureV2,
  validateStandardSemanticSequenceV2,
  validateStandardSemanticTreeV2,
  type DeclarationRefV1,
  type MediaRefV1,
  type OrdinarySemanticBlockTreeV1,
  type ParameterRefV1,
  type ProcedureRefV1,
  type ProcedureSignatureV1,
  type SemanticFieldValueV1,
  type SemanticInputValueV1,
  type SemanticStatementSequenceV1,
  type StandardAuthoringContextV2,
  type StandardProcedureScopeV2,
  type TopLevelScriptRootV1,
  type TargetRefV1,
} from '@scratch-agent/ir/edit'
import { resolveEditAdmissionLimits } from '@scratch-agent/sb3'

const SHA = 'a'.repeat(64)
const literal = (value: string | number | boolean): SemanticInputValueV1 => ({
  valueKind: 'literal',
  value,
})
const expression = (
  value: OrdinarySemanticBlockTreeV1
): SemanticInputValueV1 => ({ valueKind: 'block', value })
const sequence = (
  ...blocks: SemanticStatementSequenceV1['blocks']
): SemanticStatementSequenceV1 => ({ blocks })
const substack = (
  ...blocks: SemanticStatementSequenceV1['blocks']
): SemanticInputValueV1 => ({
  valueKind: 'statementSequence',
  value: sequence(...blocks),
})

function node(
  opcode: string,
  inputs: Readonly<Record<string, SemanticInputValueV1>> = {},
  fields: Readonly<Record<string, SemanticFieldValueV1>> = {}
): OrdinarySemanticBlockTreeV1
{
  return {
    nodeKind: 'ordinary',
    opcode,
    fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
    inputs: Object.entries(inputs).map(([name, value]) => ({ name, value })),
  }
}

function declaration(opId: string): DeclarationRefV1
{
  return {
    entityKind: 'declaration',
    refKind: 'created',
    opId,
    slot: { slotKind: 'fixed', name: 'declaration' },
  }
}

function param(localKey: string): SemanticInputValueV1
{
  return {
    valueKind: 'block',
    value: {
      nodeKind: 'parameterReporter',
      parameter: { refKind: 'procedureLocalParameter', localKey },
    },
  }
}

test('standard palette composes movement, keys, lists, animation, clones and recursive typed procedures in the VM', async () =>
{
  const project = blankProject()
  const actor = project.addSprite('Actor')
  const base = project.json.targets[0]!.costumes[0]!
  actor.addCostume({ ...base, name: 'idle' })
  actor.addCostume({ ...base, name: 'pose' })
  actor.addCostume({ ...base, name: 'next costume' })
  actor.addCostume({ ...base, name: '1' })
  const scoreId = project.stage!.addVariable('score', 0)
  const cloneId = project.stage!.addVariable('clones', 0)
  const costumeNamesId = project.stage!.addVariable('selectedCostumes', '')
  const historyId = actor.addList('history')
  const score = declaration('score')
  const clones = declaration('clones')
  const history = declaration('history')
  const costumeNames = declaration('selectedCostumes')
  const costume: MediaRefV1 = {
    entityKind: 'media',
    refKind: 'created',
    opId: 'pose',
    slot: { slotKind: 'fixed', name: 'media' },
  }
  const entityField = (
    value: DeclarationRefV1 | MediaRefV1
  ): SemanticFieldValueV1 => ({ valueKind: 'entity', value })
  const signature: ProcedureSignatureV1 = {
    warp: true,
    parts: [
      { kind: 'label', text: 'step' },
      {
        kind: 'parameter',
        localKey: 'amount',
        name: 'amount',
        parameterType: 'number',
        defaultValue: 0,
      },
      {
        kind: 'parameter',
        localKey: 'enabled',
        name: 'enabled',
        parameterType: 'boolean',
        defaultValue: false,
      },
    ],
  }
  const signatureHash = standardProcedureSignatureSha256V2(
    canonicalProcedureSignatureV1(signature)
  )
  const context: StandardAuthoringContextV2 = {
    resolveEntity: (request) =>
    {
      assert.equal(request.reference.refKind, 'created')
      const key =
        request.reference.refKind === 'created' ? request.reference.opId : ''
      const entries: Readonly<
        Record<string, readonly [string, string, number]>
      > = {
        score: ['score', scoreId, 0],
        clones: ['clones', cloneId, 0],
        history: ['history', historyId, 1],
        pose: ['pose', base.assetId, 1],
        next: ['next costume', base.assetId, 1],
        numeric: ['1', base.assetId, 1],
        selectedCostumes: ['selectedCostumes', costumeNamesId, 0],
      }
      const [displayName, serializedId, ownerTargetIndex] = entries[key]!
      return {
        entityKind: request.expectedEntityKind,
        entitySubtype: request.expectedEntitySubtype,
        displayName,
        serializedId,
        ownerTargetIndex,
        semanticLineageSha256: SHA,
        semanticFingerprintSha256: SHA,
      }
    },
    resolveProcedure: () => ({
      ...scope!,
      ownerTargetIndex: 1,
      semanticLineageSha256: SHA,
      semanticFingerprintSha256: SHA,
    }),
    resolveParameter: (request) =>
    {
      const ref = request.reference
      assert.equal(ref.refKind, 'created')
      const localKey =
        ref.refKind === 'created' && ref.slot.slotKind === 'parameter'
          ? ref.slot.localKey
          : ''
      return {
        ...scope!.parameters.find((x) => x.localKey === localKey)!,
        proccode: scope!.proccode,
        signatureSha256: scope!.signatureSha256,
        ownerTargetIndex: 1,
        semanticLineageSha256: SHA,
        semanticFingerprintSha256: SHA,
      }
    },
  }
  const adapters = createStandardOperationAdaptersV2(context)
  const recursiveCall = {
    nodeKind: 'procedureCall' as const,
    procedure: { refKind: 'selfProcedure' as const },
    expectedSignatureSha256: signatureHash,
    arguments: [
      {
        parameter: {
          refKind: 'procedureLocalParameter' as const,
          localKey: 'amount',
        },
        value: expression(
          node('operator_subtract', { NUM1: param('amount'), NUM2: literal(1) })
        ),
      },
      {
        parameter: {
          refKind: 'procedureLocalParameter' as const,
          localKey: 'enabled',
        },
        value: param('enabled'),
      },
    ],
  }
  const added = applyProcedureOperationV1(
    project,
    {
      targetIndex: 1,
      operation: {
        kind: 'procedure.add',
        opId: 'step',
        target: {
          entityKind: 'target',
          refKind: 'created',
          opId: 'actor',
          slot: { slotKind: 'fixed', name: 'target' },
        },
        expectedPlanningFactSetSha256: SHA,
        expectedProspectiveProcedureCollisionSetSha256: SHA,
        requireExistingProspectiveCollisionCount: 0,
        signature,
        workspace: { x: 0, y: 0 },
        body: sequence(
          node('control_if', {
            CONDITION: param('enabled'),
            SUBSTACK: substack(
              node('motion_changexby', { DX: param('amount') }),
              node(
                'data_addtolist',
                { ITEM: param('amount') },
                { LIST: entityField(history) }
              ),
              node('control_if', {
                CONDITION: expression(
                  node('operator_gt', {
                    OPERAND1: param('amount'),
                    OPERAND2: literal(1),
                  })
                ),
                SUBSTACK: substack(recursiveCall),
              })
            ),
          })
        ),
      },
    },
    { ...adapters.block, semanticAuthorityId: 'standard-v2' }
  )
  const scope: StandardProcedureScopeV2 = {
    ...canonicalProcedureSignatureV1(signature),
    signatureSha256: signatureHash,
    parameters: canonicalProcedureSignatureV1(signature).parameters.map(
      (x) => ({ ...x, argumentId: added.argumentIdByLocalKey[x.localKey]! })
    ),
  }
  assert.equal(
    validateStandardClosureV2(actor.raw.blocks, added.definitionBlockId!).ok,
    true
  )
  const procedure: ProcedureRefV1 = {
    entityKind: 'procedure',
    refKind: 'created',
    opId: 'step',
    slot: { slotKind: 'fixed', name: 'procedure' },
  }
  const parameterRef = (localKey: string): ParameterRefV1 => ({
    entityKind: 'parameter',
    refKind: 'created',
    opId: 'step',
    slot: { slotKind: 'parameter', localKey },
  })
  const call = {
    nodeKind: 'procedureCall' as const,
    procedure,
    expectedSignatureSha256: signatureHash,
    arguments: [
      { parameter: parameterRef('amount'), value: literal(3) },
      {
        parameter: parameterRef('enabled'),
        value: expression(
          node('operator_equals', {
            OPERAND1: literal('go'),
            OPERAND2: literal('go'),
          })
        ),
      },
    ],
  }
  const install = (root: TopLevelScriptRootV1) =>
  {
    const before = project.uids.snapshot()
    const first = new StandardBlockLowererV2(context).lowerTopLevelRoot(
      project,
      1,
      root,
      { x: 200, y: 0 }
    )
    const again = new StandardBlockLowererV2(context).lowerTopLevelRoot(
      project,
      1,
      root,
      { x: 200, y: 0 }
    )
    assert.deepEqual(first.blocks, again.blocks)
    assert.deepEqual(project.uids.snapshot(), before)
    const validation = validateStandardClosureV2(first.blocks, first.rootId)
    assert.deepEqual(validation.issues, [])
    installGraphClosureV1(actor.raw, first)
    commitGraphAllocatorV1(project.uids, first)
  }
  install({
    rootKind: 'eventScript',
    hat: node('control_start_as_clone'),
    body: sequence(
      node(
        'data_changevariableby',
        { VALUE: literal(1) },
        { VARIABLE: entityField(clones) }
      ),
      node('control_delete_this_clone')
    ),
  })
  install({
    rootKind: 'eventScript',
    hat: node('event_whenflagclicked'),
    body: sequence(
      node('motion_setx', { X: literal(0) }),
      node('data_deletealloflist', {}, { LIST: entityField(history) }),
      node('control_if_else', {
        CONDITION: expression(
          node('sensing_keypressed', { KEY_OPTION: literal('d') })
        ),
        SUBSTACK: substack(call),
        SUBSTACK2: substack(node('motion_setx', { X: literal(-1) })),
      }),
      node(
        'data_setvariableto',
        {
          VALUE: expression(
            node('data_lengthoflist', {}, { LIST: entityField(history) })
          ),
        },
        { VARIABLE: entityField(score) }
      ),
      node('looks_switchcostumeto', {
        COSTUME: {
          valueKind: 'entity',
          value: { ...costume, opId: 'next' },
        },
      }),
      node(
        'data_setvariableto',
        {
          VALUE: expression(node('looks_costumenumbername', {}, {
            NUMBER_NAME: { valueKind: 'enum', value: 'name' },
          })),
        },
        { VARIABLE: entityField(costumeNames) }
      ),
      node('looks_switchcostumeto', {
        COSTUME: {
          valueKind: 'entity',
          value: { ...costume, opId: 'numeric' },
        },
      }),
      node(
        'data_setvariableto',
        {
          VALUE: expression(node('operator_join', {
            STRING1: expression(node('data_variable', {}, {
              VARIABLE: entityField(costumeNames),
            })),
            STRING2: expression(node('looks_costumenumbername', {}, {
              NUMBER_NAME: { valueKind: 'enum', value: 'name' },
            })),
          })),
        },
        { VARIABLE: entityField(costumeNames) }
      ),
      node('looks_switchcostumeto', {
        COSTUME: { valueKind: 'entity', value: costume },
      }),
      node('sound_setvolumeto', { VOLUME: literal(70) }),
      node(
        'sound_changeeffectby',
        { VALUE: literal(10) },
        { EFFECT: { valueKind: 'enum', value: 'PITCH' } }
      ),
      node('control_create_clone_of', {
        CLONE_OPTION: {
          valueKind: 'special',
          value: { domain: 'targetSelector', token: 'myself' },
        },
      }),
      node('control_wait', { DURATION: literal(0.05) }),
      node(
        'control_stop',
        {},
        { STOP_OPTION: { valueKind: 'enum', value: 'other scripts in sprite' } }
      ),
      node('looks_say', {
        MESSAGE: expression(
          node('operator_join', {
            STRING1: literal('steps:'),
            STRING2: expression(
              node('data_listcontents', {}, { LIST: entityField(history) })
            ),
          })
        ),
      })
    ),
  })
  assert.equal(
    parseKnownProcedureMutations(project.json, resolveEditAdmissionLimits())
      .records.length,
    3
  )
  const argumentProbe = ProjectIR.fromProjectJsonWithUidSnapshot(
    structuredClone(project.json),
    project.assets,
    project.uids.snapshot()
  )
  const probeTarget = argumentProbe.json.targets[1]!
  const callIds = Object.keys(probeTarget.blocks).filter((id) =>
  {
    const block = probeTarget.blocks[id]!
    return !Array.isArray(block) && block.opcode === 'procedures_call'
  })
  const recursiveId = callIds.find((id) => added.createdBlockIds.includes(id))!
  const externalId = callIds.find((id) => id !== recursiveId)!
  assert.ok(recursiveId)
  assert.ok(externalId)
  const setArgument = (
    callId: string,
    localKey: string,
    value: SemanticInputValueV1
  ) =>
  {
    const block = probeTarget.blocks[callId]!
    assert.ok(!Array.isArray(block))
    const argumentId = added.argumentIdByLocalKey[localKey]!
    const ownedId = block.inputs?.[argumentId]?.[1]
    const owned = typeof ownedId === 'string'
      ? planGraphClosureV1(probeTarget, 'ownedBlock', ownedId)
      : null
    return applyProcedureOperationV1(argumentProbe, {
      targetIndex: 1,
      callBlockId: callId,
      argumentId,
      record: resolveProcedureRecordV1(argumentProbe, 1, scope.proccode),
      operation: {
        kind: 'procedure.setCallArgument',
        opId: 'replace-argument',
        procedure,
        parameter: parameterRef(localKey),
        call: {
          entityKind: 'block',
          refKind: 'created',
          opId: 'caller',
          slot: { slotKind: 'fixed', name: 'rootBlock' },
        },
        expectedInputFingerprint: SHA,
        expectedSignatureSha256: signatureHash,
        expectedPlanningFactSetSha256: SHA,
        replacedInput: owned === null
          ? { kind: 'requireNoOwnedBlock' }
          : {
              kind: 'deleteExactOwnedClosure',
              expectedClosureSha256: owned.closureSha256,
              expectedOwnedBlockCount: owned.orderedBlockIds.length,
              comments: { kind: 'rejectIfPresent' },
            },
        value,
      },
    }, {
      ...adapters.block,
      semanticAuthorityId: 'standard-v2',
      procedureScopeForBlock: (_project, _targetIndex, id) =>
        id === recursiveId ? scope : undefined,
    })
  }
  for (const [id, value] of [
    [externalId, expression(node('sensing_answer'))],
    [recursiveId, param('amount')],
  ] as const)
  {
    const before = argumentProbe.toProjectJsonText()
    const allocator = argumentProbe.uids.snapshot()
    assert.throws(() => setArgument(id, 'enabled', value), /incompatible/)
    assert.equal(argumentProbe.toProjectJsonText(), before)
    assert.deepEqual(argumentProbe.uids.snapshot(), allocator)
  }
  setArgument(externalId, 'amount', expression(node('sensing_mousedown')))
  setArgument(recursiveId, 'amount', param('enabled'))
  setArgument(externalId, 'enabled', expression(node('sensing_mousedown')))
  assertStandardProcedureGraphOwnershipV2(argumentProbe)
  assert.deepEqual(
    validateStandardClosureV2(probeTarget.blocks, added.definitionBlockId!).issues,
    []
  )
  const external = probeTarget.blocks[externalId]!
  assert.ok(!Array.isArray(external))
  const amountId = added.argumentIdByLocalKey.amount!
  const enabledId = added.argumentIdByLocalKey.enabled!
  const literalShadowId = external.inputs![amountId]![1]
  assert.equal(typeof literalShadowId, 'string')
  const literalShadow = probeTarget.blocks[literalShadowId as string]!
  assert.ok(!Array.isArray(literalShadow))
  Object.assign(literalShadow, {
    opcode: 'math_number',
    fields: { NUM: ['2'] },
    shadow: true,
  })
  external.inputs![amountId] = [1, literalShadowId as string]
  assertStandardProcedureGraphOwnershipV2(argumentProbe)
  const beforeRootShapeEdit = ProjectIR.fromProjectJsonWithUidSnapshot(
    structuredClone(argumentProbe.json),
    argumentProbe.assets,
    argumentProbe.uids.snapshot()
  )
  const enabledRoot = probeTarget.blocks[
    external.inputs![enabledId]![1] as string
  ]!
  assert.ok(!Array.isArray(enabledRoot))
  enabledRoot.opcode = 'sensing_answer'
  assert.throws(() => assertStandardProcedureGraphOwnershipV2(
    argumentProbe,
    beforeRootShapeEdit
  ), /incompatible shape/)
  const bytes = await project.toSb3()
  const trace = await runScenario(bytes, {
    seed: 1,
    maxTicks: 60,
    steps: [
      { do: 'keyDown', key: 'd' },
      { do: 'greenFlag' },
      { do: 'wait', ticks: 15 },
      { do: 'snapshot', label: 'composed' },
    ],
  })
  assert.equal(trace.ok, true, trace.errors.join('; '))
  const state = trace.snapshots[0]!
  assert.equal(state.targets.Actor?.x, 6)
  assert.equal(state.variables.score, 3)
  assert.equal(state.variables.clones, 1)
  assert.equal(state.variables.selectedCostumes, 'next costume1')
  assert.deepEqual(state.targets.Actor?.lists.history, [3, 2, 1])
  assert.equal(state.targets.Actor?.costume, 'pose')
  assert.equal(state.targets.Actor?.volume, 70)
  assert.equal(state.targets.Actor?.bubble?.text, 'steps:3 2 1')
})

test('exact sensing properties match selected VM owners and refuse names hidden by builtins', async () =>
{
  const project = blankProject()
  const stage = project.stage!
  const first = project.addSprite('First')
  const second = project.addSprite('Second')
  for (const actor of [first, second])
    actor.addCostume({ ...stage.raw.costumes[0]!, name: 'idle' })
  first.addVariable('duplicate', 11)
  const values = {
    firstScore: ['score', first.addVariable('score', 7), 1],
    secondScore: ['score', second.addVariable('score', 19), 2],
    stageVolume: ['volume', stage.addVariable('volume', 7), 0],
    stageAlias: ['background #', stage.addVariable('background #', 9), 0],
    stageOnly: ['globalScore', stage.addVariable('globalScore', 5), 0],
    stageX: ['x position', stage.addVariable('x position', 42), 0],
    firstSize: ['size', first.addVariable('size', 9), 1],
    duplicate: ['duplicate', first.addVariable('duplicate', 22), 1],
    outFirst: ['outFirst', stage.addVariable('outFirst', 0), 0],
    outSecond: ['outSecond', stage.addVariable('outSecond', 0), 0],
    outVolume: ['outVolume', stage.addVariable('outVolume', 0), 0],
    outStageX: ['outStageX', stage.addVariable('outStageX', 0), 0],
  } satisfies Record<string, readonly [string, string, number]>
  const context: StandardAuthoringContextV2 = {
    resolveEntity: (request) =>
    {
      assert.equal(request.reference.refKind, 'created')
      const key =
        request.reference.refKind === 'created' ? request.reference.opId : ''
      const selected =
        request.expectedEntityKind === 'target'
          ? key === 'first'
            ? (['First', 'target:1', 1] as const)
            : (['Second', 'target:2', 2] as const)
          : values[key as keyof typeof values]
      assert.ok(selected)
      return {
        entityKind: request.expectedEntityKind,
        entitySubtype: request.expectedEntitySubtype,
        displayName: selected[0],
        serializedId: selected[1],
        ownerTargetIndex: selected[2],
        semanticLineageSha256: SHA,
        semanticFingerprintSha256: SHA,
      }
    },
  }
  const compiler = new StandardBlockLowererV2(context)
  const actor = (opId: string): SemanticInputValueV1 => ({
    valueKind: 'entity',
    value: {
      entityKind: 'target',
      refKind: 'created',
      opId,
      slot: { slotKind: 'fixed', name: 'target' },
    } satisfies TargetRefV1,
  })
  const stageSelector: SemanticInputValueV1 = {
    valueKind: 'special',
    value: { domain: 'targetSelector', token: 'stage' },
  }
  const field = (key: keyof typeof values): SemanticFieldValueV1 => ({
    valueKind: 'entity',
    value: declaration(key),
  })
  const sensing = (
    object: SemanticInputValueV1,
    property: SemanticFieldValueV1
  ) => node('sensing_of', { OBJECT: object }, { PROPERTY: property })
  const before = project.toProjectJsonText()
  const allocator = project.uids.snapshot()
  for (const [object, property] of [
    [stageSelector, field('stageVolume')],
    [stageSelector, field('stageAlias')],
    [actor('first'), field('firstSize')],
    [actor('first'), field('duplicate')],
    [actor('first'), field('stageOnly')],
    [actor('first'), field('secondScore')],
    [stageSelector, { valueKind: 'enum', value: 'size' }],
    [
      expression(
        node('operator_join', {
          STRING1: literal('Fir'),
          STRING2: literal('st'),
        })
      ),
      field('firstScore'),
    ],
  ] as const)
  {
    assert.throws(
      () =>
        compiler.lowerReplacement(project, 0, {
          replacementKind: 'expression',
          value: sensing(object, property),
        }),
      /property|target|builtin|ambiguous|unique/u
    )
    assert.equal(project.toProjectJsonText(), before)
    assert.deepEqual(project.uids.snapshot(), allocator)
  }
  const assign = (
    output: keyof typeof values,
    object: SemanticInputValueV1,
    property: SemanticFieldValueV1
  ) =>
    node(
      'data_setvariableto',
      {
        VALUE: expression(sensing(object, property)),
      },
      { VARIABLE: field(output) }
    )
  const closure = compiler.lowerTopLevelRoot(
    project,
    0,
    {
      rootKind: 'eventScript',
      hat: node('event_whenflagclicked'),
      body: sequence(
        assign('outFirst', actor('first'), field('firstScore')),
        assign('outSecond', actor('second'), field('secondScore')),
        assign('outVolume', stageSelector, {
          valueKind: 'enum',
          value: 'volume',
        }),
        assign('outStageX', stageSelector, field('stageX'))
      ),
    },
    { x: 0, y: 0 }
  )
  assert.deepEqual(
    validateStandardClosureV2(closure.blocks, closure.rootId).issues,
    []
  )
  installGraphClosureV1(stage.raw, closure)
  commitGraphAllocatorV1(project.uids, closure)
  const trace = await runScenario(await project.toSb3(), {
    seed: 1,
    maxTicks: 10,
    steps: [
      { do: 'greenFlag' },
      { do: 'wait', ticks: 3 },
      { do: 'snapshot', label: 'selected-properties' },
    ],
  })
  assert.equal(trace.ok, true, trace.errors.join('; '))
  const variables = trace.snapshots[0]!.variables
  assert.equal(variables.outFirst, 7)
  assert.equal(variables.outSecond, 19)
  assert.equal(variables.outVolume, 100)
  assert.equal(variables.outStageX, 42)
  assert.equal(variables.volume, 7)
})

test('standard authority preserves A0 and refuses invalid scope, continuation and opaque graphs', () =>
{
  assertApprovedA0SemanticAuthorityV1()
  assertStandardAuthoringAuthorityV2()
  assert.equal(
    STANDARD_AUTHORING_CATALOG_EVIDENCE_V2.publicCoreOpcodeCount,
    121
  )
  assert.equal(
    STANDARD_AUTHORING_CATALOG_EVIDENCE_V2.publicExtensionOpcodeCount,
    20
  )
  assert.ok(
    STANDARD_AUTHORING_DESCRIPTORS_V2.some(
      (x) => x.opcode === 'videoSensing_videoOn'
    )
  )
  assert.ok(
    STANDARD_AUTHORING_DESCRIPTORS_V2.filter(
      (x) => x.shape === 'menuReporter'
    ).every((x) => x.availability === 'builderOnly')
  )
  const project = blankProject()
  const actor = project.addSprite('Actor')
  project.addSprite('_mouse_')
  const base = project.stage!.raw.costumes[0]!
  for (const name of ['duplicate', 'duplicate', 'next costume'])
    actor.addCostume({ ...base, name })
  project.stage!.addCostume({ ...base, name: 'next backdrop' })
  const exactTarget: TargetRefV1 = {
    entityKind: 'target',
    refKind: 'created',
    opId: 'reserved-sprite',
    slot: { slotKind: 'fixed', name: 'target' },
  }
  const exactMedia: MediaRefV1 = {
    entityKind: 'media',
    refKind: 'created',
    opId: 'duplicate-costume',
    slot: { slotKind: 'fixed', name: 'media' },
  }
  const names = new StandardBlockLowererV2((request) => ({
    entityKind: request.expectedEntityKind,
    entitySubtype: request.expectedEntitySubtype,
    displayName: request.expectedEntityKind === 'target'
      ? '_mouse_'
      : 'duplicate',
    serializedId: request.expectedEntityKind === 'target'
      ? 'target:2'
      : base.assetId,
    ownerTargetIndex: request.expectedEntityKind === 'target' ? 2 : 1,
    semanticLineageSha256: SHA,
    semanticFingerprintSha256: SHA,
  }))
  const beforeNames = project.toProjectJsonText()
  const beforeNameAllocator = project.uids.snapshot()
  for (const [tree, message] of [
    [node('motion_goto', {
      TO: { valueKind: 'entity', value: exactTarget },
    }), /special runtime selector/],
    [node('looks_switchcostumeto', {
      COSTUME: { valueKind: 'entity', value: exactMedia },
    }), /ambiguous/],
    [node('looks_switchcostumeto', {
      COSTUME: {
        valueKind: 'special',
        value: { domain: 'costumeSelector', token: 'next' },
      },
    }), /captured/],
    [node('looks_switchbackdropto', {
      BACKDROP: {
        valueKind: 'special',
        value: { domain: 'backdropSelector', token: 'next' },
      },
    }), /captured/],
  ] as const)
  {
    assert.throws(() => names.lowerStatementSequence(project, 1,
      sequence(tree)), message)
    assert.equal(project.toProjectJsonText(), beforeNames)
    assert.deepEqual(project.uids.snapshot(), beforeNameAllocator)
  }
  const lowerer = new StandardBlockLowererV2(() =>
    assert.fail('no entity resolution expected')
  )
  assert.throws(
    () =>
      lowerer.lowerTopLevelRoot(
        project,
        0,
        {
          rootKind: 'statementSequence',
          value: sequence(node('motion_setx', { X: literal(1) })),
        },
        { x: 0, y: 0 }
      ),
    /target kind/
  )
  assert.throws(
    () =>
      lowerer.lowerReplacement(project, 1, {
        replacementKind: 'expression',
        value: {
          nodeKind: 'parameterReporter',
          parameter: { refKind: 'procedureLocalParameter', localKey: 'amount' },
        },
      }),
    /scope/
  )
  assert.ok(
    validateStandardSemanticSequenceV2(
      sequence(
        node(
          'control_stop',
          {},
          { STOP_OPTION: { valueKind: 'enum', value: 'this script' } }
        ),
        node('looks_show')
      )
    ).issues.some((x) => x.code === 'sequence-terminal')
  )
  const scope: StandardProcedureScopeV2 = {
    proccode: 'go',
    signatureSha256: SHA,
    warp: false,
    parameters: [],
  }
  assert.throws(
    () =>
      new StandardBlockLowererV2({
        resolveEntity: () => assert.fail(),
        procedureScope: scope,
      }).lowerStatementSequence(
        project,
        1,
        sequence({
          nodeKind: 'procedureCall',
          procedure: { refKind: 'selfProcedure' },
          expectedSignatureSha256: 'b'.repeat(64),
          arguments: [],
        })
      ),
    /signature/
  )
  const root = lowerer.lowerTopLevelRoot(
    project,
    1,
    {
      rootKind: 'statementSequence',
      value: sequence(
        node('videoSensing_videoToggle', { VIDEO_STATE: literal('off') }),
        node('pen_setPenColorToColor', { COLOR: literal('#123456') }),
        node('music_setInstrument', { INSTRUMENT: literal(2) }),
        node('music_playNoteForBeats', {
          NOTE: literal(60),
          BEATS: literal(0.25),
        })
      ),
    },
    { x: 0, y: 0 }
  )
  assert.deepEqual(
    validateStandardClosureV2(root.blocks, root.rootId).issues,
    []
  )
  const opaque = structuredClone(root.blocks)
  Object.assign(opaque[root.rootId]!, {
    mutation: { tagName: 'mutation', children: [], unsafe: true },
  })
  assert.equal(
    validateStandardClosureV2(opaque, root.rootId).safeForStructuralEdit,
    false
  )
  const adapters = createStandardOperationAdaptersV2(() =>
    assert.fail('no references expected')
  )
  const installStop = (option: string, withSuccessor: boolean) =>
  {
    const stop = node(
      'control_stop',
      {},
      { STOP_OPTION: { valueKind: 'enum', value: option } }
    )
    const lowered = lowerer.lowerTopLevelRoot(
      project,
      1,
      {
        rootKind: 'statementSequence',
        value: sequence(stop, ...(withSuccessor ? [node('looks_show')] : [])),
      },
      { x: 400, y: 0 }
    )
    installGraphClosureV1(project.json.targets[1]!, lowered)
    commitGraphAllocatorV1(project.uids, lowered)
    return lowered.rootId
  }
  const changeStop = (blockId: string, option: string) =>
  {
    const block = project.json.targets[1]!.blocks[blockId]!
    assert.ok(!Array.isArray(block))
    return applyBlockStructuralOperationV1(
      project,
      {
        targetIndex: 1,
        blockId,
        operation: {
          kind: 'block.setField',
          opId: 'stop-field',
          block: {
            entityKind: 'block',
            refKind: 'created',
            opId: 'stop',
            slot: { slotKind: 'fixed', name: 'rootBlock' },
          },
          fieldName: 'STOP_OPTION',
          value: { valueKind: 'enum', value: option },
          expectedValueFingerprint: blockFieldFingerprintV1(
            1,
            blockId,
            'STOP_OPTION',
            block.fields?.STOP_OPTION
          ),
          expectedPlanningFactSetSha256: SHA,
        },
      },
      adapters.block
    )
  }
  const terminating = installStop('all', false)
  changeStop(terminating, 'other scripts in sprite')
  const changed = project.json.targets[1]!.blocks[terminating]!
  assert.ok(!Array.isArray(changed))
  assert.equal(changed.mutation?.hasnext, 'true')
  const continuing = installStop('other scripts in sprite', true)
  const beforeRefusal = project.toProjectJsonText()
  assert.throws(() => changeStop(continuing, 'this script'), /successor/)
  assert.equal(project.toProjectJsonText(), beforeRefusal)
  assert.ok(
    validateStandardSemanticTreeV2({
      nodeKind: 'ordinary',
      opcode: 'looks_show',
    } as OrdinarySemanticBlockTreeV1).issues.length > 0
  )
})
