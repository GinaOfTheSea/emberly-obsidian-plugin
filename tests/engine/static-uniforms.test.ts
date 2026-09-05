import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
// @ts-expect-error The renderer's runtime helpers are plain JavaScript.
import { createUniformSync, createBufferSync } from '../../src/emberly-engine/static-uniforms.js';

// Oracle: execute only the installed version's original generators, in a test VM.
// No alternate generator or runtime compilation is included in production.
const source = readFileSync('node_modules/@pixi/core/dist/esm/core.mjs', 'utf8');
const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true);
const names = new Set(['GLSL_TO_SIZE', 'uniformParsers', 'GLSL_TO_SINGLE_SETTERS_CACHED', 'GLSL_TO_ARRAY_SETTERS',
  'UBO_TO_SINGLE_SETTERS', 'GLSL_TO_STD40_SIZE', 'mapSize', 'generateUniformsSync', 'generateUniformBufferSync', 'getUBOData', 'createUBOElements', 'uboUpdate']);
const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) ? names.has(n.name?.text ?? '')
  : ts.isVariableStatement(n) && n.declarationList.declarations.some(d => names.has(d.name.getText(ast))));
const original = runInNewContext(declarations.map(n => n.getText(ast)).join('\n')
  + '\n({generateUniformsSync,generateUniformBufferSync,getUBOData,createUBOElements})');
const metadata = (type: string, size = 1, isArray = false) => ({ name: 'value', type, size, isArray, index: 0 });
function renderer() {
  const calls: unknown[][] = [];
  return { calls, gl: new Proxy({}, { get: (_target, method) => (...args: unknown[]) => calls.push([method, ...args]) }),
    texture: { bind: (...args: unknown[]) => calls.push(['texture', ...args]) },
    shader: { syncUniformGroup: (...args: unknown[]) => calls.push(['group', ...args]), syncUniformBufferGroup: (...args: unknown[]) => calls.push(['ubo', ...args]) },
    buffer: { update: () => calls.push(['buffer-update']) } };
}

