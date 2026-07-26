// packages/eval/src/fragility-check/fragility-check.ts
// admit projects & retain bounded static fragility evidence

import { readFileSync } from 'node:fs'
import { cpus, totalmem } from 'node:os'

import { collectVersions, newRunId } from '@scratch-agent/runner'
import { admitSb3, type ProjectJson } from '@scratch-agent/sb3'
import {
  analyzeFragility,
  type FragilityAnalysis,
  type FragilityFinding,
} from '@scratch-agent/static'
import { buildIndex } from '@scratch-agent/validate'

import { sha256 } from '../core/sha256.js'
import { unknownErrorMessage } from '../core/unknown-error-message.js'
import {
  ProjectArtifactStore,
  type ProjectArtifactReference,
} from '../project-check/project-artifacts.js'
import {
  FRAGILITY_CHECK_ISSUE_CODES,
  FRAGILITY_CLAIM_SCOPE,
  MAX_COUNTER_EVIDENCE_PER_FINDING,
  MAX_EVIDENCE_PER_FINDING,
  MAX_FRAGILITY_REPORT_ARTIFACT_BYTES,
  MAX_REPORT_ADVISORIES,
  MAX_REPORT_FINDINGS,
  MAX_REPORT_TEXT_VALUE_BYTES,
  type FragilityCheckIssue,
  type FragilityCheckIssueCode,
  type FragilityCheckReport,
} from './fragility-check-contract.js'
import type { FragilityInputReadFailure } from './fragility-check-input.js'
import { writeFragilityCheckCheckpoint } from './fragility-check-report.js'

type FragilitySeverity = 'high' | 'medium' | 'low'

export interface FragilityCheckOptions
{
  input: {
    displayName: string
    bytes: Uint8Array | null
    readFailure?: FragilityInputReadFailure
  }
  runRoot: string
  failOn: FragilitySeverity | null
  probeScriptPath: string
  runId?: string
  sourceRevision?: string
}

export interface FragilityCheckResult
{
  report: FragilityCheckReport
  runRoot: string
  artifacts: ProjectArtifactReference[]
}

interface ParsedSemver
{
  major: number
  minor: number
  patch: number
  prerelease: boolean
}

interface TextProjectionStats
{
  valuesTruncated: number
  bytesOmitted: number
}

interface CachedTextProjection
{
  value: string
  truncated: boolean
  bytesOmitted: number
}

function visibleCharacter(character: string): string
{
  const codePoint = character.codePointAt(0)!
  if (character === '\r') return '\\r'
  if (character === '\n') return '\\n'
  if (character === '\t') return '\\t'
  if (
    codePoint < 0x20 ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  )
    return `\\u{${codePoint.toString(16)}}`
  return character
}

class TextProjector
{
  private readonly cacheByLimit = new Map<
    number,
    Map<string, CachedTextProjection>
  >()

  project(
    value: string,
    stats: TextProjectionStats,
    maxBytes = MAX_REPORT_TEXT_VALUE_BYTES
  ): string
  {
    let cache = this.cacheByLimit.get(maxBytes)
    if (!cache)
    {
      cache = new Map()
      this.cacheByLimit.set(maxBytes, cache)
    }
    let projected = cache.get(value)
    if (!projected)
    {
      projected = this.compute(value, maxBytes)
      cache.set(value, projected)
    }
    if (projected.truncated)
    {
      stats.valuesTruncated++
      stats.bytesOmitted += projected.bytesOmitted
    }
    return projected.value
  }

  private compute(value: string, maxBytes: number): CachedTextProjection
  {
    let fullPrefix = ''
    let fullPrefixBytes = 0
    let truncatedPrefix = ''
    let truncatedPrefixBytes = 0
    let totalBytes = 0
    for (const character of value)
    {
      const visible = visibleCharacter(character)
      const size = Buffer.byteLength(visible, 'utf-8')
      totalBytes += size
      if (fullPrefixBytes + size <= maxBytes)
      {
        fullPrefix += visible
        fullPrefixBytes += size
      }
      if (truncatedPrefixBytes + size + 3 <= maxBytes)
      {
        truncatedPrefix += visible
        truncatedPrefixBytes += size
      }
    }
    if (totalBytes <= maxBytes)
      return { value: fullPrefix, truncated: false, bytesOmitted: 0 }
    return {
      value: `${truncatedPrefix}...`,
      truncated: true,
      bytesOmitted: totalBytes - truncatedPrefixBytes,
    }
  }
}

function addTextProjectionStats(
  report: FragilityCheckReport,
  stats: TextProjectionStats
): void
{
  report.truncation.textValuesTruncated += stats.valuesTruncated
  report.truncation.textBytesOmitted += stats.bytesOmitted
}

