(function attachQuickMenuHotkeys(global) {
  function createQuickMenuHotkeys({ timeoutMs = 850, isRootDigit, openRoot, selectCurrentItem, isMenuOpen, setTimer = global.setTimeout, clearTimer = global.clearTimeout } = {}) {
    let digits = "";
    let timer = null;

    function clear() {
      if (timer) clearTimer(timer);
      timer = null;
      digits = "";
    }

    function armTimeout() {
      if (timer) clearTimer(timer);
      timer = setTimer(clear, timeoutMs);
    }

    // A path always starts at a numbered top-level tab. The next two digits
    // select the visible numbered rows, so dynamic menus keep their own truth.
    function acceptDigit(digit) {
      if (!/^[0-9]$/.test(String(digit || ""))) return false;
      if (!digits) {
        if (!isRootDigit?.(digit)) return false;
        // Opening a root menu closes existing panels. That route can call
        // closeMainMenu(), so record the first digit only after it returns.
        openRoot?.(digit);
        digits = digit;
        armTimeout();
        return true;
      }

      const depth = digits.length;
      digits += digit;
      if (depth >= 2) {
        // Three levels are the deliberate limit. Clear first because the
        // selected action may synchronously close the menu.
        clear();
        selectCurrentItem?.(digit);
        return true;
      }

      if (selectCurrentItem?.(digit) === false) {
        clear();
        return true;
      }
      if (!isMenuOpen?.()) {
        clear();
        return true;
      }
      armTimeout();
      return true;
    }

    return { acceptDigit, clear, get pendingPath() { return digits; } };
  }

  global.QuickMenuHotkeys = { createQuickMenuHotkeys };
})(window);
