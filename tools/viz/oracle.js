/**
 * tools/viz/oracle.js — A?, "the oracle keeps its seat" (the-machine-said-so §2–§4).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. The same
 * unfalsifiable slot, staffed three ways: a person, a role, a machine. The
 * dimensions that decide whether it is answerable or not do not change; only the
 * occupant does. The last one — burden of proof — is where the scandals live.
 */
VIZ.registerViz('oracle', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  // the slot's properties: identical whichever occupant holds it
  var PROPS = [
    { name: 'claim observable by you?', mystical: 'no', role: 'no', machine: 'no' },
    { name: 'grounds open to inspection?', mystical: 'no', role: 'no', machine: 'no' },
    { name: 'who must disprove it?', mystical: 'you', role: 'you', machine: 'you' },
    { name: 'appeal available?', mystical: 'to whom?', role: 'to whom?', machine: 'to whom?' },
  ];

  var OCCUPANTS = [
    { key: 'a person', sub: 'a guru; a master; a medium' },
    { key: 'a role', sub: 'a Grand Master; a Forum Leader' },
    { key: 'a machine', sub: 'a score; a data match; a model' },
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var at = 0;

    var btns = OCCUPANTS.map(function (o, i) {
      var b = VIZ.button(o.key, function () {
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
      get: function () { return { occupant: at }; },
      set: function (s) { if (s.occupant != null) at = Math.max(0, Math.min(OCCUPANTS.length - 1, Number(s.occupant) | 0)); paint(); draw(); },
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 300,
        ariaLabel:
          'One slot, three occupants: a person, a role, a machine. The properties of the slot are the ' +
          'same whoever holds it \u2014 the claim is not observable by the subject, the grounds are not ' +
          'inspectable, the burden of proof falls on the subject, and there is no one to appeal to.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var mid = f.w - f.pad.r - 150; // fixed width for the value column, clear of the longest label
      var top = f.pad.t + 4;
      var rowH = 32;

      /* the occupant — the only thing that changes */
      f.textPx('the oracle', left, top + 2, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(left, top + 14, f.w - f.pad.l - f.pad.r, 30);
      ctx2.strokeStyle = VIZ.token('accent');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(left, top + 14, f.w - f.pad.l - f.pad.r, 30);
      ctx2.stroke();
      ctx2.restore();
      f.textPx(OCCUPANTS[at].key, left + 8, top + 29, { color: VIZ.token('accent'), font: '600 12px ' + MONO });
      // the sub-label sits in the box, to the right of the occupant's name, never below it
      f.textPx('\u2014 ' + OCCUPANTS[at].sub, left + 130, top + 29, { color: VIZ.token('dim') });

      /* the slot's properties — identical for every occupant */
      var py = top + 78; // clear of the box above
      f.textPx('the slot it occupies \u2014 the same, whichever it is', left, py - 14, {
        color: VIZ.token('dim'), font: '600 10px ' + MONO,
      });
      for (var i = 0; i < PROPS.length; i++) {
        var y = py + 8 + i * rowH;
        var p = PROPS[i];
        ctx2.save();
        ctx2.strokeStyle = VIZ.token('line');
        ctx2.globalAlpha = 0.6;
        ctx2.beginPath();
        ctx2.moveTo(left, y + 15);
        ctx2.lineTo(f.w - f.pad.r, y + 15);
        ctx2.stroke();
        ctx2.restore();
        f.textPx(p.name, left, y, { color: VIZ.token('fg') });
        ctx2.save();
        ctx2.fillStyle = at === 2 ? VIZ.token('accent') : VIZ.token('accent2');
        ctx2.fillRect(mid - 8, y - 3, 7, 7);
        ctx2.restore();
        var val = at === 0 ? p.mystical : at === 1 ? p.role : p.machine;
        f.textPx(val, mid + 6, y, { color: at === 2 ? VIZ.token('accent') : VIZ.token('accent2') });
      }

      out.set(
        at === 2
          ? [
              'the oracle is a machine. The slot does not change: the claim is not observable by you, ',
              'the grounds are ', VIZ.bold('not inspectable', true),
              ', the burden of proof is ', VIZ.bold('yours', true),
              ', and there is no one to appeal to. "The computer said so" is the whole of the authority \u2014 ',
              'which is exactly what the guru sold, minus the person',
            ]
          : [
              'the oracle is ' + OCCUPANTS[at].key + '. Same four properties: unobservable claim, closed grounds, ',
              VIZ.bold('reversed burden of proof', true),
              ', no appeal. Swap the occupant and the slot is unchanged \u2014 the position was never about the person',
            ]);
    }

    bag.onResize(draw);
    paint();
    draw();
  }

  function unmount(slot, ctx) {
    ctx.lifecycle.dispose();
  }

  function update(prev, next, ctx) {
    unmount(prev, next && next.lifecycle ? next : ctx);
    mount(next, ctx);
  }

  return { mount: mount, unmount: unmount, update: update };
})());
