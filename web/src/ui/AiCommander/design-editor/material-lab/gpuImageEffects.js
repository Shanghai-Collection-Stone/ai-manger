/**
 * WebGL2 素材特效引擎。
 *
 * 全流程跑在 GPU 上，六个片元着色器程序串成一条管线：
 *   1. cutout   — 按背景色做色差判定，算出每像素的「像背景」程度
 *   2. flood    — 门控膨胀 ping-pong 传播，只把「与画布边缘连通」的背景判为外部，
 *                 避免主体内部同色区域（白眼球、浅色高光）被一起挖掉
 *   3. resolve  — 合成最终 alpha，并按背景色反向去色溢出（despill）
 *   4. jfaInit  — 把不透明像素编码成种子坐标
 *   5. jfaStep  — Jump Flooding，步长折半 log2(N) 趟得到外部距离场
 *   6. composite— 用同一张距离场一次性合成发光 / 投影 / 多层描边 / 主体
 *
 * 描边、投影、发光三种特效全部由距离场推导，因此天然「按图像形状」走，
 * 而不是简单的矩形框或高斯模糊。
 */

/** 工作纹理长边上限，越大越精细也越慢；预览用小尺寸，导出用大尺寸。 */
const DEFAULT_MAX_SIZE = 1024;
/** 连通性判定的降采样边长，只负责「这块背景是否连到画布边缘」这个长距离问题。 */
const FLOOD_SIZE = 192;
/** 降采样层的门控膨胀趟数，需覆盖降采样图的最长绕行路径。 */
const FLOOD_PASSES = 320;
/** 全分辨率精修的额外趟数余量，用来吃掉降采样放大带来的边界误差。 */
const REFINE_MARGIN = 10;
/** 边缘关联扩散趟数：抗锯齿残边一般只有 1~3px，趟数给多了会开始啃主体。 */
const FRINGE_PASSES = 3;

const VERTEX_SHADER = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

/** 把 RGB 转成 YCbCr，色度分量单独加权，肤色/浅色主体压在纯色背景上时判定更稳。 */
const GLSL_YCBCR = `
vec3 toYCbCr(vec3 c) {
  float y = dot(c, vec3(0.299, 0.587, 0.114));
  return vec3(y, (c.b - y) * 0.565, (c.r - y) * 0.713);
}`;

const CUTOUT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform vec3 u_bg0;
uniform vec3 u_bg1;
uniform vec3 u_bg2;
uniform vec3 u_bg3;
uniform float u_bgCount;
uniform float u_strict;
uniform float u_loose;
uniform float u_exact;
uniform float u_softness;
uniform float u_useSourceAlpha;
out vec4 outColor;
${GLSL_YCBCR}

/** 色度差权重高于亮度差：背景纯色时主体的明暗变化不会被误判成背景。 */
float bgDistance(vec3 c, vec3 bg) {
  vec3 d = toYCbCr(c) - toYCbCr(bg);
  return sqrt(d.x * d.x * 0.55 + d.y * d.y * 2.2 + d.z * d.z * 2.2);
}

void main() {
  vec4 src = texture(u_src, v_uv);
  if (u_useSourceAlpha > 0.5) {
    float a = 1.0 - src.a;
    outColor = vec4(a, a, 0.0, 1.0);
    return;
  }
  // 三档判定，从紧到松：
  //   b = 精确  只认和底色几乎一模一样的像素，**不看连通性**。用来吃掉被笔画围住的
  //             字腔、缝隙这类封闭背景——它们和外面的底色是同一片，但连不到画布边缘，
  //             纯靠连通性判定会全部残留下来。
  //   r = 严格  控制连通传播，防止顺着相近色钻进主体。
  //   g = 宽松  主体边缘那圈混了背景色的抗锯齿像素，只在已确认与背景相连处才生效。
  // 背景可能有两种主色（渐变底、暗角、双色背景），取到最近那个的距离
  float dist = bgDistance(src.rgb, u_bg0);
  if (u_bgCount > 1.5) dist = min(dist, bgDistance(src.rgb, u_bg1));
  if (u_bgCount > 2.5) dist = min(dist, bgDistance(src.rgb, u_bg2));
  if (u_bgCount > 3.5) dist = min(dist, bgDistance(src.rgb, u_bg3));
  float soft = max(u_softness, 0.001);
  outColor = vec4(
    1.0 - smoothstep(u_strict, u_strict + soft, dist),
    1.0 - smoothstep(u_loose, u_loose + soft, dist),
    1.0 - smoothstep(u_exact, u_exact + soft * 0.4, dist),
    1.0);
}`;

/**
 * 把降采样的连通性结果放大成全分辨率种子：只取「确定是外部」的核心，边界留给全分辨率精修去吸附。
 * 同时把「精确匹配底色」的像素也并成种子——这是封闭区域（字腔、笔画缝隙）唯一的入口，
 * 它们和外面是同一片底色却连不到画布边缘，不这样单独放行就会整片残留。
 */
const SEED_UPSCALE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_state;
uniform sampler2D u_bgness;
uniform float u_holeFill;
out vec4 outColor;
void main() {
  float outside = texture(u_state, v_uv).r;
  vec3 bg = texture(u_bgness, v_uv).rgb;
  float connected = step(0.75, outside) * step(0.5, bg.r);
  float enclosed = step(0.5, bg.b) * u_holeFill;
  outColor = vec4(max(connected, enclosed), 0.0, 0.0, 1.0);
}`;

/**
 * 边缘精修：对 alpha 做 3×3 加权平滑再重映射。
 * 一步同时解决三件事——去掉阈值造成的锯齿、按 choke 收边吃掉残留的背景光晕、
 * 用 feather 控制边缘软硬；顺带把孤立的单像素噪点抹平。
 */
