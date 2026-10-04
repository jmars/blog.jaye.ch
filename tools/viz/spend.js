/**
 * tools/viz/spend.js — the worker §3 (the price), what reconstructing the self
 * costs, per arm, in both sets.
 *
 * A REPLAY, not a simulation: every bar is a measured count from the runs. Two
 * panels read from the page's own data: per arm, the reconstruction calls
 * (total across the arm's cells) with the self-directed thinking behind them
 * (median per cell, with the range), and the mix of the two routes the calls
 * took. The no-self and carrier arms are zero on every axis, and the zeros are
 * DRAWN — a missing bar is a claim the reader cannot check.
 *
 * The controls cycle the set; the readout names the arm's numbers.
 */
VIZ.registerViz('spend', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  /** The page's own data (every arm's aggregates, both sets). */
  function data() {
    var el = document.getElementById('viz-data-worker');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.sets ? d : null;
    } catch (e) {
      return null;
    }
  }

  /** 400804 → "400,804", the form the prose quotes. */
  function thou(n) {
    var s = String(Math.round(n));
    var out = '';
    for (var i = 0; i < s.length; i++) {
      if (i > 0 && (s.length - i) % 3 === 0) out += ',';
      out += s.charAt(i);
    }
    return out;
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var d = data();
    if (!d) {
      out.set([
        'the figure is missing its own data — every mark on it comes from real runs, and there are none to draw.',
      ]);
      return;
    }

    var SET_NAMES = { set1: 'the deciding set', set2: 'the replication' };
    var order = ['D0', "D1'", 'D1'];
    var ARM_LABELS = { D0: 'D0 — no self', "D1'": 'D1′ — carrier', D1: 'D1 — reconstruct' };

    var at = d.sets.length - 1; // the replication by default, like the replay

    var buttons = d.sets.map(function (s, i) {
      var b = VIZ.button(SET_NAMES[s.key] || s.key, function () {
        at = i;
        paint();
        draw();
        VIZ.saveState(ctx);
      });
      controls.appendChild(b);
      return b;
    });

    function paint() {
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].style.borderColor = i === at ? VIZ.token('accent') : '';
        buttons[i].style.color = i === at ? VIZ.token('accent') : '';
      }
    }

    VIZ.share(ctx, {
      get: function () {
        return { s: at };
      },
      set: function (s) {
        if (s.s != null) at = Math.round(VIZ.clamp(s.s, 0, d.sets.length - 1));
        paint();
        draw();
      },
    });

    function draw() {
      var set = d.sets[at];
      var f = VIZ.frame(canvas, {
        height: 360,
        ariaLabel:
          'The price of reconstructing the self, per arm: reconstruction calls and the self-directed thinking ' +
          'behind them, and the mix of the two routes the calls took. The no-self and carrier arms are zero ' +
          'on every axis, drawn as zero.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
        pad: { l: 8, r: 8, t: 14, b: 8 },
      });
      var c2 = f.ctx;
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;

      // ---- panel 1: reconstruction calls per arm, drawn per-cell dots over a
      // bar of the total (a zero arm gets an explicit "0", not a blank) ----
      var p1w = w * 0.34;
      f.textPx('reconstruction calls, per arm', left, 16, {
        font: '600 10px ' + MONO,
        color: VIZ.token('dim'),
      });
      var maxCalls = 0;
      for (var a = 0; a < order.length; a++) {
        var arm1 = set.arms[order[a]];
        if (!arm1) continue;
        if (arm1.reconCalls > maxCalls) maxCalls = arm1.reconCalls;
      }
      if (!(maxCalls > 0)) maxCalls = 1;
      var barW = Math.min(52, Math.max(22, p1w / (order.length + 2)));
      var slotW = p1w / order.length;
      for (var i = 0; i < order.length; i++) {
        var arm = set.arms[order[i]];
        var x = left + slotW * i + (slotW - barW) / 2;
        var y0 = 40;
        var hMax = 140;
        var h = (arm.reconCalls / maxCalls) * hMax;
        c2.save();
        c2.fillStyle = VIZ.token('accent');
        c2.globalAlpha = h > 0 ? 0.85 : 0.35; // a zero is drawn, faintly
        c2.fillRect(x, y0 + hMax - h, barW, Math.max(h, h > 0 ? h : 1.5));
        c2.restore();
        // the per-cell dots over the arm's bar: where each cell's own calls sit
        c2.save();
        for (var k = 0; k < arm.cells.length; k++) {
          var cy = y0 + hMax - (arm.cells[k].reconCalls / maxCalls) * hMax;
          c2.fillStyle = VIZ.token('fg');
          c2.globalAlpha = 0.7;
          c2.beginPath();
          c2.arc(x + barW / 2, cy, 2, 0, Math.PI * 2);
          c2.fill();
        }
        c2.restore();
        f.textPx(
          thou(arm.reconCalls),
          x + barW / 2,
          y0 + hMax - h - 10,
          { align: 'center', font: '600 11px ' + MONO, color: VIZ.token('fg') },
        );
        f.textPx(
          ARM_LABELS[order[i]].replace(/ —.*/, ''),
          x + barW / 2,
          y0 + hMax + 14,
          { align: 'center', font: '10px ' + MONO, color: VIZ.token('dim') },
        );
      }

      // ---- panel 2: the thinking behind the calls, per arm: a bar at the
      // MEDIAN self-directed thinking per cell, whiskers to the range, and an
      // explicit "0" where the arm did none ----
      var p2x = left + p1w + 18;
      var p2w = w * 0.30;
      f.textPx('self-directed thinking, per cell', p2x, 16, {
        font: '600 10px ' + MONO,
        color: VIZ.token('dim'),
      });
      var maxThink = 0;
      for (var a2 = 0; a2 < order.length; a2++) {
        var armT = set.arms[order[a2]];
        if (!armT) continue;
        if (armT.thinkingRange && armT.thinkingRange[1] > maxThink) maxThink = armT.thinkingRange[1];
      }
      if (!(maxThink > 0)) maxThink = 1;
      var slot2 = p2w / order.length;
      var bar2 = Math.min(52, Math.max(22, slot2 / 2));
      for (var i2 = 0; i2 < order.length; i2++) {
        var arm2 = set.arms[order[i2]];
        var x2 = p2x + slot2 * i2 + (slot2 - bar2) / 2;
        var y02 = 40;
        var hMax2 = 140;
        var med = arm2.thinkingMedian || 0;
        var lo = arm2.thinkingRange ? arm2.thinkingRange[0] : 0;
        var hi = arm2.thinkingRange ? arm2.thinkingRange[1] : 0;
        var hm = (med / maxThink) * hMax2;
        c2.save();
        c2.fillStyle = VIZ.token('accent2');
        c2.globalAlpha = med > 0 ? 0.85 : 0.35; // a zero is drawn, faintly
        c2.fillRect(x2, y02 + hMax2 - hm, bar2, Math.max(hm, med > 0 ? hm : 1.5));
        c2.restore();
        if (hi > 0) {
          // the range, as whiskers through the bar
          c2.save();
          c2.strokeStyle = VIZ.token('dim');
          c2.globalAlpha = 0.8;
          c2.lineWidth = 1;
          c2.setLineDash([]);
          var yLo = y02 + hMax2 - (lo / maxThink) * hMax2;
          var yHi = y02 + hMax2 - (hi / maxThink) * hMax2;
          c2.beginPath();
          c2.moveTo(x2 + bar2 / 2, yLo);
          c2.lineTo(x2 + bar2 / 2, yHi);
          c2.moveTo(x2 + bar2 / 2 - 4, yLo);
          c2.lineTo(x2 + bar2 / 2 + 4, yLo);
          c2.moveTo(x2 + bar2 / 2 - 4, yHi);
          c2.lineTo(x2 + bar2 / 2 + 4, yHi);
          c2.stroke();
          c2.restore();
        }
        f.textPx(
          med > 0 ? thou(med) : '0',
          x2 + bar2 / 2,
          y02 + hMax2 - hm - 10,
          { align: 'center', font: '600 11px ' + MONO, color: VIZ.token('fg') },
        );
        f.textPx(
          ARM_LABELS[order[i2]].replace(/ —.*/, ''),
          x2 + bar2 / 2,
          y02 + hMax2 + 14,
          { align: 'center', font: '10px ' + MONO, color: VIZ.token('dim') },
        );
      }
      f.textPx(
        'median per cell, whiskers the range; in characters',
        p2x,
        y02 + hMax2 + 30,
        { font: '10px ' + MONO, color: VIZ.token('dim') },
      );

      // ---- panel 3: the route mix of the calls — content without steps vs
      // the whole budget spent thinking ----
      var p3x = p2x + p2w + 18;
      var p3w = w - p1w - p2w - 36;
      f.textPx('the routes the calls took', p3x, 16, {
        font: '600 10px ' + MONO,
        color: VIZ.token('dim'),
      });
      var d1 = set.arms.D1;
      var r1 = d1.routes.content_without_steps || 0;
      var r2 = d1.routes.exhausted_inward || 0;
      var rTot = r1 + r2;
      if (!(rTot > 0)) rTot = 1;
      var ly = 46;
      var lh = 26;
      var rows = [
        { label: 'prose, no step structure in it', n: r1, tone: 'accent2' },
        { label: 'the whole budget spent thinking', n: r2, tone: 'accent' },
      ];
      for (var i3 = 0; i3 < rows.length; i3++) {
        var y = ly + i3 * (lh + 14);
        c2.save();
        c2.fillStyle = VIZ.token(rows[i3].tone);
        c2.globalAlpha = rows[i3].n > 0 ? 0.8 : 0.35; // a zero is drawn, faintly
        var bw = Math.max(2, (p3w - 130) * (rows[i3].n / rTot));
        c2.fillRect(p3x, y - 4, Math.max(bw, rows[i3].n > 0 ? bw : 1.5), lh - 8);
        c2.restore();
        f.textPx(
          thou(rows[i3].n),
          p3x + Math.max(bw, 2) + 8,
          y + 6,
          { font: '600 11px ' + MONO, color: VIZ.token('fg') },
        );
        f.textPx(rows[i3].label, p3x, y + lh + 2, {
          font: '10px ' + MONO,
          color: VIZ.token('dim'),
        });
      }
      f.textPx(
        'of the reconstruct arm\u2019s ' + thou(d1.reconCalls) + ' calls',
        p3x,
        ly + 2 * (lh + 14) + lh,
        { font: '10px ' + MONO, color: VIZ.token('dim') },
      );

      f.flushLabels();

      // the readout: the set's own price, with the zeros named as zeros
      var d1m = d1.thinkingMedian || 0;
      out.set([
        SET_NAMES[set.key] + ' — reconstruction calls: ',
        VIZ.bold('D0: 0', false),
        ', ',
        VIZ.bold('D1\u2032: 0', false),
        ', ',
        VIZ.bold('D1: ' + thou(d1.reconCalls), true),
        ' · self-directed thinking per cell: ',
        VIZ.bold('D1: ' + thou(d1m), true),
        ' (range ' + thou(d1.thinkingRange[0]) + '\u2013' + thou(d1.thinkingRange[1]) + '), the controls zero',
        ' · the calls: ' + thou(r1) + ' returned prose with no step structure, ' + thou(r2) +
          ' spent the whole budget thinking and emitted nothing at all' + '.',
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
