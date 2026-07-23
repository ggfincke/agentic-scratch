// packages/mcp/src/transport/paths.ts
// enforce configured real roots for selected inputs, artifacts, & exports

import { LOWERCASE_SHA256_PATTERN } from '../internal/sha256-pattern.js'

import { createHash } from 'node:crypto'

import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  statSync,
  type BigIntStats,
} from 'node:fs'
import {
  basename,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'

import { DEFAULT_SB3_LIMITS } from '@scratch-agent/sb3'
import { canonicalJsonBytesV1 } from '@scratch-agent/sb3/canonical-json'
import { isPathWithinRootV1 } from '@scratch-agent/eval'

import { RepairMcpBoundaryError } from './errors.js'

export const MAX_INPUT_BYTES = DEFAULT_SB3_LIMITS.maxCompressedBytes

export interface SelectedMcpInput
{
  bytes: Uint8Array
  displayName: string
  sha256: string
  byteLength: number
  provenance: SelectedInputHostProvenanceV1
}

export interface SelectedInputHostProvenanceV1
{
  kind: 'projectSession'
  selectedPath: string
  canonicalPath: string
  device: string
  inode: string
  byteLength: number
  modifiedAtNanoseconds: string
  sha256: string
}

export interface RegisteredTemplateHostProvenanceV1
{
  kind: 'registeredTemplate'
  registryEntryId: string
  templateId: string
  templateVersion: number
  templateArtifactSha256: string
}

export type EditSourceHostProvenanceV1 =
  SelectedInputHostProvenanceV1 | RegisteredTemplateHostProvenanceV1

export function defineRegisteredTemplateHostProvenanceV1(
  input: Omit<RegisteredTemplateHostProvenanceV1, 'kind'>
): RegisteredTemplateHostProvenanceV1
{
  if (
    typeof input.registryEntryId !== 'string' ||
    input.registryEntryId.length === 0 ||
    input.registryEntryId.includes('\0') ||
    typeof input.templateId !== 'string' ||
    input.templateId.length === 0 ||
    input.templateId.includes('\0') ||
    !Number.isSafeInteger(input.templateVersion) ||
    input.templateVersion < 1 ||
    !LOWERCASE_SHA256_PATTERN.test(input.templateArtifactSha256)
  )
  {
    throw new TypeError('registered template provenance is invalid')
  }
  return Object.freeze({
    kind: 'registeredTemplate',
    registryEntryId: input.registryEntryId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    templateArtifactSha256: input.templateArtifactSha256,
  })
}

export type SelectedInputProvenanceRecheckV1 =
  | {
      ok: true
      provenance: SelectedInputHostProvenanceV1
    }
  | {
      ok: false
      reason: 'missing' | 'changed'
      provenance: SelectedInputHostProvenanceV1 | null
    }

export interface RepairMcpPathConfig
{
  inputRoot: string
  outputRoot: string
  artifactRoot: string
  inputLexicalRoot?: string
  outputLexicalRoot?: string
  artifactLexicalRoot?: string
}

export interface RepairMcpPaths
{
  inputRoot: string
  outputRoot: string
  artifactRoot: string
  inputLexicalRoot: string
  outputLexicalRoot: string
  artifactLexicalRoot: string
  readonly rootAuthorities: {
    readonly input: ProtectedMcpRootAuthorityV1
    readonly output: ProtectedMcpRootAuthorityV1
    readonly artifact: ProtectedMcpRootAuthorityV1
  }
}

export type ProtectedMcpRootRoleV1 =
  'input' | 'asset-input' | 'output' | 'edit-private' | 'readable-artifact'

export interface ProtectedMcpRootAuthorityV1
{
  readonly schemaVersion: 1
  readonly role: ProtectedMcpRootRoleV1
  readonly lexicalRoot: string
  readonly canonicalRoot: string
  readonly device: string
  readonly inode: string
  readonly mode: string
  readonly uid: string
  readonly ownershipSha256: string
}

export interface EditMcpProtectedRootConfigV1
{
  readonly inputRoot: string
  readonly assetInputRoot: string
  readonly outputRoot: string
  readonly editPrivateRoot: string
  readonly readableArtifactRoot: string
}

export interface EditMcpProtectedRootsV1
{
  readonly input: ProtectedMcpRootAuthorityV1
  readonly assetInput: ProtectedMcpRootAuthorityV1
  readonly output: ProtectedMcpRootAuthorityV1
  readonly editPrivate: ProtectedMcpRootAuthorityV1
  readonly readableArtifact: ProtectedMcpRootAuthorityV1
}

function rootOwnershipSha256(
  role: ProtectedMcpRootRoleV1,
  canonicalRoot: string,
  device: string,
  inode: string,
  mode: string,
  uid: string
): string
{
  return createHash('sha256')
    .update('scratch-agent:mcp-protected-root:v1', 'utf8')
    .update(Buffer.from([0]))
    .update(
      canonicalJsonBytesV1({
        schemaVersion: 1,
        role,
        canonicalRoot,
        device,
        inode,
        mode,
        uid,
      })
    )
    .digest('hex')
}

function rootPath(
  value: string,
  name: string,
  role: ProtectedMcpRootRoleV1
): ProtectedMcpRootAuthorityV1
{
  if (typeof value !== 'string' || !isAbsolute(value))
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      `${name} must be configured as an absolute existing directory`
    )
  }
  try
  {
    const lexicalRoot = resolve(value)
    const lexicalInfo = lstatSync(lexicalRoot, { bigint: true })
    if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isDirectory())
      throw new Error('not a no-follow directory')
    const canonicalRoot = realpathSync(lexicalRoot)
    const canonicalInfo = statSync(canonicalRoot, { bigint: true })
    if (
      !canonicalInfo.isDirectory() ||
      canonicalInfo.dev !== lexicalInfo.dev ||
      canonicalInfo.ino !== lexicalInfo.ino
    )
      throw new Error('directory identity changed')
    const device = canonicalInfo.dev.toString()
    const inode = canonicalInfo.ino.toString()
    const mode = (canonicalInfo.mode & 0o7777n).toString(8)
    const uid = canonicalInfo.uid.toString()
    return Object.freeze({
      schemaVersion: 1,
      role,
      lexicalRoot,
      canonicalRoot,
      device,
      inode,
      mode,
      uid,
      ownershipSha256: rootOwnershipSha256(
        role,
        canonicalRoot,
        device,
        inode,
        mode,
        uid
      ),
    })
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-invalid',
      `${name} must be configured as an absolute existing directory`
    )
  }
}