const REFINE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_matte;
uniform vec2 u_texel;
uniform float u_choke;
uniform float u_feather;
out vec4 outColor;
void main() {
  vec4 center = texture(u_matte, v_uv);
  float sum = 0.0;
  float weightSum = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      float w = (x == 0 && y == 0) ? 4.0 : ((x == 0 || y == 0) ? 2.0 : 1.0);
      sum += texture(u_matte, v_uv + vec2(float(x), float(y)) * u_texel).a * w;
      weightSum += w;
    }
  }
  float smoothed = sum / weightSum;
  float edge = max(u_feather, 0.01);
  float alpha = smoothstep(0.5 + u_choke - edge, 0.5 + u_choke + edge, smoothed);
  outColor = vec4(center.rgb * alpha, alpha);
}`;

const FLOOD_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_state;
uniform sampler2D u_bgness;
uniform vec2 u_texel;
uniform float u_channel;
out vec4 outColor;
void main() {
  // 只有「够像背景」的像素才允许承接外部标记，主体像素把传播挡住。
  // u_channel=0 用严格判定做主体传播，=1 用宽松判定做边缘关联扩散。
  vec2 bg = texture(u_bgness, v_uv).rg;
  float gate = step(0.5, mix(bg.r, bg.g, u_channel));
  if (gate < 0.5) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float best = texture(u_state, v_uv).r;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = v_uv + vec2(float(x), float(y)) * u_texel;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { best = 1.0; continue; }
      best = max(best, texture(u_state, uv).r);
    }
  }
  outColor = vec4(best, 0.0, 0.0, 1.0);
}`;

const RESOLVE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_bgness;
uniform sampler2D u_outside;
uniform vec3 u_bg0;
uniform float u_despill;
uniform float u_useSourceAlpha;
out vec4 outColor;
void main() {
  vec4 src = texture(u_src, v_uv);
  if (u_useSourceAlpha > 0.5) { outColor = src; return; }
  // 用宽松判定算 alpha，但乘上「是否与画布边缘连通」这个门。
  // 于是同一个黑色：背景那片连通 → 被去掉；主体内部的黑描边不连通 → 完整保留。
  // 这就是「关联去除」：判定放宽到能吃掉边缘残留，靠连通性保证不误伤主体。
  float bgness = texture(u_bgness, v_uv).g;
  float outside = texture(u_outside, v_uv).r;
  float alpha = clamp(1.0 - bgness * outside, 0.0, 1.0);
  // 半透明边缘会混入背景色，按 alpha 反解出主体原色，消掉绿边/白边
  vec3 rgb = src.rgb;
  if (u_despill > 0.0 && alpha > 0.004) {
    vec3 unmixed = (src.rgb - u_bg0 * (1.0 - alpha)) / alpha;
    rgb = mix(src.rgb, clamp(unmixed, 0.0, 1.0), u_despill);
  }
  // 这里输出非预乘，交给 refine 平滑完再预乘，避免边缘平滑时把背景色混进来
  outColor = vec4(rgb, alpha);
}`;

/** RGBA8 里存两个 16 位坐标：x 拆高低字节放 rg，y 拆高低字节放 ba，全 255 表示空种子。 */
const GLSL_SEED_CODEC = `
const vec4 EMPTY_SEED = vec4(1.0);
vec4 encodeSeed(vec2 c) {
  vec2 hi = floor(c / 256.0);
  vec2 lo = c - hi * 256.0;
  return vec4(hi.x, lo.x, hi.y, lo.y) / 255.0;
}
vec2 decodeSeed(vec4 e) {
  vec2 hi = floor(vec2(e.x, e.z) * 255.0 + 0.5);
  vec2 lo = floor(vec2(e.y, e.w) * 255.0 + 0.5);
  return hi * 256.0 + lo;
}
bool isEmptySeed(vec4 e) { return all(greaterThan(e, vec4(0.996))); }`;

const JFA_INIT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_mask;
uniform vec2 u_size;
uniform float u_threshold;
out vec4 outColor;
${GLSL_SEED_CODEC}
void main() {
  float a = texture(u_mask, v_uv).a;
  outColor = a > u_threshold ? encodeSeed(floor(v_uv * u_size)) : EMPTY_SEED;
}`;

