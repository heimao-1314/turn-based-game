(function initLoginMediaPolicy(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.LoginMediaPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createLoginMediaPolicy() {
  function shouldUseStaticImage(userAgent = "") {
    return /\b(?:Chrome|Chromium|Edg|OPR)\//.test(String(userAgent));
  }

  return Object.freeze({ shouldUseStaticImage });
});