export function recheckProtectedMcpRootV1(
  authority: ProtectedMcpRootAuthorityV1
): void
{
  try
  {
    const expectedOwnership = rootOwnershipSha256(
      authority.role,
      authority.canonicalRoot,
      authority.device,
      authority.inode,
      authority.mode,
      authority.uid
    )
    if (expectedOwnership !== authority.ownershipSha256)
      throw new Error('ownership digest changed')
    const lexicalInfo = lstatSync(authority.lexicalRoot, { bigint: true })
    if (lexicalInfo.isSymbolicLink() || !lexicalInfo.isDirectory())
      throw new Error('root is not a no-follow directory')
    const canonicalRoot = realpathSync(authority.lexicalRoot)
    const canonicalInfo = statSync(canonicalRoot, { bigint: true })
    if (
      canonicalRoot !== authority.canonicalRoot ||
      !canonicalInfo.isDirectory() ||
      canonicalInfo.dev.toString() !== authority.device ||
      canonicalInfo.ino.toString() !== authority.inode ||
      (canonicalInfo.mode & 0o7777n).toString(8) !== authority.mode ||
      canonicalInfo.uid.toString() !== authority.uid ||
      canonicalInfo.dev !== lexicalInfo.dev ||
      canonicalInfo.ino !== lexicalInfo.ino
    )
      throw new Error('root identity changed')
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-changed',
      `${authority.role} root identity changed after startup`
    )
  }
}

export function assertProtectedMcpRootsDisjointV1(
  authorities: readonly ProtectedMcpRootAuthorityV1[]
): void
{
  const roles = new Set<ProtectedMcpRootRoleV1>()
  for (const authority of authorities)
  {
    if (roles.has(authority.role))
    {
      throw new RepairMcpBoundaryError(
        'mcp.root-role-duplicate',
        `protected root role ${authority.role} is configured more than once`
      )
    }
    roles.add(authority.role)
    recheckProtectedMcpRootV1(authority)
  }
  for (let leftIndex = 0; leftIndex < authorities.length; leftIndex++)
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < authorities.length;
      rightIndex++
    )
    {
      const left = authorities[leftIndex]!
      const right = authorities[rightIndex]!
      if (
        (left.device === right.device && left.inode === right.inode) ||
        isPathWithinRootV1(left.canonicalRoot, right.canonicalRoot) ||
        isPathWithinRootV1(right.canonicalRoot, left.canonicalRoot)
      )
      {
        throw new RepairMcpBoundaryError(
          'mcp.root-overlap',
          `${left.role} and ${right.role} roots must be disjoint`
        )
      }
    }
}

function requireWithin(root: string, candidate: string, code: string): void
{
  if (!isPathWithinRootV1(root, candidate))
  {
    throw new RepairMcpBoundaryError(
      code,
      'path is outside the configured root'
    )
  }
}

function rejectSymlinkComponents(
  root: string,
  candidate: string,
  code: string
): void
{
  const rel = relative(root, candidate)
  if (rel === '') return
  let cursor = root
  for (const part of rel.split(/[\\/]+/))
  {
    cursor = join(cursor, part)
    try
    {
      if (lstatSync(cursor).isSymbolicLink())
      {
        throw new RepairMcpBoundaryError(
          code,
          'symlink path components are not allowed'
        )
      }
    }
    catch (error)
    {
      if (error instanceof RepairMcpBoundaryError) throw error
      throw new RepairMcpBoundaryError(code, 'path does not exist')
    }
  }
}

