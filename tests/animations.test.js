require('./setup');
const fs = require('fs');
const path = require('path');

// The popup.js toast helper references `animation: slideUp 0.3s ease;`. The
// previous CSS never defined this keyframe, so the toast snapped in with no
// animation. This test guards against that regression.
describe('CSS: required keyframes are defined', () => {
  const popupCss = fs.readFileSync(path.join(__dirname, '..', 'styles', 'popup.css'), 'utf8');

  test('@keyframes slideUp is defined in popup.css', () => {
    expect(popupCss).toMatch(/@keyframes\s+slideUp\s*\{/);
  });

  test('@keyframes celebrate is defined in popup.css', () => {
    expect(popupCss).toMatch(/@keyframes\s+celebrate\s*\{/);
  });

  test('toast styles live in CSS, not in inline style.cssText', () => {
    const popupJs = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
    // showToast no longer hand-writes "animation: slideUp" into style.cssText
    expect(popupJs).not.toMatch(/animation:\s*slideUp/);
    // It still creates a toast element with the .toast class
    expect(popupJs).toMatch(/['"]toast(\s+toast-error)?['"]/);
  });

  test('prefers-reduced-motion media query exists', () => {
    expect(popupCss).toMatch(/prefers-reduced-motion/);
    const contentCss = fs.readFileSync(path.join(__dirname, '..', 'styles', 'content.css'), 'utf8');
    expect(contentCss).toMatch(/prefers-reduced-motion/);
  });
});

// FLIP technique: the order must be MEASURE -> MUTATE -> INVERT (with
// transition:none) -> reflow -> PLAY (with transitions enabled). The
// previous implementation enabled transitions BEFORE setting the start
// transform, which caused a one-frame jitter from 0 -> deltaY. This test
// asserts that the new code path applies transition:none before setting the
// inverted transform.
describe('Animation: FLIP ordering in animateLeaderboardSort', () => {
  const popupJs = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
  // Match both the historical `async function ...` and the current sync form.
  const fn = popupJs.match(/(async\s+)?function animateLeaderboardSort[\s\S]*?\n  \}/);
  test('the function exists in popup.js', () => {
    expect(fn).not.toBeNull();
  });

  test('disables transitions before setting the initial transform', () => {
    const body = fn[0];
    const transitionNoneIdx = body.indexOf("transition = 'none'");
    const transformIdx = body.indexOf('translateY(${deltaY}px)');
    expect(transitionNoneIdx).toBeGreaterThan(-1);
    expect(transformIdx).toBeGreaterThan(-1);
    expect(transitionNoneIdx).toBeLessThan(transformIdx);
  });

  test('forces reflow before re-enabling transitions', () => {
    const body = fn[0];
    const reflowIdx = body.indexOf('offsetHeight');
    const animatingClassIdx = body.indexOf("classList.add('animating')");
    expect(reflowIdx).toBeGreaterThan(-1);
    expect(animatingClassIdx).toBeGreaterThan(-1);
    expect(reflowIdx).toBeLessThan(animatingClassIdx);
  });
});

// Accessibility: form fields that previously triggered the
// "No label associated with a form field" console issue now have labels.
describe('A11y: form inputs have labels', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');

  test('mutuals-friend-select has an associated label and aria-label', () => {
    expect(html).toMatch(/for="mutuals-friend-select"/);
    expect(html).toMatch(/id="mutuals-friend-select"[^>]*aria-label=/);
  });

  test('my-username, friend-username, setting-daily-goal have aria-label', () => {
    expect(html).toMatch(/id="my-username"[^>]*aria-label=/);
    expect(html).toMatch(/id="friend-username"[^>]*aria-label=/);
    expect(html).toMatch(/id="setting-daily-goal"[^>]*aria-label=/);
  });
});
