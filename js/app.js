/**
 * Photo Merge Editor – app.js
 * Full-featured canvas-based photo compositing editor.
 * Vanilla JS, no external dependencies.
 */

'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */

/** Converts sensitivity slider (1-100) to colour-distance threshold used in BG removal */
const SENSITIVITY_TO_THRESHOLD = 2.5;

/** Factor applied to edge gradient magnitude when building contrast maps */
const EDGE_THRESHOLD_FACTOR = 0.4;

/* ============================================================
   STATE
   ============================================================ */

/** Per-layer data */
let layers = {
  1: { image: null, x: 200, y: 150, scale: 1, rotation: 0, opacity: 1,
       blendMode: 'source-over', flipX: false, flipY: false,
       brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0,
       blur: 0, sharpness: 0, vignette: 0, hdr: 0, grain: 0 },
  2: { image: null, x: 300, y: 200, scale: 1, rotation: 0, opacity: 1,
       blendMode: 'source-over', flipX: false, flipY: false,
       brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0,
       blur: 0, sharpness: 0, vignette: 0, hdr: 0, grain: 0 },
  3: { image: null, x: 400, y: 250, scale: 1, rotation: 0, opacity: 1,
       blendMode: 'source-over', flipX: false, flipY: false,
       brightness: 0, contrast: 0, saturation: 0, temperature: 0, hue: 0,
       blur: 0, sharpness: 0, vignette: 0, hdr: 0, grain: 0 }
};

/** Original images before background removal */
let originalImages = { 1: null, 2: null, 3: null };

let activeLayer = 1;   // currently selected layer id (1/2/3)
let canvasZoom  = 1;   // current canvas display zoom
let uiScale     = 1;   // UI scale factor

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const canvas          = document.getElementById('mainCanvas');
const ctx             = canvas.getContext('2d');
const canvasContainer = document.getElementById('canvasContainer');
const canvasViewport  = document.getElementById('canvasViewport');
const hintToast       = document.getElementById('hintToast');
const spinnerOverlay  = document.getElementById('spinnerOverlay');
const spinnerLabel    = document.getElementById('spinnerLabel');
const zoomDisplay     = document.getElementById('zoomDisplay');
const zoomStatus      = document.getElementById('zoomStatus');
const statusMsg       = document.getElementById('statusMsg');

/* ============================================================
   RENDER ENGINE
   ============================================================ */

/**
 * Render all layers to the main canvas.
 * Layers are drawn in order 1 → 3 (1 = bottom, 3 = top).
 */
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // White background so canvas export looks correct
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  [1, 2, 3].forEach(id => {
    const layer = layers[id];
    if (!layer.image) return;

    // Build filtered/effected image on a temp canvas
    const filtered = applyFilters(layer);
    const effected  = applyEffects(filtered, layer);

    const img = effected;
    const iw  = img.width;
    const ih  = img.height;

    ctx.save();

    // Position & transform
    ctx.translate(layer.x, layer.y);
    ctx.rotate((layer.rotation * Math.PI) / 180);
    ctx.scale(
      layer.scale * (layer.flipX ? -1 : 1),
      layer.scale * (layer.flipY ? -1 : 1)
    );

    ctx.globalAlpha             = layer.opacity;
    ctx.globalCompositeOperation = layer.blendMode;

    // Draw centred on anchor point
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);

    ctx.restore();

    // Per-layer vignette overlay
    if (layer.vignette > 0) {
      applyVignetteOverlay(layer, iw, ih);
    }
  });
}

/**
 * Draw a vignette radial-gradient over the layer's screen-space bounds.
 * The vignette is applied with 'multiply' composite so it darkens edges.
 */
function applyVignetteOverlay(layer, iw, ih) {
  const strength = layer.vignette / 100;
  const screenW = iw * layer.scale;
  const screenH = ih * layer.scale;

  ctx.save();
  ctx.translate(layer.x, layer.y);
  ctx.rotate((layer.rotation * Math.PI) / 180);

  const grad = ctx.createRadialGradient(
    0, 0, Math.min(screenW, screenH) * 0.2,
    0, 0, Math.max(screenW, screenH) * 0.8
  );
  grad.addColorStop(0,   'rgba(0,0,0,0)');
  grad.addColorStop(1,   `rgba(0,0,0,${strength * 0.85})`);

  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = grad;
  ctx.fillRect(-screenW / 2, -screenH / 2, screenW, screenH);
  ctx.restore();
}

/* ============================================================
   FILTER PIPELINE
   ============================================================ */

/**
 * Apply all colour filters to a layer and return a new HTMLCanvasElement.
 * Stage 1: brightness / contrast via CSS filter string on a temp canvas.
 * Stage 2: saturation / hue via pixel-level HSL conversion.
 * Stage 3: temperature by shifting R / B channels.
 *
 * @param {object} layer  - layer data object (from the `layers` map)
 * @returns {HTMLCanvasElement}
 */
function applyFilters(layer) {
  const src  = layer.image;
  const tw   = document.createElement('canvas');
  tw.width   = src.width  || src.naturalWidth  || src.videoWidth  || 1;
  tw.height  = src.height || src.naturalHeight || src.videoHeight || 1;

  // Use naturalWidth/Height for Image elements
  if (src instanceof HTMLImageElement) {
    tw.width  = src.naturalWidth;
    tw.height = src.naturalHeight;
  } else if (src instanceof HTMLCanvasElement) {
    tw.width  = src.width;
    tw.height = src.height;
  }

  const tc = tw.getContext('2d');

  // ---- Stage 1: brightness / contrast via CSS filter ----
  const brightnessPct = 100 + layer.brightness;        // 0 … 200
  const contrastPct   = 100 + layer.contrast * 1.5;    // 1.5x amplifier makes contrast steps more perceptible

  tc.filter = `brightness(${brightnessPct}%) contrast(${Math.max(0, contrastPct)}%)`;
  tc.drawImage(src, 0, 0, tw.width, tw.height);
  tc.filter = 'none';

  // ---- Stage 2 & 3: pixel manipulation ----
  if (layer.saturation !== 0 || layer.hue !== 0 || layer.temperature !== 0) {
    const imgData = tc.getImageData(0, 0, tw.width, tw.height);
    const data    = imgData.data;
    const satShift  = layer.saturation / 100;   // -1 … +1
    const hueShift  = layer.hue;                // 0 … 360
    const tempShift = layer.temperature / 100;  // -1 … +1

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i+1], b = data[i+2];

      // Temperature: warm = more red / less blue, cool = opposite
      if (tempShift !== 0) {
        const t = tempShift * 40;
        r = clamp(r + t,       0, 255);
        b = clamp(b - t * 0.8, 0, 255);
      }

      // Saturation + hue via HSL
      if (satShift !== 0 || hueShift !== 0) {
        let [h, s, l] = rgbToHsl(r, g, b);
        if (hueShift !== 0) h = (h + hueShift / 360 + 1) % 1;
        if (satShift  !== 0) s = clamp(s + satShift * s + satShift * 0.3, 0, 1);
        [r, g, b] = hslToRgb(h, s, l);
      }

      data[i]   = r;
      data[i+1] = g;
      data[i+2] = b;
    }
    tc.putImageData(imgData, 0, 0);
  }

  return tw;
}

