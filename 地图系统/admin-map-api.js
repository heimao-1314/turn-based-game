"use strict";

function createAdminMapApi(options) {
  const registry = options.registry;
  const checkAdmin = options.checkAdmin;
  const sendJson = options.sendJson;

  function handleGet(req, res, url) {
    if (url.pathname === "/api/maps/manifest") {
      sendJson(res, 200, registry.manifest());
      return true;
    }
    if (!url.pathname.startsWith("/api/admin/maps")) return false;
    if (!checkAdmin(req, res)) return true;
    if (url.pathname === "/api/admin/maps/scan") {
      sendJson(res, 200, registry.manifest());
      return true;
    }
    if (url.pathname === "/api/admin/maps/config") {
      sendJson(res, 200, registry.manifest());
      return true;
    }
    return false;
  }

  function handlePost(req, res, url, data) {
    if (!url.pathname.startsWith("/api/admin/maps")) return false;
    if (!checkAdmin(req, res, data)) return true;
    if (url.pathname === "/api/admin/maps/scan") {
      sendJson(res, 200, registry.manifest());
      return true;
    }
    if (url.pathname === "/api/admin/maps/save") {
      const config = registry.readConfig();
      if (Array.isArray(data.maps)) config.maps = data.maps;
      if (Array.isArray(data.portals)) config.portals = data.portals;
      registry.writeConfig(config);
      sendJson(res, 200, registry.manifest());
      return true;
    }
    if (url.pathname === "/api/admin/maps/portals") {
      registry.savePortals(data.portals || []);
      sendJson(res, 200, registry.manifest());
      return true;
    }
    return false;
  }

  return { handleGet, handlePost };
}

module.exports = { createAdminMapApi };
