import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error Build scripts deliberately use plain JavaScript.
import { adaptPixiUniforms, assertNoDynamicCode } from '../../scripts/build/pixi-static-uniforms.mjs';

describe('version-guarded Pixi static adaptation', () => {
  const source = readFileSync('node_modules/@pixi/core/dist/esm/core.mjs', 'utf8');
  it('rejects changed, missing or additional code generators', () => {
    expect(() => adaptPixiUniforms(source.replace('return param1[param2] === param3;', 'return false;'))).toThrow('changed');
    expect(() => adaptPixiUniforms(source.replace('function generateUniformsSync(', 'function missing('))).toThrow('Missing');
    expect(() => adaptPixiUniforms(source + '\nconst unexpected = new Function("return 1");')).toThrow('remains');
  });
  it.each(['new Function("return 1")', 'Function("return 1")', 'window["eval"]("1")', 'globalThis.eval("1")', 'setTimeout("doSomething()", 0)'])('rejects %s in a production bundle', source => {
    expect(() => assertNoDynamicCode(source)).toThrow();
  });
  it('allows ordinary functions and diagnostic text mentioning compilation', () => {
    expect(() => assertNoDynamicCode('const text = "new Function()"; setTimeout(() => 1, 0);')).not.toThrow();
  });
});