const JFA_STEP_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_seed;
uniform vec2 u_texel;
uniform vec2 u_size;
uniform float u_step;
out vec4 outColor;
${GLSL_SEED_CODEC}
void main() {
  vec2 here = floor(v_uv * u_size);
  vec4 best = texture(u_seed, v_uv);
  float bestDist = isEmptySeed(best) ? 1.0e20 : distance(decodeSeed(best), here);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = v_uv + vec2(float(x), float(y)) * u_step * u_texel;
      if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
      vec4 s = texture(u_seed, uv);
      if (isEmptySeed(s)) continue;
      float d = distance(decodeSeed(s), here);
      if (d < bestDist) { bestDist = d; best = s; }
    }
  }
  outColor = best;
}`;

const COMPOSITE_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_src;
uniform sampler2D u_seed;
uniform vec2 u_size;
uniform vec4 u_outline1;
uniform vec3 u_outline1Color;
uniform vec4 u_outline2;
uniform vec3 u_outline2Color;
uniform vec4 u_shadow;
uniform vec4 u_shadowColor;
uniform vec2 u_shadowOffset;
uniform vec4 u_glow;
uniform vec3 u_glowColor;
out vec4 outColor;
${GLSL_SEED_CODEC}

/** 采样外部距离场：返回该点到最近不透明像素的像素距离。 */
float sampleDistance(vec2 uv) {
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0e6;
  vec4 s = texture(u_seed, uv);
  if (isEmptySeed(s)) return 1.0e6;
  return distance(decodeSeed(s), floor(uv * u_size));
}

/** 把一层颜色按 alpha 叠到已有结果上（预乘 alpha 的 source-over）。 */
vec4 over(vec4 dst, vec4 src) {
  return src + dst * (1.0 - src.a);
}

void main() {
  float d = sampleDistance(v_uv);
  vec4 result = vec4(0.0);

  // 发光：距离场直接当作衰减因子，光晕严格贴着轮廓
  if (u_glow.x > 0.0) {
    float t = clamp(1.0 - d / u_glow.x, 0.0, 1.0);
    float a = pow(t, max(u_glow.z, 0.05)) * u_glow.y;
    result = over(result, vec4(u_glowColor * a, a));
  }

  // 投影：在偏移后的位置采距离场，等价于把整个形状平移再取距离，因此投影也按形状走
  if (u_shadowColor.a > 0.0) {
    float ds = sampleDistance(v_uv - u_shadowOffset);
    float a = (1.0 - smoothstep(u_shadow.x - u_shadow.y, u_shadow.x + u_shadow.y, ds)) * u_shadowColor.a;
    result = over(result, vec4(u_shadowColor.rgb * a, a));
  }

  // 外层描边 → 内层描边：宽度即距离阈值，1px 过渡带做抗锯齿
  if (u_outline2.x > 0.0) {
    float a = (1.0 - smoothstep(u_outline2.x - 1.0, u_outline2.x + 1.0, d)) * u_outline2.y;
    result = over(result, vec4(u_outline2Color * a, a));
  }
  if (u_outline1.x > 0.0) {
    float a = (1.0 - smoothstep(u_outline1.x - 1.0, u_outline1.x + 1.0, d)) * u_outline1.y;
    result = over(result, vec4(u_outline1Color * a, a));
  }

  vec4 src = texture(u_src, v_uv);
  result = over(result, src);
  // 转回非预乘，交给 canvas 输出 PNG
  outColor = result.a > 0.0035 ? vec4(result.rgb / result.a, result.a) : vec4(0.0);
}`;

let sharedContext = null;

/**
 * @description 编译单个着色器，失败时抛出带日志的错误便于定位 GLSL 问题。
 * @keyword-cn 着色器编译
 * @keyword-en compile shader
 * @param {WebGL2RenderingContext} gl - GL 上下文。
 * @param {number} type - 着色器类型。
 * @param {string} source - GLSL 源码。
 * @returns {WebGLShader} 编译后的着色器。
 */
const compileShader = (gl, type, source) => {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`SHADER_COMPILE_FAILED: ${log}`);
  }
  return shader;
};

/**
 * @description 链接片元着色器程序，并缓存其 uniform 位置。
 * @keyword-cn 着色器程序
 * @keyword-en build program
 * @param {WebGL2RenderingContext} gl - GL 上下文。
 * @param {string} fragmentSource - 片元着色器源码。
 * @returns {{ program: WebGLProgram, uniforms: Map<string, WebGLUniformLocation> }} 程序与 uniform 缓存。
 */
const buildProgram = (gl, fragmentSource) => {
  const program = gl.createProgram();
  const vs = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'a_pos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`PROGRAM_LINK_FAILED: ${log}`);
  }
  return { program, uniforms: new Map() };
};

/**
 * @description 惰性创建并复用共享的 WebGL2 上下文与全部着色器程序，避免每次特效都重建 GPU 资源。
 * @keyword-cn GPU上下文
 * @keyword-en gpu context
 * @returns {object|null} GPU 上下文包装，浏览器不支持 WebGL2 时返回 null。
 */
const acquireContext = () => {
  if (sharedContext !== null) return sharedContext.gl ? sharedContext : null;
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', {
    premultipliedAlpha: false,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (!gl) {
    sharedContext = { gl: null };
    return null;
  }
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  try {
    sharedContext = {
      gl,
      canvas,
      vao,
      framebuffer: gl.createFramebuffer(),
      programs: {
        cutout: buildProgram(gl, CUTOUT_SHADER),
        flood: buildProgram(gl, FLOOD_SHADER),
        seedUpscale: buildProgram(gl, SEED_UPSCALE_SHADER),
        resolve: buildProgram(gl, RESOLVE_SHADER),
        refine: buildProgram(gl, REFINE_SHADER),
        jfaInit: buildProgram(gl, JFA_INIT_SHADER),
        jfaStep: buildProgram(gl, JFA_STEP_SHADER),
        composite: buildProgram(gl, COMPOSITE_SHADER),
      },
    };
  } catch (buildError) {
    // 着色器编译/链接失败时 GLSL 日志是唯一线索，不能吞掉——
    // 否则表现只是一句"不支持 WebGL2"，完全指不到真正的出错行
    console.error('[material-lab] GPU 特效着色器构建失败', buildError);
    sharedContext = { gl: null };
    return null;
  }
  return sharedContext;
};

/**
 * @description 判断当前浏览器能否跑 GPU 特效管线。
 * @keyword-cn GPU支持检测
 * @keyword-en gpu support check
 * @returns {boolean} 支持返回 true。
 */
export const isGpuEffectsSupported = () => Boolean(acquireContext());

/**
 * @description 读取（并缓存）程序里某个 uniform 的位置。
 * @keyword-cn uniform位置
 * @keyword-en uniform location
 * @param {WebGL2RenderingContext} gl - GL 上下文。
 * @param {object} entry - buildProgram 返回的程序条目。
 * @param {string} name - uniform 名。
 * @returns {WebGLUniformLocation|null} uniform 位置。
 */
const uniformOf = (gl, entry, name) => {
  if (!entry.uniforms.has(name))
    entry.uniforms.set(name, gl.getUniformLocation(entry.program, name));
  return entry.uniforms.get(name);
};

/**
 * @description 创建一张 RGBA8 纹理，可选地用图像数据初始化。
 * @keyword-cn 纹理创建
 * @keyword-en create texture
 * @param {WebGL2RenderingContext} gl - GL 上下文。
 * @param {number} width - 宽。
 * @param {number} height - 高。
 * @param {TexImageSource|null} [source] - 初始化图像源。
 * @returns {WebGLTexture} 纹理。
 */