function absoluteToolPath(value: unknown, code: string): string
{
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0'))
  {
    throw new RepairMcpBoundaryError(code, 'path must be absolute')
  }
  return resolve(value)
}

function readBoundedDescriptor(
  descriptor: number,
  maximumByteLength: number
): Buffer
{
  const bytes = Buffer.alloc(maximumByteLength + 1)
  let offset = 0
  while (offset < bytes.byteLength)
  {
    const count = readSync(
      descriptor,
      bytes,
      offset,
      bytes.byteLength - offset,
      null
    )
    if (count === 0) break
    offset += count
  }
  return bytes.subarray(0, offset)
}

export function configureRepairMcpPaths(
  config: RepairMcpPathConfig
): RepairMcpPaths
{
  const configuredRoot = (
    canonicalRoot: string,
    lexicalRoot: string | undefined,
    name: string,
    role: ProtectedMcpRootRoleV1
  ): ProtectedMcpRootAuthorityV1 =>
  {
    const authority = rootPath(lexicalRoot ?? canonicalRoot, name, role)
    if (
      lexicalRoot !== undefined &&
      resolve(canonicalRoot) !== authority.canonicalRoot
    )
    {
      throw new RepairMcpBoundaryError(
        'mcp.root-invalid',
        `${name} canonical authority differs from its lexical root`
      )
    }
    return authority
  }
  const input = configuredRoot(
    config.inputRoot,
    config.inputLexicalRoot,
    'inputRoot',
    'input'
  )
  const output = configuredRoot(
    config.outputRoot,
    config.outputLexicalRoot,
    'outputRoot',
    'output'
  )
  const artifact = configuredRoot(
    config.artifactRoot,
    config.artifactLexicalRoot,
    'artifactRoot',
    'readable-artifact'
  )
  assertProtectedMcpRootsDisjointV1([input, output, artifact])
  return Object.freeze({
    inputRoot: input.canonicalRoot,
    outputRoot: output.canonicalRoot,
    artifactRoot: artifact.canonicalRoot,
    inputLexicalRoot: input.lexicalRoot,
    outputLexicalRoot: output.lexicalRoot,
    artifactLexicalRoot: artifact.lexicalRoot,
    rootAuthorities: Object.freeze({ input, output, artifact }),
  })
}

export function configureEditMcpProtectedRootsV1(
  config: EditMcpProtectedRootConfigV1
): EditMcpProtectedRootsV1
{
  const input = rootPath(config.inputRoot, 'inputRoot', 'input')
  const assetInput = rootPath(
    config.assetInputRoot,
    'assetInputRoot',
    'asset-input'
  )
  const output = rootPath(config.outputRoot, 'outputRoot', 'output')
  const editPrivate = rootPath(
    config.editPrivateRoot,
    'editPrivateRoot',
    'edit-private'
  )
  const readableArtifact = rootPath(
    config.readableArtifactRoot,
    'readableArtifactRoot',
    'readable-artifact'
  )
  assertProtectedMcpRootsDisjointV1([
    input,
    assetInput,
    output,
    editPrivate,
    readableArtifact,
  ])
  return Object.freeze({
    input,
    assetInput,
    output,
    editPrivate,
    readableArtifact,
  })
}

export const MAX_PROTECTED_MCP_FILE_BYTES = 25 * 1024 * 1024

export interface ProtectedMcpFileEvidenceV1
{
  readonly schemaVersion: 1
  readonly rootRole: ProtectedMcpRootRoleV1
  readonly rootOwnershipSha256: string
  readonly canonicalPathSha256: string
  readonly device: string
  readonly inode: string
  readonly modifiedAtNanoseconds: string
  readonly byteLength: number
  readonly contentSha256: string
  readonly hostEvidenceSha256: string
}

export interface ProtectedMcpFileReadV1
{
  readonly bytes: Uint8Array
  readonly byteLength: number
  readonly sha256: string
  readonly evidence: ProtectedMcpFileEvidenceV1
}