/**
 * Apply post-processing effects (blur, sharpness, grain, HDR) to a canvas.
 * Returns a new canvas with effects applied.
 *
 * @param {HTMLCanvasElement} srcCanvas
 * @param {object} layer
 * @returns {HTMLCanvasElement}
 */
function applyEffects(srcCanvas, layer) {
  if (layer.blur === 0 && layer.sharpness === 0 &&
      layer.grain === 0 && layer.hdr === 0) {
    return srcCanvas; // Fast-path: nothing to do
  }

  const ew   = srcCanvas.width;
  const eh   = srcCanvas.height;
  const ec   = document.createElement('canvas');
  ec.width   = ew;
  ec.height  = eh;
  const ectx = ec.getContext('2d');

  // ---- Blur ----
  if (layer.blur > 0) {
    ectx.filter = `blur(${layer.blur}px)`;
    ectx.drawImage(srcCanvas, 0, 0);
    ectx.filter = 'none';
  } else {
    ectx.drawImage(srcCanvas, 0, 0);
  }

  // ---- Sharpness (unsharp mask) ----
  if (layer.sharpness > 0) {
    const amount = layer.sharpness / 100;
    const imgData = ectx.getImageData(0, 0, ew, eh);
    const sharpened = unsharpMask(imgData, amount);
    ectx.putImageData(sharpened, 0, 0);
  }

  // ---- HDR (boost local contrast & saturation) ----
  if (layer.hdr > 0) {
    const s      = layer.hdr / 100;
    const imgData = ectx.getImageData(0, 0, ew, eh);
    const data    = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i+1], b = data[i+2];
      // Boost saturation
      let [h, sat, l] = rgbToHsl(r, g, b);
      sat = clamp(sat + s * 0.4, 0, 1);
      // Boost contrast via S-curve
      l = clamp(sCurve(l, s * 0.5), 0, 1);
      [r, g, b] = hslToRgb(h, sat, l);
      data[i] = r; data[i+1] = g; data[i+2] = b;
    }
    ectx.putImageData(imgData, 0, 0);
  }

  // ---- Film Grain ----
  if (layer.grain > 0) {
    const imgData = ectx.getImageData(0, 0, ew, eh);
    const data    = imgData.data;
    const maxNoise = layer.grain * 0.6;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * maxNoise;
      data[i]   = clamp(data[i]   + noise, 0, 255);
      data[i+1] = clamp(data[i+1] + noise, 0, 255);
      data[i+2] = clamp(data[i+2] + noise, 0, 255);
    }
    ectx.putImageData(imgData, 0, 0);
  }

  return ec;
}

/**
 * Simple S-curve for HDR local contrast boost.
 * @param {number} v  – normalised value 0..1
 * @param {number} s  – strength 0..1
 */
function sCurve(v, s) {
  // Shift v towards 0 or 1 based on which side of 0.5 it's on
  if (v < 0.5) return v - s * v * (0.5 - v) * 4;
  else         return v + s * (v - 0.5) * (1 - v) * 4;
}

/* ============================================================
   UNSHARP MASK
   ============================================================ */

/**
 * Unsharp-mask algorithm:
 *   sharpened = original + amount * (original - blurred)
 *
 * @param {ImageData} imageData
 * @param {number}    amount   0..1+
 * @returns {ImageData}
 */
function unsharpMask(imageData, amount) {
  const { width, height, data } = imageData;
  const blurred = gaussianBlurPixels(data, width, height, 2);
  const result  = new Uint8ClampedArray(data.length);

  for (let i = 0; i < data.length; i += 4) {
    result[i]   = clamp(data[i]   + amount * (data[i]   - blurred[i]),   0, 255);
    result[i+1] = clamp(data[i+1] + amount * (data[i+1] - blurred[i+1]), 0, 255);
    result[i+2] = clamp(data[i+2] + amount * (data[i+2] - blurred[i+2]), 0, 255);
    result[i+3] = data[i+3];
  }

  return new ImageData(result, width, height);
}

/**
 * Fast separable Gaussian blur on raw pixel data.
 * Uses a radius-2 kernel: [1,4,6,4,1]/16
 *
 * @param {Uint8ClampedArray} src
 * @param {number} width
 * @param {number} height
 * @param {number} radius  (currently fixed to 2)
 * @returns {Uint8ClampedArray} blurred pixel data
 */
function gaussianBlurPixels(src, width, height, radius) {
  const kernel = [1, 4, 6, 4, 1];
  const kLen   = kernel.length;
  const kHalf  = Math.floor(kLen / 2);
  const kSum   = kernel.reduce((a, b) => a + b, 0);
  const tmp    = new Float32Array(src.length);
  const out    = new Uint8ClampedArray(src.length);

  // Horizontal pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < kLen; k++) {
        const xi  = clamp(x + k - kHalf, 0, width - 1);
        const idx = (y * width + xi) * 4;
        const w   = kernel[k];
        r += src[idx]   * w;
        g += src[idx+1] * w;
        b += src[idx+2] * w;
        a += src[idx+3] * w;
      }
      const oi = (y * width + x) * 4;
      tmp[oi] = r/kSum; tmp[oi+1] = g/kSum; tmp[oi+2] = b/kSum; tmp[oi+3] = a/kSum;
    }
  }
  // Vertical pass
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < kLen; k++) {
        const yi  = clamp(y + k - kHalf, 0, height - 1);
        const idx = (yi * width + x) * 4;
        const w   = kernel[k];
        r += tmp[idx] * w; g += tmp[idx+1] * w;
        b += tmp[idx+2] * w; a += tmp[idx+3] * w;
      }
      const oi = (y * width + x) * 4;
      out[oi] = r/kSum; out[oi+1] = g/kSum; out[oi+2] = b/kSum; out[oi+3] = a/kSum;
    }
  }
  return out;
}