const createTexture = (gl, width, height, source = null) => {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (source) {
    // GL 纹理原点在左下、画布原点在左上，上传外部图像时必须翻 Y，
    // 否则整条管线的结果相对画布是上下颠倒的。中间纹理是渲染出来的，同一套朝向，不能翻。
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  } else {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }
  return texture;
};

/**
 * @description JFA 的种子纹理必须最近邻采样，线性插值会把编码坐标混成非法值。
 * @keyword-cn 最近邻采样
 * @keyword-en nearest filter
 * @param {WebGL2RenderingContext} gl - GL 上下文。
 * @param {WebGLTexture} texture - 目标纹理。
 * @returns {WebGLTexture} 原纹理。
 */
const useNearest = (gl, texture) => {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
};

/**
 * @description 把一个片元程序渲染到指定纹理（或直接渲染到画布）。
 * @keyword-cn 渲染趟次
 * @keyword-en render pass
 * @param {object} ctx - GPU 上下文包装。
 * @param {object} entry - 程序条目。
 * @param {WebGLTexture|null} target - 目标纹理，null 表示画布。
 * @param {number} width - 视口宽。
 * @param {number} height - 视口高。
 * @param {Function} setup - 设置 uniform 与纹理绑定的回调。
 * @returns {void}
 */
const renderPass = (ctx, entry, target, width, height, setup) => {
  const { gl } = ctx;
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? ctx.framebuffer : null);
  if (target)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      target,
      0,
    );
  gl.viewport(0, 0, width, height);
  gl.useProgram(entry.program);
  gl.bindVertexArray(ctx.vao);
  setup((name, value) => gl.uniform1i(uniformOf(gl, entry, name), value));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
};

/**
 * @description 把 #rrggbb 颜色解析成 0~1 的 RGB 三元组。
 * @keyword-cn 颜色解析
 * @keyword-en parse color
 * @param {string} value - 颜色字符串。
 * @param {number[]} [fallback] - 解析失败时的兜底值。
 * @returns {number[]} RGB 数组。
 */
const parseColor = (value, fallback = [0, 0, 0]) => {
  const hex = String(value || '')
    .trim()
    .replace('#', '');
  if (hex.length !== 6) return fallback;
  const int = Number.parseInt(hex, 16);
  if (!Number.isFinite(int)) return fallback;
  return [
    ((int >> 16) & 255) / 255,
    ((int >> 8) & 255) / 255,
    (int & 255) / 255,
  ];
};

/** 直方图量化位数：每通道 32 级，够把「同一块底色」聚到同一个桶里又不至于把主体色混进来。 */
const HISTOGRAM_BITS = 3;
/** 统计用的降采样边长。 */
const HISTOGRAM_SIZE = 128;
/** 参与「谁能去掉最多」评估的候选色个数。 */
const CANDIDATE_COUNT = 8;
/** 单个候选色去除比例超过这个值就判为异常（会把主体一起吃光），不予采纳。 */
const MAX_REMOVAL_RATIO = 0.92;

/**
 * @description CPU 侧的背景色距离，度量方式与 cutout 着色器里的 `bgDistance` 严格一致，
 *   否则候选评估的结论和 GPU 实际抠图结果对不上。
 * @keyword-cn 背景色距离
 * @keyword-en background color distance
 * @param {number[]} a - 0~1 的 RGB。
 * @param {number[]} b - 0~1 的 RGB。
 * @returns {number} 加权色差。
 */
const backgroundDistance = (a, b) => {
  const ya = 0.299 * a[0] + 0.587 * a[1] + 0.114 * a[2];
  const yb = 0.299 * b[0] + 0.587 * b[1] + 0.114 * b[2];
  const dy = ya - yb;
  const dcb = (a[2] - ya) * 0.565 - (b[2] - yb) * 0.565;
  const dcr = (a[0] - ya) * 0.713 - (b[0] - yb) * 0.713;
  return Math.sqrt(dy * dy * 0.55 + dcb * dcb * 2.2 + dcr * dcr * 2.2);
};

/**
 * @description 用某个候选色做一次低分辨率的连通去底，返回实际能被去掉的面积占比。
 *   这是选背景色的判据：只统计「与画布边缘连通」的部分，所以一个颜色即使出现次数很多，
 *   只要它主要长在主体内部（比如艺术字的黑描边），也不会被误选成背景。
 * @keyword-cn 去除面积评估
 * @keyword-en measure removable area
 * @param {Uint8ClampedArray} pixels - 降采样后的 RGBA 数据。
 * @param {number} size - 降采样边长。
 * @param {number[]} color - 候选背景色。
 * @param {number} tolerance - 判定容差。
 * @returns {number} 0~1 的可去除面积占比。
 */
const measureRemovableArea = (pixels, size, color, tolerance) => {
  const total = size * size;
  const isBackgroundLike = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    const o = i * 4;
    if (pixels[o + 3] < 8) {
      isBackgroundLike[i] = 1;
      continue;
    }
    const sample = [pixels[o] / 255, pixels[o + 1] / 255, pixels[o + 2] / 255];
    isBackgroundLike[i] =
      backgroundDistance(sample, color) <= tolerance ? 1 : 0;
  }

  const seen = new Uint8Array(total);
  const stack = [];
  const seed = (index) => {
    if (index < 0 || index >= total || seen[index] || !isBackgroundLike[index])
      return;
    seen[index] = 1;
    stack.push(index);
  };
  for (let x = 0; x < size; x += 1) {
    seed(x);
    seed((size - 1) * size + x);
  }
  for (let y = 0; y < size; y += 1) {
    seed(y * size);
    seed(y * size + size - 1);
  }

  let reached = 0;
  while (stack.length) {
    const index = stack.pop();
    reached += 1;
    const x = index % size;
    if (x > 0) seed(index - 1);
    if (x < size - 1) seed(index + 1);
    seed(index - size);
    seed(index + size);
  }
  return reached / total;
};

