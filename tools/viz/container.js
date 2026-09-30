/**
 * tools/viz/container.js — C15, "the loop that cannot see itself" (the-container §4).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. The
 * rationalisation loop: the content acts, the member explains it as their own
 * choice, the explanation confirms the content was voluntary — and while that
 * runs, other containers' inconsistencies are visible and this one's are not.
 * Step the loop and watch the two panels.
 */
VIZ.registerViz('container', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var STEPS = [
    { key: 'the content acts', note: 'the container supplies the reading before the member speaks' },
    { key: 'the member explains it', note: 'the explanation is sincere — it feels like their own reason' },
    { key: 'the explanation confirms it', note: '"I chose this" is read back as evidence the container is voluntary' },
    { key: 'no one can see it', note: 'and the loop closes: the auditing instrument is the container itself' },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var at = 1;

    var btns = STEPS.map(function (s, i) {
      var b = VIZ.button(s.key, function () {
        at = i;
        paint();
        draw();
        VIZ.saveState(ctx);
      });
      controls.appendChild(b);
      return b;
    });

    function paint() {
      btns.forEach(function (b, i) {
        b.style.borderColor = i === at ? VIZ.token('accent') : '';
        b.style.color = i === at ? VIZ.token('accent') : '';
      });
    }

    VIZ.share(ctx, {
      get: function () { return { step: at }; },
      set: function (s) { if (s.step != null) at = Math.max(0, Math.min(STEPS.length - 1, Number(s.step) | 0)); paint(); draw(); },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 290,
        ariaLabel:
          'A four-step loop: the content acts, the member explains it as their own choice, the explanation confirms ' +
          'the content was voluntary, and no one can see the loop because the auditing instrument is the container ' +
          'itself. Beside it, two columns: the inconsistencies of other containers are visible, and those of the ' +
          'container the member inhabits are not.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var w = f.w - f.pad.l - f.pad.r;
      var top = f.pad.t + 8;

      /* the loop: four boxes round a circle */
      var cx = left + w * 0.30;
      var cy = top + 92;
      var r = Math.min(84, w * 0.16);
      for (var i = 0; i < STEPS.length; i++) {
        var a = -Math.PI / 2 + (i * 2 * Math.PI) / STEPS.length;
        var x = cx + Math.cos(a) * r;
        var y = cy + Math.sin(a) * r;
        var on = i === at;
        ctx2.save();
        ctx2.fillStyle = on ? VIZ.token('accent') : VIZ.token('bg2');
        ctx2.strokeStyle = on ? VIZ.token('accent') : VIZ.token('dim');
        ctx2.lineWidth = 1;
        ctx2.beginPath(); ctx2.arc(x, y, 13, 0, 2 * Math.PI); ctx2.fill(); ctx2.stroke();
        ctx2.restore();
        f.textPx(String(i + 1), x, y, {
          align: 'center', color: on ? '#ffffff' : VIZ.token('dim'), font: '600 11px ' + MONO,
        });
      }
      // the arc arrows
      ctx2.save();
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.globalAlpha = 0.7;
      ctx2.beginPath(); ctx2.arc(cx, cy, r, 0, 2 * Math.PI); ctx2.stroke();
      ctx2.restore();

      /* the two visibility columns */
      var cx2 = left + w * 0.62;
      f.textPx('other containers', cx2, top, { color: VIZ.token('accent2'), font: '600 10px ' + MONO });
      f.textPx("the one you're in", cx2 + 160, top, { color: VIZ.token('accent'), font: '600 10px ' + MONO });
      var rows = [
        ['errors: visible', 'errors: invisible'],
        ['inconsistencies: seen', 'inconsistencies: unfelt'],
        ['"that group is a container"', '"this is just how things are"'],
      ];
      for (var k = 0; k < rows.length; k++) {
        var y2 = top + 30 + k * 22;
        f.textPx(rows[k][0], cx2, y2, { color: VIZ.token('accent2') });
        f.textPx(rows[k][1], cx2 + 160, y2, { color: VIZ.token('accent') });
      }
      f.textPx('the same faculty, pointed two ways', cx2, top + 30 + rows.length * 22 + 6, {
        color: VIZ.token('dim'),
      });

      out.set([
        'step ' + (at + 1) + ': ', VIZ.bold(STEPS[at].key, true), ' — ', STEPS[at].note,
        '. ', at === 3
          ? VIZ.bold('the loop cannot audit itself', true) + ': the instrument doing the checking is the container'
          : 'and the member is sincere at every step — which is what makes it work',
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
