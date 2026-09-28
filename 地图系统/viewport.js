(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MapViewport = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function compute({ width, height, worldWidth, worldHeight, viewWidth, viewHeight, playerX, playerY, tileSize }) {
    const mapScale = Math.min(width / viewWidth, height / viewHeight);
    const mapViewportW = viewWidth * mapScale;
    const mapViewportH = viewHeight * mapScale;
    const mapViewportX = (width - mapViewportW) / 2;
    const mapViewportY = 0;
    const targetCameraX = (playerX + tileSize / 2) - viewWidth / 2;
    const targetCameraY = (playerY + tileSize / 2) - viewHeight / 2;
    const cameraX = worldWidth <= viewWidth ? -(viewWidth - worldWidth) / 2 : Math.max(0, Math.min(worldWidth - viewWidth, targetCameraX));
    const cameraY = worldHeight <= viewHeight ? -(viewHeight - worldHeight) / 2 : Math.max(0, Math.min(worldHeight - viewHeight, targetCameraY));
    return { mapScale, mapViewportW, mapViewportH, mapViewportX, mapViewportY, cameraX, cameraY };
  }

  return { compute };
});
