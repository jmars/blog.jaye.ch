/**
 * tools/viz/nowarning.js — W8, why there is no warning (meditation-harm §5).
 *
 * The post's exact audit of the approach to the edge, as a figure: the reader
 * creeps toward the cliff over the five decades of distance the audit swept,
 * and the indicator everyone would watch — how long the system takes to settle
 * — does not move at all. It is **667 time-units at every distance**, the
 * recovery rate constant is **flat at −0.0015** (spread: exactly 0), and the
 * "critical" mode moves 0.5% where a saddle-node would move 98%. Then the
 * healthy branch is annihilated on contact, with no fanfare at all.
 *
 * What does move is the *basin of attraction* — the size of perturbation the
 * system can absorb — tracking distance-to-edge almost exactly (slope ≈ 1) and
 * going to zero. Which is the post's practical conclusion: a protocol that
 * measures only settling time will miss the approach entirely; you have to
 * measure the size of the disturbance the system tolerates.
 *
 * SCHEMATIC. Published landmarks only (§5):
 *   recovery rate constant −0.0015, recovery time 667 t.u., across five decades
 *   the rate is constant with spread exactly 0; 2×10⁻⁶ is the closest approach
 *   the critical mode moves 0.5% where a saddle-node would move 98%
 *   annihilated on contact: ε_c = 0.265192279 dying exactly on E = Θ_eff (10⁻¹³)
 *   at the moment of death the eigenvalues are [−0.0015, −0.0055, −0.0088,
 *   −0.0427, −0.598] — every mode bounded away from zero
 *   the basin tracks distance-to-edge with slope ≈ 1, so it reaches zero there
 * The settling-time line is drawn flat because it is flat; the basin line is
 * drawn as distance-to-edge itself (slope 1), normalized to its far-field value.
 */
