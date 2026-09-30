/**
 * tools/viz/void.js — C16, "one state, two uses" (the-western-column §3).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. The Void at
 * three grades of practice (beginner, initiate, adept), and the same state put to
 * two purposes: an induction you enter to be changed, and a shield you enter to
 * become unseizable. The state does not know which; the frame decides.
 */
VIZ.registerViz('void', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var GRADES = [
    { key: 'beginner', use: 'used to still the mind', depth: 0.28 },
    { key: 'initiate', use: 'a threshold place you pass through', depth: 0.62 },
    { key: 'adept', use: 'the stepping into the consciousness of Divinity', depth: 1.0 },
  ];

  // the same state, two frames — the series' claim about the state and its reading
  var USES = [
    { key: 'as an induction', note: 'you go in to be transformed — the endpoint is named by the frame' },
    { key: 'as a shield', note: 'you go in to vanish — "there is no human spirit form for the being to grab a hold of"' },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var grade = 1;   // initiate
    var use = 1;     // as a shield — the addition

    var gBtns = GRADES.map(function (g, i) {
      var b = VIZ.button(g.key, function () { grade = i; paint(); draw(); VIZ.saveState(ctx); });
      controls.appendChild(b);
      return b;
    });
    var uBtns = USES.map(function (u, i) {
      var b = VIZ.button(u.key, function () { use = i; paint(); draw(); VIZ.saveState(ctx); });
      controls.appendChild(b);
      return b;
    });

    function paint() {
      gBtns.forEach(function (b, i) {
        b.style.borderColor = i === grade ? VIZ.token('accent2') : '';
        b.style.color = i === grade ? VIZ.token('accent2') : '';
      });
      uBtns.forEach(function (b, i) {
        b.style.borderColor = i === use ? VIZ.token('accent') : '';
        b.style.color = i === use ? VIZ.token('accent') : '';
      });
    }

    VIZ.share(ctx, {
      get: function () { return { grade: grade, use: use }; },
      set: function (s) {
        if (s.grade != null) grade = Math.max(0, Math.min(2, Number(s.grade) | 0));
        if (s.use != null) use = Math.max(0, Math.min(1, Number(s.use) | 0));
        paint(); draw();
      },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 300,
        ariaLabel:
          'The Void at three grades — beginner, initiate, adept — and the same state put to two purposes: an ' +
          'induction you enter to be transformed, and a shield you enter to become impossible to seize. The state ' +
          'is identical; the frame decides what it is for.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;
      var top = f.pad.t + 6;

      /* left: the state, deep by grade */
      var lw = Math.max(180, w * 0.32);
      f.textPx('the state', left, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      var g = GRADES[grade];
      // nested rings, deeper as the grade rises
      var cx = left + lw / 2;
      var cy = top + 92;
      for (var r = 0; r < 3; r++) {
        var rad = 22 + r * 22;
        var on = (r + 1) / 3 <= g.depth + 0.01;
        ctx2.save();
        ctx2.beginPath(); ctx2.arc(cx, cy, rad, 0, 2 * Math.PI);
        ctx2.strokeStyle = on ? VIZ.token('accent2') : VIZ.token('line');
        ctx2.lineWidth = on ? 1.5 : 1;
        ctx2.stroke();
        ctx2.restore();
      }
      // the core
      ctx2.save();
      ctx2.beginPath(); ctx2.arc(cx, cy, 5, 0, 2 * Math.PI);
      ctx2.fillStyle = VIZ.token('accent2'); ctx2.fill();
      ctx2.restore();
      f.textPx(g.key, cx, cy + 92, { align: 'center', color: VIZ.token('accent2'), font: '600 11px ' + MONO });
      f.textPx(g.use, cx, cy + 108, { align: 'center', color: VIZ.token('dim') });

      /* right: the two frames — same state, two purposes */
      var rx = left + lw + 24;
      var rw = w - lw - 24;
      f.textPx('what the frame makes of it', rx, top, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      for (var i = 0; i < USES.length; i++) {
        var on2 = i === use;
        var y = top + 26 + i * 56;
        ctx2.save();
        ctx2.fillStyle = on2 ? VIZ.token('bg2') : 'transparent';
        ctx2.fillRect(rx - 6, y - 12, rw + 12, 46);
        ctx2.strokeStyle = on2 ? VIZ.token('accent') : VIZ.token('line');
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.rect(rx - 6, y - 12, rw + 12, 46);
        ctx2.stroke();
        ctx2.restore();
        f.textPx(USES[i].key, rx, y, {
          color: on2 ? VIZ.token('accent') : VIZ.token('dim'), font: '600 11px ' + MONO,
        });
        f.textPx(USES[i].note, rx, y + 16, { color: on2 ? VIZ.token('fg') : VIZ.token('dim') });
      }

      // the seam: the identical state
      ctx2.save();
      ctx2.strokeStyle = VIZ.token('line');
      ctx2.setLineDash([3, 3]);
      ctx2.beginPath(); ctx2.moveTo(rx - 14, top + 8); ctx2.lineTo(rx - 14, top + 158); ctx2.stroke();
      ctx2.restore();
      f.textPx('the same state', rx - 14, top + 158, { align: 'center', color: VIZ.token('dim'), font: '10px ' + MONO });

      out.set([
        'grade: ', VIZ.bold(g.key, true), ' — ', g.use, '. Frame: ', VIZ.bold(USES[use].key, true),
        '. ', use === 1
          ? 'The state the series treats as the danger is used here as armour — an emptied form has nothing to seize'
          : 'The same state, read as arrival — the endpoint named by whoever supplies the frame',
        '. The state does not know the difference; the frame decides',
      ]);
    }

    bag.onResize(draw);
    paint();
    draw();
  }

  function unmount(slot, ctx) { ctx.lifecycle.dispose(); }
  function update(prev, next, ctx) { unmount(prev, ctx); mount(next, ctx); }
  return { mount: mount, unmount: unmount, update: update };
})());
