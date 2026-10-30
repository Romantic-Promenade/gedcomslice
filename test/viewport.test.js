import { describe, expect, it } from 'vitest';
import { scrollAxis, wheelFactor } from '../src/ui/viewport.js';

describe('scrollAxis', () => {
  it('hides the bar when the chart fits', () => {
    expect(scrollAxis(10, 490, 500)).toBeNull();
  });

  it('places the thumb at the start when the chart runs off the far edge', () => {
    const a = scrollAxis(0, 970, 500, 30);
    expect(a.total).toBe(1030); // from -30 to 1000
    expect(a.start).toBeCloseTo(30 / 1030);
    expect(a.size).toBeCloseTo(500 / 1030);
  });

  it('places the thumb at the end when the chart runs off the near edge', () => {
    const a = scrollAxis(-500, 470, 500, 30);
    expect(a.start + a.size).toBeCloseTo(1);
  });
});

describe('wheelFactor', () => {
  it('zooms in on wheel up and out on wheel down', () => {
    expect(wheelFactor({ deltaY: -100, deltaMode: 0 }, 600)).toBeGreaterThan(1);
    expect(wheelFactor({ deltaY: 100, deltaMode: 0 }, 600)).toBeLessThan(1);
  });

  it('gives a trackpad pinch (Ctrl+wheel) more gain', () => {
    const pinch = wheelFactor({ deltaY: -10, deltaMode: 0, ctrlKey: true }, 600);
    const wheel = wheelFactor({ deltaY: -10, deltaMode: 0 }, 600);
    expect(pinch).toBeGreaterThan(wheel);
  });

  it('treats line-mode deltas like pixels', () => {
    expect(wheelFactor({ deltaY: 3, deltaMode: 1 }, 600)).toBeCloseTo(wheelFactor({ deltaY: 48, deltaMode: 0 }, 600));
  });
});
