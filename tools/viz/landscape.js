/**
 * tools/viz/landscape.js — W7, the dose landscape (meditation-harm §4, §6).
 *
 * The whole dose plane at once: intensity `a` across, duration down, shaded by
 * the outcome the post publishes. §4 sweeps both axes and finds **214 healthy
 * outcomes, 98 collapsed outcomes, and zero in between** — so there is no
 * gradient to draw: the boundary is a cliff, and it passes through the two
 * measured values, the intensity `0.5992` and (at that intensity) the duration
 * `66.3` t.u. The reader drags a point across the cliff and watches the state
 * flip.
 *
 * The flip is *bistable*, and that is the second published fact the figure
 * carries: §6 audits the collapsed branch in decreasing drive — including into
 * withdrawal — and finds it simply *exists*, all the way down. The hysteresis
 * window is `[0, ε_c)`, unbounded below, so dragging the point back under the
 * threshold does NOT restore the healthy state. You cannot exit by stopping.
 *
 * SCHEMATIC. Published landmarks only (§4, §6):
 *   dose sweep: 214 healthy / 98 collapsed / 0 in between
 *   intensity threshold 0.5992; duration threshold 66.3 t.u. at that intensity
 *   the two settled values: G* 0.886 (healthy) and 0.049 (collapsed)
 *   hysteresis [0, ε_c), unbounded below; the last healthy solution
 *   ε_c = 0.265192279 dies exactly on E = Θ_eff (residual 10⁻¹³)
 * The plane is drawn as the sweep's own two-axis threshold: the region the
 * sweep found healthy is shaded healthy and the region it found collapsed is
 * shaded collapsed, and the shape BETWEEN the published runs is not invented —
 * the figure says so on its face and draws the boundary as the measured corner.
 */
