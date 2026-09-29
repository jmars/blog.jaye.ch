/**
 * tools/viz/warrant.js — C5, "the warrant in transit" (the-certified-frame §2–§4).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. As a teacher
 * travels from home to a host culture, three quantities move together: the
 * authority the host grants before any check, the protection that stops
 * travelling, and the social cost of raising a doubt. The frame is the same
 * person; only the room changes.
 */
VIZ.registerViz('warrant', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';
  var GAUGES = [
    ['authority the host grants', function (d) { return d; }],
    ['a reflex of scrutiny', function (d) { return 1 - d; }],
    ['the cost of raising a doubt', function (d) { return d; }],
    ['local protection', function (d) { return 1 - d; }],
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var dist = VIZ.slider({
      label: 'distance from home — home ← → abroad',
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.85,
      digits: 2,
      onInput: draw,
    });
    controls.appendChild(dist.el);

    VIZ.share(ctx, {
      get: function () { return { dist: dist.value() }; },
      set: function (s) { if (s.dist != null) dist.set(s.dist); draw(); },
    });

    function draw() {
      var d = dist.value();

      var f = VIZ.frame(canvas, {
        height: 250,
        ariaLabel:
          'A teacher travels from home to a host culture. As distance grows, the authority the host grants rises, ' +
          'a reflex of scrutiny falls, the social cost of raising a doubt rises, and local protection falls. ' +
          'The teacher does not change; the room does.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');

      /* the route — home → abroad, with the teacher on it */
      var rx = f.pad.l;
      var ry = f.pad.t + 22;
      var rw = f.w - f.pad.l - f.pad.r;
      ctx2.save();
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1.5;
      ctx2.beginPath();
      ctx2.moveTo(rx, ry);
      ctx2.lineTo(rx + rw, ry);
      ctx2.stroke();
      // the teacher's position
      var tx = rx + rw * d;
      ctx2.fillStyle = VIZ.token('accent2');
      ctx2.fillRect(tx - 3, ry - 6, 6, 12);
      ctx2.restore();
      f.textPx('home', rx, ry + 18, { color: VIZ.token('dim'), font: '10px ' + MONO });
      f.textPx('abroad', rx + rw, ry + 18, { align: 'right', color: VIZ.token('dim'), font: '10px ' + MONO });

      /* the gauges */
      var gy = f.pad.t + 66;
      var gh = 16;
      var gap = 30;
      var lw = 190;
      for (var i = 0; i < GAUGES.length; i++) {
        var y = gy + i * gap;
        var val = Math.max(0, Math.min(1, GAUGES[i][1](d)));
        f.textPx(GAUGES[i][0], f.pad.l, y, { color: VIZ.token('fg') });
        ctx2.save();
        ctx2.fillStyle = VIZ.token('bg2');
        ctx2.fillRect(f.pad.l + lw, y - gh / 2 - 4, f.w - f.pad.r - (f.pad.l + lw), gh);
        ctx2.fillStyle = val > 0.5 ? VIZ.token('accent') : VIZ.token('dim');
        ctx2.fillRect(f.pad.l + lw, y - gh / 2 - 4, (f.w - f.pad.r - (f.pad.l + lw)) * val, gh);
        ctx2.strokeStyle = VIZ.token('dim');
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.rect(f.pad.l + lw, y - gh / 2 - 4, f.w - f.pad.r - (f.pad.l + lw), gh);
        ctx2.stroke();
        ctx2.restore();
      }

      out.set([
        'distance ', VIZ.bold(VIZ.fmt(d, 2)),
        ' — the same teacher: the authority the host grants is now ',
        VIZ.bold(VIZ.fmt(d, 2), true),
        ', local protection is ', VIZ.bold(VIZ.fmt(1 - d, 2), true),
        '. The warrant is not built here; it is ', VIZ.bold('granted', true),
        ' — and the check that might have been made is the one that costs the most to raise',
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
