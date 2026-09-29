/**
 * tools/viz/alarm.js — C4, "the alarm" (the-sanctioned-trance §3).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. The state is
 * held fixed; the only thing the slider moves is the appraisal. Watch who, if
 * anyone, notices — and read why the culture is right not to run a reflex alarm,
 * which is exactly why the alarm is off.
 */
VIZ.registerViz('alarm', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';
  var OBSERVERS = [
    ['the person', 'I am being worked on, spiritually'],
    ['family / friends', 'they seem transformed lately'],
    ['a clinician', 'a dissociative state, in a religious register'],
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var appr = VIZ.slider({
      label: 'appraisal — clinical ← → spiritual',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.9,
      digits: 2,
      onInput: draw,
    });
    controls.appendChild(appr.el);

    VIZ.share(ctx, {
      get: function () { return { appr: appr.value() }; },
      set: function (s) { if (s.appr != null) appr.set(s.appr); draw(); },
    });

    function draw() {
      var a = appr.value(); // 0 = clinical, 1 = spiritual
      var alarm = 1 - a; // who notices: strong when the state is read as pathology

      var f = VIZ.frame(canvas, {
        height: 250,
        ariaLabel:
          'The state is identical at every setting. The slider changes only the appraisal, from clinical to ' +
          'spiritual, and with it the reading each observer gives the same state: the person, their friends and ' +
          'family, and a clinician. Read as spiritual, the state raises no alarm and reads as progress.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      /* the state — a fixed marker, never moved by the slider */
      f.textPx('the state', f.pad.l, f.pad.t + 6, { color: VIZ.token('fg'), font: '600 11px ' + MONO });
      f.textPx('identical at every setting — only the appraisal moves', f.pad.l, f.pad.t + 20, {
        color: VIZ.token('dim'),
      });

      var sx = f.pad.l + 6;
      var sy = f.pad.t + 44;
      var sw = 210;
      var ctx2 = canvas.getContext('2d');
      ctx2.save();
      ctx2.fillStyle = VIZ.token('accent2');
      ctx2.fillRect(sx, sy, sw, 12);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(sx, sy, sw, 12);
      ctx2.stroke();
      ctx2.restore();
      f.textPx('the collapse', sx + sw + 8, sy + 6, { color: VIZ.token('accent2') });

      /* the observers — the reading each gives the same state */
      var oy = f.pad.t + 82;
      var lit = alarm > 0.5;
      for (var i = 0; i < OBSERVERS.length; i++) {
        var y = oy + i * 30;
        f.textPx(OBSERVERS[i][0], f.pad.l, y, { color: VIZ.token('fg') });
        // lamp: a small filled square, lit or dark
        ctx2.save();
        ctx2.fillStyle = lit ? VIZ.token('accent') : VIZ.token('bg2');
        ctx2.fillRect(f.pad.l - 16, y - 5, 9, 9);
        ctx2.strokeStyle = VIZ.token('dim');
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.rect(f.pad.l - 16, y - 5, 9, 9);
        ctx2.stroke();
        ctx2.restore();
        f.textPx(lit ? 'alarm — this is harm' : 'no alarm — ' + OBSERVERS[i][1], f.pad.l + 96, y, {
          color: lit ? VIZ.token('accent') : VIZ.token('dim'),
        });
      }

      /* the alarm gauge — the threshold is the whole point */
      var gx = f.w - f.pad.r - 26;
      var gy = f.pad.t + 44;
      var gh = 120;
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(gx, gy, 22, gh);
      ctx2.fillStyle = lit ? VIZ.token('accent') : VIZ.token('dim');
      ctx2.fillRect(gx, gy + gh * (1 - alarm), 22, gh * alarm);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(gx, gy, 22, gh);
      ctx2.stroke();
      ctx2.restore();
      f.textPx('alarm', gx + 11, gy - 10, { align: 'center', color: VIZ.token('dim'), font: '10px ' + MONO });

      out.set([
        'appraisal ', VIZ.bold(VIZ.fmt(a, 2) + ' — ' + (a < 0.5 ? 'clinical' : 'spiritual')),
        ' → alarm ', VIZ.bold(lit ? 'fires' : 'does not fire', lit),
        '. The state is the same on both sides. A culture that treats the sanctioned state as holy is also a ',
        'culture in which no one runs the alarm — and the reflex alarm, where it has been run, is what has done ',
        'documented harm',
      ]);
    }

    bag.onResize(draw);
    draw();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  function update(prev, next, ctx) {
    unmount(prev, ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