/**
 * @description 选背景色：先用全图直方图取出若干候选色，再逐个试算「按这个色去底能去掉多大面积」，
 *   取**实际能去掉最多**的那个。判据是去除面积而不是出现次数——一个颜色出现得再多，
 *   只要它主要长在主体内部（比如艺术字的黑描边、和背景同色但被主体包住的区域），
 *   连通判定就到不了它，去除面积自然小，不会被误选成背景。
 *   去除比例超过 `MAX_REMOVAL_RATIO` 的候选直接排除，那是会把主体一起吃光的异常解。
 *   同时返回第二背景色（若也能去掉可观面积且与主色差得远），用于渐变底/双色底。
 * @keyword-cn 背景色估计
 * @keyword-cn 主色统计
 * @keyword-en estimate-background
 * @keyword-en dominant-color-histogram
 * @param {TexImageSource} source - 原始图像。
 * @param {number} tolerance - 当前去底强度对应的判定容差，让选色随滑杆实时变化。
 * @returns {number[][]} 一到两个 0~1 的 RGB 背景色。
 */
const estimateBackgroundColors = (source, tolerance, pickedColors = []) => {
  const size = HISTOGRAM_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size, size);
  let data;
  try {
    ({ data } = ctx.getImageData(0, 0, size, size));
  } catch {
    // 图片跨域且服务端没给 CORS 头时画布被污染，退回白底假设
    return [[1, 1, 1]];
  }

  const shift = 8 - HISTOGRAM_BITS;
  const levels = 1 << HISTOGRAM_BITS;
  const bins = new Map();
  for (let i = 0; i < size * size; i += 1) {
    const o = i * 4;
    if (data[o + 3] < 8) continue;
    const r = data[o];
    const g = data[o + 1];
    const b = data[o + 2];
    const key = ((r >> shift) * levels + (g >> shift)) * levels + (b >> shift);
    const bin = bins.get(key);
    if (bin) {
      bin.count += 1;
      bin.r += r;
      bin.g += g;
      bin.b += b;
    } else bins.set(key, { count: 1, r, g, b });
  }
  if (!bins.size)
    return pickedColors.length ? pickedColors.slice(0, 4) : [[1, 1, 1]];

  // 直方图只负责提名候选（桶中心太粗糙，取桶内均值作实际颜色），谁当选由去除面积说了算
  const candidates = [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, CANDIDATE_COUNT)
    .map((bin) => ({
      count: bin.count,
      color: [
        bin.r / bin.count / 255,
        bin.g / bin.count / 255,
        bin.b / bin.count / 255,
      ],
    }));
  candidates.forEach((candidate) => {
    const ratio = measureRemovableArea(data, size, candidate.color, tolerance);
    candidate.removable = ratio > MAX_REMOVAL_RATIO ? 0 : ratio;
  });

  const ranked = [...candidates].sort(
    (a, b) => b.removable - a.removable || b.count - a.count,
  );
  const primary = ranked[0];
  // 一个都去不掉说明这张图本来就没有连通背景，退回出现次数最多的色，让用户自己调强度
  if (!primary || primary.removable <= 0.001)
    return pickedColors.length
      ? pickedColors.slice(0, 4)
      : [candidates[0].color];
  const secondary = ranked.slice(1).find((candidate) => {
    if (candidate.removable < primary.removable * 0.35) return false;
    const spread = Math.hypot(
      candidate.color[0] - primary.color[0],
      candidate.color[1] - primary.color[1],
      candidate.color[2] - primary.color[2],
    );
    return spread > 0.12;
  });
  const automatic = secondary
    ? [primary.color, secondary.color]
    : [primary.color];
  const colors = [];
  [...pickedColors, ...automatic].forEach((color) => {
    if (!Array.isArray(color) || color.length < 3 || colors.length >= 4) return;
    const normalized = color
      .slice(0, 3)
      .map((value) => clampNumber(Number(value) || 0, 0, 1));
    const duplicate = colors.some(
      (item) =>
        Math.hypot(
          item[0] - normalized[0],
          item[1] - normalized[1],
          item[2] - normalized[2],
        ) < 0.035,
    );
    if (!duplicate) colors.push(normalized);
  });
  return colors.length ? colors : automatic;
};

/**
 * @description 检测原图是否已有透明通道；已有透明通道时应直接保留，避免再次按颜色误扣浅色主体。
 * @keyword-cn 透明通道检测
 * @keyword-en source-alpha-check
 * @param {TexImageSource} source - 原始图像。
 * @returns {boolean} 是否包含半透明或全透明像素。
 */
const sourceHasTransparency = (source) => {
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, size, size);
  try {
    const { data } = context.getImageData(0, 0, size, size);
    for (let index = 3; index < data.length; index += 4)
      if (data[index] < 250) return true;
  } catch {
    return false;
  }
  return false;
};

/**
 * @description 把数值限制在区间内。
 * @keyword-cn 数值限制
 * @keyword-en clamp
 * @param {number} value - 原始值。
 * @param {number} min - 下限。
 * @param {number} max - 上限。
 * @returns {number} 安全值。
 */
const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

/**
 * @description 把「去底强度」这一个 0~1 的参数展开成引擎实际要用的一整套阈值。
 *   对外只暴露一条滑杆：强度大 = 判定更宽松、收边更狠、去色溢出更强，
 *   这几项本来就该同向变化，拆成五条只会让人调不出好结果。
 * @keyword-cn 去底强度
 * @keyword-en derive cutout params
 * @param {object} cutout - 特效配置里的 cutout 段。
 * @returns {{ strict: number, loose: number, softness: number, choke: number, feather: number, despill: number }} 展开后的阈值。
 */
