(function () {
  "use strict";

  const frameParts = {
    corners: ["tl", "tr", "bl", "br"],
    edges: ["top", "right", "bottom", "left"]
  };

  function decorateFrame(element, options = {}) {
    if (!element || Array.from(element.children).some((child) => child.classList?.contains("menu-frame-corner"))) return;
    const cornerClass = options.cornerClass || "menu-frame-corner";
    const edgeClass = options.edgeClass || "menu-frame-edge";
    frameParts.corners.forEach((pos) => {
      const corner = document.createElement("i");
      corner.className = `${cornerClass} ${pos}`;
      element.appendChild(corner);
    });
    frameParts.edges.forEach((pos) => {
      const edge = document.createElement("i");
      edge.className = `${edgeClass} ${pos}`;
      element.appendChild(edge);
    });
  }

  function stripFrame(element) {
    element?.querySelectorAll(".menu-frame-corner, .menu-frame-edge, .role-frame-corner, .role-frame-edge").forEach((node) => node.remove());
  }

  function setSingleTitle(tabsElement, enabled = true) {
    tabsElement?.classList.toggle("single-title", Boolean(enabled));
    if (enabled) tabsElement?.classList.remove("tab-deck");
    else tabsElement?.classList.remove("secondary-title");
  }

  function decorateTabDeck(tabsElement) {
    if (!tabsElement) return;
    tabsElement.classList.remove("single-title");
    tabsElement.classList.add("tab-deck");
    tabsElement.querySelectorAll(":scope > .menu-frame-corner, :scope > .menu-frame-edge").forEach((node) => node.remove());
    tabsElement.querySelectorAll(":scope > button").forEach((button, index) => {
      button.style.setProperty("--tab-stack-index", String(index + 1));
      decorateFrame(button);
    });
  }

  function decorateSecondaryTitle(tabsElement) {
    if (!tabsElement) return;
    tabsElement.classList.remove("tab-deck");
    tabsElement.classList.add("single-title", "secondary-title");
    tabsElement.querySelectorAll(":scope > .menu-frame-corner, :scope > .menu-frame-edge").forEach((node) => node.remove());
    const titleButton = tabsElement.querySelector(":scope > button");
    if (titleButton) decorateFrame(titleButton);
  }

  function decorateButtons(root = document) {
    root.querySelectorAll?.(".menu-framed-button").forEach(decorateFrame);
  }

  window.MenuUI = Object.freeze({
    decorateFrame,
    decorateSecondaryTitle,
    decorateTabDeck,
    stripFrame,
    setSingleTitle,
    decorateButtons
  });
})();