VIZ.registerViz('landscape', (function () {
  'use strict';

  var A_MIN = 0.5992; // measured intensity threshold (§4)
  var A_STEP = 0.0002; // the drive slider's step — 0.5992 must be a step point
  var T_CRIT = 66.3; // measured duration threshold, at that intensity (§4)
  var A_LO = 0.5; // the drive axis the figures sweep (§4 canonical 0.9)
  var A_HI = 1.0;
  var T_HI = 120; // the hold axis, in time units
  var G_STAR = 0.886; // healthy settled level (§4)
  var G_COL = 0.049; // collapsed level (§4)
  var EPS_C = 0.265192279; // last healthy solution (§6)
  var ERR_TAIL = '10⁻¹³'; // its residual on E = Θ_eff (§6)
  var N_HEALTHY = 214; // the published grid (§4)
  var N_COLLAPSED = 98;

  // pad.t is the frame's own (it depends on the wrapped state line); ditto pad.b.
  // PAD.t/PAD.b here are only the fallback in the frame options below
  var PAD = { l: 58, r: 26, t: 46, b: 46 };
  var PLOT_H = 246;
  var HEAD_TOP = 12; // the state line, above the plot and its axis label
  var TICKS_TOP = 44; // where the notes start below the plot rect
  var FONT = '11px SFMono-Regular, Menlo, Consolas, monospace';
  var LINE_H = 15;
  var SPEED = 30; // time-units per second of the automated cross

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    // dragging the point takes over the gesture: without this a touch drag
    // scrolls the page instead of moving the point
    canvas.style.touchAction = 'none';

    var meas = document.createElement('canvas').getContext('2d');
    meas.font = FONT;

    /** The first of `cands` that fits `maxPx` (a label shortens on a narrow
     * canvas rather than run off it). */
    function fit(cands, maxPx) {
      for (var i = 0; i < cands.length; i++) {
        if (meas.measureText(cands[i]).width <= maxPx) return cands[i];
      }
      return cands[cands.length - 1];
    }

    /** Split a string into lines that fit `maxPx` in FONT. */
    function wrapText(str, maxPx) {
      var words = String(str).split(' ');
      var lines = [];
      var line = '';
      for (var i = 0; i < words.length; i++) {
        var t = line ? line + ' ' + words[i] : words[i];
        if (line && meas.measureText(t).width > maxPx) {
          lines.push(line);
          line = words[i];
        } else {
          line = t;
        }
      }
      if (line) lines.push(line);
      return lines;
    }

    // the point the reader drags, and the one irreversible fact about it: once
    // the sweep's collapsed outcome is reached, drive is not what brings it back
    var collapsed = false;
    var frame = null;

    // step 0.0002: the step grid has to contain the measured 0.5992, or a range
    // input snaps the default (and every value the latch tests) down to 0.599
    // and the published threshold cannot be reached by hand at all. 0.0002 also
    // divides the 0.001 the drag quantises to below, so a pointer drag lands on
    // the same grid.
    var aSlider = VIZ.slider({
      label: 'drive a (intensity)',
      min: A_LO,
      max: A_HI,
      step: A_STEP,
      value: A_MIN,
      digits: 4,
      onInput: function () {
        creep.stop();
        run.textContent = '▶ drag across the cliff';
        draw();
      },
    });
    var holdSlider = VIZ.slider({
      label: 'hold (t.u.)',
      min: 0,
      max: T_HI,
      step: 0.1,
      value: 55,
      digits: 1,
      format: function (v) {
        return VIZ.fmt(v, 1) + ' t.u.';
      },
      onInput: function () {
        creep.stop();
        run.textContent = '▶ drag across the cliff';
        draw();
      },
    });
    controls.appendChild(aSlider.el);
    controls.appendChild(holdSlider.el);

    /** The state the reader is holding, clamped to the sliders' own steps. */
    function setPoint(a, hold) {
      aSlider.set(VIZ.clamp(Math.round(a / 0.001) * 0.001, A_LO, A_HI));
      holdSlider.set(VIZ.clamp(Math.round(hold / 0.1) * 0.1, 0, T_HI));
      draw();
      VIZ.saveState(ctx); // a drag is the reader's action: this frame is linkable
    }

    /** The point under the pointer, in data coordinates. */
    function fromPointer(ev) {
      if (!frame) return null;
      var rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      var k = frame.w / rect.width;
      var px = (ev.clientX - rect.left) * k;
      var py = (ev.clientY - rect.top) * k;
      var pw = frame.w - frame.pad.l - frame.pad.r;
      var ph = frame.h - frame.pad.t - frame.pad.b;
      return {
        a: A_LO + ((px - frame.pad.l) / pw) * (A_HI - A_LO),
        hold: T_HI - ((py - frame.pad.t) / ph) * T_HI,
      };
    }

    var dragging = false;
    bag.on(canvas, 'pointerdown', function (ev) {
      var p = fromPointer(ev);
      if (!p) return;
      dragging = true;
      if (canvas.setPointerCapture) {
        try {
          canvas.setPointerCapture(ev.pointerId);
        } catch (e) {
          // capture is an optimisation; the move listeners work without it
        }
      }
      ev.preventDefault();
      creep.stop();
      run.textContent = '▶ drag across the cliff';
      setPoint(p.a, p.hold);
    });
    bag.on(canvas, 'pointermove', function (ev) {
      if (!dragging) return;
      var p = fromPointer(ev);
      if (p) setPoint(p.a, p.hold);
    });
    bag.on(canvas, 'pointerup', function () {
      dragging = false;
    });
    bag.on(canvas, 'pointercancel', function () {
      dragging = false;
    });

    /** The automated cross: hold the drive at the measured intensity and walk
     * the duration up through the threshold, then back down again — the state
     * that does not come back shows §6's point. */
    var sweepBack = false;
    var creep = bag.loop(function (dt) {
      var hold = holdSlider.value() + (sweepBack ? -1 : 1) * dt * SPEED;
      if (!sweepBack && hold >= T_CRIT + 12) sweepBack = true;
      if (sweepBack && hold <= T_CRIT - 12) {
        creep.stop();
        run.textContent = '▶ drag across the cliff';
        hold = T_CRIT - 12;
      }
      aSlider.set(A_MIN);
      holdSlider.set(VIZ.clamp(hold, 0, T_HI));
      draw();
      if (!creep.isRunning()) VIZ.saveState(ctx); // one write for the whole cross
    });

    var run = VIZ.button('▶ drag across the cliff', function () {
      if (creep.isRunning()) {
        creep.stop();
        run.textContent = '▶ resume the cross';
      } else {
        if (holdSlider.value() >= T_CRIT) holdSlider.set(T_CRIT - 12);
        sweepBack = false;
        run.textContent = '❚❚ pause';
        creep.start();
      }
    });
    var reset = VIZ.button('reset', function () {
      creep.stop();
      run.textContent = '▶ drag across the cliff';
      collapsed = false;
      aSlider.set(A_MIN);
      holdSlider.set(55);
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    // shareable frame: #viz=landscape&a=0.5992&hold=55&collapsed=0
    VIZ.share(ctx, {
      get: function () {
        return { a: aSlider.value(), hold: holdSlider.value(), collapsed: collapsed ? 1 : 0 };
      },
      set: function (s) {
        creep.stop();
        run.textContent = '▶ drag across the cliff';
        if (s.a != null) aSlider.set(s.a);
        if (s.hold != null) holdSlider.set(s.hold);
        collapsed = !!s.collapsed;
        draw();
      },
    });

    function draw() {
      var a = aSlider.value();
      var hold = holdSlider.value();
      // the latch: any path that moves the point past the measured corner — a
      // slider, a drag, the automated cross — latches the collapsed outcome,
      // and no path un-latches it (§6: you cannot exit by stopping)
      if (a >= A_MIN && hold >= T_CRIT) collapsed = true;
      var avail = Math.max(240, canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 680);
      var textW = avail - 16;

      // the state line, wrapped to the canvas it is drawn on (a long line on a
      // narrow figure must break rather than run off the edge)
      var head = wrapText(
        collapsed
          ? 'collapsed — held: the state does not come back when you drag back'
          : 'healthy — the dose has not completed',
        textW,
      );

      var notes = [
        'shading is the published grid: ' +
          N_HEALTHY +
          ' healthy outcomes, ' +
          N_COLLAPSED +
          ' collapsed, 0 in between — the boundary is a cliff, not a gradient',
        'the two measured values it passes through: intensity ' +
          VIZ.fmt(A_MIN, 4) +
          ' and, at that intensity, a duration of ' +
          VIZ.fmt(T_CRIT, 1) +
          ' t.u.',
        'no shape is drawn between those two published runs: the sweep found 0 outcomes in between, so the between ' +
          'is exactly what is not invented',
      ];
      if (collapsed) {
        notes.push(
          'the collapsed branch has no mirror edge: hysteresis [0, ε_c) is unbounded below, so this state ' +
            'persists at every drive under the fold — including zero',
        );
      }
      var noteLines = [];
      for (var n = 0; n < notes.length; n++) {
        noteLines = noteLines.concat(wrapText(notes[n], textW));
      }
      var padT = HEAD_TOP + head.length * LINE_H + 14; // + the y axis label's strip
      var padB = TICKS_TOP + noteLines.length * LINE_H + PAD.b;
      var height = padT + PLOT_H + padB;

      var f = VIZ.frame(canvas, {
        height: height,
        ariaLabel: collapsed
          ? 'the dose landscape: intensity across, duration down. This point is past the measured boundary at ' +
            'intensity 0.5992 and duration 66.3 time units, so the outcome is the collapsed state G = 0.049, held — ' +
            'and it stays collapsed when the point is dragged back under the boundary, because the hysteresis window ' +
            'reaches down to zero drive'
          : 'the dose landscape: intensity across, duration down, shaded by the outcome of the published dose sweep ' +
            '(214 healthy, 98 collapsed, 0 in between). This point is under the measured boundary at intensity 0.5992 ' +
            'and duration 66.3 time units, so the outcome is the healthy state G = 0.886',
        xMin: A_LO,
        xMax: A_HI,
        yMin: 0,
        yMax: T_HI,
        xLabel: 'a — inward drive (intensity)',
        yLabel: 'hold — duration (t.u.)',
        pad: { l: PAD.l, r: PAD.r, t: padT, b: padB },
      });
      frame = f;
      var c = f.ctx;
      var pw = f.w - f.pad.l - f.pad.r;
      var ph = f.h - f.pad.t - f.pad.b;
      var accent = VIZ.token('accent');
      var accent2 = VIZ.token('accent2');

      // --- the two outcomes, shaded where the sweep found them ---
      // One fill for the healthy shape (both rects in a single path, so the
      // corner where they meet is not double-shaded), then the collapsed one.
      c.save();
      c.fillStyle = accent2;
      c.globalAlpha = 0.13;
      c.beginPath();
      // every duration at an intensity under the measured threshold …
      c.rect(f.X(A_LO), f.pad.t, f.X(A_MIN) - f.X(A_LO), ph);
      // … and a duration under the threshold at any intensity above it
      c.rect(f.X(A_MIN), f.Y(T_CRIT), f.X(A_HI) - f.X(A_MIN), f.Y(0) - f.Y(T_CRIT));
      c.fill();
      c.fillStyle = accent;
      c.globalAlpha = 0.16;
      c.fillRect(f.X(A_MIN), f.Y(T_HI), f.X(A_HI) - f.X(A_MIN), f.Y(T_CRIT) - f.Y(T_HI));
      c.restore();

      f.grid({
        xCount: 6,
        yCount: 6,
        xFormat: function (v) {
          return VIZ.fmt(v, 1);
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
      });

      // --- the boundary: the measured corner, and nothing invented past it ---
      f.vline(A_MIN, {
        color: accent,
        dash: [5, 4],
        width: 2,
        from: T_CRIT,
        to: T_HI,
      });
      f.hline(T_CRIT, {
        color: accent,
        dash: [5, 4],
        width: 2,
        from: A_MIN,
        to: A_HI,
      });

      // --- what the sweep found in each region ---
      var stripW = f.X(A_MIN) - f.X(A_LO) - 8;
      f.textPx(fit([N_HEALTHY + ' healthy', String(N_HEALTHY)], stripW), (f.X(A_LO) + f.X(A_MIN)) / 2, f.Y(T_HI * 0.9), {
        align: 'center',
        color: accent2,
        font: FONT,
      });
      f.textPx(
        fit([N_COLLAPSED + ' collapsed', String(N_COLLAPSED)], f.X(A_HI) - f.X(A_MIN) - 40),
        (f.X(A_MIN) + f.X(A_HI)) / 2,
        f.Y(T_CRIT + (T_HI - T_CRIT) * 0.78),
        { align: 'center', color: accent, font: FONT },
      );
      // the under-threshold band above the corner fits a note only when the
      // canvas is wide; below that the note is simply not drawn (the notes
      // under the plot and the readout carry it in words either way)
      if (f.X(A_HI) - f.X(A_MIN) - 40 >= meas.measureText('healthy — nothing to consume').width) {
        f.textPx('healthy — nothing to consume', (f.X(A_MIN) + f.X(A_HI)) / 2, f.Y(T_CRIT * 0.5), {
          align: 'center',
          color: accent2,
          font: FONT,
        });
      }

      // the state line above the plot: what the reader is holding right now, and
      // the corner itself. Both live in the band ABOVE the plot rect — the whole
      // plot interior is reachable by the reader's point, so a label placed in
      // there could be hidden under the marker.
      var headW = head.length ? meas.measureText(head[0]).width : 0;
      var cornerW = f.w - PAD.r - (PAD.l - 52) - headW - 12;
      if (cornerW >= meas.measureText('0.5992 × 66.3').width) {
        f.textPx(
          fit(['measured corner 0.5992 × 66.3 t.u.', 'corner 0.5992 × 66.3', '0.5992 × 66.3'], cornerW),
          f.w - PAD.r,
          HEAD_TOP,
          { align: 'right', color: accent, font: FONT },
        );
      }
      for (i = 0; i < head.length; i++) {
        f.textPx(head[i], PAD.l - 52, HEAD_TOP + i * LINE_H, {
          color: collapsed ? accent : accent2,
          font: FONT,
        });
      }

      // --- the point the reader drags ---
      // The corner dot is fixed; the reader's marker is re-outlined after
      // flushLabels (below) so it can never be hidden under one of the region
      // labels it is dragged across.
      f.dot(A_MIN, T_CRIT, { color: accent, r: 2.6 });
      f.dot(a, hold, {
        color: collapsed ? accent : accent2,
        r: 4.6,
        label: fit(
          collapsed
            ? ['collapsed on contact — G 0.049, held', 'collapsed — G 0.049', 'collapsed']
            : ['healthy — G* 0.886', 'healthy'],
          f.X(A_HI) - f.X(A_MIN) - 30,
        ),
        dy: collapsed ? -14 : 18,
      });

      // --- the notes, wrapped to the canvas it is drawn on ---
      var y = f.pad.t + PLOT_H + TICKS_TOP;
      for (var i = 0; i < noteLines.length; i++) {
        f.textPx(noteLines[i], 6, y, { color: VIZ.token('dim'), font: FONT });
        y += LINE_H;
      }

      f.flushLabels(); // labels last: the boundary cannot strike through them

      // …then the reader's own marker, outlined on top: a thin hollow ring the
      // reader can always find, even parked on a region label (it leaves the
      // glyphs underneath legible — it is a 1.6px stroke, not a patch)
      var mctx = f.ctx;
      mctx.save();
      mctx.strokeStyle = collapsed ? accent : accent2;
      mctx.lineWidth = 1.6;
      mctx.beginPath();
      mctx.arc(f.X(a), f.Y(hold), 5, 0, Math.PI * 2);
      mctx.stroke();
      mctx.restore();

      out.set(
        [
          collapsed ? 'collapsed outcome' : 'healthy outcome',
          ' · drive a = ',
          VIZ.bold(VIZ.fmt(a, 4)),
          ' × hold ',
          VIZ.bold(VIZ.fmt(hold, 1) + ' t.u.'),
          collapsed
            ? ' — past the measured corner, so G = '
            : ' — under the measured corner, so G* = ',
          collapsed ? VIZ.bold('0.049', true) : VIZ.bold('0.886'),
          collapsed ? ' and held; ' : '; ',
        ].concat(
          collapsed
            ? [
                'the last healthy solution was ε_c = ',
                VIZ.bold(EPS_C, true),
                ' (residual ',
                VIZ.bold(ERR_TAIL),
                '), and the collapsed branch has no mirror edge — hysteresis [0, ε_c) is unbounded below, so it ' +
                  'persists at every drive under the fold, including zero: ',
                VIZ.bold('you cannot exit by stopping'),
              ]
            : [
                'the published dose sweep found ',
                VIZ.bold(N_HEALTHY + ' healthy / ' + N_COLLAPSED + ' collapsed / 0 in between'),
                ', and the boundary is sharp and bisectable at intensity ',
                VIZ.bold(VIZ.fmt(A_MIN, 4)),
                ' and ',
                VIZ.bold(VIZ.fmt(T_CRIT, 1) + ' t.u.'),
                ' at that intensity',
              ],
        ),
      );
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
