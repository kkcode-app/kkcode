/**
 * [INPUT]: 接收图片原始宽高与可用视口宽高
 * [OUTPUT]: 对外提供 fitImageWithinViewport，返回保持宽高比且不溢出视口的尺寸
 * [POS]: utils/ 的图片布局纯函数，被 PartView 全屏图片预览与单元测试复用
 * [PROTOCOL]: 变更时更新此头部，然后检查 CLAUDE.md
 */

export type ImageViewportSize = {
  width: number;
  height: number;
};

export function fitImageWithinViewport(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ImageViewportSize {
  const safeViewportWidth = Math.max(1, viewportWidth);
  const safeViewportHeight = Math.max(1, viewportHeight);
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0
  ) {
    return {
      width: safeViewportWidth,
      height: Math.min(safeViewportHeight, Math.round(safeViewportWidth * 0.75)),
    };
  }

  const scale = Math.min(safeViewportWidth / imageWidth, safeViewportHeight / imageHeight);
  return {
    width: Math.max(1, Math.round(imageWidth * scale)),
    height: Math.max(1, Math.round(imageHeight * scale)),
  };
}
