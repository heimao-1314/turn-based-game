(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.MapViewport = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function snapToDevicePixel(value, devicePixelRatio) {
    return Math.round(value * devicePixelRatio) / devicePixelRatio;
  }

  function snapCamera(camera, viewportOffset, scale, devicePixelRatio) {
    const snappedOrigin = snapToDevicePixel(viewportOffset - camera * scale, devicePixelRatio);
    return (viewportOffset - snappedOrigin) / scale;
  }

  function snapPoint(point, devicePixelRatio) {
    return {
      x: snapToDevicePixel(point.x, devicePixelRatio),
      y: snapToDevicePixel(point.y, devicePixelRatio)
    };
  }

  function compute({ width, height, worldWidth, worldHeight, viewWidth, viewHeight, playerX, playerY, tileSize, devicePixelRatio }) {
    const mapScale = Math.min(width / viewWidth, height / viewHeight);
    const mapViewportW = viewWidth * mapScale;
    const mapViewportH = viewHeight * mapScale;
    const mapViewportX = (width - mapViewportW) / 2;
    const mapViewportY = 0;
    const targetCameraX = (playerX + tileSize / 2) - viewWidth / 2;
    const targetCameraY = (playerY + tileSize / 2) - viewHeight / 2;
    let cameraX = worldWidth <= viewWidth ? -(viewWidth - worldWidth) / 2 : Math.max(0, Math.min(worldWidth - viewWidth, targetCameraX));
    let cameraY = worldHeight <= viewHeight ? -(viewHeight - worldHeight) / 2 : Math.max(0, Math.min(worldHeight - viewHeight, targetCameraY));
    if (devicePixelRatio > 0) {
      cameraX = snapCamera(cameraX, mapViewportX, mapScale, devicePixelRatio);
      cameraY = snapCamera(cameraY, mapViewportY, mapScale, devicePixelRatio);
    }
    return { mapScale, mapViewportW, mapViewportH, mapViewportX, mapViewportY, cameraX, cameraY };
  }

  return { compute, snapPoint };
});
