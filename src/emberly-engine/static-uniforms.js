// Static upload plans for Pixi 6.5.1. Build the plan once per shader signature;
// changing uniform values remain data passed to these ordinary JS functions.
const arrayMethods = {
  float: 'uniform1fv', vec2: 'uniform2fv', vec3: 'uniform3fv', vec4: 'uniform4fv',
  int: 'uniform1iv', ivec2: 'uniform2iv', ivec3: 'uniform3iv', ivec4: 'uniform4iv',
  uint: 'uniform1uiv', uvec2: 'uniform2uiv', uvec3: 'uniform3uiv', uvec4: 'uniform4uiv',
  bool: 'uniform1iv', bvec2: 'uniform2iv', bvec3: 'uniform3iv', bvec4: 'uniform4iv',
  sampler2D: 'uniform1iv', samplerCube: 'uniform1iv', sampler2DArray: 'uniform1iv',
};

function vectorStep(name, type, components, shape) {
  const method = `uniform${components}${type.startsWith('u') ? 'ui' : /^[ib]/.test(type) ? 'i' : 'f'}`;
  const fields = shape === 'point' ? ['x', 'y'] : shape === 'rectangle' ? ['x', 'y', 'width', 'height'] : [0, 1, 2, 3];
  return (ud, uv, renderer) => {
    const uniform = ud[name], cached = uniform.value, value = uv[name];
    let changed = false;
    for (let i = 0; i < components; i++) {
      // Pixi's bvec2 template uses coercing comparison; retain that behavior.
      if (type === 'bvec2' ? cached[i] != value[fields[i]] : cached[i] !== value[fields[i]]) changed = true;
    }
    if (!changed) return;
    for (let i = 0; i < components; i++) cached[i] = value[fields[i]];
    const gl = renderer.gl;
    if (components === 2) gl[method](uniform.location, cached[0], cached[1]);
    else if (components === 3) gl[method](uniform.location, cached[0], cached[1], cached[2]);
    else gl[method](uniform.location, cached[0], cached[1], cached[2], cached[3]);
  };
}

function uniformStep(name, data, initial) {
  const { type, size, isArray } = data;
  if (/^sampler/.test(type) && size === 1 && !isArray) {
    return (ud, uv, renderer, syncData) => {
      const unit = syncData.textureCount++;
      renderer.texture.bind(uv[name], unit);
      if (ud[name].value !== unit) {
        ud[name].value = unit; renderer.gl.uniform1i(ud[name].location, unit);
      }
    };
  }
  if (/^mat[234]$/.test(type)) {
    const method = `uniformMatrix${type.slice(3)}fv`;
    const matrixObject = type === 'mat3' && size === 1 && initial.a !== undefined;
    return (ud, uv, renderer) => renderer.gl[method](ud[name].location, false, matrixObject ? uv[name].toArray(true) : uv[name]);
  }
  if (size > 1) {
    const method = arrayMethods[type];
    if (!method) throw new Error(`Unsupported Pixi uniform array: ${type}`);
    return (ud, uv, renderer) => renderer.gl[method](ud[name].location, uv[name]);
  }
  const vector = /^(?:[iub])?vec([234])$/.exec(type);
  if (vector) {
    const shape = type === 'vec2' && initial.x !== undefined ? 'point'
      : type === 'vec4' && initial.width !== undefined ? 'rectangle' : 'array';
    return vectorStep(name, type, Number(vector[1]), shape);
  }
  if (/^sampler/.test(type)) return (ud, uv, renderer) => renderer.gl.uniform1i(ud[name].location, uv[name]);
  const method = { float: 'uniform1f', int: 'uniform1i', uint: 'uniform1ui', bool: 'uniform1i' }[type];
  if (!method) throw new Error(`Unsupported Pixi uniform: ${type}`);
  return (ud, uv, renderer) => {
    const uniform = ud[name], value = uv[name];
    if (uniform.value !== value) { uniform.value = value; renderer.gl[method](uniform.location, value); }
  };
}

export function createUniformSync(group, uniformData) {
  const steps = [];
  for (const name in group.uniforms) {
    const data = uniformData[name], initial = group.uniforms[name];
    if (data) steps.push(uniformStep(name, data, initial));
    else if (initial?.group) {
      steps.push(initial.ubo
        ? (_ud, uv, renderer) => renderer.shader.syncUniformBufferGroup(uv[name], name)
        : (_ud, uv, renderer, syncData) => renderer.shader.syncUniformGroup(uv[name], syncData));
    }
  }
  return (ud, uv, renderer, syncData) => {
    for (let i = 0; i < steps.length; i++) steps[i](ud, uv, renderer, syncData);
  };
}

export function createBufferSync(group, uniformData, getUBOData, createUBOElements) {
  const upload = (_ud, _uv, renderer, _syncData, buffer) => renderer.buffer.update(buffer);
  if (!group.autoManage) return { size: 0, syncFunc: upload };
  // Use Pixi's existing layout calculation to preserve its STD140 offsets.
  const { uboElements, size } = createUBOElements(getUBOData(group.uniforms, uniformData));
  const steps = uboElements.map(({ data: descriptor, offset }) => {
    const { name, type, size: count } = descriptor;
    const initial = group.uniforms[name];
    const start = offset / 4;
    if (count === 1 && type === 'mat3' && initial.a !== undefined) {
      return (uv, data) => {
        const value = uv[name].toArray(true);
        for (let row = 0; row < 3; row++) for (let column = 0; column < 3; column++) data[start + row * 4 + column] = value[row * 3 + column];
      };
    }
    const shape = count === 1 && type === 'vec2' && initial.x !== undefined ? ['x', 'y']
      : count === 1 && type === 'vec4' && initial.width !== undefined ? ['x', 'y', 'width', 'height'] : null;
    if (shape) return (uv, data) => { for (let i = 0; i < shape.length; i++) data[start + i] = uv[name][shape[i]]; };
    const matrix = /^mat([234])$/.exec(type);
    const vector = /^(?:[iub])?vec([234])$/.exec(type);
    const width = matrix ? Number(matrix[1]) : vector ? Number(vector[1]) : 1;
    const rows = matrix ? width : 1;
    if (count > 1) return (uv, data) => {
      const value = uv[name]; let input = 0;
      for (let row = 0; row < count * rows; row++) for (let column = 0; column < width; column++) data[start + row * 4 + column] = value[input++];
    };
    if (type === 'float') return (uv, data) => { data[start] = uv[name]; };
    if (!matrix && !/^vec[234]$/.test(type)) throw new Error(`Unsupported Pixi uniform-buffer scalar: ${type}`);
    return (uv, data) => {
      const value = uv[name];
      for (let row = 0; row < rows; row++) for (let column = 0; column < width; column++) data[start + row * 4 + column] = value[row * width + column];
    };
  });
  return { size, syncFunc: (ud, uv, renderer, syncData, buffer) => {
    for (let i = 0; i < steps.length; i++) steps[i](uv, buffer.data);
    upload(ud, uv, renderer, syncData, buffer);
  } };
}
