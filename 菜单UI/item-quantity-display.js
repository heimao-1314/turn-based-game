(function attachItemQuantityDisplay(global) {
  const DIGIT_WIDTH = 7;
  const STACK_SIZE = 100;

  function normalizeQuantity(value) {
    return Math.max(0, Math.floor(Number(value) || 0));
  }

  function displayFor(quantity) {
    const amount = normalizeQuantity(quantity);
    if (amount < 1) return { badge: "", groupLabel: "" };

    return {
      badge: String(Math.min(amount, STACK_SIZE - 1)),
      groupLabel: amount >= STACK_SIZE ? `（${Math.ceil(amount / STACK_SIZE)}组）` : ""
    };
  }

  function badgeHtml(quantity) {
    const { badge } = displayFor(quantity);
    if (!badge) return "";

    const digits = [...badge].map((digit) => {
      const offset = Number(digit) * DIGIT_WIDTH;
      return `<i class=\"item-quantity-digit\" style=\"background-position:-${offset}px 0\"></i>`;
    }).join("");
    return `<span class=\"item-quantity-badge\" aria-label=\"数量 ${badge}\">${digits}</span>`;
  }

  function iconHtml(iconHtml, quantity) {
    return `<span class=\"item-quantity-icon\">${iconHtml}${badgeHtml(quantity)}</span>`;
  }

  global.ItemQuantityDisplay = { displayFor, badgeHtml, iconHtml };
}(window));