VIZ.registerViz('nowarning', (function () {
  'use strict';

  var RATE = -0.0015; // the dominant recovery rate constant (§5)
  var T_SETTLE = 667; // recovery time, the same at every distance (§5)
  var X_MAX = 5.7; // -log10(2×10⁻⁶): the closest measured approach, five decades in
  // (step-aligned with the slider below: the reader must be able to reach contact)
  var X_FAR = 0; // -log10(1): the far end of the audit's five decades
  var Y_MAX = 800; // the settling-time axis, comfortably over the published 667
  var EPS_C = 0.265192279; // the last healthy solution (§5)
  var ERR_TAIL = '10⁻¹³';
  var EV = '−0.0015, −0.0055, −0.0088, −0.0427, −0.598'; // at the moment of death
  var SUP = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

  var PAD = { l: 58, r: 54, t: 24, b: 14 };
  var PLOT_H = 196;
  var HEAD_TOP = 18; // the state line, above the plot
  var TICKS_TOP = 44; // where the notes start below the plot rect
  var FONT = '11px SFMono-Regular, Menlo, Consolas, monospace';
  var LINE_H = 15;
  var SPEED = 0.9; // decades per second of the creep

  /** Superscript an integer (or a leading minus). */
  function sup(n) {
    var s = String(n);
    var out = '';
    for (var i = 0; i < s.length; i++) out += SUP[s.charAt(i)] || s.charAt(i);
    return out;
  }

  /** 10⁻³, 3.2×10⁻⁴, 2×10⁻⁶ — the distances the audit quotes. */
  function distLabel(d) {
    if (!(d > 0)) return '0';
    if (d >= 1) return '1';
    var e = Math.floor(Math.log(d) / Math.LN10);
    var m = d / Math.pow(10, e);
    var whole = Math.round(m);
    var ms = Math.abs(m - whole) < 1e-9 ? String(whole) : VIZ.fmt(m, 1);
    return ms + '×10' + sup(e);
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var meas = document.createElement('canvas').getContext('2d');
    meas.font = FONT;

    /** The first of `cands` that fits `maxPx` (a label shortens on a narrow
     * canvas rather than run off it; the full statement is in the notes). */
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

    // annihilated on contact — and, per §6, not restored by walking back
    var annihilated = false;

    var distSlider = VIZ.slider({
      label: 'distance to the edge',
      min: X_FAR,
      max: X_MAX,
      step: 0.01,
      value: X_FAR,
      digits: 2,
      format: function (v) {
        return v <= 0 ? 'far' : distLabel(Math.pow(10, -v)) + ' away';
      },
      onInput: function (v) {
        creep.stop();
        run.textContent = '▶ creep toward the edge';
        if (v >= X_MAX - 1e-9) annihilated = true;
        draw();
      },
    });
    controls.appendChild(distSlider.el);

    var creep = bag.loop(function (dt) {
      var x = Math.min(X_MAX, distSlider.value() + dt * SPEED);
      distSlider.set(x);
      if (x >= X_MAX) {
        creep.stop();
        run.textContent = '▶ creep toward the edge';
        annihilated = true; // contact, with no ceremony of any kind
      }
      draw();
      if (!creep.isRunning()) VIZ.saveState(ctx); // one write for the whole creep
    });

    var run = VIZ.button('▶ creep toward the edge', function () {
      if (creep.isRunning()) {
        creep.stop();
        run.textContent = '▶ resume the creep';
      } else {
        if (annihilated || distSlider.value() >= X_MAX) {
          annihilated = false;
          distSlider.set(X_FAR);
        }
        run.textContent = '❚❚ pause';
        creep.start();
      }
    });
    var reset = VIZ.button('reset', function () {
      creep.stop();
      run.textContent = '▶ creep toward the edge';
      annihilated = false;
      distSlider.set(X_FAR);
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(run);
    controls.appendChild(reset);

    // shareable frame: #viz=nowarning&x=2.5&annihilated=0
    VIZ.share(ctx, {
      get: function () {
        return { x: distSlider.value(), annihilated: annihilated ? 1 : 0 };
      },
      set: function (s) {
        creep.stop();
        run.textContent = '▶ creep toward the edge';
        if (s.x != null) distSlider.set(s.x);
        annihilated = !!s.annihilated;
        draw();
      },
    });

    function draw() {
      var x = distSlider.value();
      var d = Math.pow(10, -x);
      var basin = d; // slope ≈ 1: the tolerated disturbance tracks the distance
      var avail = Math.max(240, canvas.clientWidth || (canvas.parentNode && canvas.parentNode.clientWidth) || 680);
      var textW = avail - 16;

      var head = wrapText(
        annihilated
          ? 'on contact: the healthy branch is annihilated — and the settling time never moved'
          : 'creeping toward the edge — the settling time does not move',
        textW,
      );
      var notes = [
        'x — distance to the edge, log scale, over the five decades the check swept; 2×10⁻⁶ is the closest ' +
          'measured approach',
        'grey: settling time in time units (left axis) · accent: the disturbance tolerated, normalized (right axis)',
        'the reassuring indicator is flat: ' +
          T_SETTLE +
          ' t.u. at every distance — recovery rate constant ' +
          String(RATE).replace('-', '−') +
          ', spread exactly 0',
        'the critical mode moves 0.5% where a saddle-node would move 98%',
      ];
      if (annihilated) {
        notes.push('annihilated on contact: ε_c = ' + EPS_C + ', dying exactly on E = Θ_eff (residual ' + ERR_TAIL + ')');
        notes.push('at the moment of death the eigenvalues are [' + EV + '] — every mode bounded away from zero');
      } else {
        notes.push(
          'the warning signal is not time, it is tolerance: a protocol that measures only settling time will ' +
            'miss the approach entirely',
        );
      }
      var noteLines = [];
      for (var n = 0; n < notes.length; n++) noteLines = noteLines.concat(wrapText(notes[n], textW));
      var height = HEAD_TOP + head.length * LINE_H + PLOT_H + TICKS_TOP + noteLines.length * LINE_H + PAD.b;

      var f = VIZ.frame(canvas, {
        height: height,
        ariaLabel: annihilated
          ? 'the approach to the edge measured against distance: the settling time stays flat at 667 time units ' +
            'across five decades while the tolerated disturbance falls to zero, and on contact the healthy branch is ' +
            'annihilated — the reassuring indicator never moved'
          : 'the approach to the edge measured against distance: the settling time stays flat at 667 time units and ' +
            'the recovery rate constant is flat at −0.0015 with spread exactly 0, while the tolerated disturbance ' +
            'falls with distance-to-edge toward zero',
        xMin: X_FAR,
        xMax: X_MAX,
        yMin: 0,
        yMax: Y_MAX,
        pad: { l: PAD.l, r: PAD.r, t: HEAD_TOP + head.length * LINE_H, b: TICKS_TOP + noteLines.length * LINE_H + PAD.b },
      });
      f.grid({
        xTicks: [0, 1, 2, 3, 4, 5],
        yCount: 4,
        xFormat: function (v) {
          return v === 0 ? '1' : '10' + sup(-Math.round(v));
        },
        yFormat: function (v) {
          return VIZ.fmt(v, 0);
        },
      });
      var accent = VIZ.token('accent');
      var accent2 = VIZ.token('accent2');
      var dim = VIZ.token('dim');

      // the state line above the plot, wrapped and drawn (not just allotted)
      for (var i = 0; i < head.length; i++) {
        f.textPx(head[i], 6, 12 + i * LINE_H, { color: annihilated ? accent : accent2, font: FONT });
      }

      // the right axis: the basin, normalized to its far-field value (0 → 1)
      for (var k = 0; k <= 2; k++) {
        var bv = k / 2;
        f.textPx(VIZ.fmt(bv, 1), f.pad.l + (f.w - f.pad.l - f.pad.r) + 6, f.Y(bv * Y_MAX), {
          color: accent,
          font: FONT,
        });
      }

      // --- the settling time: flat at 667, everywhere, permanently ---
      f.hline(T_SETTLE, { color: dim, width: 2.5 });
      f.textPx(
        fit([T_SETTLE + ' t.u. — flat at every distance', T_SETTLE + ' t.u. — flat', T_SETTLE + ' t.u.'], f.w - PAD.l - PAD.r - 20),
        f.pad.l + 6,
        f.Y(T_SETTLE) + 14,
        { color: dim, font: FONT },
      );

      // --- the basin: distance-to-edge, slope ≈ 1, down to zero ---
      f.sample(
        function (xx) {
          return Math.pow(10, -xx) * Y_MAX;
        },
        { from: X_FAR, to: X_MAX, n: 240, color: accent, width: 2.5 },
      );
      f.dot(X_MAX, 0, {
        color: accent,
        r: 3.4,
        label: fit(['disturbance tolerated → 0', 'tolerated → 0'], f.w - PAD.l - PAD.r - 20),
        dy: -9,
      });

      // --- where the reader is on that approach ---
      f.vline(X_MAX, { color: accent, dash: [4, 4], alpha: 0.7 });
      f.dot(x, T_SETTLE, {
        color: annihilated ? accent : accent2,
        r: 4.6,
        label: fit(
          annihilated
            ? ['annihilated on contact', 'annihilated']
            : x <= 0
              ? ['you are here — at the far end', 'you are here']
              : ['you are here — ' + distLabel(d) + ' from the edge', 'you are here'],
          f.w - PAD.l - PAD.r - 20,
        ),
        dy: -13,
      });
      if (annihilated) {
        // the branch is gone: struck through, with the flat line untouched
        var c = f.ctx;
        var mx = f.X(x);
        var my = f.Y(T_SETTLE);
        c.save();
        c.strokeStyle = accent;
        c.lineWidth = 1.8;
        c.beginPath();
        c.moveTo(mx - 5.6, my - 5.6);
        c.lineTo(mx + 5.6, my + 5.6);
        c.moveTo(mx - 5.6, my + 5.6);
        c.lineTo(mx + 5.6, my - 5.6);
        c.stroke();
        c.restore();
      }

      // --- the axis names and what was measured, wrapped to the canvas ---
      var y = f.pad.t + PLOT_H + TICKS_TOP;
      for (var i = 0; i < noteLines.length; i++) {
        f.textPx(noteLines[i], 6, y, { color: dim, font: FONT });
        y += LINE_H;
      }

      f.flushLabels(); // labels last: the curves cannot strike through them

      out.set(
        [
          'distance to the edge = ',
          VIZ.bold(x <= 0 ? '1 (far)' : distLabel(d)),
          ' · settling time ',
          VIZ.bold(T_SETTLE + ' t.u.'),
          ' (recovery rate constant ',
          VIZ.bold('−0.0015'),
          ', spread exactly ',
          VIZ.bold('0'),
          ') — unmoved · disturbance tolerated ',
          VIZ.bold(VIZ.fmt(basin, 6)),
          ' of the far-field value',
        ].concat(
          annihilated
            ? [
                ' · ',
                VIZ.bold('annihilated on contact', true),
                ': ε_c = ',
                VIZ.bold(EPS_C),
                ' (residual ',
                VIZ.bold(ERR_TAIL),
                '), eigenvalues [',
                VIZ.bold(EV),
                '] at the moment of death, every mode bounded away from zero. ',
                VIZ.bold('Settling time does not warn you; the basin does.'),
              ]
            : [
                ' · nothing has moved but the basin, and the basin is the only signal in the figure',
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
