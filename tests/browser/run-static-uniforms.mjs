import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pixiLocalImages } from '../../scripts/build/pixi-local-images.mjs';

// Baseline keeps the released Pixi generators; all other engine/build inputs match.
const bundles = {};
for (const variant of ['baseline', 'static']) {
  bundles[variant] = (await build({ entryPoints: ['tests/browser/engine-smoke-entry.ts'], bundle: true,
    write: false, minify: true, platform: 'browser', target: 'chrome120', loader: { '.woff2': 'dataurl' },
    alias: { '@emberly/dataplane': path.resolve('src/emberly-engine/adapter/dataplane.ts') },
    plugins: [pixiLocalImages({ staticUniforms: variant === 'static' })] })).outputFiles[0].text;
}
assert.equal((bundles.baseline.match(/new Function\(/g) || []).length, 3);
assert.doesNotMatch(bundles.static, /\bnew\s+Function\s*\(|\beval\s*\(/);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
const errors = [], results = [];
async function open(variant, theme = 'light') {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, bypassCSP: false });
  page.on('pageerror', error => errors.push(error.message));
  // Browser evaluation can bypass CSP; the probe runs as a normal page script.
  await page.route('http://localhost/**', route => {
    const url = route.request().url();
    if (url.endsWith('/bundle.js')) return route.fulfill({ contentType: 'application/javascript', body: bundles[variant] });
    if (url.endsWith('/styles.css')) return route.fulfill({ contentType: 'text/css', body: readFileSync('styles.css', 'utf8') });
    if (url.endsWith('/probe.js')) return route.fulfill({ contentType: 'application/javascript', body: `
      try { new Function('return 1')(); window.compilationBlocked = false; }
      catch { window.compilationBlocked = true; }
    ` });
    return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy':
      `script-src 'self'${variant === 'baseline' ? " 'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'none'` },
    body: `<title>Emberly uniform comparison</title><link rel="stylesheet" href="/styles.css"><style>html,body,#mount{width:100%;height:100%;margin:0;overflow:hidden}</style><body class="theme-${theme}"><div id="mount"></div><script src="/probe.js"></script><script src="/bundle.js"></script>` });
  });
  await page.goto('http://localhost/');
  await page.waitForFunction(() => window.emberlySmoke?.ok);
  assert.equal(await page.title(), 'Emberly uniform comparison');
  assert.equal(await page.evaluate(() => window.emberlyHarness.tree.renderer.type), 1, 'Must keep WebGL, not silently fall back to Canvas');
  assert.equal(await page.evaluate(() => window.compilationBlocked), variant === 'static');
  await page.evaluate(() => document.fonts.ready);
  return page;
}

