/**
 * tools/viz/codecs.js — the harness §4/§11c (the memory codecs).
 *
 * THE THREE CODECS ON THEIR TWO ORDERINGS: cost SCHEMA < GIST < LATENT,
 * structural fidelity SCHEMA > GIST > LATENT — the orderings AGREE, and that
 * agreement is the design's core claim: wherever structure exists, fidelity
 * is FREE, so the policy never trades fidelity for economy on structured
 * content. The figure draws them on the two axes the design orders them on
 * (encode cost vs drift), each carrying its status as a WORD — and LATENT is
 * drawn as the GAP it is: specified, gated on the task, NOT BUILDABLE (a seat
 * drawn as if it works would be the exact overclaim the project forbids).
 *
 * Every label is CURATED FROM THE DESIGN: the codecs' own table row, the
 * ordering sentence, and the three breaks are read from the page's data
 * block, which the generator parsed from the design documents. Click or hover
 * a codec to read what Z is, its decoder, its drift status, and where its
 * ordering breaks.
 */
VIZ.registerViz('codecs', (function () {
  'use strict';

  var MONO = 'SFMono-Regular, Menlo, Consolas, monospace';

  /** The page's own data block (the generator's curated codec layer). */
  function data() {
    var el = document.getElementById('viz-data-harness');
    if (!el) return null;
    try {
      var d = JSON.parse(el.textContent);
      return d && d.codecs && d.codecs.codecs && d.codecs.codecs.length ? d.codecs : null;
    } catch (e) {
      return null;
    }
  }

  function mount(slot, ctx) {
    var bag = ctx.lifecycle;
    var canvas = bag.node('canvas', 'viz-canvas');
    var out = VIZ.readout(bag);

    var d = data();
    if (!d) {
      out.set(['the figure is missing its own data — every label on it is curated from the design, and there is none to draw.']);
      return;
    }

    var sel = null; // selected codec id
    var boxes = []; // hit rects in px, per draw

    // the two axes the design orders the codecs on, with the statuses the
    // doc's own table gives. Positions are the ORDER, not measured values:
    // the design states the orderings and their agreement, and no cost or
    // drift number exists for the unbuilt codecs (§8: PROJECTION until the
    // task lands). Drawn as ordinal positions on both axes, labelled as the
    // orderings' own words.
    //   x: encode cost, low → high.  y: drift, low → high.
    var PLACE = {
      schema: { x: 1.6, y: 0.9 },
      gist: { x: 4.2, y: 4.2 },
      latent: { x: 7.6, y: 6.6 },
    };
    // drift, in the design's own words — the WORD is the carrier, never colour
    var DRIFT = { schema: 'ZERO by construction', gist: 'UNMEASURED', latent: 'UNMEASURED, opaque' };
    var BUILD = { schema: 'BUILDABLE', gist: 'BUILDABLE', latent: 'NOT BUILDABLE — gated on the task' };

    function choose(id) {
      sel = id;
      draw();
      VIZ.saveState(ctx);
    }

    function pointAt(ev) {
      if (!boxes.length) return null;
      var rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      var mx = ev.clientX;
      var my = ev.clientY;
      if (rect && rect.width && rect.height) {
        mx = (ev.clientX - rect.left) * (canvas.clientWidth / rect.width);
        my = (ev.clientY - rect.top) * (canvas.clientHeight / rect.height);
      }
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (mx >= b.x0 && mx <= b.x1 && my >= b.y0 && my <= b.y1) return b.id;
      }
      return null;
    }
    bag.on(canvas, 'mousemove', function (ev) {
      var hit = pointAt(ev);
      if (hit !== sel) choose(hit);
    });
    bag.on(canvas, 'mouseleave', function () {
      if (sel !== null) choose(null);
    });
    bag.on(canvas, 'click', function (ev) {
      choose(pointAt(ev));
    });
    canvas.setAttribute('tabindex', '0');
    bag.on(canvas, 'keydown', function (ev) {
      var keys = ['schema', 'gist', 'latent'];
      var step = ev.key === 'ArrowRight' || ev.key === 'ArrowDown' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowUp' ? -1 : 0;
      if (!step) return;
      ev.preventDefault();
      var at = sel == null ? (step > 0 ? -1 : 0) : keys.indexOf(sel);
      choose(keys[Math.min(keys.length - 1, Math.max(0, at + step))]);
    });

    function draw() {
      var f = VIZ.frame(canvas, {
        height: 320,
        ariaLabel:
          'the three memory codecs on the two axes the design orders them on: encode cost and drift. ' +
          'SCHEMA is cheap with zero drift by construction; GIST costs one model call and its drift is ' +
          'unmeasured; LATENT is the most costly and is drawn as a gap — specified but not buildable until ' +
          'the task exists, because its objective Y is the task itself. The orderings agree: cost ' +
          'SCHEMA < GIST < LATENT, fidelity SCHEMA > GIST > LATENT — wherever structure exists, ' +
          'fidelity is free.',
        xMin: 0,
        xMax: 10,
        yMin: 0,
        yMax: 8,
        pad: { l: 64, r: 24, t: 18, b: 46 },
        xLabel: 'encode cost → (the ordering: SCHEMA < GIST < LATENT)',
        yLabel: 'drift →',
      });

      // the axes' own words: both orderings and their agreement — the design's
      // core claim, drawn at the top where a reader meets it first. The full
      // agreement sentence lives in the readout; the canvas line carries
      // only what fits, ending on a whole word.
      f.textPx('cost: SCHEMA < GIST < LATENT · fidelity: SCHEMA > GIST > LATENT — the orderings AGREE: wherever structure exists, fidelity is FREE', f.pad.l, 10, {
        align: 'left',
        font: '10.5px ' + MONO,
        color: VIZ.token('dim'),
      });

      // the agreement's own geometry, drawn so the eye sees it: the diagonal
      // from cheap+faithful to costly+lossy. SCHEMA and GIST sit on it.
      f.line([[0.3, 0.6], [9.7, 7.4]], { color: VIZ.token('line'), dash: [2, 4], alpha: 0.9 });

      boxes = [];
      for (var i = 0; i < d.codecs.length; i++) {
        var c = d.codecs[i];
        var p = PLACE[c.id];
        var hot = sel === c.id;
        var cx = f.X(p.x);
        var cy = f.Y(p.y);
        var bw = 118;
        var bh = 54;
        var x0 = cx - bw / 2;
        var y0 = cy - bh / 2;

        if (c.id === 'latent') {
          // LATENT is the GAP, not an option: a dashed EMPTY seat with the
          // words NOT BUILDABLE inside it, and no fill — drawn as the absence
          // the design states (§8), never as a working codec
          boxes.push({ id: c.id, x0: x0, x1: x0 + bw, y0: y0, y1: y0 + bh });
          f.ctx.save();
          f.ctx.setLineDash([5, 4]);
          f.ctx.strokeStyle = hot ? VIZ.token('accent') : VIZ.token('dim');
          f.ctx.lineWidth = hot ? 2 : 1.2;
          f.ctx.strokeRect(x0, y0, bw, bh);
          f.ctx.restore();
          f.textPx(c.id.toUpperCase(), cx, y0 + 17, {
            align: 'center',
            font: '600 12px ' + MONO,
            color: hot ? VIZ.token('accent') : VIZ.token('dim'),
          });
          f.textPx('NOT BUILDABLE', cx, y0 + 33, {
            align: 'center',
            font: '9px ' + MONO,
            color: hot ? VIZ.token('accent') : VIZ.token('dim'),
          });
          f.textPx('gated on the task', cx, y0 + 46, {
            align: 'center',
            font: '8.5px ' + MONO,
            color: VIZ.token('dim'),
          });
          continue;
        }

        // SCHEMA and GIST: solid seats
        boxes.push({ id: c.id, x0: x0, x1: x0 + bw, y0: y0, y1: y0 + bh });
        f.ctx.save();
        f.ctx.setLineDash([]);
        f.ctx.lineWidth = hot ? 2 : 1.4;
        f.ctx.strokeStyle = hot ? VIZ.token('accent') : VIZ.token('accent2');
        f.ctx.fillStyle = VIZ.token('bg');
        f.ctx.fillRect(x0, y0, bw, bh);
        f.ctx.strokeRect(x0, y0, bw, bh);
        f.ctx.restore();
        f.textPx(c.id.toUpperCase(), cx, y0 + 16, {
          align: 'center',
          font: '600 12px ' + MONO,
          color: hot ? VIZ.token('accent') : VIZ.token('fg'),
        });
        f.textPx('drift: ' + DRIFT[c.id], cx, y0 + 32, {
          align: 'center',
          font: '8.5px ' + MONO,
          color: VIZ.token('dim'),
        });
        f.textPx(BUILD[c.id], cx, y0 + 46, {
          align: 'center',
          font: '8.5px ' + MONO,
          color: VIZ.token('dim'),
        });
      }
      f.flushLabels();

      // the readout: the agreement, always; the selected codec's own row
      var parts = [
        VIZ.bold('three codecs, one seat', true),
        ' — cost SCHEMA < GIST < LATENT, fidelity SCHEMA > GIST > LATENT, and the orderings AGREE: ',
        VIZ.bold(d.orderings.agree, true),
        '. LATENT is drawn as the gap it is: ',
        VIZ.bold('NOT BUILDABLE', true),
        ' until the task exists (its objective Y is the task — building it anyway silently degrades it to an autoencoder).',
      ];
      if (sel != null) {
        var row = null;
        for (var q = 0; q < d.codecs.length; q++) if (d.codecs[q].id === sel) row = d.codecs[q];
        var brk = null;
        for (var w = 0; w < d.orderings.breaks.length; w++) if (d.orderings.breaks[w].id === sel) brk = d.orderings.breaks[w];
        if (row) {
          parts.push('  ‖  ');
          parts.push(VIZ.bold(row.id.toUpperCase(), true));
          parts.push(' — Z is ' + row.z + '; decoder: ' + row.decoder + '; drift: ' + row.drift + '; ' + BUILD[row.id] + '.');
          if (brk) parts.push(' Where the ordering breaks: ' + row.id.toUpperCase() + ' ' + brk.what + ' ' + brk.text);
        }
      } else {
        parts.push(' Click or hover a codec to read what Z is, its decoder, and where its ordering breaks.');
      }
      out.set(parts);
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