export function readProtectedMcpFileV1(
  authority: ProtectedMcpRootAuthorityV1,
  value: unknown,
  maximumByteLength: number = MAX_PROTECTED_MCP_FILE_BYTES
): ProtectedMcpFileReadV1
{
  if (
    !Number.isSafeInteger(maximumByteLength) ||
    maximumByteLength < 1 ||
    maximumByteLength > MAX_PROTECTED_MCP_FILE_BYTES
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.protected-file-bound-invalid',
      `protected file read bound must be at most ${MAX_PROTECTED_MCP_FILE_BYTES}`
    )
  }
  recheckProtectedMcpRootV1(authority)
  const path = absoluteToolPath(value, 'mcp.protected-file-path-invalid')
  const lexicalRoot = selectedLexicalRoot(
    authority.lexicalRoot,
    authority.canonicalRoot,
    path,
    'mcp.protected-file-outside-root'
  )
  rejectSymlinkComponents(lexicalRoot, path, 'mcp.protected-file-symlink')
  let descriptor: number | null = null
  try
  {
    descriptor = openSync(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const info = fstatSync(descriptor, { bigint: true })
    if (!info.isFile())
    {
      throw new RepairMcpBoundaryError(
        'mcp.protected-file-type-invalid',
        'protected path must name an existing regular file'
      )
    }
    if (info.size > BigInt(maximumByteLength))
    {
      throw new RepairMcpBoundaryError(
        'mcp.protected-file-too-large',
        `protected file exceeds ${maximumByteLength} bytes`
      )
    }
    const canonicalPath = realpathSync(path)
    requireWithin(
      authority.canonicalRoot,
      canonicalPath,
      'mcp.protected-file-outside-root'
    )
    const canonicalInfo = statSync(canonicalPath, { bigint: true })
    if (canonicalInfo.dev !== info.dev || canonicalInfo.ino !== info.ino)
    {
      throw new RepairMcpBoundaryError(
        'mcp.protected-file-changed',
        'protected file changed during validation'
      )
    }
    const raw = readBoundedDescriptor(descriptor, maximumByteLength)
    if (raw.byteLength > maximumByteLength)
    {
      throw new RepairMcpBoundaryError(
        'mcp.protected-file-too-large',
        `protected file exceeds ${maximumByteLength} bytes`
      )
    }
    const bytes = Uint8Array.from(raw)
    const finalInfo = fstatSync(descriptor, { bigint: true })
    const finalCanonicalPath = realpathSync(path)
    const finalCanonicalInfo = statSync(finalCanonicalPath, { bigint: true })
    if (
      !sameInputStat(info, finalInfo) ||
      finalCanonicalPath !== canonicalPath ||
      !sameInputStat(finalInfo, finalCanonicalInfo)
    )
    {
      throw new RepairMcpBoundaryError(
        'mcp.protected-file-changed',
        'protected file changed while it was being read'
      )
    }
    recheckProtectedMcpRootV1(authority)
    const contentSha256 = createHash('sha256').update(bytes).digest('hex')
    const evidenceProjection = Object.freeze({
      schemaVersion: 1 as const,
      rootRole: authority.role,
      rootOwnershipSha256: authority.ownershipSha256,
      canonicalPathSha256: createHash('sha256')
        .update(canonicalPath)
        .digest('hex'),
      device: finalInfo.dev.toString(),
      inode: finalInfo.ino.toString(),
      modifiedAtNanoseconds: finalInfo.mtimeNs.toString(),
      byteLength: bytes.byteLength,
      contentSha256,
    })
    const hostEvidenceSha256 = createHash('sha256')
      .update('scratch-agent:mcp-protected-file-evidence:v1', 'utf8')
      .update(Buffer.from([0]))
      .update(canonicalJsonBytesV1(evidenceProjection))
      .digest('hex')
    return Object.freeze({
      bytes,
      byteLength: bytes.byteLength,
      sha256: contentSha256,
      evidence: Object.freeze({
        ...evidenceProjection,
        hostEvidenceSha256,
      }),
    })
  }
  catch (error)
  {
    if (error instanceof RepairMcpBoundaryError) throw error
    throw new RepairMcpBoundaryError(
      'mcp.protected-file-missing',
      'protected path must name an existing regular file'
    )
  }
  finally
  {
    if (descriptor !== null) closeSync(descriptor)
  }
}

export function createProtectedMcpReadPortV1(
  authority: ProtectedMcpRootAuthorityV1,
  maximumByteLength: number
): {
  capability(): Promise<{
    rootRole: ProtectedMcpRootRoleV1
    rootOwnershipSha256: string
    maximumByteLength: number
    rejectsSymlinkComponents: true
    enforcesRealPathContainment: true
    rechecksRootAndFileIdentity: true
  }>
  read(absolutePath: string): Promise<ProtectedMcpFileReadV1>
}
{
  recheckProtectedMcpRootV1(authority)
  if (
    !Number.isSafeInteger(maximumByteLength) ||
    maximumByteLength < 1 ||
    maximumByteLength > MAX_PROTECTED_MCP_FILE_BYTES
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.protected-file-bound-invalid',
      `protected file read bound must be at most ${MAX_PROTECTED_MCP_FILE_BYTES}`
    )
  }
  return Object.freeze({
    capability: async () =>
    {
      recheckProtectedMcpRootV1(authority)
      return Object.freeze({
        rootRole: authority.role,
        rootOwnershipSha256: authority.ownershipSha256,
        maximumByteLength,
        rejectsSymlinkComponents: true as const,
        enforcesRealPathContainment: true as const,
        rechecksRootAndFileIdentity: true as const,
      })
    },
    read: async (absolutePath: string) =>
      readProtectedMcpFileV1(authority, absolutePath, maximumByteLength),
  })
}