/* ============================================================
   COLOUR MATH HELPERS
   ============================================================ */

/** Clamp value to [min, max] */
function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/**
 * RGB (0-255) → HSL (each 0-1)
 * @returns {[number, number, number]}
 */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

/**
 * HSL (each 0-1) → RGB (0-255)
 * @returns {[number, number, number]}
 */
function hslToRgb(h, s, l) {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = hueToRgb(p, q, h + 1/3);
  const g = hueToRgb(p, q, h);
  const b = hueToRgb(p, q, h - 1/3);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function hueToRgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1/6) return p + (q - p) * 6 * t;
  if (t < 1/2) return q;
  if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
  return p;
}

/* ============================================================
   BACKGROUND REMOVAL
   ============================================================ */

/**
 * Smart background removal with several methods.
 *
 * @param {number} layerId   1 / 2 / 3
 * @param {string} method    'grabcut' | 'center' | 'contrast' | 'flood'
 */
function smartRemoveBackground(layerId, method) {
  const layer = layers[layerId];
  if (!layer.image) { showHint('No image on this layer'); return; }

  showSpinner('Removing background…');

  // Defer to next tick so spinner is visible
  setTimeout(() => {
    try {
      const sensitivity = parseInt(document.getElementById('sensitivity-slider').value, 10);
      const threshold   = sensitivity * SENSITIVITY_TO_THRESHOLD; // convert 1-100 → colour-distance threshold

      // Work on a temporary canvas at image's natural size
      const src    = layer.image;
      const tw     = document.createElement('canvas');
      tw.width     = src instanceof HTMLImageElement ? src.naturalWidth  : src.width;
      tw.height    = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
      const tc     = tw.getContext('2d');
      tc.drawImage(src, 0, 0, tw.width, tw.height);

      const W = tw.width, H = tw.height;
      const imgData = tc.getImageData(0, 0, W, H);

      switch (method) {
        case 'grabcut': grabCutRemove(imgData, W, H, threshold);  break;
        case 'center':  centerObjectRemove(imgData, W, H, threshold); break;
        case 'contrast': contrastRemove(imgData, W, H, threshold); break;
        case 'flood':    floodRemove(imgData, W, H, threshold);    break;
      }

      tc.putImageData(imgData, 0, 0);
      layer.image = tw;
      render();
      updateThumbnail(layerId);
    } catch(e) {
      console.error('BG removal error:', e);
      showHint('Background removal failed');
    }
    hideSpinner();
  }, 50);
}

/**
 * GrabCut-inspired removal:
 * Sample corner 20×20 patches for background colour;
 * preserve centre 84% region (half-extent 42% per axis), remove pixels matching background.
 */
function grabCutRemove(imgData, W, H, threshold) {
  const data      = imgData.data;
  const bgSamples = sampleCornerColors(data, W, H, 20);
  const cx = W / 2, cy = H / 2;
  const safeW = W * 0.42, safeH = H * 0.42; // half-extents → 84% safe zone (0.42*2 per axis)

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      if (data[i+3] === 0) continue;
      const r = data[i], g = data[i+1], b = data[i+2];

      // Is this pixel inside the central "keep" region?
      const inCenter = Math.abs(x - cx) < safeW && Math.abs(y - cy) < safeH;
      if (inCenter) continue;

      // Does it match any background sample?
      for (const [br, bg, bb] of bgSamples) {
        if (colorDistance(r,g,b, br,bg,bb) < threshold) {
          data[i+3] = 0;
          break;
        }
      }
    }
  }
}

/**
 * Center-object method: uses the centre pixel as object colour.
 * Removes pixels whose colour is closer to background (corner average).
 */
function centerObjectRemove(imgData, W, H, threshold) {
  const data = imgData.data;

  // Object reference: centre pixel colour
  const ci = (Math.floor(H/2) * W + Math.floor(W/2)) * 4;
  const or = data[ci], og = data[ci+1], ob = data[ci+2];

  // Background reference: average of corners
  const bgSamples = sampleCornerColors(data, W, H, 15);
  const bgAvg = bgSamples.reduce(
    (acc, [r,g,b]) => [acc[0]+r, acc[1]+g, acc[2]+b],
    [0,0,0]
  ).map(v => v / bgSamples.length);

  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] === 0) continue;
    const r = data[i], g = data[i+1], b = data[i+2];
    const distObj = colorDistance(r,g,b, or,og,ob);
    const distBg  = colorDistance(r,g,b, bgAvg[0],bgAvg[1],bgAvg[2]);
    if (distBg < distObj - threshold * 0.3) {
      data[i+3] = 0;
    }
  }
}

/**
 * Contrast-based removal: use edge detection to identify foreground,
 * then flood-fill from corners to remove background.
 */
function contrastRemove(imgData, W, H, threshold) {
  const data = imgData.data;
  // Simple luminance-gradient edge map
  const edges = new Uint8Array(W * H);
  for (let y = 1; y < H-1; y++) {
    for (let x = 1; x < W-1; x++) {
      const lum  = (r,g,b) => 0.299*r + 0.587*g + 0.114*b;
      const i    = (y*W+x)*4;
      const iR   = (y*W+x+1)*4;
      const iD   = ((y+1)*W+x)*4;
      const dx   = lum(data[iR],data[iR+1],data[iR+2]) - lum(data[i],data[i+1],data[i+2]);
      const dy   = lum(data[iD],data[iD+1],data[iD+2]) - lum(data[i],data[i+1],data[i+2]);
      edges[y*W+x] = Math.sqrt(dx*dx + dy*dy) > (threshold * EDGE_THRESHOLD_FACTOR) ? 1 : 0;
    }
  }

  // Flood fill from all 4 corners, stopping at edges
  const visited = new Uint8Array(W * H);
  const queue   = [];
  [[0,0],[W-1,0],[0,H-1],[W-1,H-1]].forEach(([cx,cy]) => {
    queue.push(cy*W+cx); visited[cy*W+cx] = 1;
  });
  while (queue.length) {
    const pos = queue.shift();
    const x   = pos % W, y = Math.floor(pos / W);
    data[pos*4+3] = 0;
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
      const nx = x+dx, ny = y+dy;
      if (nx<0||ny<0||nx>=W||ny>=H) return;
      const npos = ny*W+nx;
      if (!visited[npos] && !edges[npos]) {
        visited[npos] = 1;
        queue.push(npos);
      }
    });
  }
}

