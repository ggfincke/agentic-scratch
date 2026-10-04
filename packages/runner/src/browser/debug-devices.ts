// packages/runner/src/browser/debug-devices.ts
// allow camera & microphone only after an explicit human browser permission action

export function installDebugDevicePolicyV1(): { enableFromHuman(): void }
{
  let permitted = false
  const media = navigator.mediaDevices
  const original = media?.getUserMedia.bind(media)
  if (media && original)
  {
    media.getUserMedia = async (constraints) =>
    {
      if (!permitted)
        throw new DOMException(
          'camera & microphone require the playtest permission button',
          'NotAllowedError'
        )
      return await original(constraints)
    }
    media.getDisplayMedia = async () =>
    {
      throw new DOMException('screen capture is unavailable', 'NotAllowedError')
    }
  }
  return {
    enableFromHuman()
    {
      permitted = true
    },
  }
}