function selectedLexicalRoot(
  lexicalRoot: string,
  realRoot: string,
  candidate: string,
  code: string
): string
{
  if (isPathWithinRootV1(lexicalRoot, candidate)) return lexicalRoot
  if (isPathWithinRootV1(realRoot, candidate)) return realRoot
  throw new RepairMcpBoundaryError(code, 'path is outside the configured root')
}

export function readRepairInput(
  paths: RepairMcpPaths,
  value: unknown
): Uint8Array
{
  return readSelectedInput(paths, value).bytes
}

export function readSelectedInput(
  paths: RepairMcpPaths,
  value: unknown
): SelectedMcpInput
{
  return readSelectedProjectInputV1(paths, value, 'input')
}

export interface PublishedProjectInputAuthorityV1
{
  readonly canonicalPath: string
  readonly sha256: string
  readonly byteLength: number
}

// only an exact successful publication claim opens output bytes for inspection
export function readPublishedProjectInputV1(
  paths: RepairMcpPaths,
  value: unknown,
  authority: PublishedProjectInputAuthorityV1
): SelectedMcpInput
{
  const inputPath = absoluteToolPath(value, 'mcp.input-path-invalid')
  if (inputPath !== authority.canonicalPath)
  {
    throw new RepairMcpBoundaryError(
      'mcp.input-outside-root',
      'project publication path does not match its exact retained claim'
    )
  }
  const selected = readSelectedProjectInputV1(paths, inputPath, 'output')
  if (
    selected.sha256 !== authority.sha256 ||
    selected.byteLength !== authority.byteLength
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.input-changed',
      'project publication bytes do not match their exact retained claim'
    )
  }
  return selected
}

function readSelectedProjectInputV1(
  paths: RepairMcpPaths,
  value: unknown,
  rootRole: 'input' | 'output'
): SelectedMcpInput
{
  const inputPath = absoluteToolPath(value, 'mcp.input-path-invalid')
  const selectedRoot =
    rootRole === 'input'
      ? {
          canonicalRoot: paths.inputRoot,
          lexicalRoot: paths.inputLexicalRoot,
          authority: paths.rootAuthorities.input,
        }
      : {
          canonicalRoot: paths.outputRoot,
          lexicalRoot: paths.outputLexicalRoot,
          authority: paths.rootAuthorities.output,
        }
  recheckProtectedMcpRootV1(selectedRoot.authority)
  const lexicalRoot = selectedLexicalRoot(
    selectedRoot.lexicalRoot,
    selectedRoot.canonicalRoot,
    inputPath,
    'mcp.input-outside-root'
  )
  if (extname(inputPath).toLowerCase() !== '.sb3')
  {
    throw new RepairMcpBoundaryError(
      'mcp.input-type-invalid',
      'inputPath must name an .sb3 file'
    )
  }
  rejectSymlinkComponents(lexicalRoot, inputPath, 'mcp.input-symlink')
  let descriptor: number | null = null
  try
  {
    descriptor = openSync(
      inputPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const info = fstatSync(descriptor, { bigint: true })
    if (!info.isFile())
    {
      throw new RepairMcpBoundaryError(
        'mcp.input-type-invalid',
        'inputPath must name an existing regular file'
      )
    }
    if (info.size > BigInt(MAX_INPUT_BYTES))
    {
      throw new RepairMcpBoundaryError(
        'mcp.input-too-large',
        `input artifact exceeds ${MAX_INPUT_BYTES} bytes`
      )
    }
    const realInput = realpathSync(inputPath)
    requireWithin(
      selectedRoot.canonicalRoot,
      realInput,
      'mcp.input-outside-root'
    )
    const realInfo = statSync(realInput, { bigint: true })
    if (realInfo.dev !== info.dev || realInfo.ino !== info.ino)
    {
      throw new RepairMcpBoundaryError(
        'mcp.input-changed',
        'inputPath changed during validation'
      )
    }
    const bytes = readBoundedDescriptor(descriptor, MAX_INPUT_BYTES)
    if (bytes.byteLength > MAX_INPUT_BYTES)
    {
      throw new RepairMcpBoundaryError(
        'mcp.input-too-large',
        `input artifact exceeds ${MAX_INPUT_BYTES} bytes`
      )
    }
    const selected = Uint8Array.from(bytes)
    const finalInfo = fstatSync(descriptor, { bigint: true })
    if (!sameInputStat(info, finalInfo))
    {
      throw new RepairMcpBoundaryError(
        'mcp.input-changed',
        'inputPath changed while it was being read'
      )
    }
    const finalRealInput = realpathSync(inputPath)
    const finalRealInfo = statSync(finalRealInput, { bigint: true })
    if (
      finalRealInput !== realInput ||
      !sameInputStat(finalInfo, finalRealInfo)
    )
    {
      throw new RepairMcpBoundaryError(
        'mcp.input-changed',
        'inputPath changed while it was being read'
      )
    }
    recheckProtectedMcpRootV1(selectedRoot.authority)
    const sha256 = createHash('sha256').update(selected).digest('hex')
    return {
      bytes: selected,
      displayName: basename(inputPath),
      sha256,
      byteLength: selected.byteLength,
      provenance: provenance(
        inputPath,
        realInput,
        finalInfo,
        selected.byteLength,
        sha256
      ),
    }
  }
  catch (error)
  {
    if (error instanceof RepairMcpBoundaryError) throw error
    throw new RepairMcpBoundaryError(
      'mcp.input-missing',
      'inputPath must name an existing regular file'
    )
  }
  finally
  {
    if (descriptor !== null) closeSync(descriptor)
  }
}

function sameInputStat(left: BigIntStats, right: BigIntStats): boolean
{
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs
  )
}

