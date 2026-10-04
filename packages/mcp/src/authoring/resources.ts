// packages/mcp/src/authoring/resources.ts
// publish bounded chunks of catalogue-owned authoring evidence as resource refs

export const AUTHORING_ARTIFACT_URI_PREFIX_V1 = 'scratch-authoring://'

export function authoringArtifactUriV1(
  workspaceId: string,
  key: string,
  offset = 0,
  read?: 'snapshot-v1'
)
{
  return `${AUTHORING_ARTIFACT_URI_PREFIX_V1}${workspaceId}/artifact?key=${encodeURIComponent(key)}&offset=${offset}${read ? `&read=${read}` : ''}`
}

export function authoringResourceSelectionV1(uri: string)
{
  const parsed = new URL(uri)
  const key = parsed.searchParams.get('key')
  const offset = Number(parsed.searchParams.get('offset') ?? '0')
  const read = parsed.searchParams.get('read') ?? undefined
  const token = parsed.searchParams.get('token') ?? undefined
  if (
    parsed.protocol !== 'scratch-authoring:' ||
    parsed.pathname !== '/artifact' ||
    !/^authoring-[a-f0-9]{32}$/u.test(parsed.hostname) ||
    !key ||
    key.length > 4096 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    [...parsed.searchParams.keys()].some(
      (name) => !['key', 'offset', 'read', 'token'].includes(name)
    ) ||
    (read !== undefined && read !== 'snapshot-v1') ||
    (token !== undefined && read !== 'snapshot-v1') ||
    (read === 'snapshot-v1' &&
      ([...parsed.searchParams.keys()].some(
        (name) => parsed.searchParams.getAll(name).length !== 1
      ) ||
        (token !== undefined && token.length > 256)))
  )
    throw new Error('invalid authoring artifact resource selection')
  return { workspaceId: parsed.hostname, key, offset, read, token }
}

export function authoringResourceReferencesV1(value: unknown): unknown
{
  if (Array.isArray(value)) return value.map(authoringResourceReferencesV1)
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  const mapped = Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      authoringResourceReferencesV1(item),
    ])
  )
  if (
    typeof object.workspaceId === 'string' &&
    typeof object.key === 'string' &&
    typeof object.sha256 === 'string' &&
    typeof object.byteLength === 'number'
  )
  {
    mapped.uri = authoringArtifactUriV1(object.workspaceId, object.key)
    mapped.snapshotUri = authoringArtifactUriV1(
      object.workspaceId,
      object.key,
      0,
      'snapshot-v1'
    )
  }
  return mapped
}