function issue(
  report: FragilityCheckReport,
  projector: TextProjector,
  code: FragilityCheckIssueCode,
  message: string,
  stage?: string
): FragilityCheckIssue
{
  const stats: TextProjectionStats = { valuesTruncated: 0, bytesOmitted: 0 }
  const projected = {
    code,
    message: projector.project(message, stats),
    ...(stage ? { stage: projector.project(stage, stats) } : {}),
  }
  addTextProjectionStats(report, stats)
  return projected
}

function inputReadFailureMessage(
  failure: FragilityInputReadFailure | undefined
): string
{
  if (failure === 'not-regular') return 'selected input is not a regular file'
  if (failure === 'too-large')
    return 'selected input exceeds the compressed-byte limit'
  if (failure === 'changed')
    return 'selected input changed while it was being read'
  return 'selected input could not be read'
}

function initialReport(
  options: FragilityCheckOptions,
  projector: TextProjector
): FragilityCheckReport
{
  const cpu = cpus()
  const versions = collectVersions()
  const stats: TextProjectionStats = { valuesTruncated: 0, bytesOmitted: 0 }
  const report: FragilityCheckReport = {
    schemaVersion: 1,
    runId: projector.project(
      options.runId ?? `fragility-check-${newRunId()}`,
      stats
    ),
    sourceRevision: projector.project(
      options.sourceRevision ?? 'unknown',
      stats
    ),
    createdAt: new Date().toISOString(),
    completedAt: null,
    input: {
      displayName: projector.project(options.input.displayName, stats),
      sha256: null,
      byteLength: null,
    },
    host: {
      platform: process.platform,
      architecture: process.arch,
      cpuModel: projector.project(cpu[0]?.model ?? 'unknown', stats),
      logicalCpuCount: cpu.length,
      totalMemoryBytes: totalmem(),
    },
    versions: {
      node: projector.project(versions.node, stats),
      vm: projector.project(versions.vm, stats),
      scaffolding: projector.project(versions.scaffolding, stats),
      parser: projector.project(versions.parser, stats),
      jszip: projector.project(versions.jszip, stats),
      playwright: projector.project(versions.playwright, stats),
    },
    conversionProvenance: {
      semver: null,
      vm: null,
      agent: null,
      origin: null,
      inference: 'unknown',
    },
    boundaryModel: {
      pinnedVmVersion: 'unavailable',
      boundaryTableSha256: 'unavailable',
      corroboratedBy: {
        probeScriptSha256: 'unavailable',
      },
    },
    findings: [],
    advisories: [],
    signatureCoverage: [],
    truncation: {
      findingsOmitted: 0,
      advisoriesOmitted: 0,
      evidenceOmittedPerFinding: 0,
      counterEvidenceOmittedPerFinding: 0,
      textValuesTruncated: stats.valuesTruncated,
      textBytesOmitted: stats.bytesOmitted,
    },
    issues: [],
    overall: {
      status: 'failed',
      failOnSeverity: options.failOn,
      gatedFindingCount: 0,
    },
    claims: {
      proves: [
        'the listed signatures were evaluated against the admitted block graph',
        'the boundary model hash + probe hash bind the semantics used',
      ],
      doesNotProve: [
        'runtime failure or correctness',
        'anything about Scratch 2 behavior',
        'absence of fragility outside the implemented signatures',
      ],
      claimScope: FRAGILITY_CLAIM_SCOPE,
    },
  }
  return report
}

function parseSemver(value: string): ParsedSemver | null
{
  const match =
    /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
      value
    )
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] !== undefined,
  }
}

function isBeforePinnedStable(version: ParsedSemver): boolean
{
  const current = [version.major, version.minor, version.patch]
  const pinned = [0, 2, 0]
  for (let index = 0; index < current.length; index++)
  {
    if (current[index]! < pinned[index]!) return true
    if (current[index]! > pinned[index]!) return false
  }
  return false
}

function conversionProvenance(
  json: ProjectJson,
  report: FragilityCheckReport,
  projector: TextProjector
): FragilityCheckReport['conversionProvenance']
{
  const stats: TextProjectionStats = { valuesTruncated: 0, bytesOmitted: 0 }
  const semver =
    typeof json.meta.semver === 'string'
      ? projector.project(json.meta.semver, stats)
      : null
  const vm =
    typeof json.meta.vm === 'string'
      ? projector.project(json.meta.vm, stats)
      : null
  const agent =
    typeof json.meta.agent === 'string'
      ? projector.project(json.meta.agent, stats)
      : null
  const origin =
    typeof json.meta.origin === 'string'
      ? projector.project(json.meta.origin, stats)
      : null
  addTextProjectionStats(report, stats)
  const parsedVm = vm === null ? null : parseSemver(vm)
  let inference: FragilityCheckReport['conversionProvenance']['inference'] =
    'unknown'
  if (parsedVm !== null)
  {
    inference =
      isBeforePinnedStable(parsedVm) || parsedVm.prerelease
        ? 'consistent-with-conversion'
        : 'consistent-with-native-authoring'
  }
  return { semver, vm, agent, origin, inference }
}

