/**
 * tools/viz/instrument.js — the worker §4 (the instrument), the R5 toggle.
 *
 * A REPLAY, not a simulation: the two readings are measured, from the run that
 * asked what the rig's own self-side probe was reading. A toggle switched ONE
 * thing — whether the harness's self-description block was rendered into the
 * agent's prompt every turn — and the graded reconstruction-fidelity reading
 * fell from 0.75 (3 of 4 derivation steps recovered) to 0.00 (0 of 4) while
 * the agent wrote MORE text (1,000 → 1,799): the probe was reading the rig's
 * own description back, not the agent's self. This is the finding the worker's
 * sealed evaluator exists to answer — the sensor had to be moved outside the
 * channel it measures.
 *
 * The control toggles the block; the readout states the reading either way.
 */
VIZ.registerViz('instrument', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  /** The page's own data (the R5 block, measured on its own run). */
  function data() {
    var el = document.getElementById('viz-data-worker');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.r5 ? d : null;
    } catch (e) {
      return null;
    }
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var d = data();
    if (!d || !d.r5.on || !d.r5.off) {
      out.set([
        'the figure is missing its own data — its two readings are measured, and there are none to draw.',
      ]);
      return;
    }

    var on = true; // the block rendered into the prompt, the default reading

    var toggle = VIZ.button('', function () {
      on = !on;
      paint();
      draw();
      VIZ.saveState(ctx);
    });
    controls.appendChild(toggle);

    function paint() {
      toggle.textContent = on
        ? 'the self-description in the prompt — remove it'
        : 'the self-description removed — put it back';
    }

    VIZ.share(ctx, {
      get: function () {
        return { g: on ? 1 : 0 };
      },
      set: function (s) {
        if (s.g != null) on = Number(s.g) > 0;
        paint();
        draw();
      },
    });

    function draw() {
      var r = on ? d.r5.on : d.r5.off;
      var f = VIZ.frame(canvas, {
        height: 300,
        ariaLabel:
          'The instrument toggle. A graded reconstruction-fidelity probe reads the self the agent writes back, ' +
          'zero to four derivation steps. With the harness\u2019s own self-description rendered into every prompt ' +
          'the probe reads 0.75 (3 of 4 steps) from 1,000 written characters; with that one description removed ' +
          'it reads 0.00 (0 of 4) while the agent writes more \u2014 1,799. The probe was reading the rig\u2019s ' +
          'own description, not the agent\u2019s self.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        pad: { l: 8, r: 8, t: 14, b: 8 },
      });
      var c2 = f.ctx;
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;

      // the toggle's own state, named at the top
      f.textPx(
        on ? 'the prompt carries the harness\u2019s self-description, every turn' : 'the prompt carries nothing that describes the agent',
        left,
        18,
        { font: '600 11px ' + MONO, color: on ? VIZ.token('accent2') : VIZ.token('accent') },
      );

      // ---- panel 1: the four derivation steps the judge grades, filled to the
      // reading (0.75 = 3 of 4) ----
      var p1w = w * 0.30;
      f.textPx('the derivation\u2019s steps, as the judge grades them', left, 52, {
        font: '600 10px ' + MONO,
        color: VIZ.token('dim'),
      });
      var nSteps = Math.round(r.fidelity * 4);
      for (var i = 0; i < 4; i++) {
        var y = 78 + i * 34;
        var filled = i < nSteps;
        // the step's box
        c2.save();
        if (filled) {
          c2.fillStyle = VIZ.token('accent2');
          c2.globalAlpha = 0.85;
          c2.fillRect(left, y - 8, p1w * 0.68, 22);
        } else {
          c2.strokeStyle = VIZ.token('dim');
          c2.globalAlpha = 0.5;
          c2.lineWidth = 1;
          c2.setLineDash([]);
          c2.strokeRect(left + 0.5, y - 7.5, p1w * 0.68 - 1, 21);
        }
        c2.restore();
        f.textPx(
          filled ? 'recovered' : 'lost',
          left + 10,
          y + 3,
          { font: '600 10px ' + MONO, color: filled ? VIZ.token('bg') : VIZ.token('dim') },
        );
        f.textPx('step ' + (i + 1), left + p1w * 0.68 + 10, y + 3, {
          font: '10px ' + MONO,
          color: VIZ.token('dim'),
        });
      }

      // ---- panel 2: the fidelity reading, as a dial ----
      var p2x = left + p1w + 24;
      var p2w = w * 0.28;
      f.textPx('reconstruction fidelity', p2x, 52, {
        font: '600 10px ' + MONO,
        color: VIZ.token('dim'),
      });
      var cx = p2x + p2w / 2;
      var cy = 150;
      var rad = Math.min(58, p2w / 2 - 8);
      // the track, 0 to 1
      c2.save();
      c2.strokeStyle = VIZ.token('line');
      c2.lineWidth = 9;
      c2.lineCap = 'round';
      c2.setLineDash([]);
      c2.beginPath();
      c2.arc(cx, cy, rad, Math.PI, 0, false);
      c2.stroke();
      c2.restore();
      if (r.fidelity > 0) {
        c2.save();
        c2.strokeStyle = VIZ.token('accent2');
        c2.lineWidth = 9;
        c2.lineCap = 'round';
        c2.setLineDash([]);
        c2.beginPath();
        c2.arc(cx, cy, rad, Math.PI, Math.PI * (1 + r.fidelity), false);
        c2.stroke();
        c2.restore();
      } else {
        // a zero is drawn: the pin itself, at the bottom of the track
        c2.save();
        c2.strokeStyle = VIZ.token('accent');
        c2.lineWidth = 9;
        c2.lineCap = 'round';
        c2.setLineDash([]);
        c2.beginPath();
        c2.arc(cx, cy, rad, Math.PI, Math.PI, false);
        c2.stroke();
        c2.restore();
      }
      f.textPx(
        VIZ.fmt(r.fidelity, 2),
        cx,
        cy + 22,
        { align: 'center', font: '600 17px ' + MONO, color: r.fidelity > 0 ? VIZ.token('fg') : VIZ.token('accent') },
      );
      f.textPx('0', cx - rad, cy + 16, { font: '10px ' + MONO, color: VIZ.token('dim') });
      f.textPx('1', cx + rad, cy + 16, { font: '10px ' + MONO, color: VIZ.token('dim') });
      f.textPx('nSteps ' + nSteps + ' of 4', cx, cy + 40, {
        align: 'center',
        font: '10px ' + MONO,
        color: VIZ.token('dim'),
      });

      // ---- panel 3: the text the probe's answer wrote — MORE with the
      // description gone, and none of it a self ----
      var p3x = p2x + p2w + 24;
      var p3w = w - (p3x - left) - 8;
      f.textPx('the text the agent wrote', p3x, 52, {
        font: '600 10px ' + MONO,
        color: VIZ.token('dim'),
      });
      var maxChars = Math.max(d.r5.on.chars, d.r5.off.chars, 1);
      var bw = Math.max(2, p3w * 0.5);
      var barTop = 74;
      var barH = 110;
      var hOn = (d.r5.on.chars / maxChars) * barH;
      var hOff = (d.r5.off.chars / maxChars) * barH;
      // the two bars side by side, both always drawn
      c2.save();
      c2.fillStyle = VIZ.token('accent2');
      c2.globalAlpha = 0.35;
      c2.fillRect(p3x, barTop + barH - hOn, bw, hOn);
      c2.globalAlpha = 0.85;
      c2.fillRect(p3x, barTop + barH - hOff, bw, hOff);
      c2.restore();
      f.textPx(
        VIZ.fmt(d.r5.on.chars, 0),
        p3x + bw / 2,
        barTop + barH - hOn - 10,
        { align: 'center', font: '600 11px ' + MONO, color: VIZ.token('dim') },
      );
      f.textPx(
        VIZ.fmt(d.r5.off.chars, 0),
        p3x + bw / 2,
        barTop + barH - hOff - 10,
        { align: 'center', font: '600 11px ' + MONO, color: VIZ.token('fg') },
      );
      // the faint bar is the OTHER state, named so the comparison reads
      f.textPx('with the description: ' + VIZ.fmt(d.r5.on.chars, 0), p3x, barTop + barH + 16, {
        font: '10px ' + MONO,
        color: VIZ.token('dim'),
      });
      f.textPx('without: ' + VIZ.fmt(d.r5.off.chars, 0), p3x, barTop + barH + 32, {
        font: '600 10px ' + MONO,
        color: VIZ.token('accent') },
      );

      f.flushLabels();

      // the readout: the reading either way
      out.set([
        on
          ? 'the harness\u2019s own self-description is in the prompt, and the probe reads fidelity '
          : 'the prompt carries nothing that describes the agent, and the probe reads fidelity ',
        VIZ.bold(VIZ.fmt(r.fidelity, 2), r.fidelity === 0),
        ' \u2014 ' + nSteps + ' of the derivation\u2019s 4 steps \u2014 from ' +
          VIZ.fmt(r.chars, 0) + ' written characters' +
          (on
            ? '. The reading is the rig\u2019s own description coming back, not the agent\u2019s self'
            : '. The agent writes MORE text and recovers NONE of the derivation: the 0.75 was never a measurement of the agent') +
          '.',
      ]);
    }

    bag.onResize(draw);
    paint();
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