const deriveCutout = (cutout) => {
  const raw = Number(cutout?.strength);
  const strength = clampNumber(Number.isFinite(raw) ? raw : 0.5, 0, 1);
  const strict = 0.06 + strength * 0.26;
  return {
    strict,
    // 精确档要明显紧于严格档：它绕开连通性直接删，放松了会啃掉与底色相近的主体元素
    exact: 0.015 + strength * 0.07,
    holeFill: cutout?.holeFill === false ? 0 : 1,
    // 宽松阈值只比严格阈值放开一档：够吃掉 1~3px 的抗锯齿残边，
    // 又不至于宽到能顺着相近色钻进主体内部
    loose: strict * 1.9 + 0.04,
    softness: 0.04 + strength * 0.08,
    choke: 0.02 + strength * 0.1,
    feather: 0.15,
    despill: 0.45 + strength * 0.45,
  };
};

/**
 * @description 计算特效需要向外扩出的像素边距，保证描边/投影/发光不被画布裁掉。
 * @keyword-cn 特效边距
 * @keyword-en effect padding
 * @param {object} effect - 特效配置。
 * @param {number} scale - 工作分辨率相对基准 512 的缩放比。
 * @returns {number} 边距像素。
 */
const resolvePadding = (effect, scale) => {
  const outlines = Array.isArray(effect?.outline) ? effect.outline : [];
  const outlineMax = outlines.reduce(
    (max, item) => Math.max(max, Number(item?.width) || 0),
    0,
  );
  const shadow = effect?.shadow;
  const shadowReach = shadow
    ? Math.hypot(Number(shadow.dx) || 0, Number(shadow.dy) || 0) +
      (Number(shadow.spread) || 0) +
      (Number(shadow.blur) || 0)
    : 0;
  const glowReach = Number(effect?.glow?.radius) || 0;
  return Math.ceil(Math.max(outlineMax, shadowReach, glowReach) * scale) + 6;
};

/**
 * @description 在 GPU 上跑完整特效管线，返回带透明通道的结果画布。
 *   去底用「色差判定 + 边缘连通门控膨胀」，描边/投影/发光统一由 JFA 距离场推导。
 * @keyword-cn 素材特效渲染
 * @keyword-cn GPU渲染
 * @keyword-en render image effect
 * @keyword-en gpu-render
 * @param {TexImageSource} source - 原始图像（ImageBitmap / HTMLImageElement / Canvas）。
 * @param {object} effect - 特效配置（cutout / outline / shadow / glow）。
 * @param {{ maxSize?: number }} [options] - 渲染选项，maxSize 控制工作分辨率。
 * @returns {HTMLCanvasElement|null} 结果画布，GPU 不可用时返回 null。
 */
