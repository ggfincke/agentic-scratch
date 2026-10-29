// packages/runner/src/browser/project-parts.ts
// the project archive served in parts, each one devtools message under chromium's pipe cap

// * chromium's devtools pipe drops the connection on a message past 100 MiB, and a fulfilled body travels base64 in one
// message, so the host serves the archive in parts of PROJECT_PART_BYTES (43 MiB of base64) & the page joins them
export const PROJECT_PART_BYTES = 32 * 1024 * 1024

// the parts' index at `${url}?parts` ({byteLength, parts}), then part i at `${url}?part=i`
export async function fetchProjectParts(url: string): Promise<ArrayBuffer>
{
  const index = await fetch(`${url}?parts`)
  if (!index.ok) throw new Error(`project load failed: ${index.status}`)
  const { byteLength, parts } = (await index.json()) as {
    byteLength: number
    parts: number
  }
  const bytes = new Uint8Array(byteLength)
  let at = 0
  for (let part = 0; part < parts; part++)
  {
    const response = await fetch(`${url}?part=${part}`)
    if (!response.ok) throw new Error(`project load failed: ${response.status}`)
    const chunk = new Uint8Array(await response.arrayBuffer())
    bytes.set(chunk, at)
    at += chunk.byteLength
  }
  if (at !== byteLength)
    throw new Error(`project load failed: ${at} of ${byteLength} bytes`)
  return bytes.buffer
}
