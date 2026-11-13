/* WebGL atmosphere: a slow nebula with topographic contours, tinted by where the camera is on the map. */
(function () {
  const canvas = document.getElementById('gl');
  const api = { setCamera() {}, setWarm() {}, ok: false };
  window.WORLD_GL = api;
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) { document.body.classList.add('no-gl'); return; }

  const vs = 'attribute vec2 a; void main(){ gl_Position = vec4(a, 0.0, 1.0); }';
  const fs = `
precision highp float;
uniform vec2 u_res;
uniform float u_time;
uniform vec2 u_cam;
uniform float u_warm;
uniform float u_dpr;
uniform float u_zoom;

float hash(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  float a = hash(i), b = hash(i+vec2(1,0)), c = hash(i+vec2(0,1)), d = hash(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float fbm(vec2 p){
  float v = 0.0, a = 0.5;
  mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 5; i++){ v += a*noise(p); p = r*p*2.05 + 11.3; a *= 0.5; }
  return v;
}
void main(){
  vec2 px = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_dpr;
  vec2 res = u_res / u_dpr;
  vec2 world = u_cam + (px - 0.5*res) / u_zoom;
  vec2 p = (px - 0.5*res) / res.y;

  vec2 wp = world * 0.00075;
  float t = u_time * 0.018;
  vec2 q = vec2(fbm(wp + t), fbm(wp + vec2(5.2, 1.3) - t));
  float n = fbm(wp + 1.6*q + vec2(t*0.5, 0.0));

  vec3 deep  = vec3(0.055, 0.070, 0.105);
  vec3 blue  = vec3(0.110, 0.230, 0.380);
  vec3 ember = vec3(0.330, 0.190, 0.095);
  float warm = clamp(u_warm, 0.0, 1.0);
  vec3 tint = mix(blue, ember, warm);

  float glow = exp(-dot(p, p) * 2.6);
  vec3 col = mix(deep, tint, smoothstep(0.25, 0.85, n) * (0.35 + 0.75*glow));
  col += tint * glow * 0.22;

  float levels = n * 9.0;
  float line = abs(fract(levels) - 0.5);
  float contour = 1.0 - smoothstep(0.0, 0.035, line);
  col += vec3(0.75, 0.82, 0.9) * contour * 0.035 * (0.4 + glow);

  vec2 sp = world * 0.045;
  vec2 si = floor(sp), sf = fract(sp) - 0.5;
  float h = hash(si);
  float star = step(0.985, h) * smoothstep(0.08, 0.0, length(sf - (vec2(hash(si+3.1), hash(si+7.7)) - 0.5)*0.6));
  float tw = 0.6 + 0.4*sin(u_time*(1.0 + h*2.0) + h*40.0);
  col += vec3(0.85, 0.9, 1.0) * star * tw * 0.55;

  float vig = smoothstep(1.25, 0.35, length(p * vec2(0.85, 1.0)));
  col *= 0.55 + 0.45*vig;

  gl_FragColor = vec4(col, 1.0);
}`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn(gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  const prog = gl.createProgram();
  const v = compile(gl.VERTEX_SHADER, vs);
  const f = compile(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) { document.body.classList.add('no-gl'); return; }
  gl.attachShader(prog, v); gl.attachShader(prog, f); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); document.body.classList.add('no-gl'); return; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {
    res: gl.getUniformLocation(prog, 'u_res'),
    time: gl.getUniformLocation(prog, 'u_time'),
    cam: gl.getUniformLocation(prog, 'u_cam'),
    warm: gl.getUniformLocation(prog, 'u_warm'),
    dpr: gl.getUniformLocation(prog, 'u_dpr'),
    zoom: gl.getUniformLocation(prog, 'u_zoom')
  };

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700;
  const dpr = Math.min(window.devicePixelRatio || 1, small ? 1 : 1.5);
  let cam = [1400, 1000], warm = 0, running = true, zoom = 1;
  const start = performance.now();

  function resize() {
    const w = Math.floor(window.innerWidth * dpr), h = Math.floor(window.innerHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  }
  function frame(now) {
    if (running) {
      resize();
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform1f(U.time, reduce ? 0 : (now - start) / 1000);
      gl.uniform2f(U.cam, cam[0], cam[1]);
      gl.uniform1f(U.warm, warm);
      gl.uniform1f(U.dpr, dpr);
      gl.uniform1f(U.zoom, zoom);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', () => { running = !document.hidden; });
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);

  api.ok = true;
  api.setCamera = (x, y, z) => { cam = [x, y]; zoom = z || 1; };
  api.setWarm = (w) => { warm = w; };
})();
