#!/usr/bin/env node
'use strict';

// ============================================================
// Lument Engine v1.3.0 — Node.js test runner
//
// Tests the v1.3 feature surface by requiring ../runtime/js/lument.js.
// Because lument.js targets a browser canvas, a minimal browser
// environment (document / canvas / Canvas2D context) is mocked here so
// the engine can initialize under Node.js.
//
// Exit code is 1 if any test fails, 0 otherwise.
// ============================================================

// ------------------------------------------------------------
// Mock Canvas2D context
//   - All known drawing methods are no-op functions.
//   - A few methods return sensible objects (measureText, getImageData,
//     createImageData, createLinearGradient, ...) so call sites that read
//     a return value do not blow up.
//   - A Proxy fallback turns any unknown method into a no-op so the mock
//     stays tolerant of new Canvas2D APIs.
// ------------------------------------------------------------
function makeMockCtx() {
    const base = {
        canvas: null,
        // storable style / state properties
        fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
        font: '16px monospace', textBaseline: 'alphabetic', textAlign: 'start',
        globalAlpha: 1, globalCompositeOperation: 'source-over',
        imageSmoothingEnabled: true,
        shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)',
        shadowOffsetX: 0, shadowOffsetY: 0,
        lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
        // drawing methods (no-ops)
        beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
        arc() {}, arcTo() {}, rect() {},
        fillRect() {}, strokeRect() {}, clearRect() {},
        fill() {}, stroke() {},
        ellipse() {}, bezierCurveTo() {}, quadraticCurveTo() {},
        fillText() {}, strokeText() {}, drawImage() {}, putImageData() {},
        getImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; },
        createImageData() { return { data: new Uint8ClampedArray(4), width: 1, height: 1 }; },
        measureText() { return { width: 8 }; },
        save() {}, restore() {}, translate() {}, scale() {}, rotate() {},
        transform() {}, setTransform() {}, resetTransform() {},
        setLineDash() {}, getLineDash() { return []; },
        clip() {},
        isPointInPath() { return false; }, isPointInStroke() { return false; },
        createLinearGradient() { return { addColorStop() {} }; },
        createRadialGradient() { return { addColorStop() {} }; },
        createPattern() { return {}; },
        drawFocusIfNeeded() {}, scrollPathIntoView() {},
    };
    return new Proxy(base, {
        get(t, p) {
            if (p in t) return t[p];
            return function () {};        // unknown method -> no-op
        },
        set(t, p, v) { t[p] = v; return true; },
        has() { return true; },            // pretend every property exists
    });
}

const mockCtx = makeMockCtx();
const mockCanvas = {
    getContext: () => mockCtx,
    width: 800,
    height: 600,
    addEventListener() {}, removeEventListener() {},
    style: {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
};

// ------------------------------------------------------------
// Mock browser globals (must exist before lument.js calls init()).
// Node.js >= 21 exposes `navigator` / `performance` as getter-only
// globals, so we (re)define them via Object.defineProperty.
// ------------------------------------------------------------
function setGlobal(name, value) {
    Object.defineProperty(global, name, { value, writable: true, configurable: true });
}

setGlobal('document', {
    getElementById: (id) => (id === 'game-canvas' ? mockCanvas : null),
    createElement: () => ({
        getContext: () => mockCtx,
        width: 800, height: 600,
        addEventListener() {}, style: {},
    }),
    body: { appendChild() {} },
    addEventListener() {},
});
setGlobal('navigator', { userAgent: 'LumentNodeTestRunner/1.3.0 (no browser)' });
setGlobal('performance', { now: () => Date.now() });
setGlobal('window', {});            // window.AudioContext lookup fails -> caught by init's try/catch
setGlobal('requestAnimationFrame', () => 0);
setGlobal('cancelAnimationFrame', () => {});
setGlobal('Image', function () { this.src = ''; this.addEventListener = () => {}; });

// ------------------------------------------------------------
// Load the engine (CommonJS export at the bottom of lument.js)
// ------------------------------------------------------------
const Lument = require('../runtime/js/lument.js');

// ------------------------------------------------------------
// Minimal assert helpers
// ------------------------------------------------------------
let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed++;
        console.log('PASS: ' + name);
    } catch (e) {
        failed++;
        console.log('FAIL: ' + name + ' — ' + (e && e.message));
    }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
    if (a !== b) {
        throw new Error((msg ? msg + ': ' : '') + 'expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
    }
}
function assertFn(name) {
    if (typeof Lument[name] !== 'function') {
        throw new Error(name + ' is not a function (got ' + typeof Lument[name] + ')');
    }
}

console.log('=== Lument Engine v1.3.0 Test Suite ===\n');