/**
 * Flood-fill removal: flood-fill from all 4 edges using corner colours.
 */
function floodRemove(imgData, W, H, threshold) {
  const data      = imgData.data;
  const bgSamples = sampleCornerColors(data, W, H, 10);

  // Mark bg pixels
  const isBg = (r,g,b) => bgSamples.some(([br,bg,bb]) => colorDistance(r,g,b,br,bg,bb) < threshold);

  // BFS from each edge pixel that matches background
  const visited = new Uint8Array(W * H);
  const queue   = [];

  const enqueue = (x, y) => {
    const i = (y*W+x)*4;
    if (!visited[y*W+x] && data[i+3]>0 && isBg(data[i],data[i+1],data[i+2])) {
      visited[y*W+x] = 1;
      queue.push(y*W+x);
    }
  };

  for (let x = 0; x < W; x++) { enqueue(x, 0); enqueue(x, H-1); }
  for (let y = 0; y < H; y++) { enqueue(0, y); enqueue(W-1, y); }

  while (queue.length) {
    const pos = queue.shift();
    data[pos*4+3] = 0;
    const x = pos%W, y = Math.floor(pos/W);
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=W||ny>=H) return;
      enqueue(nx, ny);
    });
  }
}

/**
 * Sample colours from the four corners of the image.
 * @param {Uint8ClampedArray} data
 * @param {number} W
 * @param {number} H
 * @param {number} patchSize  – side length of patch in pixels
 * @returns {Array<[number,number,number]>}  array of [r,g,b] averages
 */
function sampleCornerColors(data, W, H, patchSize) {
  const corners = [
    [0,         0],
    [W-patchSize, 0],
    [0,         H-patchSize],
    [W-patchSize, H-patchSize]
  ];
  return corners.map(([ox, oy]) => {
    let r=0, g=0, b=0, n=0;
    for (let y = Math.max(0,oy); y < Math.min(H, oy+patchSize); y++) {
      for (let x = Math.max(0,ox); x < Math.min(W, ox+patchSize); x++) {
        const i = (y*W+x)*4;
        r += data[i]; g += data[i+1]; b += data[i+2]; n++;
      }
    }
    return n > 0 ? [r/n, g/n, b/n] : [0,0,0];
  });
}

/**
 * Euclidean colour distance in RGB space.
 */
function colorDistance(r1,g1,b1, r2,g2,b2) {
  const dr=r1-r2, dg=g1-g2, db=b1-b2;
  return Math.sqrt(dr*dr + dg*dg + db*db);
}

/**
 * Flood-fill BFS that zeros the alpha channel.
 * Used for fine-tune operations.
 *
 * @param {ImageData} imageData
 * @param {number} startX
 * @param {number} startY
 * @param {number} threshold  – colour tolerance
 */
function floodFill(imageData, startX, startY, threshold) {
  const { data, width: W, height: H } = imageData;
  const si = (startY * W + startX) * 4;
  const sr = data[si], sg = data[si+1], sb = data[si+2];

  const visited = new Uint8Array(W * H);
  const queue   = [startY * W + startX];
  visited[startY * W + startX] = 1;

  while (queue.length) {
    const pos = queue.shift();
    data[pos * 4 + 3] = 0;
    const x = pos % W, y = Math.floor(pos / W);
    [[1,0],[-1,0],[0,1],[0,-1]].forEach(([dx,dy]) => {
      const nx=x+dx, ny=y+dy;
      if (nx<0||ny<0||nx>=W||ny>=H) return;
      const npos = ny*W+nx;
      if (visited[npos]) return;
      const ni = npos*4;
      if (colorDistance(data[ni],data[ni+1],data[ni+2], sr,sg,sb) <= threshold) {
        visited[npos] = 1;
        queue.push(npos);
      }
    });
  }
}

/**
 * Remove a specific colour from the active layer's image.
 *
 * @param {number} layerId
 * @param {string} colorName  'white'|'black'|'green'|'blue'|'auto'
 */
function removeColorFromBackground(layerId, colorName) {
  const layer = layers[layerId];
  if (!layer.image) { showHint('No image on this layer'); return; }

  showSpinner('Removing colour…');
  setTimeout(() => {
    const src  = layer.image;
    const tw   = document.createElement('canvas');
    tw.width   = src instanceof HTMLImageElement ? src.naturalWidth  : src.width;
    tw.height  = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
    const tc   = tw.getContext('2d');
    tc.drawImage(src, 0, 0, tw.width, tw.height);

    const W       = tw.width, H = tw.height;
    const imgData = tc.getImageData(0, 0, W, H);
    const data    = imgData.data;
    const sensitivity = parseInt(document.getElementById('sensitivity-slider').value, 10);
    const threshold   = sensitivity * SENSITIVITY_TO_THRESHOLD;

    let targetR=255, targetG=255, targetB=255;
    if (colorName === 'auto') {
      // Use average of corner samples
      const samples = sampleCornerColors(data, W, H, 20);
      [targetR, targetG, targetB] = samples
        .reduce((a,[r,g,b])=>[a[0]+r,a[1]+g,a[2]+b],[0,0,0])
        .map(v=>v/samples.length);
    } else {
      const presets = {
        white: [255,255,255],
        black: [0,0,0],
        green: [0,177,64],
        blue:  [0,120,212]
      };
      [targetR, targetG, targetB] = presets[colorName] || [255,255,255];
    }

    for (let i = 0; i < data.length; i += 4) {
      if (colorDistance(data[i],data[i+1],data[i+2], targetR,targetG,targetB) < threshold) {
        data[i+3] = 0;
      }
    }

    tc.putImageData(imgData, 0, 0);
    layer.image = tw;
    render();
    updateThumbnail(layerId);
    hideSpinner();
  }, 50);
}

