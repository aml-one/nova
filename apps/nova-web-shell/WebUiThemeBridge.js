(function () {
  if (window !== window.top) {
    return;
  }
  function pushTheme() {
    try {
      var isDark = document.documentElement.classList.contains("dark");
      window.chrome.webview.postMessage(JSON.stringify({ type: "nova-theme", dark: isDark }));
    } catch (e) {}
  }
  if (!window.__novaThemeBridge) {
    window.__novaThemeBridge = true;
    pushTheme();
    new MutationObserver(pushTheme).observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"]
    });
  }
})();