// ============================================================
// 1. Module + VERSION
// ============================================================
test('Module loads and VERSION === "1.3.0"', () => {
    assert(typeof Lument === 'object' && Lument !== null, 'Lument module is an object');
    assertEq(Lument.VERSION, '1.3.0', 'VERSION');
});

// ============================================================
// 2. New constants
// ============================================================
test('WIDGET.DROPDOWN exists (=== 12)', () => assertEq(Lument.WIDGET.DROPDOWN, 12));
test('WIDGET.TOGGLE exists (=== 13)', () => assertEq(Lument.WIDGET.TOGGLE, 13));
test('LAYOUT.FLOW exists (=== 5)', () => assertEq(Lument.LAYOUT.FLOW, 5));
test('AUTOSIZE constant set exists', () => {
    assertEq(Lument.AUTOSIZE.OFF, 0);
    assertEq(Lument.AUTOSIZE.WIDTH, 1);
    assertEq(Lument.AUTOSIZE.HEIGHT, 2);
    assertEq(Lument.AUTOSIZE.BOTH, 3);
});
test('BROADPHASE constant set exists', () => {
    assertEq(Lument.BROADPHASE.GRID, 0);
    assertEq(Lument.BROADPHASE.QUADTREE, 1);
    assertEq(Lument.BROADPHASE.BRUTE, 2);
});

// ============================================================
// 3. Function existence (no calls — safe before init)
// ============================================================
['drawCircle', 'drawLine', 'drawTriangle', 'drawPolygon', 'drawEllipse', 'drawPoint']
    .forEach((n) => test(n + ' exists as a function', () => assertFn(n)));

['beginBatch', 'batchQuad', 'batchTriangle', 'endBatch']
    .forEach((n) => test(n + ' exists as a function', () => assertFn(n)));

['uiCreateDropdown', 'uiCreateToggle', 'uiCreateScrollview', 'uiCreateSlider',
 'uiCreateCheckbox', 'uiCreateSpinner', 'uiCreateDivider', 'uiCreateTooltip', 'uiCreateIcon']
    .forEach((n) => test(n + ' exists as a function', () => assertFn(n)));

['physicsSetBroadphase', 'physicsSetGridCellSize', 'physicsDebugDraw', 'physicsGetPairCount']
    .forEach((n) => test(n + ' exists as a function', () => assertFn(n)));

['uiSetAutoSize', 'uiMeasureText', 'uiSetMargin']
    .forEach((n) => test(n + ' exists as a function', () => assertFn(n)));

['uiSetValue', 'uiGetValue', 'uiSetOptions', 'uiGetSelected',
 'uiSetChecked', 'uiGetChecked', 'uiSetScroll', 'uiGetScroll']
    .forEach((n) => test(n + ' exists as a function', () => assertFn(n)));

['uiSetTheme', 'uiGetTheme', 'uiResetTheme', 'uiBuildFromJson', 'uiFindById', 'uiDumpTree']
    .forEach((n) => test(n + ' exists as a function', () => assertFn(n)));

// ============================================================
// 4. Engine init (sets up the mocked canvas / context)
// ============================================================
test('engine init runs without error (mocked canvas)', () => {
    Lument.init({ width: 800, height: 600, targetFPS: 60 });
});

// ============================================================
// 5. Functional execution (ctx-dependent — needs init)
// ============================================================
test('rendering primitives execute without error', () => {
    Lument.drawCircle(100, 100, 50, { r: 255, g: 0, b: 0, a: 255 }, true);
    Lument.drawLine(0, 0, 100, 100, 2, { r: 255, g: 255, b: 255, a: 255 });
    Lument.drawTriangle(0, 0, 50, 0, 25, 50, { r: 0, g: 255, b: 0, a: 255 }, true);
    Lument.drawPolygon([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }], { r: 0, g: 0, b: 255, a: 255 }, true);
    Lument.drawEllipse(50, 50, 20, 10, { r: 255, g: 255, b: 0, a: 255 }, false);
    Lument.drawPoint(10, 10, 3, { r: 255, g: 255, b: 255, a: 255 });
});

test('batch API runs a full begin/batch/end cycle', () => {
    Lument.beginBatch(0);
    Lument.batchQuad({ x: 0, y: 0, w: 10, h: 10 }, { r: 255, g: 255, b: 255, a: 255 });
    Lument.batchTriangle(0, 0, 10, 0, 5, 10, { r: 255, g: 0, b: 0, a: 255 });
    Lument.endBatch();
});

// ============================================================
// 6. UI state round-trips
// ============================================================
test('uiSetValue / uiGetValue round-trip on a slider', () => {
    const sl = Lument.uiCreateSlider(0, 100, 0, 0, 0, 200, 30);
    assert(sl > 0, 'slider created');
    Lument.uiSetValue(sl, 75);
    assertEq(Lument.uiGetValue(sl), 75, 'slider value');
});

