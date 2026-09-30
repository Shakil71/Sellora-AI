/*!
 * Sellora AI website chat loader.
 * <script src="https://YOUR-SELLORA-DOMAIN/widget.js" data-sellora-key="wc_..." async></script>
 * Optional: data-open="true" opens the chat on load.
 * API: window.SelloraChat.open(), .close(), .toggle()
 */
(function () {
  'use strict';
  if (window.SelloraChat && window.SelloraChat.__loaded) return;

  var script =
    document.currentScript ||
    (function () {
      var list = document.querySelectorAll('script[data-sellora-key]');
      return list[list.length - 1];
    })();
  if (!script) return;
  var key = script.getAttribute('data-sellora-key');
  if (!key || !/^wc_[0-9a-f]{24}$/.test(key)) {
    if (window.console) console.warn('[Sellora] Missing or invalid data-sellora-key on the widget script.');
    return;
  }
  var base = new URL(script.src, window.location.href).origin;
  var pageOrigin = window.location.origin;

  var CLOSED = { w: 88, h: 88 };
  var OPEN = { w: 400, h: 640 };
  var state = { open: false, position: 'right', ready: false };

  var frame = document.createElement('iframe');
  frame.src = base + '/widget/' + key + '?origin=' + encodeURIComponent(pageOrigin);
  frame.title = 'Chat';
  frame.setAttribute('allow', 'clipboard-write');
  frame.setAttribute('aria-label', 'Chat with us');
  var s = frame.style;
  s.position = 'fixed';
  s.bottom = '0';
  s.right = '0';
  s.border = '0';
  s.background = 'transparent';
  s.colorScheme = 'normal';
  s.zIndex = '2147483000';
  s.opacity = '0';
  s.pointerEvents = 'none'; // never block the page before the chat is ready
  s.transition = 'opacity .2s ease';
  s.maxWidth = '100vw';
  s.maxHeight = '100vh';

  function layout() {
    var mobile = window.innerWidth < 520;
    var size = state.open ? OPEN : CLOSED;
    if (state.open && mobile) {
      s.width = '100vw';
      s.height = '100dvh';
    } else {
      s.width = size.w + 'px';
      s.height = Math.min(size.h, window.innerHeight) + 'px';
    }
    s.left = state.position === 'left' ? '0' : 'auto';
    s.right = state.position === 'left' ? 'auto' : '0';
  }

  function post(type) {
    if (frame.contentWindow) frame.contentWindow.postMessage({ source: 'sellora-host', type: type, mobile: window.innerWidth < 520 }, base);
  }

  window.addEventListener('message', function (e) {
    if (e.origin !== base || !e.data || e.data.source !== 'sellora-widget') return;
    var d = e.data;
    if (d.type === 'ready') {
      state.ready = true;
      state.position = d.position === 'left' ? 'left' : 'right';
      s.opacity = '1';
      s.pointerEvents = 'auto';
      layout();
      post('host-info');
      if (script.getAttribute('data-open') === 'true') post('open');
    } else if (d.type === 'state') {
      state.open = Boolean(d.open);
      layout();
    }
  });
  window.addEventListener('resize', function () {
    layout();
    post('host-info');
  });

  function mount() {
    layout();
    document.body.appendChild(frame);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.SelloraChat = {
    __loaded: true,
    open: function () { post('open'); },
    close: function () { post('close'); },
    toggle: function () { post(state.open ? 'close' : 'open'); },
  };
})();