describe('static uniform plans compared with Pixi 6.5.1', () => {
  const scalars = ['float', 'int', 'uint', 'bool'];
  const vectors = ['vec2', 'vec3', 'vec4', 'ivec2', 'ivec3', 'ivec4', 'uvec2', 'uvec3', 'uvec4', 'bvec2', 'bvec3', 'bvec4'];
  const matrices = ['mat2', 'mat3', 'mat4'];
  const samplers = ['sampler2D', 'samplerCube', 'sampler2DArray'];
  it.each([...scalars, ...vectors, ...matrices, ...samplers])('matches %s uploads and repeated-value caching', type => {
    function run(factory: typeof createUniformSync) {
      const r = renderer(), data = { value: metadata(type) }, syncData = { textureCount: 2 };
      const count = type.startsWith('mat') ? Number(type.at(-1)) ** 2 : Number(type.at(-1)) || 1;
      const make = (offset: number) => count > 1 ? Array.from({ length: count }, (_, i) => i + offset) : offset;
      const uv = { value: make(1) }, ud = { value: { location: 'location', value: make(0) } };
      const sync = factory({ uniforms: uv }, data);
      sync(ud, uv, r, syncData); sync(ud, uv, r, syncData);
      uv.value = make(3); sync(ud, uv, r, syncData);
      return { calls: structuredClone(r.calls), cached: ud.value.value, syncData };
    }
    expect(run(createUniformSync)).toEqual(run(original.generateUniformsSync));
  });
  it.each([...scalars, ...vectors, ...matrices, ...samplers])('matches %s arrays', type => {
    function run(factory: typeof createUniformSync) {
      const r = renderer(), uv = { value: new Float32Array(32).fill(2) };
      const sync = factory({ uniforms: uv }, { value: metadata(type, 2, true) });
      sync({ value: { location: 'location', value: [] } }, uv, r, { textureCount: 0 });
      return r.calls;
    }
    expect(run(createUniformSync)).toEqual(run(original.generateUniformsSync));
  });
  it.each(['point', 'rectangle', 'matrix'])('matches Pixi %s objects', shape => {
    function run(factory: typeof createUniformSync) {
      const type = shape === 'point' ? 'vec2' : shape === 'rectangle' ? 'vec4' : 'mat3';
      const value = shape === 'matrix' ? { a: 1, toArray: () => [1, 0, 0, 0, 1, 0, 4, 5, 1] } : { x: 2, y: 3, width: 4, height: 5 };
      const uv = { value }, r = renderer(), ud = { value: { location: 'location', value: [0, 0, 0, 0] } };
      const sync = factory({ uniforms: uv }, { value: metadata(type) });
      sync(ud, uv, r, { textureCount: 0 }); sync(ud, uv, r, { textureCount: 0 });
      return r.calls;
    }
    expect(run(createUniformSync)).toEqual(run(original.generateUniformsSync));
  });
  it('shares texture units through nested groups and dispatches UBO groups', () => {
    function run(factory: typeof createUniformSync) {
      const r = renderer(), syncData = { textureCount: 3, uboCount: 0 };
      const child = { group: true, uniforms: { value: 'child texture' } }, buffer = { group: true, ubo: true };
      const uv = { value: 'parent texture', child, buffer };
      const data = { value: metadata('sampler2D') };
      const ud = { value: { location: 'location', value: -1 } };
      r.shader.syncUniformGroup = (_group: unknown, shared: any) => factory(child, data)(ud, child.uniforms, r, shared);
      factory({ uniforms: uv }, data)(ud, uv, r, syncData);
      return { calls: r.calls, syncData };
    }
    expect(run(createUniformSync)).toEqual(run(original.generateUniformsSync));
  });
  it('keeps names as data, including names containing JS punctuation', () => {
    const name = 'untrusted["name"]';
    const r = renderer();
    createUniformSync({ uniforms: { [name]: 3 } }, { [name]: metadata('float') })({ [name]: { location: 1, value: 0 } }, { [name]: 3 }, r, {});
    expect(r.calls).toEqual([['uniform1f', 1, 3]]);
  });
  it.each(['float', 'vec2', 'vec3', 'vec4', 'mat2', 'mat3', 'mat4'])('matches %s buffer layout, padding and updates', type => {
    function run(useStatic: boolean, size: number, shape: boolean) {
      const components = type.startsWith('mat') ? Number(type.at(-1)) ** 2 : Number(type.at(-1)) || 1;
      const value = shape && type === 'mat3' ? { a: 1, toArray: () => Array.from({ length: 9 }, (_, i) => i + 1) }
        : shape && type === 'vec2' ? { x: 2, y: 3 } : shape && type === 'vec4' ? { x: 2, y: 3, width: 4, height: 5 }
        : type === 'float' && size === 1 ? 9 : Array.from({ length: components * size }, (_, i) => i + 1);
      const uniforms = { before: 6, value, after: 7 };
      const data = { before: { ...metadata('float'), name: 'before' }, value: { ...metadata(type, size), index: 1 }, after: { ...metadata('float'), name: 'after', index: 2 } };
      const group = { autoManage: true, uniforms };
      const plan = useStatic ? createBufferSync(group, data, original.getUBOData, original.createUBOElements) : original.generateUniformBufferSync(group, data);
      const buffer = { data: new Float32Array(plan.size / 4).fill(-1) }, r = renderer();
      const ud = Object.fromEntries(Object.keys(data).map(name => [name, { value: 0 }]));
      plan.syncFunc(ud, uniforms, r, {}, buffer);
      return { size: plan.size, data: Array.from(buffer.data), calls: r.calls };
    }
    for (const [size, shape] of [[1, false], [1, true], [2, false]] as const) expect(run(true, size, shape)).toEqual(run(false, size, shape));
  });
  it('uploads manually managed buffers without rewriting them', () => {
    const r = renderer(), buffer = { data: new Float32Array([1, 2, 3]) };
    const plan = createBufferSync({ autoManage: false }, {}, original.getUBOData, original.createUBOElements);
    plan.syncFunc({}, {}, r, {}, buffer);
    expect(plan.size).toBe(0); expect(Array.from(buffer.data)).toEqual([1, 2, 3]); expect(r.calls).toEqual([['buffer-update']]);
  });
});