test('uiSetOptions / uiSetSelected / uiGetSelected on a dropdown', () => {
    const dd = Lument.uiCreateDropdown(0, 0, 100, 30);
    Lument.uiSetOptions(dd, ['alpha', 'beta', 'gamma']);
    Lument.uiSetSelected(dd, 2);
    assertEq(Lument.uiGetSelected(dd), 2, 'dropdown selected');
});

test('uiSetChecked / uiGetChecked on a checkbox', () => {
    const cb = Lument.uiCreateCheckbox(false, 0, 0, 30, 30);
    Lument.uiSetChecked(cb, true);
    assertEq(Lument.uiGetChecked(cb), true, 'checkbox checked');
});

test('uiSetChecked / uiGetChecked on a toggle', () => {
    const tg = Lument.uiCreateToggle(false, 0, 0, 60, 30);
    Lument.uiSetChecked(tg, true);
    assertEq(Lument.uiGetChecked(tg), true, 'toggle checked');
});

test('uiSetScroll / uiGetScroll on a scrollview', () => {
    const sv = Lument.uiCreateScrollview(0, 0, 200, 200);
    Lument.uiSetContentSize(sv, 1000, 1000);   // content larger than view -> scroll clamps, not zeroes
    Lument.uiSetScroll(sv, 50, 80);
    const s = Lument.uiGetScroll(sv);
    assertEq(s.x, 50, 'scroll x');
    assertEq(s.y, 80, 'scroll y');
});

// ============================================================
// 7. Theme system
// ============================================================
test('uiSetTheme / uiGetTheme round-trip', () => {
    Lument.uiSetTheme({ primary: { r: 255, g: 0, b: 0, a: 255 } });
    const t = Lument.uiGetTheme();
    assertEq(t.primary.r, 255, 'theme primary.r');
});

test('uiResetTheme restores defaults', () => {
    Lument.uiResetTheme();
    const t = Lument.uiGetTheme();
    assertEq(t.primary.r, 60, 'reset primary.r');   // default primary {60,90,160}
});

// ============================================================
// 8. Declarative UI
// ============================================================
const DEMO_JSON = JSON.stringify({
    type: 'container', name: 'rootPanel', layout: 'vertical',
    x: 0, y: 0, w: 300, h: 200,
    children: [
        { type: 'label', name: 'titleLabel', text: 'Built from JSON' },
        { type: 'button', name: 'okBtn', text: 'OK' },
        { type: 'slider', name: 'volSlider', min: 0, max: 100, value: 50 },
    ],
});

test('uiBuildFromJson builds a tree (id > 0)', () => {
    const root = Lument.uiBuildFromJson(DEMO_JSON);
    assert(root > 0, 'built root id > 0');
});

test('uiFindById locates a named widget', () => {
    Lument.uiBuildFromJson(DEMO_JSON);
    const okId = Lument.uiFindById('okBtn');
    assert(okId > 0, 'found okBtn id > 0');
    assertEq(Lument.uiFindById('doesNotExist'), 0, 'missing id returns 0');
});

test('uiDumpTree returns a non-empty string', () => {
    const root = Lument.uiBuildFromJson(DEMO_JSON);
    const tree = Lument.uiDumpTree(root);
    assert(typeof tree === 'string', 'dump is a string');
    assert(tree.length > 0, 'dump is non-empty');
});

// ============================================================
// 9. Physics spatial partitioning & debug
// ============================================================
test('physicsSetBroadphase / physicsSetGridCellSize / physicsDebugDraw / physicsGetPairCount', () => {
    Lument.physicsSetBroadphase(Lument.BROADPHASE.GRID);
    Lument.physicsSetGridCellSize(64);
    Lument.physicsDebugDraw({ showGrid: true, showContacts: false });
    const pairs = Lument.physicsGetPairCount();
    assert(typeof pairs === 'number', 'pair count is a number');
});

// ============================================================
// 10. Auto-size
// ============================================================
test('uiMeasureText returns {w,h} with w > 0', () => {
    const m = Lument.uiMeasureText('hello', 14);
    assert(typeof m === 'object' && m !== null, 'measure result is an object');
    assert(typeof m.w === 'number' && m.w > 0, 'w is a positive number');
    assert(typeof m.h === 'number', 'h is a number');
});

test('uiSetAutoSize + uiSetMargin run without error', () => {
    const lbl = Lument.uiCreateLabel('test', 0, 0, 100, 30);
    assert(lbl > 0, 'label created');
    Lument.uiSetAutoSize(lbl, Lument.AUTOSIZE.BOTH);
    Lument.uiSetMargin(lbl, 1, 2, 3, 4);
});

// ------------------------------------------------------------
// Summary
// ------------------------------------------------------------
console.log('\n=== Summary: ' + passed + ' passed, ' + failed + ' failed ===');
process.exit(failed > 0 ? 1 : 0);
