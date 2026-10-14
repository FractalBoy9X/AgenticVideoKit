// Minimal contract example: replace this file with your own scene implementation.
export const meta = {
  kind: 'shot',
  about: 'Technical example: draw a message and a time-based progress bar.',
  tags: ['example', 'contract'],
  params: { text: ['string', true, 'Message to display'] },
  example: { type: './message', hold: 3, text: 'Your module' },
};

export default function create(ctx, clip) {
  return {
    update(t, alpha) {
      const p = Math.max(0, Math.min(1, (t - clip.t0) / clip.hold));
      ctx.hud.text(clip.text, ctx.W / 2, ctx.H / 2, {
        family: 'sans-serif', size: 48 * ctx.u, align: 'center',
        color: '#ffffff', alpha,
      });
      ctx.hud.rect(ctx.W * 0.25, ctx.H * 0.6, ctx.W * 0.5 * p, 4 * ctx.u, {
        fill: '#ffffff', alpha,
      });
    },
  };
}
