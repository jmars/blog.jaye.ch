/**
 * tools/viz/method.js — C8, "the designed method" (the-designed-method §2–§3).
 *
 * SCHEMATIC — an illustration of the argument, not a measurement. Step through
 * the five stages of a designed practice and watch two things happen at once:
 * the system is driven toward the edge on a schedule, and the reading of the
 * result is fixed in advance. The state is engineered; the meaning is supplied.
 */
VIZ.registerViz('method', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  var STAGES = [
    { n: '1', label: 'chaotic breathing', does: 'arousal up — deliberate hyperventilation', self: 0.95 },
    { n: '2', label: 'catharsis', does: 'the affective system loaded and discharged', self: 0.78 },
    { n: '3', label: '"Hoo!" jumping', does: 'exhaustion — damping down', self: 0.5 },
    { n: '4', label: 'sudden stillness', does: 'the freeze — an emptied, quiet system', self: 0.18 },
    { n: '5', label: 'music, dancing', does: 'the state is named, and celebrated', self: 0.95 },
  ];
  var READ = [
    'the beginning of the path',
    'letting go',
    'burning through',
    'no-mind',
    'arrival — this is it',
  ];

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var controls = bag.node('div', 'viz-controls');
    var out = VIZ.readout(bag);

    var at = 3; // the freeze — the stage the post is about

    var stage = VIZ.slider({
      label: 'stage',
      min: 1,
      max: 5,
      step: 1,
      value: at,
      digits: 0,
      onInput: function (v) { at = v; draw(); },
      format: function (v) { return STAGES[Math.round(v) - 1].label; },
    });
    controls.appendChild(stage.el);

    var note = VIZ.button('the reading is fixed', function () {
      draw();
      VIZ.saveState(ctx);
    });
    note.style.cursor = 'default';
    controls.appendChild(note);

    VIZ.share(ctx, {
      get: function () { return { stage: at }; },
      set: function (s) { if (s.stage != null) { at = Math.max(1, Math.min(5, Number(s.stage) | 0)); stage.set(at); } draw(); },
    });

    function draw() {
      var i = Math.max(0, Math.min(4, Math.round(at) - 1));
      var st = STAGES[i];

      var f = VIZ.frame(canvas, {
        height: 265,
        ariaLabel:
          'A five-stage practice. A slider steps through the stages: chaotic breathing, catharsis, "Hoo!" jumping, ' +
          'sudden stillness, and celebration. As the self-content bar falls to its lowest at the stillness stage, ' +
          'the reading of each stage is fixed in advance: the beginning of the path, letting go, burning through, ' +
          'no-mind, arrival.',
        xMin: 0,
        xMax: 1,
        yMin: 0,
        yMax: 1,
      });

      var ctx2 = canvas.getContext('2d');
      var left = f.pad.l;
      var full = f.w - f.pad.l - f.pad.r;
      var top = f.pad.t + 4;

      /* the five stage blocks — the schedule */
      var gap = 6;
      var bw = (full - gap * 4) / 5;
      for (var k = 0; k < 5; k++) {
        var x = left + k * (bw + gap);
        var on = k === i;
        ctx2.save();
        ctx2.fillStyle = on ? VIZ.token('accent') : VIZ.token('bg2');
        ctx2.fillRect(x, top, bw, 34);
        ctx2.strokeStyle = on ? VIZ.token('accent') : VIZ.token('dim');
        ctx2.lineWidth = 1;
        ctx2.beginPath();
        ctx2.rect(x, top, bw, 34);
        ctx2.stroke();
        ctx2.restore();
        // drawn with plain canvas text: the frame's label painter lays an opaque
        // background patch behind glyphs, which would erase white-on-accent text.
        ctx2.font = '600 10px ' + MONO;
        ctx2.fillStyle = on ? '#ffffff' : VIZ.token('dim');
        ctx2.fillText(STAGES[k].n, x + 6, top + 12);
        ctx2.font = '10px ' + MONO;
        ctx2.fillStyle = on ? '#ffffff' : VIZ.token('fg');
        ctx2.fillText(STAGES[k].label, x + 6, top + 26);
      }

      /* what it does, and how it is read — the two half-columns */
      f.textPx('what it does to the system', left, top + 58, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      f.textPx(st.does, left, top + 74, { color: VIZ.token('fg') });

      f.textPx('how the method reads it', left, top + 100, { color: VIZ.token('dim'), font: '600 10px ' + MONO });
      f.textPx('"' + READ[i] + '"', left, top + 116, { color: VIZ.token('accent'), font: '600 12px ' + MONO });

      /* the self-content bar — driven toward the edge on a schedule */
      var by = top + 146;
      f.textPx('the self it is working on', left, by - 8, { color: VIZ.token('dim'), font: '10px ' + MONO });
      var trackW = full;
      ctx2.save();
      ctx2.fillStyle = VIZ.token('bg2');
      ctx2.fillRect(left, by, trackW, 16);
      ctx2.fillStyle = VIZ.token('accent2');
      ctx2.fillRect(left, by, trackW * st.self, 16);
      ctx2.strokeStyle = VIZ.token('dim');
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.rect(left, by, trackW, 16);
      ctx2.stroke();
      ctx2.restore();
      f.textPx(VIZ.fmt(st.self, 2), left + trackW * st.self + 8 > f.w - 40 ? left + 6 : left + trackW * st.self + 8, by + 8,
        { color: VIZ.token('fg') });

      // the edge marker at the freeze
      var edge = left + trackW * 0.18;
      ctx2.save();
      ctx2.strokeStyle = VIZ.token('accent');
      ctx2.setLineDash([3, 3]);
      ctx2.lineWidth = 1;
      ctx2.beginPath();
      ctx2.moveTo(edge, by - 4);
      ctx2.lineTo(edge, by + 20);
      ctx2.stroke();
      ctx2.restore();
      f.textPx('the edge', edge + 4, by + 30, { color: VIZ.token('accent') });

      out.set([
        'stage ', VIZ.bold(st.n + ' — ' + st.label),
        ': ', st.does, '. The reading, however, was fixed before the practice began: ',
        VIZ.bold('"' + READ[i] + '"', true),
        '. The state is engineered; the meaning is supplied — which is the whole of the method',
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
