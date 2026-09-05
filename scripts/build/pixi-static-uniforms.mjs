import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const expected = {
  generateUniformsSync: '1cbf112edee2a6ecac6d6b1145468f72a0762da3159a19b003c3c66849398bcb',
  unsafeEvalSupported: 'd14ec893223729abce3313535d420eb0c55bd90ceaf13b82679a2b138ab11ba1',
  generateUniformBufferSync: 'b8135efd0bcf6b32b6b6e28927ac9cd6f86a433de6d7aa850cd6ff1c8e96dfa8',
};
const replacements = {
  generateUniformsSync: `function generateUniformsSync(group, uniformData) {
    emberlyCheckUniformParsers();
    return emberlyCreateUniformSync(group, uniformData);
  }`,
  unsafeEvalSupported: 'function unsafeEvalSupported() { /* Static upload plans need no runtime compiler. */ return true; }',
  generateUniformBufferSync: `function generateUniformBufferSync(group, uniformData) {
    emberlyCheckUniformParsers();
    return emberlyCreateBufferSync(group, uniformData, getUBOData, createUBOElements);
  }`,
};

export function adaptPixiUniforms(source) {
  source = source.replace(/\r\n/g, '\n');
  const ast = ts.createSourceFile('core.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [], found = new Set();
  for (const node of ast.statements) {
    if (ts.isFunctionDeclaration(node) && node.name && expected[node.name.text]) {
      const name = node.name.text;
      const hash = createHash('sha256').update(node.getText(ast)).digest('hex');
      if (found.has(name) || hash !== expected[name]) throw new Error(`Pixi ${name} changed: review static uniform adaptation.`);
      found.add(name);
      edits.push({ start: node.getStart(ast), end: node.end, text: replacements[name] });
    }
    if (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'uniformParsers')) {
      edits.push({ start: node.end, end: node.end, text: `
const emberlyUniformParsers = uniformParsers.map(parser => ({ ...parser }));
function emberlyCheckUniformParsers() {
  if (uniformParsers.length !== emberlyUniformParsers.length || uniformParsers.some((parser, index) =>
    ['test', 'code', 'codeUbo'].some(key => parser[key] !== emberlyUniformParsers[index][key]))) {
    throw new Error('Emberly static uniforms do not support custom Pixi code generators.');
  }
}
` });
    }
  }
  if (found.size !== 3 || edits.length !== 4) throw new Error('Missing Pixi code generators: review static uniform adaptation.');
  for (const edit of edits.sort((a, b) => b.start - a.start)) source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  if (/\bnew\s+Function\s*\(|\beval\s*\(/.test(source)) throw new Error('Unexpected Pixi dynamic code remains.');
  const helper = fileURLToPath(new URL('../../src/emberly-engine/static-uniforms.js', import.meta.url));
  return `import { createUniformSync as emberlyCreateUniformSync, createBufferSync as emberlyCreateBufferSync } from ${JSON.stringify(helper)};\n${source}`;
}

export function assertNoDynamicCode(source) {
  const ast = ts.createSourceFile('main.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const visit = node => {
    if (ts.isNewExpression(node) || ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee) ? callee.text
        : ts.isPropertyAccessExpression(callee) ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteral(callee.argumentExpression) ? callee.argumentExpression.text : '';
      if (name === 'Function' || name === 'eval') throw new Error('Dynamic JavaScript compilation found in the production bundle.');
      if (['setTimeout', 'setInterval'].includes(name) && node.arguments?.[0] && ts.isStringLiteralLike(node.arguments[0])) {
        throw new Error('String timer found in the production bundle.');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
}