/**
 * Restore the active layer to its original image (before any BG removal).
 * @param {number} layerId
 */
function restoreOriginal(layerId) {
  if (!originalImages[layerId]) { showHint('No original stored'); return; }
  layers[layerId].image = originalImages[layerId];
  render();
  updateThumbnail(layerId);
  showHint('Original restored');
}

/* ============================================================
   FINE-TUNE OPERATIONS
   ============================================================ */

/**
 * Morphological operation on the alpha channel.
 * @param {number} layerId
 * @param {'expand'|'contract'|'smooth'|'invert'} op
 */
function fineTuneAlpha(layerId, op) {
  const layer = layers[layerId];
  if (!layer.image) { showHint('No image on this layer'); return; }

  showSpinner('Fine-tuning…');
  setTimeout(() => {
    const src = layer.image;
    const tw  = document.createElement('canvas');
    tw.width  = src instanceof HTMLImageElement ? src.naturalWidth  : src.width;
    tw.height = src instanceof HTMLImageElement ? src.naturalHeight : src.height;
    const tc  = tw.getContext('2d');
    tc.drawImage(src, 0, 0, tw.width, tw.height);

    const W = tw.width, H = tw.height;
    const imgData = tc.getImageData(0, 0, W, H);
    const data    = imgData.data;
    const alpha   = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W*H; i++) alpha[i] = data[i*4+3];

    if (op === 'invert') {
      for (let i = 0; i < W*H; i++) data[i*4+3] = 255 - alpha[i];
    } else if (op === 'expand' || op === 'contract') {
      const newAlpha = new Uint8ClampedArray(alpha);
      const radius   = 3;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let val = alpha[y*W+x];
          for (let dy=-radius; dy<=radius; dy++) {
            for (let dx=-radius; dx<=radius; dx++) {
              const nx=x+dx, ny=y+dy;
              if (nx<0||ny<0||nx>=W||ny>=H) continue;
              const n = alpha[ny*W+nx];
              if (op === 'expand')   val = Math.max(val, n);
              else                   val = Math.min(val, n);
            }
          }
          newAlpha[y*W+x] = val;
        }
      }
      for (let i = 0; i < W*H; i++) data[i*4+3] = newAlpha[i];
    } else if (op === 'smooth') {
      // Box-blur the alpha channel
      const newAlpha = new Float32Array(W * H);
      const r = 2;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          let sum = 0, n = 0;
          for (let dy=-r; dy<=r; dy++) {
            for (let dx=-r; dx<=r; dx++) {
              const nx=x+dx, ny=y+dy;
              if (nx<0||ny<0||nx>=W||ny>=H) continue;
              sum += alpha[ny*W+nx]; n++;
            }
          }
          newAlpha[y*W+x] = sum/n;
        }
      }
      for (let i = 0; i < W*H; i++) data[i*4+3] = Math.round(newAlpha[i]);
    }

    tc.putImageData(imgData, 0, 0);
    layer.image = tw;
    render();
    updateThumbnail(layerId);
    hideSpinner();
  }, 30);
}

/* ============================================================
   IMAGE LOADING
   ============================================================ */

/**
 * Load an image file into a layer.
 * @param {File}   file
 * @param {number} layerId
 */