export const renderImageEffect = (source, effect, options = {}) => {
  const ctx = acquireContext();
  if (!ctx) return null;
  const { gl } = ctx;
  const srcWidth = source.width || source.naturalWidth || 0;
  const srcHeight = source.height || source.naturalHeight || 0;
  if (!srcWidth || !srcHeight) return null;

  const maxSize = Number(options.maxSize) || DEFAULT_MAX_SIZE;
  const fit = Math.min(1, maxSize / Math.max(srcWidth, srcHeight));
  const innerWidth = Math.max(1, Math.round(srcWidth * fit));
  const innerHeight = Math.max(1, Math.round(srcHeight * fit));
  const scale = Math.max(innerWidth, innerHeight) / 512;
  const cutoutEnabled = effect?.cutout?.enabled !== false;
  const preserveSourceAlpha = cutoutEnabled && sourceHasTransparency(source);
  const pad = resolvePadding(effect, scale);
  const width = innerWidth + pad * 2;
  const height = innerHeight + pad * 2;

  // 选色要用当前强度对应的容差，所以阈值先展开；选色本身每次渲染都重算，跟着滑杆实时变
  const tuning = deriveCutout(effect?.cutout);
  // 先定背景色，再用它填满外扩区域，让门控膨胀能从画布边缘一路吃到主体轮廓
  const pickedBackgrounds = Array.isArray(effect?.cutout?.backgroundColors)
    ? effect.cutout.backgroundColors
    : [];
  const backgrounds =
    cutoutEnabled && !preserveSourceAlpha
      ? estimateBackgroundColors(source, tuning.strict, pickedBackgrounds)
      : [[0, 0, 0]];
  const staging = document.createElement('canvas');
  staging.width = width;
  staging.height = height;
  const staging2d = staging.getContext('2d');
  if (cutoutEnabled && !preserveSourceAlpha) {
    staging2d.fillStyle = `rgb(${backgrounds[0].map((c) => Math.round(c * 255)).join(',')})`;
    staging2d.fillRect(0, 0, width, height);
  }
  staging2d.drawImage(source, pad, pad, innerWidth, innerHeight);

  const textures = [];
  const track = (texture) => {
    textures.push(texture);
    return texture;
  };
  const srcTexture = track(createTexture(gl, width, height, staging));
  const bgness = track(createTexture(gl, width, height));
  const matte = track(createTexture(gl, width, height));
  const cut = track(createTexture(gl, width, height));

  const cutoutProgram = ctx.programs.cutout;
  /** 同一段 cutout 着色器要在全分辨率和降采样两个尺寸各跑一次，参数完全一致。 */
  const bindCutoutUniforms = (setInt) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    setInt('u_src', 0);
    gl.uniform3fv(uniformOf(gl, cutoutProgram, 'u_bg0'), backgrounds[0]);
    gl.uniform3fv(
      uniformOf(gl, cutoutProgram, 'u_bg1'),
      backgrounds[1] || backgrounds[0],
    );
    gl.uniform3fv(
      uniformOf(gl, cutoutProgram, 'u_bg2'),
      backgrounds[2] || backgrounds[0],
    );
    gl.uniform3fv(
      uniformOf(gl, cutoutProgram, 'u_bg3'),
      backgrounds[3] || backgrounds[0],
    );
    gl.uniform1f(uniformOf(gl, cutoutProgram, 'u_bgCount'), backgrounds.length);
    gl.uniform1f(uniformOf(gl, cutoutProgram, 'u_strict'), tuning.strict);
    gl.uniform1f(uniformOf(gl, cutoutProgram, 'u_loose'), tuning.loose);
    gl.uniform1f(uniformOf(gl, cutoutProgram, 'u_exact'), tuning.exact);
    gl.uniform1f(uniformOf(gl, cutoutProgram, 'u_softness'), tuning.softness);
    gl.uniform1f(
      uniformOf(gl, cutoutProgram, 'u_useSourceAlpha'),
      cutoutEnabled && !preserveSourceAlpha ? 0 : 1,
    );
  };
  renderPass(ctx, cutoutProgram, bgness, width, height, bindCutoutUniforms);

  // 连通性分两级做。降采样层解决长距离问题（这块背景到底连不连到画布边缘），
  // 300+ 趟传播在 192² 上是毫秒级、放全分辨率完全跑不动；
  // 但降采样掩膜直接放大回去会把边界糊掉好几个像素，所以下面还要在全分辨率上精修。
  const floodScale = FLOOD_SIZE / Math.max(width, height);
  const floodW = Math.max(16, Math.round(width * floodScale));
  const floodH = Math.max(16, Math.round(height * floodScale));
  const floodBgness = track(createTexture(gl, floodW, floodH));
  renderPass(
    ctx,
    cutoutProgram,
    floodBgness,
    floodW,
    floodH,
    bindCutoutUniforms,
  );

  let outsideA = track(createTexture(gl, floodW, floodH));
  let outsideB = track(createTexture(gl, floodW, floodH));
  gl.bindFramebuffer(gl.FRAMEBUFFER, ctx.framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    outsideA,
    0,
  );
  gl.viewport(0, 0, floodW, floodH);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  let fullA = track(createTexture(gl, width, height));
  let fullB = track(createTexture(gl, width, height));
  if (cutoutEnabled && !preserveSourceAlpha) {
    for (let i = 0; i < FLOOD_PASSES; i += 1) {
      renderPass(
        ctx,
        ctx.programs.flood,
        outsideB,
        floodW,
        floodH,
        (setInt) => {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, outsideA);
          setInt('u_state', 0);
          gl.activeTexture(gl.TEXTURE1);
          gl.bindTexture(gl.TEXTURE_2D, floodBgness);
          setInt('u_bgness', 1);
          gl.uniform2f(
            uniformOf(gl, ctx.programs.flood, 'u_texel'),
            1 / floodW,
            1 / floodH,
          );
          gl.uniform1f(uniformOf(gl, ctx.programs.flood, 'u_channel'), 0);
        },
      );
      const swap = outsideA;
      outsideA = outsideB;
      outsideB = swap;
    }

    // 只把「确定是外部」的核心放大成种子，边界的几个像素故意留空
    renderPass(
      ctx,
      ctx.programs.seedUpscale,
      fullA,
      width,
      height,
      (setInt) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, outsideA);
        setInt('u_state', 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bgness);
        setInt('u_bgness', 1);
        gl.uniform1f(
          uniformOf(gl, ctx.programs.seedUpscale, 'u_holeFill'),
          tuning.holeFill,
        );
      },
    );
    // 再在全分辨率上做短程门控膨胀，把边界精确吸附到真实轮廓上。
    // 趟数只需覆盖降采样的放大倍率，代价很小，但边缘干净度提升是决定性的。
    const refinePasses = Math.ceil(1 / floodScale) + REFINE_MARGIN;
    // 前 refinePasses 趟走严格通道把边界吸附到真实轮廓；
    // 最后 FRINGE_PASSES 趟切到宽松通道，把紧贴背景的那圈抗锯齿残边一起关联进来。
    // 残边宽度随工作分辨率等比变宽，趟数固定的话大图就吃不干净
    const fringePasses = Math.max(
      FRINGE_PASSES,
      Math.round(FRINGE_PASSES * scale),
    );
    const totalPasses = refinePasses + fringePasses;
    for (let i = 0; i < totalPasses; i += 1) {
      const channel = i < refinePasses ? 0 : 1;
      renderPass(ctx, ctx.programs.flood, fullB, width, height, (setInt) => {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, fullA);
        setInt('u_state', 0);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, bgness);
        setInt('u_bgness', 1);
        gl.uniform2f(
          uniformOf(gl, ctx.programs.flood, 'u_texel'),
          1 / width,
          1 / height,
        );
        gl.uniform1f(uniformOf(gl, ctx.programs.flood, 'u_channel'), channel);
      });
      const swap = fullA;
      fullA = fullB;
      fullB = swap;
    }
  }

  renderPass(ctx, ctx.programs.resolve, matte, width, height, (setInt) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTexture);
    setInt('u_src', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bgness);
    setInt('u_bgness', 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, fullA);
    setInt('u_outside', 2);
    gl.uniform3fv(uniformOf(gl, ctx.programs.resolve, 'u_bg0'), backgrounds[0]);
    gl.uniform1f(
      uniformOf(gl, ctx.programs.resolve, 'u_despill'),
      tuning.despill,
    );
    gl.uniform1f(
      uniformOf(gl, ctx.programs.resolve, 'u_useSourceAlpha'),
      cutoutEnabled && !preserveSourceAlpha ? 0 : 1,
    );
  });

  // 边缘精修：平滑锯齿、按 choke 收边吃掉残留光晕、feather 控制软硬，并输出预乘 alpha
  renderPass(ctx, ctx.programs.refine, cut, width, height, (setInt) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, matte);
    setInt('u_matte', 0);
    gl.uniform2f(
      uniformOf(gl, ctx.programs.refine, 'u_texel'),
      1 / width,
      1 / height,
    );
    gl.uniform1f(uniformOf(gl, ctx.programs.refine, 'u_choke'), tuning.choke);
    gl.uniform1f(
      uniformOf(gl, ctx.programs.refine, 'u_feather'),
      tuning.feather,
    );
  });

  // JFA：log2(边长) 趟就能把每个像素指向最近的不透明种子，得到精确外部距离场
  let seedA = useNearest(gl, track(createTexture(gl, width, height)));
  let seedB = useNearest(gl, track(createTexture(gl, width, height)));
  renderPass(ctx, ctx.programs.jfaInit, seedA, width, height, (setInt) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cut);
    setInt('u_mask', 0);
    gl.uniform2f(uniformOf(gl, ctx.programs.jfaInit, 'u_size'), width, height);
    gl.uniform1f(uniformOf(gl, ctx.programs.jfaInit, 'u_threshold'), 0.5);
  });
  for (
    let step = Math.pow(2, Math.ceil(Math.log2(Math.max(width, height))) - 1);
    step >= 1;
    step /= 2
  ) {
    renderPass(ctx, ctx.programs.jfaStep, seedB, width, height, (setInt) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, seedA);
      setInt('u_seed', 0);
      gl.uniform2f(
        uniformOf(gl, ctx.programs.jfaStep, 'u_texel'),
        1 / width,
        1 / height,
      );
      gl.uniform2f(
        uniformOf(gl, ctx.programs.jfaStep, 'u_size'),
        width,
        height,
      );
      gl.uniform1f(uniformOf(gl, ctx.programs.jfaStep, 'u_step'), step);
    });
    const swap = seedA;
    seedA = seedB;
    seedB = swap;
  }

  ctx.canvas.width = width;
  ctx.canvas.height = height;
  const outlines = Array.isArray(effect?.outline) ? effect.outline : [];
  const outline1 = outlines[0] || {};
  const outline2 = outlines[1] || {};
  const shadow = effect?.shadow || {};
  const glow = effect?.glow || {};
  const program = ctx.programs.composite;
  renderPass(ctx, program, null, width, height, (setInt) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, cut);
    setInt('u_src', 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, seedA);
    setInt('u_seed', 1);
    gl.uniform2f(uniformOf(gl, program, 'u_size'), width, height);
    gl.uniform4f(
      uniformOf(gl, program, 'u_outline1'),
      (Number(outline1.width) || 0) * scale,
      outline1.opacity ?? 1,
      0,
      0,
    );
    gl.uniform3fv(
      uniformOf(gl, program, 'u_outline1Color'),
      parseColor(outline1.color, [1, 1, 1]),
    );
    gl.uniform4f(
      uniformOf(gl, program, 'u_outline2'),
      (Number(outline2.width) || 0) * scale,
      outline2.opacity ?? 1,
      0,
      0,
    );
    gl.uniform3fv(
      uniformOf(gl, program, 'u_outline2Color'),
      parseColor(outline2.color, [1, 1, 1]),
    );
    gl.uniform4f(
      uniformOf(gl, program, 'u_shadow'),
      (Number(shadow.spread) || 0) * scale,
      Math.max((Number(shadow.blur) || 0) * scale, 0.75),
      0,
      0,
    );
    gl.uniform4f(
      uniformOf(gl, program, 'u_shadowColor'),
      ...parseColor(shadow.color, [0.13, 0.13, 0.17]),
      Number(shadow.opacity) || 0,
    );
    // uv 的 y 轴朝上，预设里的 dy 按「向下为正」写，所以这里取负
    gl.uniform2f(
      uniformOf(gl, program, 'u_shadowOffset'),
      ((Number(shadow.dx) || 0) * scale) / width,
      -((Number(shadow.dy) || 0) * scale) / height,
    );
    gl.uniform4f(
      uniformOf(gl, program, 'u_glow'),
      (Number(glow.radius) || 0) * scale,
      Number(glow.strength) || 0,
      Number(glow.falloff) || 1.6,
      0,
    );
    gl.uniform3fv(
      uniformOf(gl, program, 'u_glowColor'),
      parseColor(glow.color, [1, 0.85, 0.24]),
    );
  });

  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  out.getContext('2d').drawImage(ctx.canvas, 0, 0);
  textures.forEach((texture) => gl.deleteTexture(texture));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return out;
};

/**
 * @description 跑一遍特效并输出 PNG dataURL，供画布图层直接当 src 使用（不走网络，导出无跨域问题）。
 * @keyword-cn 素材特效渲染
 * @keyword-en render effect to data url
 * @param {TexImageSource} source - 原始图像。
 * @param {object} effect - 特效配置。
 * @param {{ maxSize?: number }} [options] - 渲染选项。
 * @returns {string} PNG dataURL，失败时返回空串。
 */
export const renderEffectToDataUrl = (source, effect, options = {}) => {
  const canvas = renderImageEffect(source, effect, options);
  return canvas ? canvas.toDataURL('image/png') : '';
};

/**
 * @description 把 File / Blob / URL 解码成可上传给 GPU 的位图。
 * @keyword-cn 图像解码
 * @keyword-en decode image source
 * @param {File|Blob|string} input - 文件或图片地址。
 * @returns {Promise<ImageBitmap|HTMLImageElement>} 解码后的图像。
 */
export const decodeImageSource = async (input) => {
  if (typeof input !== 'string') return createImageBitmap(input);
  const image = new Image();
  image.crossOrigin = 'anonymous';
  image.src = input;
  await image.decode();
  return image;
};