function provenance(
  selectedPath: string,
  canonicalPath: string,
  info: BigIntStats,
  byteLength: number,
  sha256: string
): SelectedInputHostProvenanceV1
{
  return Object.freeze({
    kind: 'projectSession',
    selectedPath,
    canonicalPath,
    device: info.dev.toString(),
    inode: info.ino.toString(),
    byteLength,
    modifiedAtNanoseconds: info.mtimeNs.toString(),
    sha256,
  })
}

function sameProvenance(
  left: SelectedInputHostProvenanceV1,
  right: SelectedInputHostProvenanceV1
): boolean
{
  return (
    left.selectedPath === right.selectedPath &&
    left.canonicalPath === right.canonicalPath &&
    left.device === right.device &&
    left.inode === right.inode &&
    left.byteLength === right.byteLength &&
    left.modifiedAtNanoseconds === right.modifiedAtNanoseconds &&
    left.sha256 === right.sha256
  )
}

export function selectedInputHostProvenanceSha256V1(
  value: SelectedInputHostProvenanceV1
): string
{
  return createHash('sha256')
    .update('scratch-agent:edit-source-host-provenance:v1', 'utf8')
    .update(Buffer.from([0]))
    .update(
      canonicalJsonBytesV1({
        kind: value.kind,
        selectedPath: value.selectedPath,
        canonicalPath: value.canonicalPath,
        device: value.device,
        inode: value.inode,
        byteLength: value.byteLength,
        modifiedAtNanoseconds: value.modifiedAtNanoseconds,
        sha256: value.sha256,
      })
    )
    .digest('hex')
}

export interface SelectedInputLeaseEvidenceV1
{
  readonly schemaVersion: 1
  readonly sourceProvenanceSha256: string
  readonly sourceContentSha256: string
  readonly sourceByteLength: number
  readonly retainedContentSha256: string
  readonly retainedByteLength: number
  readonly hostEvidenceSha256: string
}

export function selectedInputLeaseEvidenceV1(
  admitted: SelectedInputHostProvenanceV1,
  retainedBytes: Uint8Array
): SelectedInputLeaseEvidenceV1
{
  const retainedContentSha256 = createHash('sha256')
    .update(retainedBytes)
    .digest('hex')
  if (
    admitted.sha256 !== retainedContentSha256 ||
    admitted.byteLength !== retainedBytes.byteLength
  )
    throw new RepairMcpBoundaryError(
      'mcp.edit-source-lease-invalid',
      'retained source differs from its admitted identity'
    )
  const sourceProvenanceSha256 = selectedInputHostProvenanceSha256V1(admitted)
  const projection = Object.freeze({
    schemaVersion: 1 as const,
    sourceProvenanceSha256,
    sourceContentSha256: admitted.sha256,
    sourceByteLength: admitted.byteLength,
    retainedContentSha256,
    retainedByteLength: retainedBytes.byteLength,
  })
  const hostEvidenceSha256 = createHash('sha256')
    .update('scratch-agent:edit-source-lease-evidence:v1', 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalJsonBytesV1(projection))
    .digest('hex')
  return Object.freeze({ ...projection, hostEvidenceSha256 })
}

export function recheckSelectedInputLeaseEvidenceV1(
  paths: RepairMcpPaths,
  expected: SelectedInputHostProvenanceV1,
  retainedBytes: Uint8Array
): SelectedInputLeaseEvidenceV1
{
  let current: SelectedMcpInput
  try
  {
    current = readSelectedInput(paths, expected.selectedPath)
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.edit-source-lease-invalid',
      'selected source is missing or changed while its lease is held'
    )
  }
  const retainedContentSha256 = createHash('sha256')
    .update(retainedBytes)
    .digest('hex')
  if (
    !sameProvenance(expected, current.provenance) ||
    current.byteLength !== retainedBytes.byteLength ||
    current.sha256 !== retainedContentSha256
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.edit-source-lease-invalid',
      'retained source and original source provenance no longer agree'
    )
  }
  return selectedInputLeaseEvidenceV1(current.provenance, retainedBytes)
}