function loadImageFile(file, layerId) {
  if (!file || !file.type.startsWith('image/')) {
    showHint('Please provide a valid image file');
    return;
  }
  showSpinner('Loading image…');
  const reader = new FileReader();
  reader.onload = e => {
    const img = new Image();
    img.onload = () => {
      layers[layerId].image = img;
      originalImages[layerId] = img;
      // Centre the image in canvas by default
      layers[layerId].x = canvas.width  / 2;
      layers[layerId].y = canvas.height / 2;
      render();
      updateThumbnail(layerId);
      setActiveLayer(layerId);
      hideSpinner();
      showHint(`Layer ${layerId} loaded`);
    };
    img.onerror = () => { hideSpinner(); showHint('Failed to load image'); };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

/**
 * Update the thumbnail preview for a layer.
 * @param {number} layerId
 */
function updateThumbnail(layerId) {
  const thumb     = document.getElementById(`thumb${layerId}`);
  const dropHint  = document.getElementById(`dropHint${layerId}`);
  const img       = layers[layerId].image;

  if (!img) {
    thumb.style.display    = 'none';
    dropHint.style.display = '';
    return;
  }

  // Draw scaled version to a tiny canvas for the thumbnail
  const tc = document.createElement('canvas');
  tc.width = 80; tc.height = 60;
  const tctx = tc.getContext('2d');
  tctx.drawImage(img, 0, 0, 80, 60);
  thumb.src          = tc.toDataURL();
  thumb.style.display = 'block';
  dropHint.style.display = 'none';
}

/* ============================================================
   ACTIVE LAYER & UI SYNC
   ============================================================ */

/**
 * Set the active layer and refresh all UI controls.
 * @param {number} id  1/2/3
 */
function setActiveLayer(id) {
  activeLayer = id;
  [1,2,3].forEach(n => {
    document.getElementById(`layerCard${n}`)
      .classList.toggle('active', n === id);
  });
  updateUI();
  setStatus(`Layer ${id} selected`);
}

/**
 * Sync all sidebar controls to the current active layer's values.
 */
function updateUI() {
  const layer = layers[activeLayer];

  // Helper: set slider + badge
  const setSlider = (id, badgeId, val) => {
    const el = document.getElementById(id);
    if (el) { el.value = val; }
    const badge = document.getElementById(badgeId);
    if (badge) badge.textContent = Math.round(val);
  };

  // Basic tab
  setSlider('opacity-slider',  'opacityVal',  Math.round(layer.opacity  * 100));
  setSlider('scale-slider',    'scaleVal',    Math.round(layer.scale    * 100));
  setSlider('rotation-slider', 'rotationVal', Math.round(layer.rotation));

  const posX = document.getElementById('pos-x');
  const posY = document.getElementById('pos-y');
  if (posX) posX.value = Math.round(layer.x);
  if (posY) posY.value = Math.round(layer.y);

  const bm = document.getElementById('blend-mode');
  if (bm) bm.value = layer.blendMode;

  // Filters tab
  setSlider('brightness-slider', 'brightnessVal', layer.brightness);
  setSlider('contrast-slider',   'contrastVal',   layer.contrast);
  setSlider('saturation-slider', 'saturationVal', layer.saturation);
  setSlider('temperature-slider','temperatureVal',layer.temperature);
  setSlider('hue-slider',        'hueVal',        layer.hue);

  // Effects tab
  setSlider('blur-slider',      'blurVal',      layer.blur);
  setSlider('sharpness-slider', 'sharpnessVal', layer.sharpness);
  setSlider('vignette-slider',  'vignetteVal',  layer.vignette);
  setSlider('hdr-slider',       'hdrVal',       layer.hdr);
  setSlider('grain-slider',     'grainVal',     layer.grain);
}

/* ============================================================
   CANVAS ZOOM
   ============================================================ */

/**
 * Set canvas display zoom (not image zoom).
 * @param {number} zoom  e.g. 0.5 = 50%, 2 = 200%
 */
function setZoom(zoom) {
  canvasZoom = clamp(zoom, 0.1, 4);
  document.documentElement.style.setProperty('--canvas-zoom', canvasZoom);
  const pct = Math.round(canvasZoom * 100) + '%';
  if (zoomDisplay) zoomDisplay.textContent = pct;
  if (zoomStatus)  zoomStatus.textContent  = pct;
}

/** Fit canvas to viewport */
function fitCanvas() {
  const vp = canvasViewport;
  if (!vp) return;
  const vpW = vp.clientWidth  - 40;
  const vpH = vp.clientHeight - 40;
  const zw  = vpW / canvas.width;
  const zh  = vpH / canvas.height;
  setZoom(Math.min(zw, zh));
}

/* ============================================================
   DOWNLOAD
   ============================================================ */

/**
 * Render the canvas to PNG and trigger a file download.
 */
function downloadResult() {
  render();
  const link = document.createElement('a');
  link.download = `photo-merge-${Date.now()}.png`;
  link.href     = canvas.toDataURL('image/png');
  link.click();
  showHint('Image downloaded!');
}

/* ============================================================
   DRAG-TO-MOVE LAYER ON CANVAS
   ============================================================ */

let isDragging  = false;
let dragLayerId = null;
let dragStartX  = 0;
let dragStartY  = 0;
let dragLayerStartX = 0;
let dragLayerStartY = 0;

/**
 * Convert a mouse/touch event to canvas-space coordinates
 * (accounts for CSS zoom transform).
 */
function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  // rect already accounts for CSS transform scale
  return {
    x: (clientX - rect.left) * (canvas.width  / rect.width),
    y: (clientY - rect.top)  * (canvas.height / rect.height)
  };
}

/**
 * Check if a canvas-space point is within a layer's transformed bounds.
 * Returns true if the point is inside the (rotated, scaled) bounding rect.
 */
function pointInLayer(px, py, layer) {
  if (!layer.image) return false;
  const iw = (layer.image instanceof HTMLImageElement
    ? layer.image.naturalWidth  : layer.image.width)  * layer.scale;
  const ih = (layer.image instanceof HTMLImageElement
    ? layer.image.naturalHeight : layer.image.height) * layer.scale;

  // Translate to layer-local coordinates
  const dx = px - layer.x;
  const dy = py - layer.y;
  const rad = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(-rad), sin = Math.sin(-rad);
  const lx  = dx * cos - dy * sin;
  const ly  = dx * sin + dy * cos;

  return Math.abs(lx) <= iw / 2 && Math.abs(ly) <= ih / 2;
}

canvas.addEventListener('mousedown', e => {
  const pt = canvasPoint(e);
  // Check layers top→bottom (3 is on top)
  for (let id = 3; id >= 1; id--) {
    if (pointInLayer(pt.x, pt.y, layers[id])) {
      isDragging       = true;
      dragLayerId      = id;
      dragStartX       = pt.x;
      dragStartY       = pt.y;
      dragLayerStartX  = layers[id].x;
      dragLayerStartY  = layers[id].y;
      setActiveLayer(id);
      canvas.classList.add('dragging');
      e.preventDefault();
      break;
    }
  }
});

canvas.addEventListener('mousemove', e => {
  if (!isDragging) return;
  const pt = canvasPoint(e);
  layers[dragLayerId].x = dragLayerStartX + (pt.x - dragStartX);
  layers[dragLayerId].y = dragLayerStartY + (pt.y - dragStartY);
  // Update position inputs
  const posX = document.getElementById('pos-x');
  const posY = document.getElementById('pos-y');
  if (posX) posX.value = Math.round(layers[dragLayerId].x);
  if (posY) posY.value = Math.round(layers[dragLayerId].y);
  render();
});

const endDrag = () => {
  if (isDragging) {
    isDragging  = false;
    dragLayerId = null;
    canvas.classList.remove('dragging');
  }
};
canvas.addEventListener('mouseup',    endDrag);
canvas.addEventListener('mouseleave', endDrag);

// Touch events
canvas.addEventListener('touchstart', e => {
  const pt = canvasPoint(e);
  for (let id = 3; id >= 1; id--) {
    if (pointInLayer(pt.x, pt.y, layers[id])) {
      isDragging = true; dragLayerId = id;
      dragStartX = pt.x; dragStartY = pt.y;
      dragLayerStartX = layers[id].x; dragLayerStartY = layers[id].y;
      setActiveLayer(id); e.preventDefault(); break;
    }
  }
}, { passive: false });

canvas.addEventListener('touchmove', e => {
  if (!isDragging) return;
  const pt = canvasPoint(e);
  layers[dragLayerId].x = dragLayerStartX + (pt.x - dragStartX);
  layers[dragLayerId].y = dragLayerStartY + (pt.y - dragStartY);
  render(); e.preventDefault();
}, { passive: false });

canvas.addEventListener('touchend', endDrag);

/* ============================================================
   SIDEBAR RESIZE
   ============================================================ */

const resizeHandle = document.getElementById('resizeHandle');
const sidebar      = document.getElementById('sidebar');
let   isResizing   = false;

resizeHandle.addEventListener('mousedown', e => {
  isResizing = true;
  resizeHandle.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  e.preventDefault();
});

document.addEventListener('mousemove', e => {
  if (!isResizing) return;
  const newWidth = clamp(e.clientX, 220, 520);
  sidebar.style.width = newWidth + 'px';
  document.documentElement.style.setProperty('--sidebar-width', newWidth + 'px');
});

document.addEventListener('mouseup', () => {
  if (isResizing) {
    isResizing = false;
    resizeHandle.classList.remove('dragging');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }
});

/* ============================================================
   TAB SWITCHING
   ============================================================ */

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    const panel = document.getElementById(`tab-${tab}`);
    if (panel) panel.classList.add('active');
  });
});

