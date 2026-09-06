// Lock-screen artwork, drawn from the palette.
//
// Without this Android falls back to whatever it can find for the page — on
// a Pixel that turned out to be a letterform lifted from the domain name,
// blown up and blurred behind the controls. Media Session takes an artwork
// list, so the thing on the lock screen may as well be the same light the
// page is showing: each identity gets its own image, in its own colour.
//
// Drawn on a canvas rather than shipped as files because there is one per
// palette and they are derived from values that already exist.

const CACHE = new Map();

// Canvas cannot parse `oklch(... calc(...) ...)`, and reading a custom
// property back gives the unresolved declaration. Resolving through an
// element's computed colour is the reliable way round it.
function resolve(css) {
  const probe = document.createElement('span');
  probe.style.color = css;
  probe.style.position = 'absolute';
  probe.style.opacity = '0';
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value || '#e3a24d';
}

function bloom(ctx, x, y, radius, colour, alpha) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, colour);
  gradient.addColorStop(1, 'transparent');
  ctx.globalAlpha = alpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

/**
 * A square image for `palette`, as a data URL. Cached: the same identity
 * always looks the same, and this runs on every chunk.
 */
export function paletteArtwork(palette, size = 512, type = 'image/jpeg') {
  if (!palette) return null;
  const key = palette.name + ':' + size + ':' + type;
  if (CACHE.has(key)) return CACHE.get(key);

  const hue = palette.hue !== undefined ? palette.hue : 40;
  const chroma = palette.chroma !== undefined ? palette.chroma : 0.05;
  const ground = resolve(`oklch(0.13 ${chroma * 0.5} ${hue})`);
  const deep = resolve(`oklch(0.08 ${chroma * 0.4} ${hue})`);
  const light = resolve(`oklch(0.72 ${chroma + 0.05} ${hue})`);
  const ink = resolve(`oklch(0.86 ${chroma * 0.3} ${hue})`);

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, size, size);

  // The same two pools of light the page has behind it.
  ctx.globalCompositeOperation = 'lighter';
  bloom(ctx, size * 0.3, size * 0.28, size * 0.55, light, 0.42);
  bloom(ctx, size * 0.74, size * 0.76, size * 0.6, light, 0.3);
  ctx.globalCompositeOperation = 'source-over';

  // Darker at the corners, so it reads as a space rather than a swatch.
  const edge = ctx.createRadialGradient(size / 2, size * 0.45, size * 0.2, size / 2, size / 2, size * 0.78);
  edge.addColorStop(0, 'transparent');
  edge.addColorStop(1, deep);
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, size, size);

  // The mark. Small and low-contrast: the lock screen prints the track name
  // beside this anyway, so the image should not repeat it loudly. A favicon
  // has no such caption and only a few pixels, so there the mark fills the
  // tile and the wordmark under it is dropped rather than smeared.
  const tiny = size < 96;
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.92;
  ctx.font = `700 ${Math.round(size * (tiny ? 0.3 : 0.115))}px "Space Mono", ui-monospace, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('076', size / 2, size * (tiny ? 0.52 : 0.47));
  if (!tiny) {
    ctx.globalAlpha = 0.55;
    ctx.font = `400 ${Math.round(size * 0.05)}px "Space Mono", ui-monospace, monospace`;
    ctx.fillText('lofi', size / 2, size * 0.585);
  }
  ctx.globalAlpha = 1;

  // JPEG by default: Chrome dithers its gradients, and that noise is
  // incompressible losslessly — the same image was 310 KB as a PNG. The
  // build-time icons ask for PNG because that is what a favicon link wants.
  const url = canvas.toDataURL(type, 0.9);
  CACHE.set(key, url);
  return url;
}

/** The artwork list Media Session expects, at the sizes Android asks for. */
export function artworkFor(palette) {
  const sizes = [256, 512];
  return sizes
    .map((size) => ({ src: paletteArtwork(palette, size), sizes: `${size}x${size}`, type: 'image/jpeg' }))
    .filter((entry) => entry.src);
}