export function recheckSelectedInputProvenanceV1(
  paths: RepairMcpPaths,
  expected: SelectedInputHostProvenanceV1
): SelectedInputProvenanceRecheckV1
{
  let current: SelectedMcpInput
  try
  {
    current = readSelectedInput(paths, expected.selectedPath)
  }
  catch (error)
  {
    return {
      ok: false,
      reason:
        !existsSync(expected.selectedPath) ||
        (error instanceof RepairMcpBoundaryError &&
          error.code === 'mcp.input-missing')
          ? 'missing'
          : 'changed',
      provenance: null,
    }
  }
  if (!sameProvenance(expected, current.provenance))
  {
    return { ok: false, reason: 'changed', provenance: current.provenance }
  }
  return { ok: true, provenance: current.provenance }
}

export const MAX_EDIT_ASSET_INPUT_BYTES = 25 * 1024 * 1024

export interface EditAssetInputRoot
{
  assetRoot: string
  assetLexicalRoot: string
  authority: ProtectedMcpRootAuthorityV1
}

export interface EditAssetHostProvenance
{
  kind: 'assetInput'
  selectedPath: string
  canonicalPath: string
  device: string
  inode: string
  byteLength: number
  modifiedAtNanoseconds: string
  sha256: string
}

export interface EditAssetInputRead
{
  bytes: Uint8Array
  byteLength: number
  sha256: string
  provenance: EditAssetHostProvenance
}

export function editAssetHostProvenanceSha256V1(
  value: EditAssetHostProvenance
): string
{
  return createHash('sha256')
    .update('scratch-agent:edit-asset-host-provenance:v1', 'utf8')
    .update(Buffer.from([0]))
    .update(
      canonicalJsonBytesV1({
        kind: value.kind,
        selectedPath: value.selectedPath,
        canonicalPath: value.canonicalPath,
        device: value.device,
        inode: value.inode,
        byteLength: value.byteLength,
        modifiedAtNanoseconds: value.modifiedAtNanoseconds,
        sha256: value.sha256,
      })
    )
    .digest('hex')
}

export function editAssetInputRootFromAuthorityV1(
  authority: ProtectedMcpRootAuthorityV1
): EditAssetInputRoot
{
  if (authority.role !== 'asset-input')
  {
    throw new RepairMcpBoundaryError(
      'mcp.root-role-invalid',
      'asset input port requires the asset-input root authority'
    )
  }
  recheckProtectedMcpRootV1(authority)
  return Object.freeze({
    assetRoot: authority.canonicalRoot,
    assetLexicalRoot: authority.lexicalRoot,
    authority,
  })
}

export function configureEditAssetInputRoot(
  assetRoot: string
): EditAssetInputRoot
{
  const root = rootPath(assetRoot, 'assetRoot', 'asset-input')
  return editAssetInputRootFromAuthorityV1(root)
}