/* ============================================================
   LAYER CARD INTERACTIONS
   ============================================================ */

// Click to select layer
document.querySelectorAll('.layer-card').forEach(card => {
  card.addEventListener('click', e => {
    // Don't activate if clicking the delete button
    if (e.target.classList.contains('btn-delete')) return;
    setActiveLayer(parseInt(card.dataset.layer, 10));
  });
});

// Delete layer button
document.querySelectorAll('.btn-delete').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const id = parseInt(btn.dataset.layer, 10);
    layers[id].image = null;
    originalImages[id] = null;
    updateThumbnail(id);
    render();
    showHint(`Layer ${id} cleared`);
  });
});

// Choose button
document.querySelectorAll('.btn-choose').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.layer;
    document.getElementById(`fileInput${id}`).click();
  });
});

/* ============================================================
   FILE INPUTS
   ============================================================ */

[1, 2, 3].forEach(id => {
  document.getElementById(`fileInput${id}`).addEventListener('change', function() {
    if (this.files && this.files[0]) {
      loadImageFile(this.files[0], id);
      this.value = ''; // allow re-selecting same file
    }
  });
});

/* ============================================================
   DRAG & DROP ON LAYER CARDS
   ============================================================ */

document.querySelectorAll('.layer-drop-zone').forEach(zone => {
  const id = parseInt(zone.dataset.layer, 10);

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', e => {
    if (!zone.contains(e.relatedTarget)) zone.classList.remove('drag-over');
  });

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadImageFile(file, id);
  });
});

/* ============================================================
   TOOLBAR BUTTONS
   ============================================================ */

// Layer-upload toolbar buttons (L1 ↑ / L2 ↑ / L3 ↑)
document.querySelectorAll('[data-layer-upload]').forEach(btn => {
  btn.addEventListener('click', () => {
    const id = btn.dataset.layerUpload;
    document.getElementById(`fileInput${id}`).click();
  });
});

document.getElementById('btnZoomIn').addEventListener('click',  () => setZoom(canvasZoom * 1.2));
document.getElementById('btnZoomOut').addEventListener('click', () => setZoom(canvasZoom / 1.2));
document.getElementById('btnFit').addEventListener('click', fitCanvas);
document.getElementById('btnCenterCanvas').addEventListener('click', () => {
  // Scroll viewport so canvas is centred
  canvasViewport.scrollTo({
    left: (canvasContainer.offsetWidth  - canvasViewport.clientWidth)  / 2,
    top:  (canvasContainer.offsetHeight - canvasViewport.clientHeight) / 2,
    behavior: 'smooth'
  });
});
document.getElementById('btnDownload').addEventListener('click', downloadResult);
document.getElementById('btnClearAll').addEventListener('click', () => {
  if (!confirm('Clear all layers?')) return;
  [1,2,3].forEach(id => {
    layers[id].image = null;
    originalImages[id] = null;
    updateThumbnail(id);
  });
  render();
  showHint('All layers cleared');
});

/* ============================================================
   BASIC TAB CONTROLS
   ============================================================ */

// Generic slider/select handler — updates the active layer property
function attachPropControl(elId, prop, transform) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.addEventListener('input', () => {
    const rawVal = parseFloat(el.value);
    const val    = transform ? transform(rawVal) : rawVal;
    layers[activeLayer][prop] = val;
    render();
    // Update badge if exists
    const badge = el.parentElement.querySelector('.val-badge');
    if (badge) badge.textContent = Math.round(rawVal);
  });
}

// Opacity: slider 0-100 → layer.opacity 0-1
attachPropControl('opacity-slider',   'opacity',     v => v / 100);
// Scale: slider 10-300 → layer.scale 0.1-3
attachPropControl('scale-slider',     'scale',       v => v / 100);
// Rotation: slider 0-360 → layer.rotation degrees
attachPropControl('rotation-slider',  'rotation',    null);
// Filters
attachPropControl('brightness-slider','brightness',  null);
attachPropControl('contrast-slider',  'contrast',    null);
attachPropControl('saturation-slider','saturation',  null);
attachPropControl('temperature-slider','temperature',null);
attachPropControl('hue-slider',       'hue',         null);
// Effects
attachPropControl('blur-slider',      'blur',        null);
attachPropControl('sharpness-slider', 'sharpness',   null);
attachPropControl('vignette-slider',  'vignette',    null);
attachPropControl('hdr-slider',       'hdr',         null);
attachPropControl('grain-slider',     'grain',       null);

// Position inputs
document.getElementById('pos-x').addEventListener('input', function() {
  layers[activeLayer].x = parseFloat(this.value) || 0;
  render();
});
document.getElementById('pos-y').addEventListener('input', function() {
  layers[activeLayer].y = parseFloat(this.value) || 0;
  render();
});

// Blend mode
document.getElementById('blend-mode').addEventListener('change', function() {
  layers[activeLayer].blendMode = this.value;
  render();
});

// Basic action buttons
document.getElementById('btnCenter').addEventListener('click', () => {
  layers[activeLayer].x = canvas.width  / 2;
  layers[activeLayer].y = canvas.height / 2;
  render(); updateUI();
});