try {
  for (const theme of ['light', 'dark']) {
    const images = [];
    for (const variant of ['baseline', 'static']) {
      const page = await open(variant, theme);
      await page.waitForTimeout(4000);
      const image = await page.screenshot(); images.push(image);
      if (process.env.QA_OUTPUT) writeFileSync(path.join(process.env.QA_OUTPUT, `uniforms-${variant}-${theme}.png`), image);
      await page.close();
    }
    assert.ok(images[0].equals(images[1]), `${theme} map pixels differ from the released generators`);
  }
  console.log('PASS: baseline/static map screenshots are identical in both themes; static WebGL runs with compilation blocked.');

  // Exercise a real WebGL2 UBO and nested sampler groups, beyond the normal map.
  let baselineGpu;
  for (const variant of ['baseline', 'static']) {
    const page = await open(variant);
    const gpu = await page.evaluate(() => {
      const { Renderer, Shader, UniformGroup, Texture } = window.emberlyImages;
      const renderer = new Renderer({ width: 4, height: 4, preserveDrawingBuffer: true });
      const gl = renderer.gl;
      if (renderer.context.webGLVersion !== 2) throw new Error('WebGL2 is required for buffer coverage');
      const vertex = `#version 300 es
        precision highp float;
        layout(std140) uniform TestBlock { vec4 color; mat3 transform; };
        out vec4 vColor;
        void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4((transform * vec3(p * 2.0 - 1.0, 1.0)).xy, 0.0, 1.0); vColor = color; }`;
      const fragment = `#version 300 es
        precision highp float; in vec4 vColor; uniform sampler2D first; uniform sampler2D second; out vec4 result;
        void main() { result = vColor * texture(first, vec2(0.5)) * texture(second, vec2(0.5)); }`;
      const block = UniformGroup.uboFrom({ color: new Float32Array([1, 0.5, 0.25, 1]), transform: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]) });
      const shader = Shader.from(vertex, fragment, { TestBlock: block, first: Texture.WHITE, nested: new UniformGroup({ second: Texture.WHITE }) });
      const reads = [];
      for (const color of [[1, 0.5, 0.25, 1], [0, 1, 0.5, 1]]) {
        block.uniforms.color.set(color); block.update();
        renderer.shader.bind(shader);
        gl.viewport(0, 0, 4, 4); gl.drawArrays(gl.TRIANGLES, 0, 3);
        const pixels = new Uint8Array(4); gl.readPixels(1, 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        const program = renderer.shader.getGlProgram().program;
        reads.push({ pixels: Array.from(pixels), first: gl.getUniform(program, gl.getUniformLocation(program, 'first')), second: gl.getUniform(program, gl.getUniformLocation(program, 'second')), error: gl.getError() });
      }
      renderer.destroy(true); shader.destroy(); return reads;
    });
    const expectedPixels = [[255, 128, 64, 255], [0, 255, 128, 255]];
    for (const [index, reading] of gpu.entries()) {
      assert.equal(reading.first, 0); assert.equal(reading.second, 1); assert.equal(reading.error, 0);
      reading.pixels.forEach((channel, i) => assert.ok(Math.abs(channel - expectedPixels[index][i]) <= 1, 'Allow GPU byte rounding only'));
    }
    if (variant === 'baseline') baselineGpu = gpu;
    else assert.deepEqual(gpu, baselineGpu, 'Static UBO output must exactly match the original');
    await page.close();
  }
  console.log('PASS: real WebGL2 uniform buffers update correct pixels; nested samplers keep distinct texture units.');

  if (process.env.UNIFORM_BENCHMARK) {
    const repeats = 4;
    for (const count of [30, 300, 1000]) for (let trial = 0; trial < repeats; trial++) {
      const pairedImages = [];
      for (const variant of trial % 2 ? ['static', 'baseline'] : ['baseline', 'static']) {
        const page = await open(variant);
        const session = await page.context().newCDPSession(page);
        await session.send('Performance.enable');
        const heap = async () => {
          await session.send('HeapProfiler.collectGarbage');
          return (await session.send('Performance.getMetrics')).metrics.find(m => m.name === 'JSHeapUsedSize').value;
        };
        const initialHeapBytes = await heap();
        const start = await page.evaluate(count => {
          const h = window.emberlyHarness; h.engine.destroy();
          const nodes = Array.from({ length: count }, (_, i) => ({ id: `n${i}`, parentId: i ? `n${Math.floor((i - 1) / 6)}` : null,
            side: i % 2 ? 'left' : 'right', order: i, path: `n${i}.md`, title: `Gull ${i} 🐦`, mapId: 'benchmark', color: -1, collapsed: false, rating: i % 6, state: 0 }));
          nodes[0].side = 'center';
          window.benchStart = performance.now();
          window.benchEngine = h.create(h.mount, { id: 'benchmark', format: 2, path: 'benchmark.md', folder: '', title: 'Benchmark', layout: 'center', issues: [], nodes });
          return performance.now() - window.benchStart;
        }, count);
        await page.waitForFunction(() => window.benchEngine.tree.isLoaded);
        const loaded = await page.evaluate(() => performance.now() - window.benchStart);
        await page.waitForTimeout(4000);
        assert.equal(await page.evaluate(() => window.benchEngine.tree.renderer.type), 1);
        pairedImages.push(await page.screenshot());
        const activeHeapBytes = await heap();
        const metrics = await page.evaluate(() => {
          const tree = window.benchEngine.tree, renderer = tree.renderer, samples = [];
          for (let i = 0; i < 150; i++) {
            tree.viewport.x += i % 2 ? 1 : -1;
            const start = performance.now(); renderer.render(tree.viewport.parent);
            if (i >= 30) samples.push(performance.now() - start);
          }
          renderer.gl.finish(); samples.sort((a, b) => a - b);
          return { medianFrameMs: samples[Math.floor(samples.length / 2)], p95FrameMs: samples[Math.floor(samples.length * 0.95)] };
        });
        await page.evaluate(() => { window.benchEngine.destroy(); window.benchEngine = null; window.emberlyHarness = null; });
        const disposedHeapBytes = await heap();
        results.push({ count, trial, variant, constructMs: start, loadedMs: loaded, initialHeapBytes, activeHeapBytes, disposedHeapBytes, ...metrics });
        await page.close();
      }
      assert.ok(pairedImages[0].equals(pairedImages[1]), `${count}-node map pixels differ`);
      console.log(`Measured ${count} nodes, paired trial ${trial + 1}/${repeats}.`);
    }
    const median = values => { values.sort((a, b) => a - b); return (values[1] + values[2]) / 2; };
    const summary = [30, 300, 1000].map(count => {
      const variants = Object.fromEntries(['baseline', 'static'].map(variant => [variant, Object.fromEntries(
        ['constructMs', 'loadedMs', 'medianFrameMs', 'p95FrameMs', 'initialHeapBytes', 'activeHeapBytes', 'disposedHeapBytes']
          .map(key => [key, median(results.filter(r => r.count === count && r.variant === variant).map(r => r[key]))]))]));
      return { count, ...variants };
    });
    const report = { browser: browser.version(), viewport: '1000x700', metric: 'Median of four alternating paired trials; CPU render submission with 30 warmup + 120 timed frames; heap after explicit GC', summary, results };
    if (process.env.QA_OUTPUT) writeFileSync(path.join(process.env.QA_OUTPUT, 'uniform-benchmark.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ browser: report.browser, summary }));
    for (const { count, baseline, static: candidate } of summary) {
      assert.ok(candidate.medianFrameMs <= baseline.medianFrameMs + Math.max(0.5, baseline.medianFrameMs * 0.1), `${count} nodes: median frame regression`);
      assert.ok(candidate.p95FrameMs <= baseline.p95FrameMs + Math.max(1, baseline.p95FrameMs * 0.15), `${count} nodes: p95 frame regression`);
      assert.ok(candidate.loadedMs <= baseline.loadedMs + Math.max(25, baseline.loadedMs * 0.2), `${count} nodes: startup regression`);
    }
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
