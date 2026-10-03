// packages/ir/src/authoring/animation-preview.ts
// render bounded local animation, contact, origin, grid & adjacent-frame previews

import { sha256Hex } from '@scratch-agent/sb3/crypto-node'
import type { ResolvedAnimationClipV2 } from './animation-clips.js'

export interface AnimationPreviewAssetV2
{
  readonly logicalAssetId: string
  readonly outputSha256: string
  readonly pngBytes: Uint8Array
  readonly width: number
  readonly height: number
}

export const ANIMATION_PREVIEW_LIMITS_V2 = Object.freeze({
  maximumHtmlBytes: 25 * 1024 * 1024,
  maximumDecodedBytes: 64 * 1024 * 1024,
  maximumSelectedAssets: 128,
  maximumPlaybackMs: 60000,
  contactPageSize: 32,
})

function fail(code: string, message: string): never
{
  throw Object.assign(new Error(message), { code })
}

function escapeHtml(value: string): string
{
  return value.replace(
    /[&<>"']/gu,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!
  )
}

function pngDimensions(asset: AnimationPreviewAssetV2): void
{
  const bytes = asset.pngBytes
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength < 33 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value
    ) ||
    Buffer.from(bytes.subarray(12, 16)).toString('ascii') !== 'IHDR'
  )
    fail(
      'authoring.invalid_preview_asset',
      `preview asset ${asset.logicalAssetId} is not a prepared PNG`
    )
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (
    !Number.isSafeInteger(asset.width) ||
    !Number.isSafeInteger(asset.height) ||
    asset.width < 1 ||
    asset.height < 1 ||
    asset.width !== view.getUint32(16) ||
    asset.height !== view.getUint32(20) ||
    bytes[24] !== 8 ||
    bytes[25] !== 6
  )
    fail(
      'authoring.invalid_preview_asset',
      `preview asset ${asset.logicalAssetId} differs from canonical RGBA dimensions`
    )
  if (sha256Hex(bytes) !== asset.outputSha256)
    fail(
      'authoring.asset_identity_mismatch',
      `preview asset ${asset.logicalAssetId} differs from its retained hash`
    )
}

