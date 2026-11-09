/* ============================================================================
   HOMURA · 自定义封面
   ----------------------------------------------------------------------------
   验证并缩小本地图片，封面单独存入元数据，不修改书本原文件。
   ========================================================================== */

export async function prepareBookCover(file: File) {
  if (!file || !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)) throw new Error('请选择 PNG、JPG、WebP、GIF、AVIF 或 BMP 图片');
  if (file.size > 20 * 1024 * 1024) throw new Error('封面图片请小于 20 MB');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法处理这张图片')), 'image/webp', 0.9));
  } catch (err) {
    throw new Error('无法读取这张图片，请换一张有效的图片');
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 读取某本书封面卡片在视口中的位置，作为共享元素展开动画的起点。
 * 返回 null 表示当前屏幕上没有对应封面（例如从"最近阅读"首屏点进来）。
 */
export function readBookCoverRect(id: string): { left: number; top: number; width: number; height: number } | null {
  if (typeof document === 'undefined') return null;
  const safe = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id;
  const el = document.querySelector(`[data-book-cover-id="${safe}"]`) as HTMLElement | null;
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}
