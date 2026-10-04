// packages/mcp/src/development/resources.ts
// resolve catalogue-owned development evidence using bounded chunk selections

export const DEVELOPMENT_ARTIFACT_URI_PREFIX_V1 = 'scratch-development://'

export function developmentArtifactUriV1(
  sessionId: string,
  key: string,
  offset = 0,
  read?: 'snapshot-v1'
)
{
  return `${DEVELOPMENT_ARTIFACT_URI_PREFIX_V1}${sessionId}/artifact?key=${encodeURIComponent(key)}&offset=${offset}${read ? `&read=${read}` : ''}`
}

export function developmentResourceSelectionV1(uri: string)
{
  const parsed = new URL(uri)
  const key = parsed.searchParams.get('key')
  const offset = Number(parsed.searchParams.get('offset') ?? '0')
  const read = parsed.searchParams.get('read') ?? undefined
  const token = parsed.searchParams.get('token') ?? undefined
  if (
    parsed.protocol !== 'scratch-development:' ||
    parsed.pathname !== '/artifact' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
      parsed.hostname
    ) ||
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
    throw new Error('invalid development artifact resource selection')
  return { sessionId: parsed.hostname, key, offset, read, token }
}

export function developmentResourceReferencesV1(value: unknown): unknown
{
  if (Array.isArray(value)) return value.map(developmentResourceReferencesV1)
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  const mapped = Object.fromEntries(
    Object.entries(object).map(([key, item]) => [
      key,
      developmentResourceReferencesV1(item),
    ])
  )
  if (
    typeof object.sessionId === 'string' &&
    typeof object.key === 'string' &&
    typeof object.sha256 === 'string' &&
    typeof object.byteLength === 'number'
  )
  {
    mapped.uri = developmentArtifactUriV1(object.sessionId, object.key)
    mapped.snapshotUri = developmentArtifactUriV1(
      object.sessionId,
      object.key,
      0,
      'snapshot-v1'
    )
  }
  return mapped
}