export function buildAnimationPreviewHtmlV2(input: {
  readonly clips: readonly ResolvedAnimationClipV2[]
  readonly assets: readonly AnimationPreviewAssetV2[]
  readonly title?: string
}): string
{
  if (input.clips.length === 0 || input.clips.length > 128)
    return fail(
      'authoring.invalid_animation',
      'preview requires between 1 and 128 resolved clips'
    )
  const title = input.title ?? 'Animation preview'
  if (typeof title !== 'string' || title.length > 256)
    return fail(
      'authoring.invalid_animation',
      'preview title exceeds its display budget'
    )
  const assetById = new Map<string, AnimationPreviewAssetV2>()
  for (const asset of input.assets)
  {
    if (assetById.has(asset.logicalAssetId))
      return fail(
        'authoring.duplicate_identity',
        `preview asset ${asset.logicalAssetId} is repeated`
      )
    assetById.set(asset.logicalAssetId, asset)
  }
  const selected = new Map<string, AnimationPreviewAssetV2>()
  let frameCount = 0
  let decodedBytes = 0
  let encodedEstimate = 0
  const clipIds = new Set<string>()
  for (const clip of input.clips)
  {
    const clipIdentity = `${clip.targetIndex}:${clip.id}`
    if (
      clipIds.has(clipIdentity) ||
      typeof clip.loop !== 'boolean' ||
      clip.frames.length === 0
    )
      return fail(
        'authoring.invalid_animation',
        'preview clip identity or frame sequence is invalid'
      )
    clipIds.add(clipIdentity)
    frameCount += clip.frames.length
    if (frameCount > 4096)
      return fail(
        'authoring.animation_budget_exceeded',
        'preview exceeds its frame budget; select fewer clips'
      )
    for (const frame of clip.frames)
    {
      if (
        !Number.isSafeInteger(frame.durationMs) ||
        frame.durationMs < 1 ||
        frame.durationMs > 60000 ||
        !Number.isFinite(frame.rotationCenterX) ||
        !Number.isFinite(frame.rotationCenterY) ||
        !Number.isFinite(frame.bitmapResolution) ||
        frame.bitmapResolution <= 0 ||
        Math.abs(frame.rotationCenterX) > 1e6 ||
        Math.abs(frame.rotationCenterY) > 1e6
      )
        return fail(
          'authoring.invalid_animation',
          'preview frame duration or origin is invalid'
        )
      const asset = assetById.get(frame.logicalAssetId)
      if (!asset || asset.outputSha256 !== frame.payloadSha256)
        return fail(
          'authoring.asset_identity_mismatch',
          `preview frame ${frame.logicalAssetId} has no exact prepared asset`
        )
      if (
        [
          asset.width,
          asset.height,
          frame.rotationCenterX,
          frame.rotationCenterY,
        ].some(
          (value) =>
            !Number.isFinite(value / frame.bitmapResolution) ||
            Math.abs(value / frame.bitmapResolution) > 1e6
        )
      )
        return fail(
          'authoring.invalid_animation',
          'preview geometry exceeds its bounded stage coordinates'
        )
      if (selected.has(frame.logicalAssetId)) continue
      pngDimensions(asset)
      decodedBytes += asset.width * asset.height * 4
      encodedEstimate += 4 * Math.ceil(asset.pngBytes.byteLength / 3)
      if (
        selected.size >= ANIMATION_PREVIEW_LIMITS_V2.maximumSelectedAssets ||
        decodedBytes > ANIMATION_PREVIEW_LIMITS_V2.maximumDecodedBytes ||
        encodedEstimate >
          ANIMATION_PREVIEW_LIMITS_V2.maximumHtmlBytes - 1024 * 1024
      )
        return fail(
          'authoring.animation_budget_exceeded',
          'preview exceeds its selected-image budget; select fewer clips'
        )
      selected.set(frame.logicalAssetId, asset)
    }
  }
  const data = JSON.stringify({
    clips: input.clips,
    assets: [...selected.values()].map((asset) => ({
      logicalAssetId: asset.logicalAssetId,
      width: asset.width,
      height: asset.height,
      src: `data:image/png;base64,${Buffer.from(asset.pngBytes).toString('base64')}`,
    })),
    limits: ANIMATION_PREVIEW_LIMITS_V2,
  })
    .replace(/</gu, '\\u003c')
    .replace(/\u2028/gu, '\\u2028')
    .replace(/\u2029/gu, '\\u2029')
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${escapeHtml(title)}</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#161a22;color:#eef0f4;font:14px system-ui,sans-serif}main{max-width:1120px;margin:auto;padding:24px}h1{font-size:24px;margin:0 0 16px}button,select,input{font:inherit}button,select{background:#283140;color:inherit;border:1px solid #53617a;border-radius:5px;padding:7px 12px}button:disabled{opacity:.5}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #70cddd;outline-offset:3px}.toolbar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:16px}.toolbar label{display:flex;align-items:center;gap:6px}.stage,.card canvas,.adjacent canvas{background-color:#eee;background-image:conic-gradient(#d6d7d9 25%,#eee 0 50%,#d6d7d9 0 75%,#eee 0);background-size:16px 16px;image-rendering:pixelated;border-radius:6px}.stage{width:100%;height:auto;display:block;max-height:65vh}#frameRange{width:min(100%,460px)}.status{color:#b9c6d8;min-height:22px}.adjacent{display:grid;grid-template-columns:1fr 1fr;gap:16px;max-width:500px;margin:20px 0}.adjacent canvas{width:100%;height:auto}.contact{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:10px}.card{padding:8px;border:1px solid #53617a;display:grid;gap:7px;text-align:left}.card[aria-current="true"]{border:2px solid #70cddd}.card canvas{width:100%;height:auto}.card small{overflow-wrap:anywhere}details{margin-top:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere;color:#b9c6d8}.muted{color:#b9c6d8}
</style></head><body><main><h1>${escapeHtml(title)}</h1>
<div class="toolbar"><label>Clip <select id="clipSelect" aria-label="Animation clip"></select></label><button id="previous">Previous frame</button><button id="play">Play</button><button id="next">Next frame</button><label><input id="loop" type="checkbox">Loop</label><span class="muted">Playback stops after 60 seconds.</span></div>
<div class="toolbar"><label><input id="origin" type="checkbox" checked>Show origin</label><label><input id="grid" type="checkbox">Grid</label><label>Grid size <input id="gridSize" type="number" min="2" max="64" value="16" style="width:65px"></label><label><input id="adjacent" type="checkbox">Adjacent overlay</label></div>
<canvas class="stage" id="stage" width="900" height="500" aria-label="Animation and origin preview"></canvas>
<div class="toolbar" style="margin-top:16px"><label>Frame <input id="frameRange" type="range" min="0" max="0" value="0"></label><output id="frameStatus"></output></div><p id="status" class="status" role="status">Loading prepared images...</p>
<div class="adjacent"><div><p>Previous frame</p><canvas id="previousCanvas" width="260" height="180"></canvas></div><div><p>Next frame</p><canvas id="nextCanvas" width="260" height="180"></canvas></div></div>
<h2>Contact sheet</h2><div class="toolbar"><button id="previousPage">Previous page</button><output id="pageStatus"></output><button id="nextPage">Next page</button></div><div id="contact" class="contact"></div>
<details><summary>Costume and duration tables</summary><pre id="tables"></pre></details></main>
<script id="animation-data" type="application/json">${data}</script>
<script>
const data=JSON.parse(document.getElementById('animation-data').textContent);
const byId=new Map(data.assets.map(asset=>[asset.logicalAssetId,asset]));
const elements=Object.fromEntries(['clipSelect','previous','play','next','loop','origin','grid','gridSize','adjacent','stage','frameRange','frameStatus','status','previousCanvas','nextCanvas','previousPage','nextPage','pageStatus','contact','tables'].map(id=>[id,document.getElementById(id)]));
let clipIndex=0,frameIndex=0,pageIndex=0,playing=false,ready=false,animationId=0,startedAt=0,lastAt=0,accumulated=0;
const clip=()=>data.clips[clipIndex];
function stop(message='Paused'){playing=false;cancelAnimationFrame(animationId);elements.play.textContent='Play';elements.status.textContent=message;}
function adjacentIndex(offset){const value=frameIndex+offset;return value<0||value>=clip().frames.length?(elements.loop.checked?(value+clip().frames.length)%clip().frames.length:null):value;}
function bounds(){let left=0,right=0,top=0,bottom=0;for(const frame of clip().frames){const asset=byId.get(frame.logicalAssetId),r=frame.bitmapResolution;left=Math.min(left,-frame.rotationCenterX/r);right=Math.max(right,(asset.width-frame.rotationCenterX)/r);top=Math.min(top,-frame.rotationCenterY/r);bottom=Math.max(bottom,(asset.height-frame.rotationCenterY)/r);}return{left,right,top,bottom};}
function render(canvas,index,overlay=false){const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);if(index===null)return;const extent=bounds(),scale=Math.min((canvas.width-30)/Math.max(1,extent.right-extent.left),(canvas.height-30)/Math.max(1,extent.bottom-extent.top)),originX=(canvas.width-(extent.left+extent.right)*scale)/2,originY=(canvas.height-(extent.top+extent.bottom)*scale)/2;context.imageSmoothingEnabled=false;if(elements.grid.checked){const spacing=Math.max(2,Math.min(64,Number(elements.gridSize.value)||16))*scale,size=spacing*Math.max(1,Math.ceil(4/spacing));context.strokeStyle='#97a8ba';context.lineWidth=1;context.beginPath();for(let x=originX%size;x<canvas.width;x+=size){context.moveTo(x,0);context.lineTo(x,canvas.height);}for(let y=originY%size;y<canvas.height;y+=size){context.moveTo(0,y);context.lineTo(canvas.width,y);}context.stroke();}const draw=(number,alpha)=>{if(number===null)return;const frame=clip().frames[number],asset=byId.get(frame.logicalAssetId),r=frame.bitmapResolution;context.globalAlpha=alpha;context.drawImage(asset.image,originX-frame.rotationCenterX/r*scale,originY-frame.rotationCenterY/r*scale,asset.width/r*scale,asset.height/r*scale);};if(overlay){draw(adjacentIndex(-1),.2);draw(adjacentIndex(1),.2);}draw(index,1);context.globalAlpha=1;if(elements.origin.checked){context.strokeStyle='#d52747';context.lineWidth=2;context.beginPath();context.moveTo(originX-8,originY);context.lineTo(originX+8,originY);context.moveTo(originX,originY-8);context.lineTo(originX,originY+8);context.stroke();}}
function contact(){elements.contact.replaceChildren();const from=pageIndex*data.limits.contactPageSize,to=Math.min(clip().frames.length,from+data.limits.contactPageSize);for(let i=from;i<to;i++){const frame=clip().frames[i],button=document.createElement('button'),canvas=document.createElement('canvas'),label=document.createElement('small');button.className='card';button.type='button';button.setAttribute('aria-current',String(i===frameIndex));button.setAttribute('aria-label','Frame '+(i+1)+', '+frame.costumeName);canvas.width=120;canvas.height=110;label.textContent=(i+1)+'. '+frame.costumeName+' · '+frame.durationMs+' ms';button.append(canvas,label);button.addEventListener('click',()=>{stop();frameIndex=i;redraw();});elements.contact.append(button);render(canvas,i);}elements.pageStatus.textContent=(from+1)+'–'+to+' / '+clip().frames.length;elements.previousPage.disabled=pageIndex===0;elements.nextPage.disabled=to===clip().frames.length;}
function redraw(){if(!ready)return;elements.frameRange.value=String(frameIndex);const frame=clip().frames[frameIndex];elements.frameStatus.textContent=(frameIndex+1)+' / '+clip().frames.length+' · '+frame.durationMs+' ms · costume '+frame.costumeIndexOneBased;render(elements.stage,frameIndex,elements.adjacent.checked);render(elements.previousCanvas,adjacentIndex(-1));render(elements.nextCanvas,adjacentIndex(1));contact();}
function choose(){stop();frameIndex=0;pageIndex=0;accumulated=0;elements.frameRange.max=String(clip().frames.length-1);elements.loop.checked=clip().loop;elements.tables.textContent=JSON.stringify(clip().tables,null,2);redraw();}
function tick(now){if(!playing)return;if(now-startedAt>=data.limits.maximumPlaybackMs){stop('Playback limit reached.');return;}accumulated+=now-lastAt;lastAt=now;let changed=false;while(accumulated>=clip().frames[frameIndex].durationMs){accumulated-=clip().frames[frameIndex].durationMs;if(frameIndex===clip().frames.length-1){if(!elements.loop.checked){redraw();stop('Clip finished.');return;}frameIndex=0;}else frameIndex++;changed=true;}if(changed){pageIndex=Math.floor(frameIndex/data.limits.contactPageSize);redraw();}animationId=requestAnimationFrame(tick);}
for(const [index,item]of data.clips.entries()){const option=document.createElement('option');option.value=String(index);option.textContent=item.name;elements.clipSelect.append(option);}elements.clipSelect.addEventListener('change',()=>{clipIndex=Number(elements.clipSelect.value);choose();});elements.previous.addEventListener('click',()=>{stop();frameIndex=Math.max(0,frameIndex-1);pageIndex=Math.floor(frameIndex/data.limits.contactPageSize);redraw();});elements.next.addEventListener('click',()=>{stop();frameIndex=Math.min(clip().frames.length-1,frameIndex+1);pageIndex=Math.floor(frameIndex/data.limits.contactPageSize);redraw();});elements.frameRange.addEventListener('input',()=>{stop();frameIndex=Number(elements.frameRange.value);pageIndex=Math.floor(frameIndex/data.limits.contactPageSize);redraw();});elements.play.addEventListener('click',()=>{if(playing){stop();return;}if(frameIndex===clip().frames.length-1)frameIndex=0;playing=true;accumulated=0;startedAt=lastAt=performance.now();elements.play.textContent='Pause';elements.status.textContent='Playing';animationId=requestAnimationFrame(tick);});for(const control of['origin','grid','gridSize','adjacent','loop'])elements[control].addEventListener('change',redraw);elements.previousPage.addEventListener('click',()=>{pageIndex=Math.max(0,pageIndex-1);contact();});elements.nextPage.addEventListener('click',()=>{pageIndex=Math.min(Math.ceil(clip().frames.length/data.limits.contactPageSize)-1,pageIndex+1);contact();});document.addEventListener('visibilitychange',()=>{if(document.hidden)stop('Paused while hidden.');});window.addEventListener('pagehide',()=>stop());
for(const control of['play','previous','next','frameRange','previousPage','nextPage','clipSelect'])elements[control].disabled=true;
Promise.all(data.assets.map(asset=>new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{asset.image=image;resolve();};image.onerror=()=>reject(new Error('A prepared image could not be decoded.'));image.src=asset.src;}))).then(()=>{ready=true;for(const control of['play','previous','next','frameRange','clipSelect'])elements[control].disabled=false;choose();}).catch(error=>stop(error.message));
</script></body></html>`
  if (
    Buffer.byteLength(html, 'utf8') >
    ANIMATION_PREVIEW_LIMITS_V2.maximumHtmlBytes
  )
    return fail(
      'authoring.animation_budget_exceeded',
      'preview exceeds its HTML budget; select fewer clips'
    )
  return html
}