document.getElementById('btnReset').addEventListener('click', () => {
  const id = activeLayer;
  layers[id].scale = 1; layers[id].rotation = 0; layers[id].opacity = 1;
  layers[id].flipX = false; layers[id].flipY = false;
  layers[id].blendMode = 'source-over';
  layers[id].x = canvas.width / 2; layers[id].y = canvas.height / 2;
  render(); updateUI();
  showHint(`Layer ${id} transform reset`);
});

document.getElementById('btnFlipH').addEventListener('click', () => {
  layers[activeLayer].flipX = !layers[activeLayer].flipX;
  render();
});
document.getElementById('btnFlipV').addEventListener('click', () => {
  layers[activeLayer].flipY = !layers[activeLayer].flipY;
  render();
});

/* ============================================================
   FILTER PRESETS
   ============================================================ */

const filterPresets = {
  reset:   { brightness:  0, contrast:  0, saturation:  0, temperature:  0, hue: 0 },
  bw:      { brightness:  0, contrast: 10, saturation:-100, temperature:  0, hue: 0 },
  sepia:   { brightness: -5, contrast:  5, saturation: -60, temperature: 40, hue: 0 },
  warm:    { brightness:  5, contrast:  5, saturation: 10,  temperature: 60, hue: 0 },
  cold:    { brightness:  0, contrast:  5, saturation:  5,  temperature:-60, hue: 0 },
  vintage: { brightness: -10, contrast:-10, saturation:-30, temperature: 20, hue: 15 }
};

document.querySelectorAll('[data-filter-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = filterPresets[btn.dataset.filterPreset];
    if (!preset) return;
    Object.assign(layers[activeLayer], preset);
    render(); updateUI();
    showHint(`Filter preset: ${btn.dataset.filterPreset}`);
  });
});

/* ============================================================
   EFFECT PRESETS
   ============================================================ */

const effectPresets = {
  soft:   { blur: 2,  sharpness:  0, vignette: 20, hdr:  0, grain:  0 },
  drama:  { blur: 0,  sharpness: 40, vignette: 50, hdr: 60, grain: 10 },
  dream:  { blur: 4,  sharpness:  0, vignette: 30, hdr: 20, grain:  5 },
  gritty: { blur: 0,  sharpness: 80, vignette: 60, hdr: 40, grain: 60 },
  cinema: { blur: 1,  sharpness: 20, vignette: 70, hdr: 30, grain: 20 }
};

document.querySelectorAll('[data-effect-preset]').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = effectPresets[btn.dataset.effectPreset];
    if (!preset) return;
    Object.assign(layers[activeLayer], preset);
    render(); updateUI();
    showHint(`Effect preset: ${btn.dataset.effectPreset}`);
  });
});

/* ============================================================
   BACKGROUND TAB
   ============================================================ */

document.getElementById('btnGrabcut').addEventListener('click', () =>
  smartRemoveBackground(activeLayer, 'grabcut'));
document.getElementById('btnCenterObj').addEventListener('click', () =>
  smartRemoveBackground(activeLayer, 'center'));
document.getElementById('btnContrast').addEventListener('click', () =>
  smartRemoveBackground(activeLayer, 'contrast'));
document.getElementById('btnFlood').addEventListener('click', () =>
  smartRemoveBackground(activeLayer, 'flood'));

document.querySelectorAll('.btn-color').forEach(btn => {
  btn.addEventListener('click', () =>
    removeColorFromBackground(activeLayer, btn.dataset.color));
});

document.getElementById('btnRestoreOrig').addEventListener('click', () =>
  restoreOriginal(activeLayer));

document.getElementById('btnExpand').addEventListener('click', () =>
  fineTuneAlpha(activeLayer, 'expand'));
document.getElementById('btnContract').addEventListener('click', () =>
  fineTuneAlpha(activeLayer, 'contract'));
document.getElementById('btnSmoothEdges').addEventListener('click', () =>
  fineTuneAlpha(activeLayer, 'smooth'));
document.getElementById('btnInvert').addEventListener('click', () =>
  fineTuneAlpha(activeLayer, 'invert'));

// Sensitivity slider badge
document.getElementById('sensitivity-slider').addEventListener('input', function() {
  document.getElementById('sensitivityVal').textContent = this.value;
});

/* ============================================================
   UI SCALE
   ============================================================ */

document.getElementById('uiScaleSlider').addEventListener('input', function() {
  uiScale = parseFloat(this.value) / 100;
  document.documentElement.style.setProperty('--ui-scale', uiScale);
  document.getElementById('uiScaleVal').textContent = this.value + '%';
});

/* ============================================================
   HINT TOAST
   ============================================================ */

let hintTimeout = null;

/**
 * Show a brief animated notification toast.
 * @param {string} message
 */
function showHint(message) {
  hintToast.textContent = message;
  hintToast.classList.add('show');
  if (hintTimeout) clearTimeout(hintTimeout);
  hintTimeout = setTimeout(() => hintToast.classList.remove('show'), 2500);
}

/* ============================================================
   SPINNER
   ============================================================ */

function showSpinner(label) {
  if (spinnerLabel) spinnerLabel.textContent = label || 'Processing…';
  if (spinnerOverlay) spinnerOverlay.style.display = 'flex';
}

function hideSpinner() {
  if (spinnerOverlay) spinnerOverlay.style.display = 'none';
}

/* ============================================================
   STATUS BAR
   ============================================================ */

function setStatus(msg) {
  if (statusMsg) statusMsg.textContent = msg;
}

/* ============================================================
   KEYBOARD SHORTCUTS
   ============================================================ */

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

  switch (e.key) {
    case '1': setActiveLayer(1); break;
    case '2': setActiveLayer(2); break;
    case '3': setActiveLayer(3); break;
    case '+':
    case '=': setZoom(canvasZoom * 1.2); break;
    case '-': setZoom(canvasZoom / 1.2); break;
    case 'f':
    case 'F': fitCanvas(); break;
    case 's':
    case 'S':
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); downloadResult(); }
      break;
  }
});

/* ============================================================
   INIT
   ============================================================ */

(function init() {
  // Initial render (blank canvas)
  render();
  // Fit to viewport — small delay to let CSS layout complete before measuring dimensions
  setTimeout(fitCanvas, 100);
  // Set active layer card highlight
  setActiveLayer(1);
  showHint('Welcome! Drop images on layers or click Choose.');
})();