// same containment/symlink/inode policy the selected-input reader uses, minus
// the .sb3 extension rule; media payloads carry no required host suffix
export function readEditAssetInput(
  root: EditAssetInputRoot,
  value: unknown,
  maximumByteLength: number = MAX_EDIT_ASSET_INPUT_BYTES
): EditAssetInputRead
{
  if (
    !Number.isSafeInteger(maximumByteLength) ||
    maximumByteLength < 1 ||
    maximumByteLength > MAX_EDIT_ASSET_INPUT_BYTES
  )
  {
    throw new RepairMcpBoundaryError(
      'mcp.asset-bound-invalid',
      `asset read bound must be a positive integer at most ${MAX_EDIT_ASSET_INPUT_BYTES}`
    )
  }
  recheckProtectedMcpRootV1(root.authority)
  const assetPath = absoluteToolPath(value, 'mcp.asset-path-invalid')
  const lexicalRoot = selectedLexicalRoot(
    root.assetLexicalRoot,
    root.assetRoot,
    assetPath,
    'mcp.asset-outside-root'
  )
  rejectSymlinkComponents(lexicalRoot, assetPath, 'mcp.asset-symlink')
  let descriptor: number | null = null
  try
  {
    descriptor = openSync(
      assetPath,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
    const info = fstatSync(descriptor, { bigint: true })
    if (!info.isFile())
    {
      throw new RepairMcpBoundaryError(
        'mcp.asset-type-invalid',
        'assetPath must name an existing regular file'
      )
    }
    if (info.size > BigInt(maximumByteLength))
    {
      throw new RepairMcpBoundaryError(
        'mcp.asset-too-large',
        `asset payload exceeds ${maximumByteLength} bytes`
      )
    }
    const realAsset = realpathSync(assetPath)
    requireWithin(root.assetRoot, realAsset, 'mcp.asset-outside-root')
    const realInfo = statSync(realAsset, { bigint: true })
    if (realInfo.dev !== info.dev || realInfo.ino !== info.ino)
    {
      throw new RepairMcpBoundaryError(
        'mcp.asset-changed',
        'assetPath changed during validation'
      )
    }
    const raw = readBoundedDescriptor(descriptor, maximumByteLength)
    if (raw.byteLength > maximumByteLength)
    {
      throw new RepairMcpBoundaryError(
        'mcp.asset-too-large',
        `asset payload exceeds ${maximumByteLength} bytes`
      )
    }
    const bytes = Uint8Array.from(raw)
    const finalInfo = fstatSync(descriptor, { bigint: true })
    if (!sameInputStat(info, finalInfo))
    {
      throw new RepairMcpBoundaryError(
        'mcp.asset-changed',
        'assetPath changed while it was being read'
      )
    }
    const finalRealAsset = realpathSync(assetPath)
    const finalRealInfo = statSync(finalRealAsset, { bigint: true })
    if (
      finalRealAsset !== realAsset ||
      !sameInputStat(finalInfo, finalRealInfo)
    )
    {
      throw new RepairMcpBoundaryError(
        'mcp.asset-changed',
        'assetPath changed while it was being read'
      )
    }
    recheckProtectedMcpRootV1(root.authority)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return {
      bytes,
      byteLength: bytes.byteLength,
      sha256,
      provenance: Object.freeze({
        kind: 'assetInput',
        selectedPath: assetPath,
        canonicalPath: realAsset,
        device: finalInfo.dev.toString(),
        inode: finalInfo.ino.toString(),
        byteLength: bytes.byteLength,
        modifiedAtNanoseconds: finalInfo.mtimeNs.toString(),
        sha256,
      }),
    }
  }
  catch (error)
  {
    if (error instanceof RepairMcpBoundaryError) throw error
    throw new RepairMcpBoundaryError(
      'mcp.asset-missing',
      'assetPath must name an existing regular file'
    )
  }
  finally
  {
    if (descriptor !== null) closeSync(descriptor)
  }
}

// the edit domain receives only this narrow capability-probed surface
export function createEditAssetInputPort(
  root: EditAssetInputRoot,
  maximumAssetByteLength: number = MAX_EDIT_ASSET_INPUT_BYTES
): {
  capability(): Promise<{
    rootId: string
    rootOwnershipSha256: string
    readable: boolean
    rejectsSymlinkComponents: boolean
    enforcesRealPathContainment: boolean
    rechecksIdentityAfterRead: boolean
    maximumAssetByteLength: number
  }>
  readAsset(
    absolutePath: string,
    maximumByteLength: number
  ): Promise<EditAssetInputRead>
}
{
  recheckProtectedMcpRootV1(root.authority)
  const rootOwnershipSha256 = root.authority.ownershipSha256
  return Object.freeze({
    capability: async () =>
    {
      recheckProtectedMcpRootV1(root.authority)
      return Object.freeze({
        rootId: `asset-input-${rootOwnershipSha256.slice(0, 16)}`,
        rootOwnershipSha256,
        readable: true,
        rejectsSymlinkComponents: true,
        enforcesRealPathContainment: true,
        rechecksIdentityAfterRead: true,
        maximumAssetByteLength,
      })
    },
    readAsset: async (absolutePath: string, maximumByteLength: number) =>
      readEditAssetInput(
        root,
        absolutePath,
        Math.min(maximumByteLength, maximumAssetByteLength)
      ),
  })
}

export function resolveRepairOutput(
  paths: RepairMcpPaths,
  value: unknown
): string
{
  recheckProtectedMcpRootV1(paths.rootAuthorities.output)
  const outputPath = absoluteToolPath(value, 'mcp.output-path-invalid')
  const lexicalRoot = selectedLexicalRoot(
    paths.outputLexicalRoot,
    paths.outputRoot,
    outputPath,
    'mcp.output-outside-root'
  )
  if (extname(outputPath).toLowerCase() !== '.sb3')
  {
    throw new RepairMcpBoundaryError(
      'mcp.output-type-invalid',
      'outputPath must name an .sb3 file'
    )
  }
  try
  {
    lstatSync(outputPath)
    throw new RepairMcpBoundaryError(
      'mcp.output-exists',
      'outputPath must not already exist'
    )
  }
  catch (error)
  {
    if (error instanceof RepairMcpBoundaryError) throw error
  }
  const parent = resolve(outputPath, '..')
  requireWithin(lexicalRoot, parent, 'mcp.output-outside-root')
  rejectSymlinkComponents(lexicalRoot, parent, 'mcp.output-symlink')
  let realParent
  try
  {
    if (!statSync(parent).isDirectory()) throw new Error('not a directory')
    realParent = realpathSync(parent)
  }
  catch
  {
    throw new RepairMcpBoundaryError(
      'mcp.output-parent-invalid',
      'outputPath parent must be an existing directory'
    )
  }
  requireWithin(paths.outputRoot, realParent, 'mcp.output-outside-root')
  recheckProtectedMcpRootV1(paths.rootAuthorities.output)
  return join(realParent, basename(outputPath))
}
