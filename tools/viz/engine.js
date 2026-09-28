/**
 * tools/viz/engine.js — the shared visualisation engine for blog.jaye.ch.
 *
 * blog.jaye.ch is deliberately self-contained: one HTML file per page, the
 * design CSS inlined, no external requests. This engine gives the interactive
 * figures the *component model* of the MFE framework (@mfe/core's
 * { mount, unmount, update } contract — see packages/core/src/types.ts) without
 * the framework: a widget registers itself with `registerViz(name, component)`
 * and `boot()` scans the page for [data-viz=NAME] slots and mounts the matching
 * component into each.
 *
 * Only the widgets a page actually uses are inlined next to this file — the
 * build (tools/build.mjs) tree-shakes by concatenation — so no page carries
 * dead code or fetches anything.
 *
 * Every widget is SCHEMATIC: it illustrates the mechanism the posts describe by
 * interpolating between numbers those posts already publish. It is not the
 * model, and it is not the solver.
 */
var VIZ = (function () {
  'use strict';

  /* ---------------------------------- registry ---------------------------------- */

  var registry = Object.create(null);

  /** Register an MFE-shaped widget. `name` is the value of a page's
   * `data-viz` attributes. The component is `{ mount, unmount, update }`. */
  function registerViz(name, component) {
    if (registry[name]) throw new Error('viz: "' + name + '" is already registered');
    if (!component || typeof component.mount !== 'function' || typeof component.unmount !== 'function') {
      throw new Error('viz: "' + name + '" must implement { mount, unmount, update }');
    }
    registry[name] = component;
    return component;
  }

  /** Names of every registered widget (diagnostics / build checks). */
  function names() {
    return Object.keys(registry);
  }

  /* -------------------------------- design tokens ------------------------------- */

  // Fallbacks mirror the tokens in design/blog.css; the live values are read
  // from :root so a widget always matches the site's palette.
  var TOKEN_FALLBACK = {
    bg: '#fbfaf7',
    bg2: '#f4f1ea',
    fg: '#1b1b1d',
    dim: '#66646d',
    accent: '#a4262c',
    accent2: '#2158b0',
    line: '#e6e1d6',
  };
  var tokens = null;

  function token(name) {
    if (!tokens) {
      tokens = {};
      var cs = window.getComputedStyle(document.documentElement);
      for (var k in TOKEN_FALLBACK) {
        var v = (cs.getPropertyValue('--' + k) || '').trim();
        tokens[k] = v || TOKEN_FALLBACK[k];
      }
    }
    return tokens[name] || TOKEN_FALLBACK[name] || '#000';
  }

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';
  var SANS = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  /* ---------------------------------- formatting -------------------------------- */

  /** Compact decimal: at most `digits` places, trailing zeros trimmed. */
  function fmt(v, digits) {
    if (!isFinite(v)) return '—';
    var d = digits == null ? 3 : digits;
    var s = v.toFixed(d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }

  /** Round ticks spanning [min, max] on 1/2/5·10ⁿ steps. */
  function ticks(min, max, count) {
    var n = count || 5;
    var span = max - min;
    if (!(span > 0)) return [min];
    var raw = span / n;
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    var out = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
      out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    }
    return out;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function lerp(a, b, u) {
    return a + (b - a) * u;
  }

  /* ----------------------------------- plumbing --------------------------------- */

  /** Size a canvas' backing store for the device and the width its CSS gives
   * it, and return a 2-D context already scaled to CSS pixels. The canvas'
   * own layout width is read (CSS gives it `width: 100%`), so the drawing
   * surface matches the content box exactly.
   *
   * A canvas that is not laid out (display:none ancestor, a collapsed
   * <details>) measures zero; it is then fitted to the content column and the
   * widget redraws when the container first gets a width — see bag.onResize,
   * which watches the slot with a ResizeObserver. */
  function fitCanvas(el, cssHeight, ariaLabel) {
    var measured = Math.round(el.clientWidth || (el.parentNode && el.parentNode.clientWidth) || 0);
    var w = Math.max(240, measured || 680);
    var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    el.width = Math.round(w * dpr);
    el.height = Math.round(cssHeight * dpr);
    el.setAttribute('role', 'img');
    if (ariaLabel) el.setAttribute('aria-label', ariaLabel);
    else if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'Interactive figure');
    var ctx = el.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, cssHeight);
    return { ctx: ctx, w: w, h: cssHeight };
  }

  /**
   * A plotting frame over a canvas: a padded plot rect, data→pixel scales and
   * the handful of drawing primitives the widgets need. Coordinates in the
   * primitives are always data-space; `textPx` takes CSS pixels.
   *
   *   frame(canvas, { height, xMin, xMax, yMin, yMax, pad, xLabel, yLabel })
   */
  function frame(el, opts) {
    var view = fitCanvas(el, opts.height || 280, opts.ariaLabel);
    var ctx = view.ctx;
    var W = view.w;
    var H = view.h;
    var pad = Object.assign({ l: 56, r: 20, t: 16, b: 42 }, opts.pad || {});
    var pw = Math.max(10, W - pad.l - pad.r);
    var ph = Math.max(10, H - pad.t - pad.b);
    var xMin = opts.xMin;
    var xMax = opts.xMax;
    var yMin = opts.yMin;
    var yMax = opts.yMax;
    var xSpan = xMax - xMin || 1;
    var ySpan = yMax - yMin || 1;
    var placed = []; // label rectangles already drawn in this frame
    var labels = []; // every label of this frame, in placement order

    function X(v) {
      return pad.l + ((v - xMin) / xSpan) * pw;
    }
    function Y(v) {
      return pad.t + (1 - (v - yMin) / ySpan) * ph;
    }

    function stroke(o) {
      ctx.strokeStyle = o.color || token('fg');
      ctx.lineWidth = o.width || 1.5;
      ctx.setLineDash(o.dash || []);
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
    }

    /** The vertical box a label's glyphs occupy, by baseline. */
    function labelBox(py, baseline) {
      if (baseline === 'top') return { y0: py - 1, y1: py + 12 };
      if (baseline === 'alphabetic') return { y0: py - 9, y1: py + 3 };
      return { y0: py - 7, y1: py + 7 }; // middle
    }

    /** Paint one label: an opaque patch of the panel colour behind the glyphs,
     * then the text. The patch is what keeps reference lines, grid rules, curves
     * and the time cursor from striking through a label. */
    function paint(str, px, py, o, x0, tw) {
      var box = labelBox(py, o.baseline);
      ctx.save();
      // the patch must be opaque whatever alpha the caller left behind
      var alpha = ctx.globalAlpha;
      ctx.globalAlpha = 1;
      ctx.fillStyle = token('bg');
      ctx.fillRect(x0 - 2, box.y0, tw + 4, box.y1 - box.y0);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = o.color || token('dim');
      ctx.font = o.font || '11px ' + MONO;
      ctx.textAlign = o.align || 'left';
      ctx.textBaseline = o.baseline || 'middle';
      ctx.fillText(str, px, py);
      ctx.restore();
    }

    function textPx(str, px, py, o) {
      o = o || {};
      var font = o.font || '11px ' + MONO;
      var align = o.align || 'left';
      // Labels never land on top of each other, and never leave the canvas:
      // each one is measured, then nudged off the first label it would sit on
      // (trying up, then down), staying inside the canvas.
      ctx.save();
      ctx.font = font;
      var tw = ctx.measureText(str).width;
      ctx.restore();
      var x0 = align === 'right' ? px - tw : align === 'center' ? px - tw / 2 : px;
      var usable = x0 >= 2 && x0 + tw <= W - 2;
      var py2 = py;
      var offsets = [0, -13, 13, -26, 26, -39, 39];
      for (var n = 0; n < offsets.length; n++) {
        var y = py + offsets[n];
        if (y - 6 < 2 || y + 6 > H - 2) continue;
        var clash = false;
        for (var i = 0; i < placed.length; i++) {
          var r = placed[i];
          if (x0 < r.x1 + 3 && x0 + tw + 3 > r.x0 && y - 6 < r.y1 + 2 && y + 6 + 2 > r.y0) {
            clash = true;
            break;
          }
        }
        if (!clash) {
          py2 = y;
          break;
        }
      }
      if (!usable) py2 = py; // let the caller's own placement stand
      placed.push({ x0: x0, x1: x0 + tw, y0: py2 - 6, y1: py2 + 6 });
      // remember it so flushLabels() can lift it above anything drawn later
      labels.push({ str: str, px: px, py: py2, o: o, x0: x0, tw: tw });
      paint(str, px, py2, o, x0, tw);
    }

    /** Re-paint every label of this frame, in placement order, on top of
     * everything the widget drew after it. Widgets call this once as the last
     * step of draw(), so a reference rule, a curve or the time cursor drawn
     * after a label can never strike through it. */
    function flushLabels() {
      for (var i = 0; i < labels.length; i++) {
        var l = labels[i];
        paint(l.str, l.px, l.py, l.o, l.x0, l.tw);
      }
    }

    /** Grid lines + tick labels. */
    function grid(o) {
      o = o || {};
      var xs = o.xTicks || ticks(xMin, xMax, o.xCount || 6);
      var ys = o.yTicks || ticks(yMin, yMax, o.yCount || 5);
      var xf = o.xFormat || fmt;
      var yf = o.yFormat || fmt;
      ctx.save();
      ctx.strokeStyle = token('line');
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath();
      for (var i = 0; i < ys.length; i++) {
        var v = ys[i];
        if (v < yMin || v > yMax) continue;
        var py = Math.round(Y(v)) + 0.5;
        ctx.moveTo(pad.l, py);
        ctx.lineTo(pad.l + pw, py);
      }
      for (var j = 0; j < xs.length; j++) {
        var t = xs[j];
        if (t < xMin || t > xMax) continue;
        var px = Math.round(X(t)) + 0.5;
        ctx.moveTo(px, pad.t);
        ctx.lineTo(px, pad.t + ph);
      }
      ctx.stroke();
      ctx.restore();
      // the tick labels are registered like any other label (they are drawn
      // first, so nothing can nudge them) and reserve their space in the plot
      var tickFont = '11px ' + MONO;
      for (var k = 0; k < ys.length; k++) {
        var yv = ys[k];
        if (yv < yMin || yv > yMax) continue;
        textPx(yf(yv), pad.l - 8, Y(yv), { align: 'right', font: tickFont });
      }
      for (var m = 0; m < xs.length; m++) {
        var xv = xs[m];
        if (xv < xMin || xv > xMax) continue;
        textPx(xf(xv), X(xv), pad.t + ph + 8, { align: 'center', baseline: 'top', font: tickFont });
      }
      // axis labels live outside the plot rect: the x label under the axis
      // (right-aligned at its end) and the y label in the strip above the
      // plot, left-aligned at its start — so neither can run off the canvas
      if (opts.xLabel) textPx(opts.xLabel, pad.l + pw, pad.t + ph + 26, { align: 'right', font: '11px ' + SANS });
      if (opts.yLabel) textPx(opts.yLabel, pad.l, pad.t - 8, { align: 'left', font: '11px ' + SANS });
    }

    /** Polyline through [[x, y], …]. */
    function line(pts, o) {
      if (pts.length < 2) return;
      o = o || {};
      ctx.save();
      stroke(o);
      ctx.beginPath();
      ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
      for (var i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
      ctx.stroke();
      ctx.restore();
    }

    /** Sample f(x) across [from, to] and stroke it. */
    function sample(f, o) {
      o = o || {};
      var from = o.from == null ? xMin : o.from;
      var to = o.to == null ? xMax : o.to;
      var n = o.n || 120;
      var pts = [];
      for (var i = 0; i <= n; i++) {
        var xv = lerp(from, to, i / n);
        pts.push([xv, f(xv)]);
      }
      line(pts, o);
    }

    /** Horizontal reference line, optionally labelled at its right end. */
    function hline(v, o) {
      o = o || {};
      if (v < yMin || v > yMax) return;
      ctx.save();
      stroke(o);
      ctx.beginPath();
      ctx.moveTo(o.from == null ? pad.l : X(o.from), Y(v));
      ctx.lineTo(o.to == null ? pad.l + pw : X(o.to), Y(v));
      ctx.stroke();
      ctx.restore();
      if (o.label) {
        textPx(o.label, pad.l + pw - 2, Y(v) - 7, { align: 'right', color: o.color || token('dim') });
      }
    }

    /** Vertical reference line, optionally labelled at its top (flipped left
     * of the line near the right edge). */
    function vline(v, o) {
      o = o || {};
      if (v < xMin || v > xMax) return;
      ctx.save();
      stroke(o);
      ctx.beginPath();
      ctx.moveTo(X(v), o.from == null ? pad.t : Y(o.from));
      ctx.lineTo(X(v), o.to == null ? pad.t + ph : Y(o.to));
      ctx.stroke();
      ctx.restore();
      if (o.label) {
        var align = o.align || (X(v) > pad.l + pw - 90 ? 'right' : 'left');
        textPx(o.label, X(v) + (align === 'right' ? -4 : 4), pad.t + 6, {
          align: align,
          color: o.color || token('dim'),
        });
      }
    }

    /** Shaded x-interval (an episode / a hold), with an optional label at the
     * bottom (default) or the top of the interval. */
    function band(x0, x1, o) {
      o = o || {};
      ctx.save();
      ctx.fillStyle = o.fill || token('bg2');
      ctx.globalAlpha = o.alpha == null ? 1 : o.alpha;
      ctx.fillRect(X(x0), pad.t, Math.max(0, X(x1) - X(x0)), ph);
      ctx.restore();
      if (o.label) {
        var py = (o.labelAt === 'top' ? pad.t + 12 : pad.t + ph - 10);
        textPx(o.label, (X(x0) + X(x1)) / 2, py, { align: 'center', color: token('dim') });
      }
    }

    /** Marker dot + optional label (flipped left of the dot near the right
     * edge, so a label never runs off the canvas). */
    function dot(xv, yv, o) {
      o = o || {};
      if (xv < xMin || xv > xMax || yv < yMin || yv > yMax) return;
      ctx.save();
      ctx.fillStyle = o.color || token('accent');
      ctx.beginPath();
      ctx.arc(X(xv), Y(yv), o.r || 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      if (o.label) {
        var align = o.align || (X(xv) > pad.l + pw - 110 ? 'right' : 'left');
        textPx(o.label, X(xv) + (o.dx == null ? (align === 'right' ? -7 : 7) : o.dx), Y(yv) + (o.dy == null ? -10 : o.dy), {
          align: align,
          color: o.color || token('accent'),
          font: '11px ' + MONO,
        });
      }
    }

    return {
      el: el,
      ctx: ctx,
      w: W,
      h: H,
      pad: pad,
      X: X,
      Y: Y,
      grid: grid,
      line: line,
      sample: sample,
      hline: hline,
      vline: vline,
      band: band,
      dot: dot,
      text: function (str, xv, yv, o) {
        o = o || {};
        textPx(str, X(xv), Y(yv), o);
      },
      textPx: textPx,
      flushLabels: flushLabels,
    };
  }

  /* ------------------------------------ controls -------------------------------- */

  /** A labelled range control (`input[type=range]`) that reports its value. */
  function slider(o) {
    var label = document.createElement('label');
    label.className = 'viz-slider';
    var name = document.createElement('span');
    name.className = 'viz-slider-name';
    name.textContent = o.label;
    var out = document.createElement('output');
    out.className = 'viz-slider-value';
    var input = document.createElement('input');
    input.type = 'range';
    input.min = String(o.min);
    input.max = String(o.max);
    input.step = String(o.step == null ? 0.001 : o.step);
    input.value = String(o.value);
    input.setAttribute('aria-label', o.label);
    var format = o.format || function (v) {
      return fmt(v, o.digits == null ? 2 : o.digits);
    };
    function sync() {
      out.textContent = format(Number(input.value));
    }
    input.addEventListener('input', function () {
      sync();
      if (o.onInput) o.onInput(Number(input.value));
      // only a real input event reaches here (a programmatic set() does not
      // dispatch one), so this is exactly "the reader moved this slider"
      writeState(owningSlot(input));
    });
    sync();
    label.appendChild(name);
    label.appendChild(input);
    label.appendChild(out);
    return {
      el: label,
      input: input,
      value: function () {
        return Number(input.value);
      },
      set: function (v) {
        input.value = String(v);
        sync();
      },
      sync: sync,
    };
  }

  /* ------------------------- shareable state (the URL hash) ---------------------- */

  /**
   * Every figure can put its state in the URL, so a frame can be linked:
   *
   *   #viz=switch&a=0.72
   *
   * The key is namespaced (`viz=`), and that is what keeps this from fighting
   * the page's own fragments: the heading anchors and footnote backrefs are
   * bare `#id` links (#4-the-runaway, #fn3), and a fragment that does not begin
   * `viz=` is never parsed as state, never rewritten and never re-applied.
   * With more than one figure on a page, the widget named in `viz=` owns the
   * unprefixed keys and every other widget's keys carry its name as a prefix:
   *
   *   #viz=switch&a=0.72&runaway.hold=66.3
   *
   * (Two slots of the SAME widget on one page would share a prefix and restore
   * the same state; no page does that.)
   *
   * A widget opts in with `VIZ.share(ctx, { get, set })`. The engine writes with
   * history.replaceState — never pushState, because dragging a slider must not
   * fill the reader's history — and only from a real `input` event, so a
   * programmatic set() or an animation frame never touches the URL. A window
   * that refuses history rewriting (an opaque origin) simply keeps the state in
   * memory: the figure still works, only the frame is not linkable.
   */
  var HASH_KEY = 'viz';
  var KEY_RE = /^[a-z0-9_-]+$/i;
  var shareSlots = []; // mounted slots that declared a state, in mount order
  var lastWritten = null; // the fragment this engine wrote last
  var initial = null; // the fragment the page was loaded with, if it is ours
  var pending = null; // the slot whose state is waiting to be written
  var pendingTimer = 0;
  var snappedRestore = false; // the fragment held a value no slider could hold

  /** The [data-viz] slot a node belongs to, or null. */
  function owningSlot(node) {
    for (var n = node; n; n = n.parentNode) {
      if (n.getAttribute && n.getAttribute('data-viz')) return n;
    }
    return null;
  }

  /** This page's fragment, with `primary` naming the `viz=` value. */
  function fragment(primary) {
    var parts = [HASH_KEY + '=' + primary.getAttribute('data-viz')];
    for (var i = 0; i < shareSlots.length; i++) {
      var el = shareSlots[i];
      var provider = el.__vizShare;
      if (!provider) continue;
      var state = provider.get() || {};
      var prefix = el === primary ? '' : el.getAttribute('data-viz') + '.';
      for (var k in state) {
        var v = Number(state[k]);
        if (!KEY_RE.test(k) || !isFinite(v)) continue;
        parts.push(prefix + k + '=' + String(v));
      }
    }
    return parts.join('&');
  }

  /** Record the reader's state in the URL. Replacing, not pushing: the reader's
   * Back button belongs to their reading, not to every slider step. Writes are
   * coalesced to one per digest-interval, so a drag that fires sixty moves a
   * second still leaves a short, honest history (and never trips the browser's
   * history throttle). */
  function writeState(slot) {
    if (!slot || !slot.__vizShare) return;
    pending = slot;
    if (pendingTimer) return;
    pendingTimer = setTimeout(flushState, 120);
  }

  function flushState() {
    pendingTimer = 0;
    var slot = pending;
    pending = null;
    writeFrame(slot);
  }

  /** Put `slot`'s own frame in the fragment, unless it is already there. */
  function writeFrame(slot) {
    if (!slot || !slot.__vizShare || slot.getAttribute('data-viz-mounted') !== '1') return;
    var frag = fragment(slot);
    if (frag === lastWritten) return;
    try {
      window.history.replaceState(null, '', '#' + frag);
      lastWritten = '#' + frag;
    } catch (e) {
      // no history rewriting here: the figure still works, the frame is just
      // not linkable, and the next input simply tries again
    }
  }

  /** `#viz=<widget>&k=v&<other>.k=v` → { primary, byWidget } — or null when the
   * fragment is not this engine's (a plain anchor). */
  function parseState(hash) {
    var h = String(hash || '').replace(/^#/, '');
    if (h.indexOf(HASH_KEY + '=') !== 0) return null;
    var segs = h.split('&');
    var primary = segs[0].slice(HASH_KEY.length + 1);
    if (!KEY_RE.test(primary)) return null;
    var byWidget = {};
    byWidget[primary] = {};
    for (var i = 1; i < segs.length; i++) {
      var eq = segs[i].indexOf('=');
      if (eq < 1) continue;
      var key = segs[i].slice(0, eq);
      var dot = key.indexOf('.');
      var widget = dot > 0 ? key.slice(0, dot) : primary;
      var name = dot > 0 ? key.slice(dot + 1) : key;
      // A share link can be mangled on the way here (a chat client, a bad
      // paste): a percent-escape that is not valid UTF-8 makes
      // decodeURIComponent throw, and this runs during boot, so an unguarded
      // throw would take the whole figure set down with it. A key that will not
      // decode is one key lost, not the page.
      var raw = segs[i].slice(eq + 1);
      try {
        raw = decodeURIComponent(raw);
      } catch (e) {
        // keep the raw text: Number() then gives NaN and the key is skipped
      }
      var v = Number(raw);
      if (!KEY_RE.test(widget) || !KEY_RE.test(name) || !isFinite(v)) continue;
      if (!byWidget[widget]) byWidget[widget] = {};
      byWidget[widget][name] = v;
    }
    return { primary: primary, byWidget: byWidget };
  }

  /** Hand a widget its own piece of the fragment. True when the widget could
   * not hold exactly what it was handed — a slider snapping an off-grid value
   * to its own step — which is the one case where the fragment may be
   * rewritten on load. A key the widget does not report (a foreign widget's, or
   * one this engine did not understand) is left alone. */
  function restoreState(provider, vals) {
    provider.set(vals);
    var got = provider.get() || {};
    for (var k in vals) {
      if (!(k in got)) continue;
      if (Math.abs(Number(got[k]) - Number(vals[k])) > 1e-9) return true;
    }
    return false;
  }

  /** An off-grid value in a pasted link is snapped by the slider that receives
   * it. Say so in the URL — one write, on load, only when something actually
   * snapped — so the address bar cannot disagree with the frame on screen. */
  function normalizeFrame() {
    if (!snappedRestore || !initial) return;
    snappedRestore = false;
    var slot = null;
    for (var i = 0; i < shareSlots.length; i++) {
      if (shareSlots[i].getAttribute('data-viz') === initial.primary) slot = shareSlots[i];
    }
    if (slot) writeFrame(slot);
  }

  /** Hand a parsed fragment back to the figures; each widget redraws itself. */
  function applyState(state) {
    if (!state) return;
    for (var i = 0; i < shareSlots.length; i++) {
      var el = shareSlots[i];
      var vals = state.byWidget[el.getAttribute('data-viz')];
      if (vals && el.__vizShare) el.__vizShare.set(vals);
    }
  }

  /** Put a widget's state in the URL: `VIZ.share(ctx, { get, set })` once, at
   * mount. `get()` returns the state as a flat object of numbers; `set(state)`
   * accepts any subset of those keys and redraws. */
  function share(ctx, provider) {
    if (!ctx || !ctx.el || !provider || typeof provider.get !== 'function' || typeof provider.set !== 'function') {
      throw new Error('viz: share(ctx, { get, set }) needs a ctx and both halves');
    }
    ctx.el.__vizShare = provider;
  }

  /* ------------------------------ figure export (PNG) --------------------------- */

  /** The page's own slug, so an exported figure has a filename worth filing
   * (meditation-harm-switch.png), on a served path or on file://. */
  function pageSlug() {
    var parts = window.location.pathname.split('/');
    var out = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(parts[i]);
    if (out.length && /^index\.html?$/i.test(out[out.length - 1])) out.pop();
    return out.length ? out[out.length - 1] : 'home';
  }

  /**
   * Compose every canvas of one figure into a single PNG blob, in the order the
   * reader sees them (a multi-panel figure exports as the figure, not as one
   * arbitrary panel). All of it is in-page canvas work: nothing is uploaded,
   * nothing is fetched, and the PNG is handed over as a data: URL.
   */
  function compose(canvases, done) {
    var gap = 10;
    var w = 0;
    var h = 0;
    var i;
    for (i = 0; i < canvases.length; i++) {
      w = Math.max(w, canvases[i].width);
      h += canvases[i].height + (i ? gap : 0);
    }
    var out = document.createElement('canvas');
    out.width = Math.max(1, w);
    out.height = Math.max(1, h);
    if (typeof out.toBlob !== 'function') return done(null); // not a real browser
    var c = out.getContext('2d');
    c.fillStyle = token('bg');
    c.fillRect(0, 0, out.width, out.height);
    var y = 0;
    for (i = 0; i < canvases.length; i++) {
      c.drawImage(canvases[i], 0, y);
      y += canvases[i].height + gap;
    }
    out.toBlob(function (blob) {
      done(blob);
    }, 'image/png');
  }

  /** Save a blob through a data: URL — self-contained, no service involved. */
  function saveBlob(blob, filename) {
    var fr = new FileReader();
    fr.onload = function () {
      var a = document.createElement('a');
      a.href = String(fr.result);
      a.download = filename;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      if (a.parentNode) a.parentNode.removeChild(a);
    };
    fr.readAsDataURL(blob);
  }

  /** A small control per figure: download it as a PNG (and copy it, where the
   * browser can put an image on the clipboard). Both live in .viz-controls, so
   * they are hidden with the rest of the controls in print. */
  function attachExport(slot, name, bag) {
    var canvases = slot.querySelectorAll('canvas.viz-canvas');
    var controls = slot.querySelector('.viz-controls');
    if (!canvases.length || !controls) return;
    var group = document.createElement('span');
    group.className = 'viz-export-group';
    var filename = pageSlug() + '-' + name + '.png';

    function flash(btn, text) {
      if (btn.__vizLabel == null) btn.__vizLabel = btn.textContent;
      btn.textContent = text;
      bag.later(function () {
        if (btn) btn.textContent = btn.__vizLabel;
      }, 1600);
    }

    var dl = document.createElement('button');
    dl.type = 'button';
    dl.className = 'viz-button viz-export';
    dl.textContent = '⬇ PNG';
    dl.setAttribute('aria-label', 'download this figure as a PNG image (' + filename + ')');
    bag.on(dl, 'click', function () {
      compose(canvases, function (blob) {
        if (!blob) return flash(dl, 'no export');
        saveBlob(blob, filename);
        flash(dl, 'saved');
      });
    });
    group.appendChild(dl);

    if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
      var cp = document.createElement('button');
      cp.type = 'button';
      cp.className = 'viz-button viz-export';
      cp.textContent = 'copy image';
      cp.setAttribute('aria-label', 'copy this figure to the clipboard as a PNG image');
      bag.on(cp, 'click', function () {
        compose(canvases, function (blob) {
          var item;
          if (!blob) return flash(cp, 'no export');
          try {
            item = new window.ClipboardItem({ 'image/png': blob });
          } catch (e) {
            return flash(cp, 'unavailable');
          }
          // both outcomes handled: a refused clipboard write is not a page error
          navigator.clipboard.write([item]).then(
            function () {
              flash(cp, 'copied');
            },
            function () {
              flash(cp, 'blocked');
            },
          );
        });
      });
      group.appendChild(cp);
    }
    controls.appendChild(group);
  }

  /** A small toggle button (run / pause / reset). */
  function button(text, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'viz-button';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  /** A readout line inside the widget: `set(['a = ', bold('0.90'), ' · ', …])`.
   * `bold(text, hot)` marks a highlighted value. */
  function readout(bag) {
    var el = bag.node('p', 'viz-readout');
    // announce the value as it changes (a slider drag, a running episode)
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    return {
      el: el,
      set: function (parts) {
        el.textContent = '';
        for (var i = 0; i < parts.length; i++) {
          var p = parts[i];
          if (p && typeof p === 'object') {
            var b = document.createElement('b');
            if (p.hot) b.className = 'hot';
            b.textContent = p.text;
            el.appendChild(b);
          } else {
            el.appendChild(document.createTextNode(String(p)));
          }
        }
      },
    };
  }

  function bold(text, hot) {
    return { text: String(text), hot: !!hot };
  }

  /** Trailing-edge debounce, so a resize storm redraws once. */
  function debounce(fn, ms) {
    var t = 0;
    return {
      run: function () {
        clearTimeout(t);
        t = setTimeout(fn, ms || 80);
      },
      cancel: function () {
        clearTimeout(t);
      },
    };
  }

  /* ----------------------------------- lifecycle -------------------------------- */

  /**
   * Per-widget lifecycle bag. Everything a widget creates — DOM nodes, event
   * listeners, the RAF loop, the resize handler — is registered here, so
   * `dispose()` is a complete teardown (nodes detached, listeners removed,
   * animation cancelled). unmount() is exactly this call.
   */
  function lifecycle(slot) {
    var disposers = [];

    function beforeCaption(node) {
      var cap = slot.querySelector('.viz-caption');
      slot.insertBefore(node, cap || null);
      return node;
    }

    var bag = {
      /** Create an element inside the slot, above its caption. */
      node: function (tag, cls) {
        var el = document.createElement(tag);
        if (cls) el.className = cls;
        beforeCaption(el);
        disposers.push(function () {
          if (el.parentNode) el.parentNode.removeChild(el);
        });
        return el;
      },
      /** Add a listener and remember it for teardown. */
      on: function (target, type, fn, opts) {
        target.addEventListener(type, fn, opts);
        disposers.push(function () {
          target.removeEventListener(type, fn, opts);
        });
        return fn;
      },
      /** A timeout that is cleared with the widget (no timer outlives a slot). */
      later: function (fn, ms) {
        var t = setTimeout(fn, ms);
        disposers.push(function () {
          clearTimeout(t);
        });
        return t;
      },
      /** Re-draw on resize, debounced. The slot itself is watched as well as
       * the window, so a widget mounted into a container that had no width
       * yet (a collapsed <details>, a hidden panel) refits and redraws the
       * moment that container gains one. */
      onResize: function (fn) {
        var d = debounce(fn, 100);
        bag.on(window, 'resize', d.run);
        if (typeof window.ResizeObserver === 'function') {
          var ro = new window.ResizeObserver(function () {
            d.run();
          });
          ro.observe(slot);
          disposers.push(function () {
            ro.disconnect();
          });
        }
        disposers.push(d.cancel);
        return d;
      },
      /** A start/stop animation loop driven by requestAnimationFrame. */
      loop: function (fn) {
        var handle = 0;
        var last = 0;
        var running = false;
        function tick(ts) {
          if (!running) return;
          var dt = last ? Math.min((ts - last) / 1000, 0.05) : 0;
          last = ts;
          fn(dt, ts);
          handle = window.requestAnimationFrame(tick);
        }
        var api = {
          start: function () {
            if (running) return;
            running = true;
            last = 0;
            handle = window.requestAnimationFrame(tick);
          },
          stop: function () {
            running = false;
            if (handle) window.cancelAnimationFrame(handle);
            handle = 0;
          },
          isRunning: function () {
            return running;
          },
        };
        disposers.push(api.stop);
        return api;
      },
      /** Detach everything this widget created. */
      dispose: function () {
        for (var i = disposers.length - 1; i >= 0; i--) disposers[i]();
        disposers.length = 0;
      },
    };
    return bag;
  }

  /* ------------------------------------- boot ----------------------------------- */

  var running = [];
  var booted = false;
  var refCounter = 0;

  /** `data-*` attributes → a props object (numeric where numeric). */
  function parseProps(el) {
    var props = {};
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.name.indexOf('data-') !== 0) continue;
      var key = a.name.slice(5).replace(/-([a-z])/g, function (_, c) {
        return c.toUpperCase();
      });
      if (key === 'viz' || key === 'vizMounted') continue;
      var v = a.value;
      props[key] = v !== '' && v !== 'true' && v !== 'false' && isFinite(Number(v)) ? Number(v) : v;
    }
    return props;
  }

  /** MountContext, shaped like @mfe/core's: { host, ref, props } — plus the
   * slot element, the per-mount lifecycle bag and the helper API, which is
   * what a widget actually reads. */
  function context(el, name, bag) {
    if (!el.__vizRef) el.__vizRef = 'viz:' + name + '#' + ++refCounter;
    return {
      host: {
        // The page must stay self-contained, so head injection is refused
        // rather than silently adopted from the served framework.
        addHeadTag: function () {
          throw new Error('viz: widgets stay self-contained — no head tags');
        },
      },
      ref: el.__vizRef,
      el: el,
      props: parseProps(el),
      lifecycle: bag,
      viz: api,
    };
  }

  function mountSlot(el, name) {
    var component = registry[name];
    if (!component) {
      window.console.warn('viz: no component registered for "' + name + '"');
      return false;
    }
    var ctx = context(el, name, lifecycle(el));
    el.setAttribute('data-viz-mounted', '1');
    component.mount(el, ctx);
    // a widget that declared its state opts into the URL, and is restored from
    // the fragment the page was loaded with (set() redraws)
    if (el.__vizShare) {
      shareSlots.push(el);
      if (initial && initial.byWidget[name] && restoreState(el.__vizShare, initial.byWidget[name])) {
        snappedRestore = true;
      }
    }
    attachExport(el, name, ctx.lifecycle);
    running.push({ name: name, el: el, ctx: ctx, component: component });
    return true;
  }

  /** Mount every un-mounted [data-viz] slot under `root`. Idempotent. */
  function mountAll(root) {
    var slots = (root || document).querySelectorAll('[data-viz]');
    var n = 0;
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].getAttribute('data-viz-mounted') === '1') continue;
      if (mountSlot(slots[i], slots[i].getAttribute('data-viz'))) n++;
    }
    return n;
  }

  /** Tear every mounted widget down (leaves the markup as it was authored). */
  function unmountAll() {
    for (var i = running.length - 1; i >= 0; i--) {
      var e = running[i];
      e.component.unmount(e.el, e.ctx);
      e.ctx.lifecycle.dispose();
      e.el.removeAttribute('data-viz-mounted');
    }
    running = [];
    shareSlots = [];
  }

  function boot() {
    if (booted) return; // a second call is a no-op
    booted = true;
    // the fragment the page arrived with, if it is this engine's (a plain
    // heading anchor is not, and is left exactly where the browser put it)
    initial = parseState(window.location.hash);
    window.addEventListener('hashchange', function () {
      if (window.location.hash === lastWritten) return; // our own write
      var state = parseState(window.location.hash);
      if (!state) return; // a plain #anchor — never rewritten, never clobbered
      applyState(state);
    });
    if (document.readyState === 'loading') {
      var onReady = function () {
        document.removeEventListener('DOMContentLoaded', onReady);
        mountAll(document);
        normalizeFrame();
      };
      document.addEventListener('DOMContentLoaded', onReady);
    } else {
      mountAll(document);
      normalizeFrame();
    }
  }

  var api = {
    registerViz: registerViz,
    names: names,
    boot: boot,
    mountAll: mountAll,
    unmountAll: unmountAll,
    token: token,
    fmt: fmt,
    ticks: ticks,
    clamp: clamp,
    lerp: lerp,
    frame: frame,
    slider: slider,
    button: button,
    readout: readout,
    bold: bold,
    share: share,
    saveState: function (ctx) {
      // for a widget that changes its own state outside a slider's input event
      // (a pointer drag, an automated cross): the frame is linkable too
      if (ctx && ctx.el) writeState(ctx.el);
    },
  };

  boot();
  return api;
})();
