// cube_js_loader_test.js - 验证 Lument.Cube JS 端加载器与数学
require('../runtime/js/lument.js');
const C = globalThis.Lument.Cube;
let fail = 0;
function check(c,m){ if(!c){ console.log('  [FAIL] '+m); fail++; } else console.log('  [ ok ] '+m); }

console.log('=== Lument.Cube JS 加载器测试 ===');
console.log('VERSION=', globalThis.Lument.VERSION, 'EDITION=', globalThis.Lument.EDITION);

// 图元
const box = C.createBox(2,2,2);
check(box.positions.length===24*3, 'box 顶点数=24');
check(box.indices.length===36, 'box 索引数=36');
const sph = C.createSphere(1,8);
check(sph.positions.length===(8+1)*(8+1)*3, 'sphere(8) 顶点数=81');
check(sph.indices.length===8*8*6, 'sphere(8) 索引数=384');

// 数学
const I = C.math.M4.identity();
check(I[0]===1 && I[15]===1, '单位矩阵');
const P = C.math.M4.perspective(60,1.5,0.1,100);
check(P[11]===-1, '透视 m[11]=-1');
const eye=[0,0,5], ctr=[0,0,0], up=[0,1,0];
const V = C.math.M4.lookAt(eye,ctr,up);
check(V[14]<0, 'lookAt 后退 z<0');

// OBJ
const obj = "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
const o = C.parseOBJ(obj);
check(o.positions.length===9 && o.indices.length===3, 'OBJ 顶点=3 索引=3');

// STL 二进制
const dv = new DataView(new ArrayBuffer(84+50));
dv.setUint32(80, 1, true);
const tri = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,0]);
new Float32Array(dv.buffer, 84, 12).set(tri);
const stl = C.parseSTL(dv.buffer);
check(stl.positions.length===9 && stl.indices.length===3, 'STL 顶点=9float 索引=3');

// PLY ascii
const ply = "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n";
const pl = C.parsePLY(ply);
check(pl.positions.length===9 && pl.indices.length===3, 'PLY 顶点=3 索引=3');

// glTF（内嵌 data URI）
function b64(bytes){ let s=''; for(const b of bytes) s+=String.fromCharCode(b); return btoa(s); }
const bin = [];
const pos=[0,0,0,1,0,0,0,1,0]; for(const f of pos){ const a=new Float32Array([f]); new Uint8Array(a.buffer).forEach(x=>bin.push(x)); }
const idx=[0,1,2]; for(const u of idx){ const a=new Uint16Array([u]); new Uint8Array(a.buffer).forEach(x=>bin.push(x)); }
const uri = "data:application/octet-stream;base64,"+b64(bin);
const gltf = { asset:{version:"2.0"}, buffers:[{byteLength:bin.length,uri}],
  bufferViews:[{buffer:0,byteOffset:0,byteLength:36},{buffer:0,byteOffset:36,byteLength:6}],
  accessors:[{bufferView:0,componentType:5126,count:3,type:"VEC3"},{bufferView:1,componentType:5123,count:3,type:"SCALAR"}],
  meshes:[{primitives:[{attributes:{POSITION:0},indices:1}]}] };
const g = C.parseGLTF(gltf, null, null);
check(g.meshes.length===1 && g.meshes[0].positions.length===9 && g.meshes[0].indices.length===3, 'glTF 顶点=3 索引=3');

console.log('\n=== 结果: '+(fail===0?'全部通过':fail+' 项失败')+' ===');
process.exit(fail===0?0:1);