function boundFinding(
  report: FragilityCheckReport,
  projector: TextProjector,
  finding: FragilityFinding
): FragilityFinding
{
  const stats: TextProjectionStats = { valuesTruncated: 0, bytesOmitted: 0 }
  const projected: FragilityFinding = {
    signature: finding.signature,
    class: finding.class,
    severity: finding.severity,
    confidence: finding.confidence,
    verdict: finding.verdict,
    indeterminateReason: finding.indeterminateReason,
    targetName: projector.project(finding.targetName, stats),
    topBlockId:
      finding.topBlockId === null
        ? null
        : projector.project(finding.topBlockId, stats),
    message: projector.project(finding.message, stats),
    evidence: finding.evidence
      .slice(0, MAX_EVIDENCE_PER_FINDING)
      .map((entry) => ({
        targetName: projector.project(entry.targetName, stats),
        blockId: projector.project(entry.blockId, stats),
        opcode: projector.project(entry.opcode, stats),
        role: projector.project(entry.role, stats),
        detail: projector.project(entry.detail, stats),
      })),
    counterEvidence: finding.counterEvidence
      .slice(0, MAX_COUNTER_EVIDENCE_PER_FINDING)
      .map((entry) => projector.project(entry, stats)),
  }
  addTextProjectionStats(report, stats)
  return projected
}

function maximumEvidenceOmitted(analysis: FragilityAnalysis): number
{
  return Math.max(
    0,
    ...[...analysis.findings, ...analysis.advisories].map((finding) =>
      Math.max(0, finding.evidence.length - MAX_EVIDENCE_PER_FINDING)
    )
  )
}

function maximumCounterEvidenceOmitted(analysis: FragilityAnalysis): number
{
  return Math.max(
    0,
    ...[...analysis.findings, ...analysis.advisories].map((finding) =>
      Math.max(
        0,
        finding.counterEvidence.length - MAX_COUNTER_EVIDENCE_PER_FINDING
      )
    )
  )
}

function retainAnalysis(
  report: FragilityCheckReport,
  analysis: FragilityAnalysis,
  projector: TextProjector
): void
{
  report.findings = analysis.findings
    .slice(0, MAX_REPORT_FINDINGS)
    .map((finding) => boundFinding(report, projector, finding))
  report.advisories = analysis.advisories
    .slice(0, MAX_REPORT_ADVISORIES)
    .map((finding) => boundFinding(report, projector, finding))
  report.signatureCoverage = analysis.coverage.map((coverage) => ({
    signature: coverage.signature,
    ran: coverage.ran,
    findingCount: coverage.findingCount,
    indeterminateCount: coverage.indeterminateCount,
  }))
  report.boundaryModel = {
    pinnedVmVersion: analysis.boundaryModel.pinnedVmVersion,
    boundaryTableSha256: analysis.boundaryModel.boundaryTableSha256,
    corroboratedBy: report.boundaryModel.corroboratedBy,
  }
  report.truncation = {
    findingsOmitted:
      Math.max(0, analysis.findings.length - MAX_REPORT_FINDINGS) +
      analysis.omitted.findings,
    advisoriesOmitted:
      Math.max(0, analysis.advisories.length - MAX_REPORT_ADVISORIES) +
      analysis.omitted.advisories,
    evidenceOmittedPerFinding: maximumEvidenceOmitted(analysis),
    counterEvidenceOmittedPerFinding: maximumCounterEvidenceOmitted(analysis),
    textValuesTruncated: report.truncation.textValuesTruncated,
    textBytesOmitted: report.truncation.textBytesOmitted,
  }
}

function gatedFindingCount(
  findings: FragilityFinding[],
  failOn: FragilitySeverity | null
): number
{
  if (failOn === null) return 0
  const rank: Record<FragilitySeverity, number> = {
    high: 3,
    medium: 2,
    low: 1,
  }
  return findings.filter(
    (finding) =>
      finding.class === 'flagged' &&
      finding.verdict === 'witnessed' &&
      rank[finding.severity] >= rank[failOn]
  ).length
}

function completeOverall(
  report: FragilityCheckReport,
  analysisCompleted: boolean,
  gated = gatedFindingCount(report.findings, report.overall.failOnSeverity)
): void
{
  report.overall.gatedFindingCount = gated
  report.overall.status =
    analysisCompleted && report.issues.length === 0 && gated === 0
      ? 'passed'
      : 'failed'
}

