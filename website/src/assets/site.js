/* Design Engineer website: story player, build-receipt meter, contact form.
   No dependencies. Respects prefers-reduced-motion. */
(function () {
  'use strict';
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  function get(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? o : o[k]; }, obj);
  }
  function fill(tpl, vals) {
    return tpl.replace(/\{\{\s*([\w.$]+)\s*\}\}/g, function (_, p) {
      var v = get(vals, p);
      return v == null || v === false ? '' : String(v);
    });
  }

  // Binds elements produced from the design's template holes to live values.
  function binder(root, compute) {
    var current = {};
    var updates = [];
    $$('[data-t]', root).forEach(function (el) {
      updates.push(function (v) {
        var t = get(v, el.getAttribute('data-t'));
        t = t == null ? '' : String(t);
        if (el.textContent !== t) el.textContent = t;
      });
    });
    $$('*', root).forEach(function (el) {
      Array.prototype.slice.call(el.attributes).forEach(function (a) {
        if (a.name.indexOf('data-tpl-') !== 0) return;
        var name = a.name.slice(9), tpl = a.value;
        updates.push(function (v) {
          var val = fill(tpl, v);
          if (el.getAttribute(name) !== val) el.setAttribute(name, val);
        });
      });
    });
    $$('de-if', root).forEach(function (el) {
      updates.push(function (v) {
        var show = !!get(v, el.getAttribute('data-v'));
        if (el.hidden === show) el.hidden = !show;
      });
    });
    $$('[data-on-click]', root).forEach(function (el) {
      el.addEventListener('click', function (e) {
        var fn = get(current, el.getAttribute('data-on-click'));
        if (typeof fn === 'function') fn(e);
      });
    });
    return function render() {
      current = compute();
      updates.forEach(function (u) { u(current); });
    };
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function landingPage() {
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    var state = { tick: 0, meter: reduce ? 60 : 0, playing: !reduce };
    var meta = [
      { title: 'Select your frames', line: 'Pick the screens, the repo and your AI agent.' },
      { title: 'The plugin reads them', line: 'Your frames, plus the stack and components already in your repo.' },
      { title: 'Your build runs', line: 'The agent writes real components. The meter runs.' },
      { title: 'A pull request lands', line: 'Review it on GitHub and merge when it looks right.' }
    ];
    var colors = ['#0D99FF', '#B9A6FF', '#FFD23F', '#3CC995'];
    var render;
    function set(patch) { for (var k in patch) state[k] = patch[k]; render(); }
    function compute() {
      var step = Math.floor(state.tick / 20) % 4, within = state.tick % 20, playing = state.playing;
      var buildSec = step === 2 ? Math.min(402, Math.round(within / 18 * 402)) : 402;
      var meterSec = Math.min(402, Math.round(state.meter / 52 * 402));
      var done = meterSec >= 402;
      return {
        showFigma: step < 2, isSelect: step === 0, isRead: step === 1, isBuild: step === 2, isPR: step === 3,
        selHome: step < 2, selOthers: step === 1, selDelay: step === 0 ? '1.5s' : '0s',
        layerHomeBg: step < 2 ? '#0C5A96' : 'transparent', layerOtherBg: step === 1 ? '#0C5A96' : 'transparent',
        homeLabel: step < 2 ? '#0D99FF' : '#B3B3B3', otherLabel: step === 1 ? '#0D99FF' : '#B3B3B3',
        buildClock: pad(Math.floor(buildSec / 60)) + ':' + pad(buildSec % 60),
        buildPct: Math.round(buildSec / 900 * 100),
        chapters: meta.map(function (c, i) {
          var active = i === step;
          return {
            n: i + 1, title: c.title, line: c.line, active: active, pressed: active ? 'true' : 'false',
            bg: active ? colors[i] : '#2A2A31', fg: active ? '#17171C' : '#E4E4EA',
            barClass: playing ? 'de-progress' : '', barWidth: playing ? '0' : '100%',
            pick: function () { set({ tick: i * 20 }); }
          };
        }),
        playing: playing, paused: !playing, playLabel: playing ? 'Pause the story' : 'Play the story',
        togglePlay: function () { set({ playing: !state.playing }); },
        meterClock: done ? '6m 42s' : Math.floor(meterSec / 60) + 'm ' + pad(meterSec % 60) + 's',
        meterStatus: done ? 'Pull request opened' : 'Build running',
        meterPct: Math.round(meterSec / 402 * 100)
      };
    }
    render = binder(document, compute);
    render();
    fitStage();
    // Pause everything while the tab is hidden; nothing runs off-screen.
    setInterval(function () {
      if (document.hidden) return;
      var patch = { meter: reduce ? 60 : (state.meter + 1) % 72 };
      if (state.playing) patch.tick = (state.tick + 1) % 80;
      set(patch);
    }, 250);
  }

  // The story player is drawn at 1180×640. On narrower screens scale it down
  // to the available width instead of making people scroll sideways.
  function fitStage() {
    var stage = document.querySelector('[aria-label="Animated walkthrough of one build"]');
    if (!stage) return;
    var wrap = stage.parentElement;
    function fit() {
      var s = Math.min(1, wrap.clientWidth / 1180);
      stage.style.transformOrigin = 'top left';
      stage.style.transform = s < 1 ? 'scale(' + s + ')' : '';
      stage.style.margin = s < 1 ? '0' : '0 auto';
      wrap.style.height = s < 1 ? Math.round(640 * s) + 'px' : '';
      wrap.style.overflow = s < 1 ? 'hidden' : '';
    }
    fit();
    window.addEventListener('resize', fit);
  }

  function contactPage() {
    var form = document.getElementById('contact-form');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      var to = (form.getAttribute('action') || '').replace(/^mailto:/, '');
      if (!to || to.charAt(0) === '[') return; // support address not configured yet
      e.preventDefault();
      var data = new FormData(form);
      var subject = 'Design Engineer: ' + (data.get('topic') || 'Question');
      var body = (data.get('message') || '') + '\n\n— ' + (data.get('name') || '') + ' (' + (data.get('email') || '') + ')';
      window.location.href = 'mailto:' + to + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
    });
  }

  function start() {
    var page = document.body.getAttribute('data-page');
    if (page === 'main') landingPage();
    if (page === 'contact') contactPage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
