/**
 * tools/viz/modules.js — the harness §2 (the three-module diagram).
 *
 * The design's three modules and their deliberately different substrates:
 * DMN (an LLM, self-referential), CEN (the Datalog engine), SN (a cheap
 * non-deliberative regulator), coupled through the external store and the
 * compiled controlled-natural-language currency. Every label is CURATED FROM
 * THE DESIGN — the module's substrate, the MEASURED requirement that forced it,
 * and its build status, all read from the page's own data block, which the
 * generator parsed from the design documents.
 *
 * Hover or tap a module to select it: the readout names its substrate, the
 * measured requirement that forced that substrate, and its build status. The
 * store and the currency edge are drawn but not selectable — they are the
 * coupling, not a module.
 */
VIZ.registerViz('modules', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  /** The page's own data block (the generator's curated modules). */
  function data() {
    var el = document.getElementById('viz-data-harness');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.modules && d.modules.length ? d : null;
    } catch (e) {
      return null;
    }
  }

  /** Build status as a WORD, never a colour alone: the scaffold's own
   * REAL/STUB/PENDING vocabulary, drawn beside the module it belongs to. */
  function buildWord(s) {
    var m = String(s || '').match(/REAL|STUB|PENDING/);
    return m ? m[0] : 'unstated';
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var out = VIZ.readout(bag);

    var d = data();
    if (!d) {
      out.set(['the figure is missing its own data — every label on it is curated from the design, and there is none to draw.']);
      return;
    }

    // module geometry: three boxes on a row, the store below, currency edges
    // DMN -> CEN (checked) and DMN -> SN/store
    var BOXES = { DMN: 0, CEN: 1, SN: 2 };
    var sel = null; // selected module key
    var boxes = []; // hit rects in px, per draw

    var NAMES = { DMN: 'DMN', CEN: 'CEN', SN: 'SN' };

    function statusLine(m) {
      return (
        NAMES[m.key] + ' — ' + m.substrate.replace(/\.$/, '') + ' · ' +
        'build: ' + buildWord(m.build)
      );
    }

    function choose(key) {
      sel = key;
      draw();
      VIZ.saveState(ctx);
    }

    // pointer: hover selects (a mouse reader), tap selects (a phone has no
    // hover) — the same gesture the map's works use
    function pointAt(ev) {
      if (!boxes.length) return null;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var mx = ev.clientX;
      var my = ev.clientY;
      if (rect && rect.width && rect.height) {
        mx = (ev.clientX - rect.left) * (canvas.clientWidth / rect.width);
        my = (ev.clientY - rect.top) * (canvas.clientHeight / rect.height);
      }
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (mx >= b.x0 && mx <= b.x1 && my >= b.y0 && my <= b.y1) return b.key;
      }
      return null;
    }
    bag.on(canvas, 'mousemove', function (ev) {
      var hit = pointAt(ev);
      if (hit !== sel) choose(hit);
    });
    bag.on(canvas, 'mouseleave', function () {
      if (sel !== null) choose(null);
    });
    bag.on(canvas, 'click', function (ev) {
      choose(pointAt(ev));
    });

    // keyboard: the canvas is focusable, arrows walk the modules, Enter toggles
    canvas.setAttribute('tabindex', '0');
    bag.on(canvas, 'keydown', function (ev) {
      var keys = ['DMN', 'CEN', 'SN'];
      var step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!step && ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      if (ev.key === 'Enter' || ev.key === ' ') {
        var k = keys.filter(function (k2) {
          var mod = null;
          for (var i = 0; i < d.modules.length; i++) if (d.modules[i].key === k2) mod = d.modules[i];
          return mod && buildWord(mod.build) === 'STUB';
        });
        choose(sel == null || sel !== 'DMN' ? 'DMN' : null);
        return;
      }
      var at = sel == null ? (step > 0 ? -1 : 0) : keys.indexOf(sel);
      var next = keys[((at + step) % 3 + 3) % 3];
      choose(next);
    });

    function draw() {
      var W = canvas.clientWidth || 680;
      var f = VIZ.frame(canvas, {
        height: 240,
        ariaLabel:
          'the three modules: DMN (an LLM, self-referential), CEN (the Datalog engine) and SN (a cheap ' +
          'non-deliberative regulator), coupled through the external store and the compiled currency. ' +
          'Select a module to read the measured requirement that forced its substrate and its build status.',
        xMin: 0,
        xMax: 10,
        yMin: 0,
        yMax: 5,
        pad: { l: 20, r: 20, t: 16, b: 20 },
      });
      boxes = [];
      var bw = 2.1; // box width, data units
      var bh = 1.5;
      var rowY = 3.0; // box bottom
      var xs = { DMN: 1.2, CEN: 3.95, SN: 6.7 };
      var storeX = 5.0;
      var storeY = 0.75;

      // the external store: a wide plate UNDER the modules — the design's own
      // point is that it is outside every module
      var sx0 = f.X(0.7);
      var sx1 = f.X(9.3);
      var sy0 = f.Y(storeY + 0.55);
      var sy1 = f.Y(storeY - 0.55);
      f.ctx.save();
      f.ctx.strokeStyle = sel === null ? VIZ.token('line') : VIZ.token('line');
      f.ctx.setLineDash([]);
      f.ctx.strokeRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      f.ctx.fillStyle = VIZ.token('bg2');
      f.ctx.fillRect(sx0, sy0, sx1 - sx0, sy1 - sy0);
      f.ctx.restore();
      f.textPx('the external store — shared, append-only, outside every module', (sx0 + sx1) / 2, (sy0 + sy1) / 2, {
        align: 'center',
        font: '11px ' + MONO,
        color: VIZ.token('dim'),
      });

      // the currency: DMN emits, CEN checks — the one edge the design calls the
      // cannibalization channel; drawn with a direction chevron
      function edge(x0, y0, x1, y1, label, hot) {
        f.ctx.save();
        f.ctx.strokeStyle = hot ? VIZ.token('accent') : VIZ.token('dim');
        f.ctx.globalAlpha = hot ? 1 : 0.8;
        f.ctx.lineWidth = hot ? 1.8 : 1.2;
        f.ctx.setLineDash([]);
        f.ctx.beginPath();
        f.ctx.moveTo(f.X(x0), f.Y(y0));
        f.ctx.lineTo(f.X(x1), f.Y(y1));
        f.ctx.stroke();
        // the chevron at the receiving end
        var ang = Math.atan2(f.Y(y1) - f.Y(y0), f.X(x1) - f.X(x0));
        var cx = f.X(x1) - Math.cos(ang) * 1;
        var cy = f.Y(y1) - Math.sin(ang) * 1;
        f.ctx.beginPath();
        f.ctx.moveTo(cx, cy);
        f.ctx.lineTo(cx - Math.cos(ang - 0.5) * 8, cy - Math.sin(ang - 0.5) * 8);
        f.ctx.lineTo(cx - Math.cos(ang + 0.5) * 8, cy - Math.sin(ang + 0.5) * 8);
        f.ctx.closePath();
        f.ctx.fillStyle = hot ? VIZ.token('accent') : VIZ.token('dim');
        f.ctx.fill();
        f.ctx.restore();
        if (label) {
          f.textPx(label, (f.X(x0) + f.X(x1)) / 2, (f.Y(y0) + f.Y(y1)) / 2 - 7, {
            align: 'center',
            font: '10px ' + MONO,
            color: hot ? VIZ.token('accent') : VIZ.token('dim'),
          });
        }
      }

      // DMN -> CEN: the currency (checked emissions)
      edge(xs.DMN + bw, rowY + bh * 0.5, xs.CEN, rowY + bh * 0.5, 'the currency: LE → Datalog', sel === 'DMN' || sel === 'CEN');
      // SN regulates both: two edges down from SN
      edge(xs.SN, rowY + bh * 0.3, xs.DMN + bw, rowY + bh * 0.3, null, sel === 'SN' || sel === 'DMN');
      edge(xs.SN, rowY + bh * 0.7, xs.CEN + bw, rowY + bh * 0.7, sel === 'SN' ? 'regulates' : null, sel === 'SN' || sel === 'CEN');
      // every module reads/writes the store: three short edges down
      for (var key in xs) {
        edge(xs[key] + bw / 2, rowY, xs[key] + bw / 2, storeY + 0.55, null, sel === key);
      }

      // the three module boxes
      for (var i = 0; i < d.modules.length; i++) {
        var m = d.modules[i];
        var x = xs[m.key];
        var hot = sel === m.key;
        var x0 = f.X(x);
        var y0 = f.Y(rowY + bh);
        var x1 = f.X(x + bw);
        var y1 = f.Y(rowY);
        boxes.push({ key: m.key, x0: x0, x1: x1, y0: y0, y1: y1 });
        f.ctx.save();
        f.ctx.setLineDash([]);
        f.ctx.lineWidth = hot ? 2.2 : 1.4;
        f.ctx.strokeStyle = hot ? VIZ.token('accent') : VIZ.token('dim');
        f.ctx.fillStyle = VIZ.token('bg');
        f.ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        f.ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
        f.ctx.restore();
        // the name, the substrate's first words, and the build status — the
        // status is a WORD, never a colour alone
        f.textPx(NAMES[m.key], (x0 + x1) / 2, y0 + 16, {
          align: 'center',
          font: '600 13px ' + MONO,
          color: hot ? VIZ.token('accent') : VIZ.token('fg'),
        });
        // the box takes the SHORT substrate label (the full one is on the
        // readout when the module is selected), so it never truncates.
        var sub = (m.short || m.substrate).replace(/\.$/, '');
        f.textPx(sub, (x0 + x1) / 2, y0 + 34, {
          align: 'center',
          font: '10.5px ' + MONO,
          color: VIZ.token('dim'),
        });
        f.textPx('build: ' + buildWord(m.build), (x0 + x1) / 2, y0 + 52, {
          align: 'center',
          font: '10.5px ' + MONO,
          color: VIZ.token(hot ? 'accent' : 'dim'),
        });
      }

      f.flushLabels();

      // the readout: the selected module's own row, or the default survey
      if (sel == null) {
        var parts = ['three modules, three substrates — click or hover one: '];
        for (var j = 0; j < d.modules.length; j++) {
          var mj = d.modules[j];
          parts.push(NAMES[mj.key] + ' (' + mj.substrate.replace(/\.$/, '').replace(/^an? /, '') + ', build ' + buildWord(mj.build) + ')');
          parts.push(j < d.modules.length - 1 ? ' · ' : '');
        }
        parts.push(' — each substrate is assigned for a measured reason, not taste.');
        out.set(parts);
      } else {
        var mod = null;
        for (var k2 = 0; k2 < d.modules.length; k2++) if (d.modules[k2].key === sel) mod = d.modules[k2];
        if (!mod) {
          out.set(['the figure is missing its own data.']);
          return;
        }
        out.set([
          VIZ.bold(statusLine(mod)),
          ' — the measured requirement: ',
          VIZ.bold(mod.requirement),
          ' · build status: ',
          VIZ.bold(mod.build, true),
          ' (the scaffold\u2019s own component map).',
        ]);
      }
    }

    bag.onResize(draw);
    draw();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  /** Part of the MFE contract; never invoked on a static page. */
  function update(prev, next, ctx) {
    unmount(prev, ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