function finalize(
  report: FragilityCheckReport,
  analysisCompleted: boolean,
  gated?: number
): void
{
  completeOverall(report, analysisCompleted, gated)
  report.completedAt = new Date().toISOString()
}

function checkpoint(
  store: ProjectArtifactStore,
  report: FragilityCheckReport,
  projector: TextProjector
): boolean
{
  try
  {
    writeFragilityCheckCheckpoint(store, report)
    return true
  }
  catch
  {
    if (
      !report.issues.some(
        (entry) =>
          entry.code === FRAGILITY_CHECK_ISSUE_CODES.internalFailed &&
          entry.stage === 'report'
      )
    )
    {
      report.issues.push(
        issue(
          report,
          projector,
          FRAGILITY_CHECK_ISSUE_CODES.internalFailed,
          'fragility report checkpoint could not be written',
          'report'
        )
      )
    }
    return false
  }
}

function finalizeAndCheckpoint(
  store: ProjectArtifactStore,
  report: FragilityCheckReport,
  projector: TextProjector,
  analysisCompleted: boolean,
  gated?: number
): void
{
  finalize(report, analysisCompleted, gated)
  if (checkpoint(store, report, projector)) return
  completeOverall(report, analysisCompleted, gated)
  checkpoint(store, report, projector)
}

function result(
  report: FragilityCheckReport,
  runRoot: string,
  store: ProjectArtifactStore | null
): FragilityCheckResult
{
  const artifacts =
    store
      ?.references()
      .filter(
        (artifact) =>
          artifact.path !== 'fragility-check.json' &&
          artifact.path !== 'fragility-check.md'
      ) ?? []
  return {
    report,
    runRoot: store?.root ?? runRoot,
    artifacts,
  }
}

export async function runFragilityCheck(
  options: FragilityCheckOptions
): Promise<FragilityCheckResult>
{
  const projector = new TextProjector()
  const report = initialReport(options, projector)
  let store: ProjectArtifactStore
  try
  {
    store = new ProjectArtifactStore(options.runRoot, {
      maxBytes: MAX_FRAGILITY_REPORT_ARTIFACT_BYTES,
      requireNewRoot: true,
    })
  }
  catch
  {
    report.issues.push(
      issue(
        report,
        projector,
        FRAGILITY_CHECK_ISSUE_CODES.internalFailed,
        'fragility artifact store could not be initialized',
        'report'
      )
    )
    finalize(report, false)
    return result(report, options.runRoot, null)
  }

  if (options.input.bytes === null)
  {
    report.issues.push(
      issue(
        report,
        projector,
        FRAGILITY_CHECK_ISSUE_CODES.inputReadFailed,
        inputReadFailureMessage(options.input.readFailure),
        'input'
      )
    )
    finalizeAndCheckpoint(store, report, projector, false)
    return result(report, options.runRoot, store)
  }

  report.input.byteLength = options.input.bytes.byteLength
  report.input.sha256 = sha256(options.input.bytes)

  let json: ProjectJson
  try
  {
    const admission = await admitSb3(options.input.bytes)
    json = JSON.parse(admission.projectJsonText) as ProjectJson
  }
  catch (error)
  {
    report.issues.push(
      issue(
        report,
        projector,
        FRAGILITY_CHECK_ISSUE_CODES.admissionFailed,
        unknownErrorMessage(error),
        'admission'
      )
    )
    finalizeAndCheckpoint(store, report, projector, false)
    return result(report, options.runRoot, store)
  }

  let analysis: FragilityAnalysis
  try
  {
    report.conversionProvenance = conversionProvenance(json, report, projector)
    analysis = analyzeFragility(json, buildIndex(json))
    retainAnalysis(report, analysis, projector)
  }
  catch (error)
  {
    report.issues.push(
      issue(
        report,
        projector,
        FRAGILITY_CHECK_ISSUE_CODES.analysisFailed,
        unknownErrorMessage(error),
        'analysis'
      )
    )
    finalizeAndCheckpoint(store, report, projector, false)
    return result(report, options.runRoot, store)
  }

  try
  {
    report.boundaryModel.corroboratedBy.probeScriptSha256 = sha256(
      readFileSync(options.probeScriptPath)
    )
  }
  catch
  {
    report.issues.push(
      issue(
        report,
        projector,
        FRAGILITY_CHECK_ISSUE_CODES.internalFailed,
        'fragility probe script could not be read',
        'boundary-model'
      )
    )
  }

  const gated = gatedFindingCount(
    analysis.findings,
    report.overall.failOnSeverity
  )
  finalizeAndCheckpoint(store, report, projector, true, gated)
  return result(report, options.runRoot, store)
}
