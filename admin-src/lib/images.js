const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

function imageError(message) {
  const error = new Error(message);
  error.name = 'ImageProcessingError';
  return error;
}

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari and older Chromium may reject imageOrientation; retry without it.
      return createImageBitmap(file);
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function canvasBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(imageError('浏览器无法生成所需图片格式，请换用最新版 Chrome 或 Edge'));
    }, mime, quality);
  });
}

async function makeVariant(source, sourceWidth, sourceHeight, maxWidth, mime, quality) {
  const width = Math.min(maxWidth, sourceWidth);
  const height = Math.max(1, Math.round((sourceHeight * width) / sourceWidth));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { alpha: false });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, width, height);
  const blob = await canvasBlob(canvas, mime, quality);
  return { blob, width, height, mime };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(imageError('读取处理后的图片失败'));
    reader.readAsDataURL(blob);
  });
}

function fileSlug(filename) {
  const basename = filename.replace(/\.[^.]+$/, '').toLowerCase();
  const ascii = basename
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return ascii || 'journey-photo';
}

export async function prepareResponsiveImage(file) {
  if (!(file instanceof File)) throw imageError('请选择图片文件');
  if (!ACCEPTED_TYPES.has(file.type)) throw imageError('目前支持 JPG、PNG、WebP 图片');
  if (file.size > MAX_INPUT_BYTES) throw imageError('原图不能超过20MB');

  const source = await loadBitmap(file);
  const sourceWidth = source.width || source.naturalWidth;
  const sourceHeight = source.height || source.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw imageError('无法读取图片尺寸');
  if (sourceWidth < 720 || sourceHeight < 480) throw imageError('图片分辨率过低，建议至少720×480像素');

  try {
    const outputs = await Promise.all([
      makeVariant(source, sourceWidth, sourceHeight, 480, 'image/webp', 0.78),
      makeVariant(source, sourceWidth, sourceHeight, 960, 'image/webp', 0.8),
      makeVariant(source, sourceWidth, sourceHeight, 1600, 'image/webp', 0.82),
      makeVariant(source, sourceWidth, sourceHeight, 960, 'image/jpeg', 0.84),
    ]);
    const keys = ['webp480', 'webp960', 'webp1600', 'fallback'];
    const variants = await Promise.all(outputs.map(async (output, index) => ({
      key: keys[index],
      mime: output.mime,
      width: output.width,
      height: output.height,
      base64: await blobToBase64(output.blob),
    })));
    return {
      slug: fileSlug(file.name),
      variants,
      previewUrl: URL.createObjectURL(outputs[2].blob),
      original: { width: sourceWidth, height: sourceHeight, bytes: file.size },
      outputBytes: outputs.reduce((total, output) => total + output.blob.size, 0),
    };
  } finally {
    if (typeof source.close === 'function') source.close();
  }
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
