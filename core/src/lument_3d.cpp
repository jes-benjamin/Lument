// ============================================================
// lument_3d.cpp - Lument Cube 3D 子系统
// ------------------------------------------------------------
// 实现 Lument Cube 3D C ABI：
//   - 3D 数学（向量/矩阵/四元数）
//   - 网格 / 材质 / 模型 管理
//   - 原生模型加载器：glTF 2.0(.gltf/.glb)、OBJ、STL、PLY、DAE
//   - 可选 Assimp 集成：FBX；Blender CLI 桥接：.blend
//   - 3D 场景图（节点变换层级）
//   - 3D 光照（方向/点/聚光 + 环境光）
//   - 3D 渲染：GLES2/WebGL 后端真实绘制，其余后端为安全 no-op
//
// 设计：全部 3D 数据结构零第三方依赖；模型加载器纯 C++ 实现；
// 渲染在无 GPU 后端（Null）下不绘制但 API 仍可用（便于无头测试）。
// ============================================================
#include "lument_internal.h"

#include <cmath>
#include <string>
#include <vector>
#include <unordered_map>
#include <cstring>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>

// ============================================================
// 1. 轻量 JSON 解析器（供 glTF 使用）
// ============================================================
namespace json {
struct Value;
using Object = std::unordered_map<std::string, Value>;
using Array = std::vector<Value>;

struct Value {
    enum Type { Null, Bool, Num, Str, Arr, Obj } type = Null;
    bool        b = false;
    double      n = 0.0;
    std::string s;
    Array       a;
    Object      o;

    bool        asBool(bool d=false) const { return type==Bool ? b : d; }
    double      asNum(double d=0.0) const { return type==Num ? n : d; }
    int         asInt(int d=0) const { return type==Num ? (int)n : d; }
    const std::string& asStr() const { static std::string empty; return type==Str ? s : empty; }
    const Array&  asArr() const { static Array empty; return type==Arr ? a : empty; }
    const Object& asObj() const { static Object empty; return type==Obj ? o : empty; }
    const Value& operator[](const std::string& k) const { static Value empty; auto it=o.find(k); return it==o.end()?empty:it->second; }
    const Value& operator[](size_t i) const { static Value empty; return (i<a.size())?a[i]:empty; }
    bool isNull() const { return type==Null; }
};

struct Parser {
    const char* p; const char* end;
    Value parse(const std::string& src) {
        p = src.c_str(); end = p + src.size();
        skipWs();
        Value v = parseValue();
        return v;
    }
    void skipWs() { while (p<end && (*p==' '||*p=='\t'||*p=='\n'||*p=='\r'||*p==','||*p==':')) ++p; }
    char peek() { return p<end?*p:'\0'; }
    Value parseValue() {
        skipWs();
        if (p>=end) return Value{};
        char c=*p;
        if (c=='{') return parseObject();
        if (c=='[') return parseArray();
        if (c=='"') { Value v; v.type=Value::Str; v.s=parseString(); return v; }
        if (c=='t'||c=='f') { Value v; v.type=Value::Bool; v.b=(c=='t'); p+= (c=='t'?4:5); return v; }
        if (c=='n') { p+=4; return Value{}; }
        if (c=='-'||(c>='0'&&c<='9')) { Value v; v.type=Value::Num; v.n=parseNumber(); return v; }
        ++p; return Value{};
    }
    Value parseObject() {
        Value v; v.type=Value::Obj; ++p; skipWs();
        while (p<end && *p!='}') {
            skipWs();
            if (*p!='"') { ++p; continue; }
            std::string key = parseString();
            skipWs(); if (*p==':') ++p; skipWs();
            v.o[key] = parseValue();
            skipWs();
        }
        if (*p=='}') ++p;
        return v;
    }
    Value parseArray() {
        Value v; v.type=Value::Arr; ++p; skipWs();
        while (p<end && *p!=']') {
            v.a.push_back(parseValue());
            skipWs();
        }
        if (*p==']') ++p;
        return v;
    }
    std::string parseString() {
        std::string out; ++p; // skip "
        while (p<end && *p!='"') {
            if (*p=='\\') {
                ++p;
                switch (*p) {
                    case 'n': out+='\n'; break;
                    case 't': out+='\t'; break;
                    case 'r': out+='\r'; break;
                    case '"': out+='"'; break;
                    case '\\': out+='\\'; break;
                    case '/': out+='/'; break;
                    case 'u': {
                        ++p;
                        int code=0;
                        for (int i=0;i<4 && p<end;++i,++p){ char ch=*p; int d= (ch>='0'&&ch<='9')?ch-'0':(ch>='a'&&ch<='f')?ch-'a'+10:(ch>='A'&&ch<='F')?ch-'A'+10:0; code=code*16+d; }
                        // 简化：仅处理 BMP 基本平面
                        out += (char)code;
                        break;
                    }
                    default: out+=*p; break;
                }
                ++p;
            } else { out+=*p; ++p; }
        }
        if (*p=='"') ++p;
        return out;
    }
    double parseNumber() {
        const char* start=p;
        while (p<end && ((*p>='0'&&*p<='9')||*p=='.'||*p=='-'||*p=='+'||*p=='e'||*p=='E')) ++p;
        return std::atof(std::string(start,p).c_str());
    }
};
} // namespace json

// ============================================================
// 2. 3D 数学（内部实现）
// ============================================================
namespace math3d {
inline void v3normalize(float* v){ float l=std::sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]); if(l>1e-8f){v[0]/=l;v[1]/=l;v[2]/=l;} }
inline void cross(const float* a,const float* b,float* out){
    out[0]=a[1]*b[2]-a[2]*b[1]; out[1]=a[2]*b[0]-a[0]*b[2]; out[2]=a[0]*b[1]-a[1]*b[0];
}
inline float dot(const float* a,const float* b){ return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }

void mat4_identity(float* m){ std::memset(m,0,16*sizeof(float)); m[0]=m[5]=m[10]=m[15]=1.0f; }
void mat4_perspective(float* m,float fovYDeg,float aspect,float nearP,float farP){
    std::memset(m,0,16*sizeof(float));
    float f=1.0f/std::tan((fovYDeg*3.14159265f/180.0f)*0.5f);
    m[0]=f/aspect; m[5]=f; m[10]=(farP+nearP)/(nearP-farP); m[11]=-1.0f;
    m[14]=(2.0f*farP*nearP)/(nearP-farP);
}
void mat4_look_at(float* m,const float* eye,const float* center,const float* up){
    float z[3]={eye[0]-center[0],eye[1]-center[1],eye[2]-center[2]}; v3normalize(z);
    float x[3],y[3]; cross(up,z,x); v3normalize(x); cross(z,x,y);
    m[0]=x[0]; m[1]=y[0]; m[2]=z[0]; m[3]=0.0f;
    m[4]=x[1]; m[5]=y[1]; m[6]=z[1]; m[7]=0.0f;
    m[8]=x[2]; m[9]=y[2]; m[10]=z[2]; m[11]=0.0f;
    m[12]=-dot(x,eye); m[13]=-dot(y,eye); m[14]=-dot(z,eye); m[15]=1.0f;
}
void mat4_mul(float* out,const float* a,const float* b){
    float r[16];
    for(int c=0;c<4;++c) for(int row=0;row<4;++row){
        float s=0.0f;
        for(int k=0;k<4;++k) s+=a[k*4+row]*b[c*4+k];
        r[c*4+row]=s;
    }
    std::memcpy(out,r,16*sizeof(float));
}
void mat4_transpose(float* m){ float r[16]; for(int i=0;i<16;++i){ int r2=i/4,c2=i%4; r[i]=m[c2*4+r2]; } std::memcpy(m,r,16*sizeof(float)); }
void mat4_invert(float* m){
    float inv[16];
    inv[0]= m[5]*m[10]*m[15]-m[5]*m[11]*m[14]-m[9]*m[6]*m[15]+m[9]*m[7]*m[14]+m[13]*m[6]*m[11]-m[13]*m[7]*m[10];
    inv[4]=-m[4]*m[10]*m[15]+m[4]*m[11]*m[14]+m[8]*m[6]*m[15]-m[8]*m[7]*m[14]-m[12]*m[6]*m[11]+m[12]*m[7]*m[10];
    inv[8]= m[4]*m[9]*m[15]-m[4]*m[11]*m[13]-m[8]*m[5]*m[15]+m[8]*m[7]*m[13]+m[12]*m[5]*m[11]-m[12]*m[7]*m[9];
    inv[12]=-m[4]*m[9]*m[14]+m[4]*m[10]*m[13]+m[8]*m[5]*m[14]-m[8]*m[6]*m[13]-m[12]*m[5]*m[10]+m[12]*m[6]*m[9];
    inv[1]=-m[1]*m[10]*m[15]+m[1]*m[11]*m[14]+m[9]*m[2]*m[15]-m[9]*m[3]*m[14]-m[13]*m[2]*m[11]+m[13]*m[3]*m[10];
    inv[5]= m[0]*m[10]*m[15]-m[0]*m[11]*m[14]-m[8]*m[2]*m[15]+m[8]*m[3]*m[14]+m[12]*m[2]*m[11]-m[12]*m[3]*m[10];
    inv[9]=-m[0]*m[9]*m[15]+m[0]*m[11]*m[13]+m[8]*m[1]*m[15]-m[8]*m[3]*m[13]-m[12]*m[1]*m[11]+m[12]*m[3]*m[9];
    inv[13]= m[0]*m[9]*m[14]-m[0]*m[10]*m[13]-m[8]*m[1]*m[14]+m[8]*m[2]*m[13]+m[12]*m[1]*m[10]-m[12]*m[2]*m[9];
    inv[2]= m[1]*m[6]*m[15]-m[1]*m[7]*m[14]-m[5]*m[2]*m[15]+m[5]*m[3]*m[14]+m[13]*m[2]*m[7]-m[13]*m[3]*m[6];
    inv[6]=-m[0]*m[6]*m[15]+m[0]*m[7]*m[14]+m[4]*m[2]*m[15]-m[4]*m[3]*m[14]-m[12]*m[2]*m[7]+m[12]*m[3]*m[6];
    inv[10]= m[0]*m[5]*m[15]-m[0]*m[7]*m[13]-m[4]*m[1]*m[15]+m[4]*m[3]*m[13]+m[12]*m[1]*m[7]-m[12]*m[3]*m[5];
    inv[14]=-m[0]*m[5]*m[14]+m[0]*m[6]*m[13]+m[4]*m[1]*m[14]-m[4]*m[2]*m[13]-m[12]*m[1]*m[6]+m[12]*m[2]*m[5];
    inv[3]=-m[1]*m[6]*m[11]+m[1]*m[7]*m[10]+m[5]*m[2]*m[11]-m[5]*m[3]*m[10]-m[9]*m[2]*m[7]+m[9]*m[3]*m[6];
    inv[7]= m[0]*m[6]*m[11]-m[0]*m[7]*m[10]-m[4]*m[2]*m[11]+m[4]*m[3]*m[10]+m[8]*m[2]*m[7]-m[8]*m[3]*m[6];
    inv[11]=-m[0]*m[5]*m[11]+m[0]*m[7]*m[9]+m[4]*m[1]*m[11]-m[4]*m[3]*m[9]-m[8]*m[1]*m[7]+m[8]*m[3]*m[5];
    inv[15]= m[0]*m[5]*m[10]-m[0]*m[6]*m[9]-m[4]*m[1]*m[10]+m[4]*m[2]*m[9]+m[8]*m[1]*m[6]-m[8]*m[2]*m[5];
    float det=m[0]*inv[0]+m[1]*inv[4]+m[2]*inv[8]+m[3]*inv[12];
    if(std::fabs(det)<1e-12f){ mat4_identity(m); return; }
    float id=1.0f/det;
    for(int i=0;i<16;++i) m[i]=inv[i]*id;
}
void mat4_ortho(float* m,float l,float r,float b,float t,float n,float f){
    std::memset(m,0,16*sizeof(float));
    m[0]=2.0f/(r-l); m[5]=2.0f/(t-b); m[10]=-2.0f/(f-n);
    m[12]=-(r+l)/(r-l); m[13]=-(t+b)/(t-b); m[14]=-(f+n)/(f-n); m[15]=1.0f;
}
void quat_from_euler(float* q,float pitchDeg,float yawDeg,float rollDeg){
    float p=pitchDeg*3.14159265f/180.0f, y=yawDeg*3.14159265f/180.0f, r=rollDeg*3.14159265f/180.0f;
    float sp=std::sin(p*0.5f),cp=std::cos(p*0.5f);
    float sy=std::sin(y*0.5f),cy=std::cos(y*0.5f);
    float sr=std::sin(r*0.5f),cr=std::cos(r*0.5f);
    // 逐轴四元数：绕 X=pitch, 绕 Y=yaw, 绕 Z=roll
    float qp[4]={sp,0,0,cp};
    float qy[4]={0,sy,0,cy};
    float qr[4]={0,0,sr,cr};
    auto mul=[&](const float* a,const float* b,float* o){
        o[0]=a[3]*b[0]+a[0]*b[3]+a[1]*b[2]-a[2]*b[1];
        o[1]=a[3]*b[1]-a[0]*b[2]+a[1]*b[3]+a[2]*b[0];
        o[2]=a[3]*b[2]+a[0]*b[1]-a[1]*b[0]+a[2]*b[3];
        o[3]=a[3]*b[3]-a[0]*b[0]-a[1]*b[1]-a[2]*b[2];
    };
    float t[4]; mul(qp,qr,t);   // pitch * roll
    mul(qy,t,q);                // yaw * (pitch*roll)
}
void quat_normalize(float* q){ float l=std::sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]); if(l>1e-8f){q[0]/=l;q[1]/=l;q[2]/=l;q[3]/=l;} }
// 从四元数构建列主序旋转矩阵（3x3 + 平移占位）
void quat_to_mat3(const float* q,float* m3){
    float x=q[0],y=q[1],z=q[2],w=q[3];
    float xx=x*x,yy=y*y,zz=z*z,xy=x*y,xz=x*z,yz=y*z,wx=w*x,wy=w*y,wz=w*z;
    m3[0]=1-2*(yy+zz); m3[1]=2*(xy+wz);   m3[2]=2*(xz-wy);
    m3[3]=2*(xy-wz);   m3[4]=1-2*(xx+zz); m3[5]=2*(yz+wx);
    m3[6]=2*(xz+wy);   m3[7]=2*(yz-wx);   m3[8]=1-2*(xx+yy);
}
} // namespace math3d

// ============================================================
// 3. 数据结构与句柄池
// ============================================================
namespace {

struct MeshData {
    std::vector<float>  positions;
    std::vector<float>  normals;
    std::vector<float>  uvs;       // 2/顶点
    std::vector<uint32_t> indices;
    LumentAABB          bounds = { {1e30f,1e30f,1e30f},{-1e30f,-1e30f,-1e30f} };
    bool                hasNormals=false;
    bool                hasUVs=false;
    // GL 资源（仅 GLES2 后端使用）
    unsigned int vboPos=0, vboNrm=0, vboUV=0, ibo=0;
    unsigned int wireIbo=0;            // 线框边索引缓冲
    unsigned int wireCount=0;          // 线框边数量
    bool         gpuUploaded=false;
};

struct MaterialData { LumentCubeMaterial desc; };

struct ModelData {
    std::vector<LumentMesh>     meshes;
    std::vector<LumentMaterial> materials;
    LumentAABB                  bounds = { {1e30f,1e30f,1e30f},{-1e30f,-1e30f,-1e30f} };
    bool ready=true;
};

struct NodeData {
    float pos[3]={0,0,0};
    float rot[4]={0,0,0,1};
    float scl[3]={1,1,1};
    float worldPos[3]={0,0,0};
    float worldMat[16];
    LumentAABB worldBounds = { {1e30f,1e30f,1e30f},{-1e30f,-1e30f,-1e30f} };
    LumentMesh mesh=0;
    LumentMaterial material=0;
    LumentModel model=0;
    bool visible=true;
    int parent=-1;
    std::vector<int> children;
};

template<typename T>
struct Pool {
    std::vector<T> items;
    std::vector<int> free;
    uint32_t alloc(){ if(!free.empty()){ int i=free.back(); free.pop_back(); items[i]=T(); return (uint32_t)(i+1);} items.push_back(T()); return (uint32_t)items.size(); }
    T* get(uint32_t h){ int i=(int)h-1; if(h==0||i<0||(size_t)i>=items.size()) return nullptr; return &items[i]; }
    void release(uint32_t h){ int i=(int)h-1; if(h==0||i<0||(size_t)i>=items.size()) return; items[i]=T(); free.push_back(i); }
};

Pool<MeshData>     g_meshes;
Pool<MaterialData> g_materials;
Pool<ModelData>    g_models;
Pool<NodeData>     g_nodes;
// 摄像机单独存放
struct CamData { LumentCamera3D desc; float view[16]; float proj[16]; };
Pool<CamData>     g_cameras;

std::vector<int>  g_sceneRoots;
LumentColor       g_bg = {15,15,30,255};

// 光照
struct LightData { LumentCubeLightType type; float posOrDir[3]; LumentColor color; float intensity; float range; };
std::vector<LightData> g_lights;
float g_ambientColor[3]={0.15f,0.15f,0.15f}; float g_ambientI=1.0f;

bool g_cubeInit=false;
bool g_wireframe=false;          // 线框渲染全局开关
int  g_cullTotal=0, g_cullVisible=0;  // 上一帧视锥剔除统计

// ---------- 工具 ----------
bool read_file(const std::string& path,std::vector<uint8_t>& out){
    std::ifstream f(path,std::ios::binary);
    if(!f) return false;
    f.seekg(0,std::ios::end); std::streamoff sz=f.tellg(); f.seekg(0,std::ios::beg);
    if(sz<0) return false;
    out.resize((size_t)sz); if(sz>0) f.read((char*)out.data(),sz);
    return true;
}

// 计算包围盒
void compute_bounds(MeshData* m){
    m->bounds.min={1e30f,1e30f,1e30f}; m->bounds.max={-1e30f,-1e30f,-1e30f};
    const float* p=m->positions.data(); size_t n=m->positions.size()/3;
    for(size_t i=0;i<n;++i){
        for(int c=0;c<3;++c){
            float v=p[i*3+c];
            if(c==0){ if(v<m->bounds.min.x) m->bounds.min.x=v; if(v>m->bounds.max.x) m->bounds.max.x=v; }
            else if(c==1){ if(v<m->bounds.min.y) m->bounds.min.y=v; if(v>m->bounds.max.y) m->bounds.max.y=v; }
            else { if(v<m->bounds.min.z) m->bounds.min.z=v; if(v>m->bounds.max.z) m->bounds.max.z=v; }
        }
    }
}

void merge_bounds(LumentAABB* dst,const LumentAABB& a){
    if(a.min.x<dst->min.x) dst->min.x=a.min.x;
    if(a.min.y<dst->min.y) dst->min.y=a.min.y;
    if(a.min.z<dst->min.z) dst->min.z=a.min.z;
    if(a.max.x>dst->max.x) dst->max.x=a.max.x;
    if(a.max.y>dst->max.y) dst->max.y=a.max.y;
    if(a.max.z>dst->max.z) dst->max.z=a.max.z;
}

LumentCubeFormat detect_format(const std::string& path){
    size_t dot=path.find_last_of('.');
    if(dot==std::string::npos) return LUMENT_CUBE_FORMAT_UNKNOWN;
    std::string ext=path.substr(dot+1);
    for(auto& c:ext) c=(char)std::tolower((unsigned char)c);
    if(ext=="gltf") return LUMENT_CUBE_FORMAT_GLTF;
    if(ext=="glb")  return LUMENT_CUBE_FORMAT_GLB;
    if(ext=="obj")  return LUMENT_CUBE_FORMAT_OBJ;
    if(ext=="stl")  return LUMENT_CUBE_FORMAT_STL;
    if(ext=="ply")  return LUMENT_CUBE_FORMAT_PLY;
    if(ext=="dae"||ext=="collada") return LUMENT_CUBE_FORMAT_DAE;
    if(ext=="fbx")  return LUMENT_CUBE_FORMAT_FBX;
    if(ext=="blend")return LUMENT_CUBE_FORMAT_BLEND;
    return LUMENT_CUBE_FORMAT_UNKNOWN;
}

// base64 解码（glTF data URI）
std::vector<uint8_t> base64_decode(const std::string& in){
    static const int tbl[256]={
        -1}; // 简单实现
    auto b64val=[&](char c)->int{
        if(c>='A'&&c<='Z') return c-'A';
        if(c>='a'&&c<='z') return c-'a'+26;
        if(c>='0'&&c<='9') return c-'0'+52;
        if(c=='+') return 62; if(c=='/') return 63; return -1;
    };
    std::vector<uint8_t> out; out.reserve(in.size()*3/4);
    int buf=0,bits=0;
    for(char c:in){ if(c=='='||c==' '||c=='\n'||c=='\r'||c=='\t') continue; int v=b64val(c); if(v<0) continue; buf=(buf<<6)|v; bits+=6; if(bits>=8){ bits-=8; out.push_back((uint8_t)((buf>>bits)&0xFF)); } }
    return out;
}

std::string data_uri_to_bytes(const std::string& uri,std::vector<uint8_t>& out){
    // 返回 mime 类型（可选）。仅处理 data:...
    if(uri.rfind("data:",0)!=0) return "";
    size_t comma=uri.find(','); if(comma==std::string::npos) return "";
    std::string meta=uri.substr(5,comma-5);
    std::string data=uri.substr(comma+1);
    bool base64 = meta.find("base64")!=std::string::npos;
    if(base64) out=base64_decode(data);
    else { out.assign(data.begin(),data.end()); } // 非 base64 简化处理
    return meta;
}

} // namespace

// ============================================================
// 4. 模型加载器（纯 C++，无第三方依赖）
// ============================================================
namespace {

// 通用：把解析结果写入 ModelData
void finalize_model(ModelData* md){
    md->bounds={ {1e30f,1e30f,1e30f},{-1e30f,-1e30f,-1e30f} };
    for(uint32_t h:md->meshes){ MeshData* m=g_meshes.get(h); if(m) merge_bounds(&md->bounds,m->bounds); }
}

// ---- OBJ ----
ModelData* load_obj(const std::vector<uint8_t>& data,const std::string& baseDir){
    std::string text((const char*)data.data(),data.size());
    std::istringstream ss(text);
    std::vector<float> v,pn; // positions (v) and parsed normals? 简化：分别存
    std::vector<float> verts;     // v
    std::vector<float> norms;     // vn
    std::vector<float> uvs;       // vt
    // 当前组构建
    std::vector<float> positions, normals, uvsOut;
    std::vector<uint32_t> indices;
    auto addVertex=[&](int vi,int ti,int ni)->uint32_t{
        // vi/ti/ni 为 1-based（可为负表示相对）；这里仅支持正数与绝对值
        vi=std::abs(vi); ti=std::abs(ti); ni=std::abs(ni);
        float x=verts[(vi-1)*3+0], y=verts[(vi-1)*3+1], z=verts[(vi-1)*3+2];
        float nx=0,ny=0,nz=0, u=0,vv=0;
        if(ni>0 && (size_t)(ni-1)*3<norms.size()){ nx=norms[(ni-1)*3+0];ny=norms[(ni-1)*3+1];nz=norms[(ni-1)*3+2]; }
        if(ti>0 && (size_t)(ti-1)*2<uvs.size()){ u=uvs[(ti-1)*2+0]; vv=uvs[(ti-1)*2+1]; }
        uint32_t idx=(uint32_t)(positions.size()/3);
        positions.push_back(x);positions.push_back(y);positions.push_back(z);
        normals.push_back(nx);normals.push_back(ny);normals.push_back(nz);
        uvsOut.push_back(u);uvsOut.push_back(vv);
        return idx;
    };
    std::string line;
    uint32_t meshH=0; MaterialData* mat=nullptr; LumentMaterial matH=0;
    auto flushMesh=[&](){
        if(positions.empty()) return;
        uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
        m->positions=std::move(positions); m->normals=std::move(normals); m->uvs=std::move(uvsOut);
        m->hasNormals=true; m->hasUVs=true; m->indices=std::move(indices);
        compute_bounds(m);
    };
    while(std::getline(ss,line)){
        if(line.empty()||line[0]=='#') continue;
        std::istringstream ls(line); std::string tag; ls>>tag;
        if(tag=="v"){ float x,y,z; ls>>x>>y>>z; verts.push_back(x);verts.push_back(y);verts.push_back(z); }
        else if(tag=="vn"){ float x,y,z; ls>>x>>y>>z; norms.push_back(x);norms.push_back(y);norms.push_back(z); }
        else if(tag=="vt"){ float u,vv; ls>>u>>vv; uvs.push_back(u);uvs.push_back(vv); }
        else if(tag=="f"){
            std::vector<uint32_t> face; std::string tok;
            while(ls>>tok){
                int vi=0,ti=0,ni=0;
                // 解析 v/vt/vn
                size_t s1=tok.find('/'); size_t s2=tok.find('/',s1+1);
                if(s1==std::string::npos){ vi=std::atoi(tok.c_str()); }
                else {
                    vi=std::atoi(tok.substr(0,s1).c_str());
                    if(s2==std::string::npos) ti=std::atoi(tok.substr(s1+1).c_str());
                    else { ti=std::atoi(tok.substr(s1+1,s2-s1-1).c_str()); ni=std::atoi(tok.substr(s2+1).c_str()); }
                }
                face.push_back(addVertex(vi,ti,ni));
            }
            // 三角扇化
            for(size_t i=1;i+1<face.size();++i){ indices.push_back(face[0]); indices.push_back(face[i]); indices.push_back(face[i+1]); }
        }
        else if(tag=="usemtl"){
            // 暂不强绑定材质；保持当前网格继续。
        }
    }
    if(positions.empty()){ // 没用 f 触发生成
        uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
        m->positions=std::move(positions); m->normals=std::move(normals); m->uvs=std::move(uvsOut);
        m->indices=std::move(indices); compute_bounds(m);
        meshH=h;
    } else {
        uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
        m->positions=std::move(positions); m->normals=std::move(normals); m->uvs=std::move(uvsOut);
        m->hasNormals=true; m->hasUVs=true; m->indices=std::move(indices); compute_bounds(m);
        meshH=h;
    }
    if(meshH==0) return nullptr;
    ModelData* md=new ModelData();
    md->meshes.push_back(meshH);
    // 默认材质（白）
    LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat)); dmat.baseColor={255,255,255,255}; dmat.albedoMap=0; dmat.metallic=0; dmat.roughness=0.8f; dmat.opacity=1; dmat.doubleSided=false; dmat.emissive[0]=dmat.emissive[1]=dmat.emissive[2]=0;
    matH=g_materials.alloc(); g_materials.get(matH)->desc=dmat;
    md->materials.push_back(matH);
    finalize_model(md);
    return md;
}

// ---- STL（ASCII / 二进制）----
ModelData* load_stl(const std::vector<uint8_t>& data){
    // 启发式：若以 "solid" 开头且为 ASCII（简单判断）
    bool ascii=false;
    if(data.size()>5){
        std::string head((const char*)data.data(), std::min<size_t>(data.size(),5));
        if(head=="solid") ascii=true;
    }
    std::vector<float> positions; std::vector<uint32_t> indices;
    if(ascii){
        std::string text((const char*)data.data(),data.size());
        std::istringstream ss(text); std::string w; float nx,ny,nz;
        std::vector<float> tri(9);
        int idx=0;
        while(ss>>w){
            if(w=="facet"){ ss>>w; ss>>nx>>ny>>nz; }
            else if(w=="vertex"){ float x,y,z; ss>>x>>y>>z; tri[idx*3+0]=x;tri[idx*3+1]=y;tri[idx*3+2]=z; ++idx; if(idx==3){ for(int k=0;k<3;++k){ positions.push_back(tri[k*3+0]);positions.push_back(tri[k*3+1]);positions.push_back(tri[k*3+2]); } indices.push_back((uint32_t)(positions.size()/3-3));indices.push_back((uint32_t)(positions.size()/3-2));indices.push_back((uint32_t)(positions.size()/3-1)); idx=0; } }
        }
    } else {
        if(data.size()<84) return nullptr;
        uint32_t n=(uint32_t)data[80]|((uint32_t)data[81]<<8)|((uint32_t)data[82]<<16)|((uint32_t)data[83]<<24);
        size_t off=84; const size_t rec=50;
        for(uint32_t i=0;i<n && off+rec<=data.size();++i){
            // 跳过法线(12)+顶点(36)+attr(2)
            for(int v=0;v<3;++v){
                size_t bp=off+12+v*12;
                float x,y,z; std::memcpy(&x,data.data()+bp,4); std::memcpy(&y,data.data()+bp+4,4); std::memcpy(&z,data.data()+bp+8,4);
                positions.push_back(x);positions.push_back(y);positions.push_back(z);
            }
            uint32_t base=(uint32_t)(positions.size()/3)-3;
            indices.push_back(base);indices.push_back(base+1);indices.push_back(base+2);
            off+=rec;
        }
    }
    if(positions.empty()) return nullptr;
    uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
    m->positions=std::move(positions); m->indices=std::move(indices);
    m->hasNormals=false; m->hasUVs=false; compute_bounds(m);
    ModelData* md=new ModelData(); md->meshes.push_back(h);
    LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat)); dmat.baseColor={200,200,210,255}; dmat.roughness=0.6f; dmat.opacity=1; dmat.metallic=0.1f;
    LumentMaterial matH=g_materials.alloc(); g_materials.get(matH)->desc=dmat; md->materials.push_back(matH);
    finalize_model(md); return md;
}

// ---- PLY（ASCII / 二进制小端）----
ModelData* load_ply(const std::vector<uint8_t>& data){
    std::string head((const char*)data.data(), std::min<size_t>(data.size(),3));
    if(head!="ply") return nullptr;
    std::string text((const char*)data.data(),data.size());
    std::istringstream ss(text);
    std::string line; bool binary=false; bool littleEndian=true;
    int vcount=0, fcount=0;
    struct Prop{ std::string name; std::string type; };
    std::vector<Prop> vprops;
    bool inVertex=false, inFace=false;
    size_t headerEnd=0; size_t dataOffset=0;
    std::vector<std::string> headers;
    while(std::getline(ss,line)){ headers.push_back(line); if(line=="end_header"){ dataOffset=(size_t)ss.tellg(); headerEnd=1; break; } }
    // 解析 header
    for(auto& hl:headers){
        std::istringstream hs(hl); std::string t; hs>>t;
        if(t=="format"){ std::string fmt; hs>>fmt; if(fmt=="binary_little_endian"||fmt=="binary_big_endian"){ binary=true; littleEndian=(fmt=="binary_little_endian"); } }
        else if(t=="element"){ std::string name; int cnt; hs>>name>>cnt; if(name=="vertex"){ vcount=cnt; inVertex=true; inFace=false; } else if(name=="face"){ fcount=cnt; inVertex=false; inFace=true; } else { inVertex=false; inFace=false; } }
        else if(t=="property" && inVertex){ std::string type,name; hs>>type>>name; vprops.push_back({name,type}); }
    }
    // 定位属性索引
    int piX=-1,piY=-1,piZ=-1,piNX=-1,piNY=-1,piNZ=-1,piR=-1,piG=-1,piB=-1;
    for(size_t i=0;i<vprops.size();++i){
        if(vprops[i].name=="x")piX=(int)i; else if(vprops[i].name=="y")piY=(int)i; else if(vprops[i].name=="z")piZ=(int)i;
        else if(vprops[i].name=="nx")piNX=(int)i; else if(vprops[i].name=="ny")piNY=(int)i; else if(vprops[i].name=="nz")piNZ=(int)i;
        else if(vprops[i].name=="red")piR=(int)i; else if(vprops[i].name=="green")piG=(int)i; else if(vprops[i].name=="blue")piB=(int)i;
    }
    int stride=(int)vprops.size();
    std::vector<float> positions; std::vector<float> normals; std::vector<uint32_t> indices;
    if(!binary){
        // 已读过头，重新读 data 区
        std::istringstream ds(std::string((const char*)data.data()+dataOffset, data.size()-dataOffset));
        std::vector<float> vrow(stride);
        for(int i=0;i<vcount;++i){
            for(int p=0;p<stride;++p) ds>>vrow[p];
            positions.push_back(vrow[piX]);positions.push_back(vrow[piY]);positions.push_back(vrow[piZ]);
            if(piNX>=0){ normals.push_back(vrow[piNX]);normals.push_back(vrow[piNY]);normals.push_back(vrow[piNZ]); }
        }
        std::string tok;
        for(int i=0;i<fcount;++i){
            int n; ds>>n; std::vector<int> ids(n); for(int k=0;k<n;++k) ds>>ids[k];
            for(int k=1;k+1<n;++k){ indices.push_back(ids[0]);indices.push_back(ids[k]);indices.push_back(ids[k+1]); }
        }
    } else {
        size_t off=dataOffset;
        auto rdF=[&](size_t o)->float{ float v; std::memcpy(&v,data.data()+o,4); if(!littleEndian){ uint8_t*b=(uint8_t*)&v; std::reverse(b,b+4);} return v; };
        auto rdI=[&](size_t o)->int{ int v; std::memcpy(&v,data.data()+o,4); if(!littleEndian){ uint8_t*b=(uint8_t*)&v; std::reverse(b,b+4);} return v; };
        auto rdU1=[&](size_t o)->unsigned char{ return data[o]; };
        size_t vRec=stride*4;
        for(int i=0;i<vcount;++i){
            size_t o=off+(size_t)i*vRec;
            positions.push_back(rdF(o+piX*4));positions.push_back(rdF(o+piY*4));positions.push_back(rdF(o+piZ*4));
            if(piNX>=0){ normals.push_back(rdF(o+piNX*4));normals.push_back(rdF(o+piNY*4));normals.push_back(rdF(o+piNZ*4)); }
        }
        off += (size_t)vcount*vRec;
        for(int i=0;i<fcount;++i){
            unsigned char n=rdU1(off); ++off;
            std::vector<int> ids(n);
            for(int k=0;k<n;++k){ ids[k]=rdI(off); off+=4; }
            for(int k=1;k+1<n;++k){ indices.push_back(ids[0]);indices.push_back(ids[k]);indices.push_back(ids[k+1]); }
        }
    }
    if(positions.empty()) return nullptr;
    uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
    m->positions=std::move(positions); m->indices=std::move(indices);
    m->hasNormals=(piNX>=0); m->hasUVs=false; compute_bounds(m);
    ModelData* md=new ModelData(); md->meshes.push_back(h);
    LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat)); dmat.baseColor={210,210,220,255}; dmat.roughness=0.7f; dmat.opacity=1;
    LumentMaterial matH=g_materials.alloc(); g_materials.get(matH)->desc=dmat; md->materials.push_back(matH);
    finalize_model(md); return md;
}

// ---- glTF / GLB ----
ModelData* load_gltf(const std::vector<uint8_t>& jsonBytes, std::vector<uint8_t>& binBlob){
    json::Parser p; json::Value root=p.parse(std::string((const char*)jsonBytes.data(),jsonBytes.size()));
    if(root.isNull()) return nullptr;
    ModelData* md=new ModelData();
    // 解析 accessor 数据到临时缓冲
    auto getBufferData=[&](int bufferViewIdx, std::vector<uint8_t>& out, int& byteStride, int& byteOffset)->bool{
        const json::Value& bv=root["bufferViews"][bufferViewIdx];
        if(bv.isNull()) return false;
        int bufIdx=bv["buffer"].asInt(0);
        int bvOffset=bv["byteOffset"].asInt(0);
        int bvLen=bv["byteLength"].asInt(0);
        byteStride=bv["byteStride"].asInt(0);
        byteOffset=bvOffset;
        const json::Value& buf=root["buffers"][bufIdx];
        std::string uri=buf["uri"].asStr();
        std::vector<uint8_t> blob;
        if(!uri.empty() && uri.rfind("data:",0)==0){ std::vector<uint8_t> tmp; data_uri_to_bytes(uri,tmp); blob=std::move(tmp); }
        else if(!uri.empty()){ return false; /* 外部 .bin 文件需额外 IO，简化忽略 */ }
        else { blob=binBlob; }
        if(bvOffset+bvLen>blob.size()) return false;
        out.assign(blob.begin()+bvOffset, blob.begin()+bvOffset+bvLen);
        return true;
    };
    auto readAccessor=[&](int accIdx, std::vector<float>& outF, std::vector<uint32_t>& outI, int& comps)->bool{
        const json::Value& acc=root["accessors"][accIdx];
        if(acc.isNull()) return false;
        int bvIdx=acc["bufferView"].asInt(-1); if(bvIdx<0) return false;
        int count=acc["count"].asInt(0);
        std::string type=acc["type"].asStr();
        int ct=acc["componentType"].asInt(0);
        comps= (type=="VEC3")?3:(type=="VEC2")?2:(type=="VEC4")?4:1;
        std::vector<uint8_t> raw; int stride=0,offset=0;
        if(!getBufferData(bvIdx,raw,stride,offset)) return false;
        if(stride==0) stride=comps*((ct==5126)?4:2);
        outF.clear(); outI.clear();
        for(int i=0;i<count;++i){
            size_t base=(size_t)offset + (size_t)i*stride;
            for(int c=0;c<comps;++c){
                size_t e=base+(size_t)c*((ct==5126)?4:2);
                if(ct==5126){ float v; std::memcpy(&v,raw.data()+e,4); outF.push_back(v); }
                else if(ct==5123){ uint16_t v; std::memcpy(&v,raw.data()+e,2); outI.push_back(v); }
                else if(ct==5125){ uint32_t v; std::memcpy(&v,raw.data()+e,4); outI.push_back(v); }
                else if(ct==5121){ uint8_t v=raw[e]; outI.push_back(v); }
                else { outI.push_back(0); }
            }
        }
        return true;
    };
    // 遍历 mesh
    const json::Value& meshes=root["meshes"];
    if(meshes.type==json::Value::Arr){
        for(size_t mi=0; mi<meshes.a.size(); ++mi){
            const json::Value& mesh=meshes.a[mi];
            const json::Value& prims=mesh["primitives"];
            for(size_t pi=0; pi<prims.a.size(); ++pi){
                const json::Value& prim=prims.a[pi];
                int posAcc=prim["attributes"]["POSITION"].asInt(-1);
                if(posAcc<0) continue;
                std::vector<float> pos, nrm, uv; std::vector<uint32_t> idx, dummy; int comps;
                if(!readAccessor(posAcc,pos,dummy,comps)) continue;
                int nrmAcc=prim["attributes"]["NORMAL"].asInt(-1);
                if(nrmAcc>=0) readAccessor(nrmAcc,nrm,dummy,comps);
                int uvAcc=prim["attributes"]["TEXCOORD_0"].asInt(-1);
                if(uvAcc>=0) readAccessor(uvAcc,uv,dummy,comps);
                int idxAcc=prim["indices"].asInt(-1);
                if(idxAcc>=0){ std::vector<float> di; readAccessor(idxAcc,di,idx,comps); }
                uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
                m->positions=std::move(pos);
                m->hasNormals=(nrmAcc>=0); if(m->hasNormals) m->normals=std::move(nrm);
                m->hasUVs=(uvAcc>=0); if(m->hasUVs) m->uvs=std::move(uv);
                m->indices=std::move(idx); compute_bounds(m);
                md->meshes.push_back(h);
                // 材质
                int matIdx=prim["material"].asInt(-1);
                LumentMaterial matH=0;
                if(matIdx>=0){
                    const json::Value& mat=root["materials"][matIdx];
                    LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat));
                    dmat.baseColor={255,255,255,255}; dmat.albedoMap=0; dmat.metallic=0; dmat.roughness=1.0f; dmat.opacity=1;
                    const json::Value& pbr=mat["pbrMetallicRoughness"];
                    if(!pbr.isNull()){
                        const json::Value& bc=pbr["baseColorFactor"];
                        if(bc.type==json::Value::Arr && bc.a.size()>=4){
                            dmat.baseColor.r=(uint8_t)(bc.a[0].asNum(1)*255);
                            dmat.baseColor.g=(uint8_t)(bc.a[1].asNum(1)*255);
                            dmat.baseColor.b=(uint8_t)(bc.a[2].asNum(1)*255);
                            dmat.baseColor.a=(uint8_t)(bc.a[3].asNum(1)*255);
                        }
                        dmat.metallic=(float)pbr["metallicFactor"].asNum(1.0);
                        dmat.roughness=(float)pbr["roughnessFactor"].asNum(1.0);
                        int texIdx=pbr["baseColorTexture"]["index"].asInt(-1);
                        if(texIdx>=0){
                            int imgIdx=root["textures"][texIdx]["source"].asInt(-1);
                            std::string imgUri=root["images"][imgIdx]["uri"].asStr();
                            if(!imgUri.empty()){ LumentColor c={255,255,255,255}; (void)c; /* 纹理加载由宿主纹理系统处理，此处记录 uri，交由上层 */ }
                        }
                    }
                    matH=g_materials.alloc(); g_materials.get(matH)->desc=dmat;
                } else {
                    LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat)); dmat.baseColor={255,255,255,255}; dmat.roughness=1.0f; dmat.opacity=1;
                    matH=g_materials.alloc(); g_materials.get(matH)->desc=dmat;
                }
                md->materials.push_back(matH);
            }
        }
    }
    if(md->meshes.empty()){ delete md; return nullptr; }
    finalize_model(md);
    return md;
}

ModelData* load_glb(const std::vector<uint8_t>& data){
    if(data.size()<12) return nullptr;
    // magic=glTF, version=2
    uint32_t magic; std::memcpy(&magic,data.data(),4);
    if(magic!=0x46546C67u) return nullptr; // 'glTF'
    // 跳到第一个 chunk
    size_t off=12;
    std::vector<uint8_t> jsonBytes, binBlob;
    while(off+8<=data.size()){
        uint32_t chunkLen; std::memcpy(&chunkLen,data.data()+off,4); off+=4;
        uint32_t chunkType; std::memcpy(&chunkType,data.data()+off,4); off+=4;
        if(off+chunkLen>data.size()) break;
        if(chunkType==0x4E4F534Au){ jsonBytes.assign(data.begin()+off,data.begin()+off+chunkLen); }
        else if(chunkType==0x004E4942u){ binBlob.assign(data.begin()+off,data.begin()+off+chunkLen); }
        off+=chunkLen;
    }
    if(jsonBytes.empty()) return nullptr;
    return load_gltf(jsonBytes,binBlob);
}

// ---- DAE (COLLADA) 简化加载 ----
ModelData* load_dae(const std::vector<uint8_t>& data){
    std::string text((const char*)data.data(),data.size());
    // 扫描 <source> 中的 float_array 与 accessor，及 <polylist>/<triangles> 的 <p>
    // 简化实现：提取第一个 geometry 的 positions / normals / 索引
    // 由于 COLLADA 复杂，这里做尽力而为的解析。
    ModelData* md=new ModelData();
    // 直接查找所有 float_array
    std::vector<float> positions, normals; std::vector<uint32_t> indices;
    size_t pos=0;
    auto extractFloats=[&](const std::string& s, std::vector<float>& out){
        std::istringstream ss(s); float v; while(ss>>v) out.push_back(v);
    };
    // 简单正则式搜索：查找 <float_array ...> ... </float_array>
    // 我们仅在包含 "position" 的 source 中提取 positions（启发式）
    // 由于可靠性有限，这里给出一个基础实现：查找所有 float_array，按首个为 positions 处理。
    size_t i=0;
    bool foundAny=false;
    while((i=text.find("<float_array",i))!=std::string::npos){
        size_t tagEnd=text.find('>',i); if(tagEnd==std::string::npos) break;
        size_t closeTag=text.find("</float_array>",tagEnd); if(closeTag==std::string::npos) break;
        std::string content=text.substr(tagEnd+1, closeTag-tagEnd-1);
        // 决定是 position 还是 normal：检查之前是否出现 "POSITION" 标记
        std::string pre=text.substr(i,tagEnd-i);
        if(pre.find("POSITION")!=std::string::npos){ positions.clear(); extractFloats(content,positions); }
        else if(pre.find("NORMAL")!=std::string::npos){ normals.clear(); extractFloats(content,normals); }
        i=closeTag+14; foundAny=true;
    }
    // 提取索引 <p>...</p>（triangles/polylist 内）
    size_t p=text.find("<p>");
    if(p!=std::string::npos){
        size_t pe=text.find("</p>",p); if(pe!=std::string::npos){
            std::string content=text.substr(p+3,pe-p-3);
            std::istringstream ss(content); int v; while(ss>>v) indices.push_back((uint32_t)v);
            // COLLADA <p> 通常为 v/t/n 三元组；若 positions 已含 x,y,z，则取每 3 个的首个
            if(!positions.empty() && indices.size()>positions.size()/3){
                std::vector<uint32_t> tri;
                for(size_t k=0;k+2<indices.size();k+=3){ tri.push_back(indices[k]); }
                if(tri.size()>=3) indices=tri;
            }
        }
    }
    if(positions.empty()){ delete md; return nullptr; }
    uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
    m->positions=std::move(positions); m->hasNormals=!normals.empty(); m->normals=std::move(normals);
    m->hasUVs=false; m->indices=std::move(indices); compute_bounds(m);
    md->meshes.push_back(h);
    LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat)); dmat.baseColor={210,210,220,255}; dmat.roughness=0.7f; dmat.opacity=1;
    LumentMaterial matH=g_materials.alloc(); g_materials.get(matH)->desc=dmat; md->materials.push_back(matH);
    finalize_model(md);
    return md;
}

// ---- FBX / BLEND（可选）----
#if defined(LUMENT_ENABLE_ASSIMP)
#include <assimp/Importer.hpp>
#include <assimp/scene.h>
#include <assimp/postprocess.h>
ModelData* load_assimp(const std::string& path){
    Assimp::Importer imp;
    const aiScene* scene=imp.ReadFile(path, aiProcess_Triangulate|aiProcess_GenNormals|aiProcess_FlipUVs);
    if(!scene||!scene->mRootNode) return nullptr;
    ModelData* md=new ModelData();
    std::function<void(const aiNode*)> walk=[&](const aiNode* node){
        for(unsigned int i=0;i<node->mNumMeshes;++i){
            const aiMesh* am=scene->mMeshes[node->mMeshes[i]];
            if(!am||!am->mVertices) continue;
            std::vector<float> positions, normals, uvs; std::vector<uint32_t> indices;
            for(unsigned int v=0;v<am->mNumVertices;++v){
                positions.push_back(am->mVertices[v].x);positions.push_back(am->mVertices[v].y);positions.push_back(am->mVertices[v].z);
                if(am->mNormals){ normals.push_back(am->mNormals[v].x);normals.push_back(am->mNormals[v].y);normals.push_back(am->mNormals[v].z); }
                if(am->mTextureCoords[0]){ uvs.push_back(am->mTextureCoords[0][v].x); uvs.push_back(am->mTextureCoords[0][v].y); }
            }
            for(unsigned int f=0;f<am->mNumFaces;++f){ const aiFace& fc=am->mFaces[f]; for(unsigned int k=0;k<fc.mNumIndices;++k) indices.push_back(fc.mIndices[k]); }
            uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
            m->positions=std::move(positions); m->hasNormals=!!am->mNormals; m->normals=std::move(normals);
            m->hasUVs=!!am->mTextureCoords[0]; m->uvs=std::move(uvs); m->indices=std::move(indices); compute_bounds(m);
            md->meshes.push_back(h);
            LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat)); dmat.baseColor={220,220,230,255}; dmat.roughness=0.7f; dmat.opacity=1;
            LumentMaterial matH=g_materials.alloc(); g_materials.get(matH)->desc=dmat; md->materials.push_back(matH);
        }
        for(unsigned int i=0;i<node->mNumChildren;++i) walk(node->mChildren[i]);
    };
    walk(scene->mRootNode);
    if(md->meshes.empty()){ delete md; return nullptr; }
    finalize_model(md); return md;
}
#else
ModelData* load_assimp(const std::string&){ return nullptr; }
#endif

// .blend 桥接：调用 Blender CLI 导出为 glb 后加载
ModelData* load_blend(const std::string& path){
    // 检测 blender 是否可用
    int v=std::system("blender --version > /dev/null 2>&1");
    if(v!=0){ lument_log("lument_cube: Blender CLI 不可用，无法原生加载 .blend（请将模型导出为 glTF/glb）"); return nullptr; }
    std::string out=path+".cube_export.glb";
    std::string cmd="blender \""+path+"\" --background --python tools/blender_export_glb.py -- \""+out+"\" > /dev/null 2>&1";
    (void)std::system(cmd.c_str());
    std::vector<uint8_t> blob;
    if(!read_file(out,blob)){ lument_log("lument_cube: .blend 导出失败"); return nullptr; }
    return load_glb(blob);
}

ModelData* dispatch_load(const std::string& path, LumentCubeFormat fmt){
    std::vector<uint8_t> blob;
    if(!read_file(path,blob)){ lument_log("lument_cube: 无法读取文件"); return nullptr; }
    if(fmt==LUMENT_CUBE_FORMAT_GLB) return load_glb(blob);
    if(fmt==LUMENT_CUBE_FORMAT_GLTF) { std::vector<uint8_t> empty; return load_gltf(blob,empty); }
    if(fmt==LUMENT_CUBE_FORMAT_OBJ) return load_obj(blob,path.substr(0,path.find_last_of('/')));
    if(fmt==LUMENT_CUBE_FORMAT_STL) return load_stl(blob);
    if(fmt==LUMENT_CUBE_FORMAT_PLY) return load_ply(blob);
    if(fmt==LUMENT_CUBE_FORMAT_DAE) return load_dae(blob);
    if(fmt==LUMENT_CUBE_FORMAT_FBX) return load_assimp(path);
    if(fmt==LUMENT_CUBE_FORMAT_BLEND) return load_blend(path);
    return nullptr;
}

} // namespace

// ============================================================
// 5. 程序化图元
// ============================================================
namespace {
void make_box(float sx,float sy,float sz, MeshData* m){
    float hx=sx*0.5f,hy=sy*0.5f,hz=sz*0.5f;
    float v[24*3]={
        -hx,-hy,-hz,  hx,-hy,-hz,  hx,hy,-hz, -hx,hy,-hz, // back
         hx,-hy, hz, -hx,-hy, hz, -hx,hy, hz,  hx,hy, hz, // front
        -hx,-hy, hz,  hx,-hy, hz,  hx,-hy,-hz, -hx,-hy,-hz, // bottom
        -hx, hy, hz,  hx, hy, hz,  hx, hy,-hz, -hx, hy,-hz, // top
         hx,-hy, hz,  hx,-hy,-hz,  hx, hy,-hz,  hx, hy, hz, // right
        -hx,-hy,-hz, -hx,-hy, hz, -hx, hy, hz, -hx, hy,-hz  // left
    };
    float n[24*3]={
        0,0,-1, 0,0,-1, 0,0,-1, 0,0,-1,
        0,0,1, 0,0,1, 0,0,1, 0,0,1,
        0,-1,0, 0,-1,0, 0,-1,0, 0,-1,0,
        0,1,0, 0,1,0, 0,1,0, 0,1,0,
        1,0,0, 1,0,0, 1,0,0, 1,0,0,
        -1,0,0, -1,0,0, -1,0,0, -1,0,0
    };
    float uv[24*2]={0,0,1,0,1,1,0,1, 0,0,1,0,1,1,0,1, 0,0,1,0,1,1,0,1, 0,0,1,0,1,1,0,1, 0,0,1,0,1,1,0,1, 0,0,1,0,1,1,0,1};
    for(int i=0;i<24;++i){ m->positions.push_back(v[i*3]);m->positions.push_back(v[i*3+1]);m->positions.push_back(v[i*3+2]); m->normals.push_back(n[i*3]);m->normals.push_back(n[i*3+1]);m->normals.push_back(n[i*3+2]); m->uvs.push_back(uv[i*2]);m->uvs.push_back(uv[i*2+1]); }
    for(int i=0;i<6;++i){ int b=i*4; m->indices.push_back(b);m->indices.push_back(b+1);m->indices.push_back(b+2); m->indices.push_back(b);m->indices.push_back(b+2);m->indices.push_back(b+3); }
}

void make_plane(float w,float h, MeshData* m){
    float hw=w*0.5f,hh=h*0.5f;
    float v[4*3]={ -hw,-hh,0, hw,-hh,0, hw,hh,0, -hw,hh,0 };
    float n[4*3]={0,0,1,0,0,1,0,0,1,0,0,1};
    float uv[4*2]={0,0,1,0,1,1,0,1};
    for(int i=0;i<4;++i){ m->positions.push_back(v[i*3]);m->positions.push_back(v[i*3+1]);m->positions.push_back(v[i*3+2]); m->normals.push_back(n[i*3]);m->normals.push_back(n[i*3+1]);m->normals.push_back(n[i*3+2]); m->uvs.push_back(uv[i*2]);m->uvs.push_back(uv[i*2+1]); }
    m->indices={0,1,2,0,2,3};
}

void make_sphere(float radius,int seg, MeshData* m){
    if(seg<3) seg=3;
    for(int y=0;y<=seg;++y){
        float v=y/(float)seg; float theta=v*3.14159265f;
        for(int x=0;x<=seg;++x){
            float u=x/(float)seg; float phi=u*2.0f*3.14159265f;
            float nx=std::sin(theta)*std::cos(phi), ny=std::cos(theta), nz=std::sin(theta)*std::sin(phi);
            m->positions.push_back(nx*radius);m->positions.push_back(ny*radius);m->positions.push_back(nz*radius);
            m->normals.push_back(nx);m->normals.push_back(ny);m->normals.push_back(nz);
            m->uvs.push_back(u);m->uvs.push_back(v);
        }
    }
    int stride=seg+1;
    for(int y=0;y<seg;++y) for(int x=0;x<seg;++x){
        int a=y*stride+x, b=a+1, c=a+stride, d=c+1;
        m->indices.push_back(a);m->indices.push_back(c);m->indices.push_back(b);
        m->indices.push_back(b);m->indices.push_back(c);m->indices.push_back(d);
    }
}

void make_cylinder(float rTop, float rBot, float h, int seg, MeshData* m){
    const float PI=3.14159265f;
    if(seg<3) seg=3;
    float halfH=h*0.5f;
    int ring=seg+1;
    for(int i=0;i<=seg;++i){
        float a=(float)i/(float)seg*2.0f*PI;
        float cx=std::cos(a), cz=std::sin(a);
        float nl=std::sqrt(cx*cx+cz*cz); nl=(nl>1e-5f)?nl:1.0f;
        // 顶圈
        m->positions.push_back(rTop*cx); m->positions.push_back(halfH); m->positions.push_back(rTop*cz);
        m->normals.push_back(cx/nl); m->normals.push_back(0); m->normals.push_back(cz/nl);
        m->uvs.push_back((float)i/(float)seg); m->uvs.push_back(1);
        // 底圈
        m->positions.push_back(rBot*cx); m->positions.push_back(-halfH); m->positions.push_back(rBot*cz);
        m->normals.push_back(cx/nl); m->normals.push_back(0); m->normals.push_back(cz/nl);
        m->uvs.push_back((float)i/(float)seg); m->uvs.push_back(0);
    }
    for(int i=0;i<seg;++i){
        int t0=2*i, b0=2*i+1, t1=2*i+2, b1=2*i+3;
        m->indices.push_back(t0); m->indices.push_back(b0); m->indices.push_back(b1);
        m->indices.push_back(t0); m->indices.push_back(b1); m->indices.push_back(t1);
    }
    // 顶盖（rTop>0）
    if(rTop>1e-5f){
        int center=(int)(m->positions.size()/3);
        m->positions.push_back(0); m->positions.push_back(halfH); m->positions.push_back(0);
        m->normals.push_back(0); m->normals.push_back(1); m->normals.push_back(0);
        m->uvs.push_back(0.5f); m->uvs.push_back(0.5f);
        int base=(int)(m->positions.size()/3);
        for(int i=0;i<=seg;++i){
            float a=(float)i/(float)seg*2.0f*PI;
            m->positions.push_back(rTop*std::cos(a)); m->positions.push_back(halfH); m->positions.push_back(rTop*std::sin(a));
            m->normals.push_back(0); m->normals.push_back(1); m->normals.push_back(0);
            m->uvs.push_back(std::cos(a)*0.5f+0.5f); m->uvs.push_back(std::sin(a)*0.5f+0.5f);
        }
        for(int i=0;i<seg;++i){ m->indices.push_back(center); m->indices.push_back(base+i); m->indices.push_back(base+i+1); }
    }
    // 底盖（rBot>0）
    if(rBot>1e-5f){
        int center=(int)(m->positions.size()/3);
        m->positions.push_back(0); m->positions.push_back(-halfH); m->positions.push_back(0);
        m->normals.push_back(0); m->normals.push_back(-1); m->normals.push_back(0);
        m->uvs.push_back(0.5f); m->uvs.push_back(0.5f);
        int base=(int)(m->positions.size()/3);
        for(int i=0;i<=seg;++i){
            float a=(float)i/(float)seg*2.0f*PI;
            m->positions.push_back(rBot*std::cos(a)); m->positions.push_back(-halfH); m->positions.push_back(rBot*std::sin(a));
            m->normals.push_back(0); m->normals.push_back(-1); m->normals.push_back(0);
            m->uvs.push_back(std::cos(a)*0.5f+0.5f); m->uvs.push_back(std::sin(a)*0.5f+0.5f);
        }
        for(int i=0;i<seg;++i){ m->indices.push_back(center); m->indices.push_back(base+i+1); m->indices.push_back(base+i); }
    }
}

void make_torus(float R, float r, int radialSeg, int tubularSeg, MeshData* m){
    const float PI=3.14159265f;
    if(radialSeg<3) radialSeg=3;
    if(tubularSeg<3) tubularSeg=3;
    int ring=radialSeg+1;
    for(int i=0;i<=tubularSeg;++i){
        float u=(float)i/(float)tubularSeg*2.0f*PI;
        float cu=std::cos(u), su=std::sin(u);
        for(int j=0;j<=radialSeg;++j){
            float v=(float)j/(float)radialSeg*2.0f*PI;
            float cv=std::cos(v), sv=std::sin(v);
            float x=(R + r*cv)*cu, y=r*sv, z=(R + r*cv)*su;
            m->positions.push_back(x); m->positions.push_back(y); m->positions.push_back(z);
            m->normals.push_back(cv*cu); m->normals.push_back(sv); m->normals.push_back(cv*su);
            m->uvs.push_back((float)i/(float)tubularSeg); m->uvs.push_back((float)j/(float)radialSeg);
        }
    }
    for(int i=0;i<tubularSeg;++i) for(int j=0;j<radialSeg;++j){
        int a=i*ring+j, b=a+ring, c=a+1, d=b+1;
        m->indices.push_back(a); m->indices.push_back(b); m->indices.push_back(d);
        m->indices.push_back(a); m->indices.push_back(d); m->indices.push_back(c);
    }
}
} // namespace

// ============================================================
// 6. 渲染（GLES2 真实绘制 / 其余后端 no-op）
// ============================================================
#if defined(LUMENT_BACKEND_GLES2)
#include <GLES2/gl2.h>

namespace {
GLuint g_cubeProg=0, g_vboQuad=0;
GLint g_uMVP=-1,g_uModel=-1,g_uCamPos=-1,g_uBaseColor=-1,g_uHasAlbedo=-1,g_uAlbedo=-1,
      g_uMetallic=-1,g_uRoughness=-1,g_uAmbient=-1,g_uNumLights=-1,
      g_uLightPos=-1,g_uLightColor=-1,g_uLightIntensity=-1,g_uLightType=-1;
bool g_cubeGLReady=false;

const char* VS=
"attribute vec3 aPos; attribute vec3 aNormal; attribute vec2 aUV;\n"
"uniform mat4 uMVP; uniform mat4 uModel;\n"
"varying vec3 vN; varying vec2 vUV; varying vec3 vWP;\n"
"void main(){ vec4 wp=uModel*vec4(aPos,1.0); vWP=wp.xyz; vN=mat3(uModel)*aNormal; vUV=aUV; gl_Position=uMVP*vec4(aPos,1.0); }\n";
const char* FS=
"precision mediump float;\n"
"varying vec3 vN; varying vec2 vUV; varying vec3 vWP;\n"
"uniform vec3 uCamPos; uniform vec3 uBaseColor; uniform sampler2D uAlbedo;\n"
"uniform bool uHasAlbedo; uniform float uMetallic; uniform float uRoughness;\n"
"uniform vec3 uAmbient; uniform int uNumLights;\n"
"uniform vec3 uLightPos[4]; uniform vec3 uLightColor[4]; uniform float uLightIntensity[4]; uniform int uLightType[4];\n"
"void main(){\n"
"  vec3 N=normalize(vN); vec3 base=uBaseColor;\n"
"  if(uHasAlbedo) base*=texture2D(uAlbedo,vUV).rgb;\n"
"  vec3 V=normalize(uCamPos-vWP); vec3 col=uAmbient*base;\n"
"  for(int i=0;i<4;i++){ if(i>=uNumLights) break;\n"
"    vec3 Ld=uLightPos[i]; float att=1.0;\n"
"    if(uLightType[i]==1){ vec3 D=vWP-uLightPos[i]; float d=length(D); Ld=-normalize(D); att=clamp(1.0-d/20.0,0.0,1.0); } else { Ld=normalize(Ld); }\n"
"    float diff=max(dot(N,Ld),0.0);\n"
"    vec3 H=normalize(Ld+V); float spec=pow(max(dot(N,H),0.0),mix(8.0,64.0,uRoughness));\n"
"    vec3 lc=uLightColor[i]*uLightIntensity[i]*att;\n"
"    col+= base*diff*lc + spec*lc*(1.0-uRoughness);\n"
"  }\n"
"  gl_FragColor=vec4(col,1.0);\n"
"}\n";

GLuint compile(GLenum t,const char* src){ GLuint s=glCreateShader(t); glShaderSource(s,1,&src,0); glCompileShader(s); return s; }
bool init_cube_gl(){
    GLuint vs=compile(GL_VERTEX_SHADER,VS); GLuint fs=compile(GL_FRAGMENT_SHADER,FS);
    g_cubeProg=glCreateProgram(); glAttachShader(g_cubeProg,vs); glAttachShader(g_cubeProg,fs); glLinkProgram(g_cubeProg);
    g_uMVP=glGetUniformLocation(g_cubeProg,"uMVP"); g_uModel=glGetUniformLocation(g_cubeProg,"uModel");
    g_uCamPos=glGetUniformLocation(g_cubeProg,"uCamPos"); g_uBaseColor=glGetUniformLocation(g_cubeProg,"uBaseColor");
    g_uHasAlbedo=glGetUniformLocation(g_cubeProg,"uHasAlbedo"); g_uAlbedo=glGetUniformLocation(g_cubeProg,"uAlbedo");
    g_uMetallic=glGetUniformLocation(g_cubeProg,"uMetallic"); g_uRoughness=glGetUniformLocation(g_cubeProg,"uRoughness");
    g_uAmbient=glGetUniformLocation(g_cubeProg,"uAmbient"); g_uNumLights=glGetUniformLocation(g_cubeProg,"uNumLights");
    g_uLightPos=glGetUniformLocation(g_cubeProg,"uLightPos"); g_uLightColor=glGetUniformLocation(g_cubeProg,"uLightColor");
    g_uLightIntensity=glGetUniformLocation(g_cubeProg,"uLightIntensity"); g_uLightType=glGetUniformLocation(g_cubeProg,"uLightType");
    g_cubeGLReady=true; return true;
}
void upload_mesh_gl(MeshData* m){
    if(m->gpuUploaded) return;
    glGenBuffers(1,&m->vboPos); glBindBuffer(GL_ARRAY_BUFFER,m->vboPos); glBufferData(GL_ARRAY_BUFFER,m->positions.size()*4,m->positions.data(),GL_STATIC_DRAW);
    glGenBuffers(1,&m->vboNrm); glBindBuffer(GL_ARRAY_BUFFER,m->vboNrm); glBufferData(GL_ARRAY_BUFFER,m->normals.size()*4,m->normals.data(),GL_STATIC_DRAW);
    glGenBuffers(1,&m->vboUV); glBindBuffer(GL_ARRAY_BUFFER,m->vboUV); glBufferData(GL_ARRAY_BUFFER,m->uvs.size()*4,m->uvs.data(),GL_STATIC_DRAW);
    glGenBuffers(1,&m->ibo); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,m->ibo); glBufferData(GL_ELEMENT_ARRAY_BUFFER,m->indices.size()*4,m->indices.data(),GL_STATIC_DRAW);
    // 线框边索引（每个三角形 3 条边的端点，绘制时按需切换为 GL_LINES）
    std::vector<uint32_t> edges; edges.reserve(m->indices.size()*2);
    for(size_t i=0;i+2<m->indices.size();i+=3){
        uint32_t a=m->indices[i],b=m->indices[i+1],c=m->indices[i+2];
        edges.push_back(a);edges.push_back(b);
        edges.push_back(b);edges.push_back(c);
        edges.push_back(c);edges.push_back(a);
    }
    glGenBuffers(1,&m->wireIbo); glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,m->wireIbo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER,edges.size()*4,edges.data(),GL_STATIC_DRAW);
    m->wireCount=(unsigned int)edges.size();
    m->gpuUploaded=true;
}
void render_mesh_gl(MeshData* m,const float* mvp,const float* model,const LumentCubeMaterial* mat){
    if(!g_cubeGLReady) init_cube_gl();
    upload_mesh_gl(m);
    glUseProgram(g_cubeProg);
    glUniformMatrix4fv(g_uMVP,1,GL_FALSE,mvp);
    glUniformMatrix4fv(g_uModel,1,GL_FALSE,model);
    float cp[3]={0,0,5}; glUniform3fv(g_uCamPos,1,cp);
    glUniform3f(g_uBaseColor, mat->baseColor.r/255.0f, mat->baseColor.g/255.0f, mat->baseColor.b/255.0f);
    glUniform1f(g_uMetallic,mat->metallic); glUniform1f(g_uRoughness,mat->roughness);
    glUniform3fv(g_uAmbient,1,g_ambientColor);
    int nl=(int)g_lights.size(); if(nl>4) nl=4;
    float lp[12]={0},lc[12]={0},li[4]={0}; int lt[4]={0};
    for(int i=0;i<nl;++i){ lp[i*3]=g_lights[i].posOrDir[0];lp[i*3+1]=g_lights[i].posOrDir[1];lp[i*3+2]=g_lights[i].posOrDir[2];
        lc[i*3]=g_lights[i].color.r/255.0f;lc[i*3+1]=g_lights[i].color.g/255.0f;lc[i*3+2]=g_lights[i].color.b/255.0f;
        li[i]=g_lights[i].intensity; lt[i]=(int)g_lights[i].type; }
    glUniform1i(g_uNumLights,nl);
    glUniform3fv(g_uLightPos,4,lp); glUniform3fv(g_uLightColor,4,lc); glUniform1fv(g_uLightIntensity,4,li); glUniform1iv(g_uLightType,4,lt);
    // 贴图
    bool hasTex=(mat->albedoMap!=0);
    glUniform1i(g_uHasAlbedo,hasTex?1:0);
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, hasTex?mat->albedoMap:0); glUniform1i(g_uAlbedo,0);
    // 属性
    glBindBuffer(GL_ARRAY_BUFFER,m->vboPos); glEnableVertexAttribArray(0); glVertexAttribPointer(0,3,GL_FLOAT,GL_FALSE,0,0);
    glBindBuffer(GL_ARRAY_BUFFER,m->vboNrm); glEnableVertexAttribArray(1); glVertexAttribPointer(1,3,GL_FLOAT,GL_FALSE,0,0);
    glBindBuffer(GL_ARRAY_BUFFER,m->vboUV); glEnableVertexAttribArray(2); glVertexAttribPointer(2,2,GL_FLOAT,GL_FALSE,0,0);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,m->ibo);
    if(g_wireframe && m->wireIbo){
        glBindBuffer(GL_ELEMENT_ARRAY_BUFFER,m->wireIbo);
        glDrawElements(GL_LINES,(GLsizei)m->wireCount,GL_UNSIGNED_INT,0);
    } else {
        glDrawElements(GL_TRIANGLES,(GLsizei)m->indices.size(),GL_UNSIGNED_INT,0);
    }
    glDisableVertexAttribArray(0);glDisableVertexAttribArray(1);glDisableVertexAttribArray(2);
}
} // namespace
#endif // LUMENT_BACKEND_GLES2

// ============================================================
// 7. 渲染入口（遍历场景图）
// ============================================================
namespace {
void compute_world(NodeData* n,const float* parentWorld){
    float local[16]; math3d::mat4_identity(local);
    float rmat[9]; math3d::quat_to_mat3(n->rot,rmat);
    local[0]=rmat[0]*n->scl[0]; local[1]=rmat[1]*n->scl[0]; local[2]=rmat[2]*n->scl[0];
    local[4]=rmat[3]*n->scl[1]; local[5]=rmat[4]*n->scl[1]; local[6]=rmat[5]*n->scl[1];
    local[8]=rmat[6]*n->scl[2]; local[9]=rmat[7]*n->scl[2]; local[10]=rmat[8]*n->scl[2];
    local[12]=n->pos[0]; local[13]=n->pos[1]; local[14]=n->pos[2];
    math3d::mat4_mul(n->worldMat, parentWorld, local);
    n->worldPos[0]=n->worldMat[12]; n->worldPos[1]=n->worldMat[13]; n->worldPos[2]=n->worldMat[14];
}

// 从 viewProj（列主序）提取 6 个视锥平面（Gribb-Hartmann 法），每个平面 (a,b,c,d)。
void extract_frustum(const float* m, float* planes){
    auto getRow=[&](int r, float* o){ o[0]=m[r]; o[1]=m[4+r]; o[2]=m[8+r]; o[3]=m[12+r]; };
    float r0[4],r1[4],r2[4],r3[4]; getRow(0,r0);getRow(1,r1);getRow(2,r2);getRow(3,r3);
    int idx[6]={0,0,1,1,2,2}; int sign[6]={1,-1,1,-1,1,-1}; // left,right,bottom,top,near,far
    for(int i=0;i<6;++i){
        float* P=planes+i*4; const float* rrow=(idx[i]==0?r0:(idx[i]==1?r1:r2)); float s=sign[i];
        P[0]=r3[0]+s*rrow[0]; P[1]=r3[1]+s*rrow[1]; P[2]=r3[2]+s*rrow[2]; P[3]=r3[3]+s*rrow[3];
        float len=std::sqrt(P[0]*P[0]+P[1]*P[1]+P[2]*P[2]);
        if(len>1e-8f){ P[0]/=len; P[1]/=len; P[2]/=len; P[3]/=len; }
    }
}

// 计算节点的世界包围盒（基于其 mesh/model 的本地包围盒经 worldMat 仿射变换）。
// 若节点自身无几何（仅作 group），返回无效包围盒（调用方据此不剔除）。
LumentAABB compute_node_world_bounds(NodeData* n){
    LumentAABB local = { {1e30f,1e30f,1e30f},{-1e30f,-1e30f,-1e30f} };
    bool has=false;
    if(n->mesh){ MeshData* m=g_meshes.get(n->mesh); if(m){ local=m->bounds; has=true; } }
    else if(n->model){ ModelData* md=g_models.get(n->model); if(md){ local=md->bounds; has=true; } }
    LumentAABB out = { {1e30f,1e30f,1e30f},{-1e30f,-1e30f,-1e30f} };
    if(!has) return out;
    const float* M=n->worldMat;
    for(int c=0;c<8;++c){
        float lx=(c&1)?local.max.x:local.min.x;
        float ly=(c&2)?local.max.y:local.min.y;
        float lz=(c&4)?local.max.z:local.min.z;
        float wx=M[0]*lx+M[4]*ly+M[8]*lz+M[12];
        float wy=M[1]*lx+M[5]*ly+M[9]*lz+M[13];
        float wz=M[2]*lx+M[6]*ly+M[10]*lz+M[14];
        if(wx<out.min.x)out.min.x=wx; if(wx>out.max.x)out.max.x=wx;
        if(wy<out.min.y)out.min.y=wy; if(wy>out.max.y)out.max.y=wy;
        if(wz<out.min.z)out.min.z=wz; if(wz>out.max.z)out.max.z=wz;
    }
    return out;
}

// 测试 AABB 是否在视锥内（任一平面外则整体剔除）。
bool aabb_in_frustum(const LumentAABB& b, const float* planes){
    if(b.min.x>b.max.x) return true; // 无效包围盒：不剔除（group 节点继续递归）
    for(int i=0;i<6;++i){
        const float* p=planes+i*4;
        float mx = p[0]>=0?b.max.x:b.min.x;
        float my = p[1]>=0?b.max.y:b.min.y;
        float mz = p[2]>=0?b.max.z:b.min.z;
        if(p[0]*mx + p[1]*my + p[2]*mz + p[3] < 0.0f) return false;
    }
    return true;
}
void draw_node(NodeData* n,const float* viewProj, const float* planes){
    if(!n->visible) return;
    // 视锥剔除：基于本节点世界包围盒，整体跳过（含子树）；group 节点（无几何）继续递归。
    if(planes){
        ++g_cullTotal;
        n->worldBounds = compute_node_world_bounds(n);
        if(!aabb_in_frustum(n->worldBounds, planes)){ return; }
        ++g_cullVisible;
    }
    // 绘制自身 mesh / model
    if(n->mesh){
        float mvp[16]; math3d::mat4_mul(mvp, viewProj, n->worldMat);
        MeshData* m=g_meshes.get(n->mesh); MaterialData* mat=g_materials.get(n->material);
        if(m){
#if defined(LUMENT_BACKEND_GLES2)
            LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat));
            if(mat) dmat=mat->desc; else { dmat.baseColor={255,255,255,255}; dmat.roughness=1; dmat.opacity=1; }
            render_mesh_gl(m,mvp,n->worldMat,&dmat);
#endif
        }
    }
    if(n->model){
        ModelData* md=g_models.get(n->model);
        if(md){
            for(size_t i=0;i<md->meshes.size();++i){
                float mvp[16]; math3d::mat4_mul(mvp, viewProj, n->worldMat);
                MeshData* m=g_meshes.get(md->meshes[i]); MaterialData* mat=g_materials.get(md->materials[i]);
                if(m){
#if defined(LUMENT_BACKEND_GLES2)
                    LumentCubeMaterial dmat; std::memset(&dmat,0,sizeof(dmat));
                    if(mat) dmat=mat->desc; else { dmat.baseColor={255,255,255,255}; dmat.roughness=1; dmat.opacity=1; }
                    render_mesh_gl(m,mvp,n->worldMat,&dmat);
#endif
                }
            }
        }
    }
    // 递归子节点：先以本节点世界矩阵为父，级联计算子节点世界变换（修复层级变换）。
    for(int c:n->children){ NodeData* cn=g_nodes.get((uint32_t)(c+1)); if(cn){ compute_world(cn,n->worldMat); draw_node(cn,viewProj,planes); } }
}
} // namespace

// ============================================================
// 8. 内部生命周期
// ============================================================
namespace ue {
bool init_cube(){
    if(g_cubeInit) return true;
    g_cubeInit=true;
    return true;
}
void shutdown_cube(){
    g_meshes.items.clear(); g_meshes.free.clear();
    g_materials.items.clear(); g_materials.free.clear();
    g_models.items.clear(); g_models.free.clear();
    g_nodes.items.clear(); g_nodes.free.clear();
    g_cameras.items.clear(); g_cameras.free.clear();
    g_sceneRoots.clear(); g_lights.clear();
    g_cubeInit=false;
}
} // namespace ue

// ============================================================
// 9. C ABI 实现
// ============================================================
extern "C" {

// --- 数学 ---
LUMENT_API void lument_cube_mat4_identity(LumentMat4* m){ if(m) math3d::mat4_identity(m->m); }
LUMENT_API void lument_cube_mat4_perspective(LumentMat4* m,float fovYDeg,float aspect,float n,float f){ if(m) math3d::mat4_perspective(m->m,fovYDeg,aspect,n,f); }
LUMENT_API void lument_cube_mat4_look_at(LumentMat4* m,const LumentVec3* eye,const LumentVec3* center,const LumentVec3* up){
    if(!m||!eye||!center||!up) return; float e[3]={eye->x,eye->y,eye->z},c[3]={center->x,center->y,center->z},u[3]={up->x,up->y,up->z};
    math3d::mat4_look_at(m->m,e,c,u);
}
LUMENT_API void lument_cube_mat4_multiply(LumentMat4* out,const LumentMat4* a,const LumentMat4* b){ if(out&&a&&b) math3d::mat4_mul(out->m,a->m,b->m); }
LUMENT_API void lument_cube_mat4_transpose(LumentMat4* m){ if(m) math3d::mat4_transpose(m->m); }
LUMENT_API void lument_cube_mat4_invert(LumentMat4* m){ if(m) math3d::mat4_invert(m->m); }
LUMENT_API void lument_cube_quat_from_euler(LumentQuat* q,float p,float y,float r){ if(q){ float qv[4]; math3d::quat_from_euler(qv,p,y,r); q->x=qv[0];q->y=qv[1];q->z=qv[2];q->w=qv[3]; } }
LUMENT_API void lument_cube_quat_normalize(LumentQuat* q){ if(q){ float qv[4]={q->x,q->y,q->z,q->w}; math3d::quat_normalize(qv); q->x=qv[0];q->y=qv[1];q->z=qv[2];q->w=qv[3]; } }
LUMENT_API void lument_cube_vec3_normalize(LumentVec3* v){ if(v){ float qv[3]={v->x,v->y,v->z}; math3d::v3normalize(qv); v->x=qv[0];v->y=qv[1];v->z=qv[2]; } }
LUMENT_API void lument_cube_mat4_ortho(LumentMat4* m,float l,float r,float b,float t,float n,float f){ if(m) math3d::mat4_ortho(m->m,l,r,b,t,n,f); }

// --- 摄像机 ---
LUMENT_API LumentCamera3DHandle lument_cube_create_camera(void){
    uint32_t h=g_cameras.alloc(); CamData* c=g_cameras.get(h);
    c->desc.position={0,0,5}; c->desc.target={0,0,0}; c->desc.up={0,1,0};
    c->desc.fovY=60.0f; c->desc.nearPlane=0.1f; c->desc.farPlane=100.0f; c->desc.aspect=16.0f/9.0f;
    c->desc.projection=LUMENT_CUBE_PROJECTION_PERSPECTIVE;
    return h;
}
LUMENT_API void lument_cube_set_camera(LumentCamera3DHandle cam,const LumentCamera3D* d){
    CamData* c=g_cameras.get(cam); if(!c||!d) return; c->desc=*d;
}
LUMENT_API void lument_cube_set_camera_projection(LumentCamera3DHandle cam,int projection){
    CamData* c=g_cameras.get(cam); if(!c) return; c->desc.projection=projection;
}
LUMENT_API void lument_cube_get_camera(LumentCamera3DHandle cam,LumentCamera3D* out){
    CamData* c=g_cameras.get(cam); if(!c||!out) return; *out=c->desc;
}
LUMENT_API void lument_cube_destroy_camera(LumentCamera3DHandle cam){ g_cameras.release(cam); }

// --- 网格 ---
LUMENT_API LumentMesh lument_cube_create_mesh(const float* positions,int vertexCount,const float* normals,const float* uvs,const uint32_t* indices,int indexCount){
    if(!positions||vertexCount<=0) return 0;
    uint32_t h=g_meshes.alloc(); MeshData* m=g_meshes.get(h);
    m->positions.assign(positions,positions+vertexCount*3);
    if(normals){ m->normals.assign(normals,normals+vertexCount*3); m->hasNormals=true; }
    if(uvs){ m->uvs.assign(uvs,uvs+vertexCount*2); m->hasUVs=true; }
    if(indices&&indexCount>0) m->indices.assign(indices,indices+indexCount);
    compute_bounds(m); return h;
}
LUMENT_API LumentMesh lument_cube_create_box(float sx,float sy,float sz){ uint32_t h=g_meshes.alloc(); make_box(sx,sy,sz,g_meshes.get(h)); compute_bounds(g_meshes.get(h)); return h; }
LUMENT_API LumentMesh lument_cube_create_plane(float w,float h){ uint32_t hh=g_meshes.alloc(); make_plane(w,h,g_meshes.get(hh)); compute_bounds(g_meshes.get(hh)); return hh; }
LUMENT_API LumentMesh lument_cube_create_sphere(float radius,int seg){ uint32_t h=g_meshes.alloc(); make_sphere(radius,seg,g_meshes.get(h)); compute_bounds(g_meshes.get(h)); return h; }
LUMENT_API LumentMesh lument_cube_create_cylinder(float rTop,float rBot,float h,int seg){ if(seg<3)seg=3; uint32_t hh=g_meshes.alloc(); make_cylinder(rTop,rBot,h,seg,g_meshes.get(hh)); compute_bounds(g_meshes.get(hh)); return hh; }
LUMENT_API LumentMesh lument_cube_create_cone(float radius,float h,int seg){ if(seg<3)seg=3; uint32_t hh=g_meshes.alloc(); make_cylinder(0.0f,radius,h,seg,g_meshes.get(hh)); compute_bounds(g_meshes.get(hh)); return hh; }
LUMENT_API LumentMesh lument_cube_create_torus(float R,float r,int rseg,int tseg){ if(rseg<3)rseg=3; if(tseg<3)tseg=3; uint32_t hh=g_meshes.alloc(); make_torus(R,r,rseg,tseg,g_meshes.get(hh)); compute_bounds(g_meshes.get(hh)); return hh; }
LUMENT_API void lument_cube_destroy_mesh(LumentMesh mesh){
    MeshData* m=g_meshes.get(mesh);
#if defined(LUMENT_BACKEND_GLES2)
    if(m&&m->gpuUploaded){ if(m->vboPos)glDeleteBuffers(1,&m->vboPos); if(m->vboNrm)glDeleteBuffers(1,&m->vboNrm); if(m->vboUV)glDeleteBuffers(1,&m->vboUV); if(m->ibo)glDeleteBuffers(1,&m->ibo); }
#endif
    (void)m;
    g_meshes.release(mesh);
}
LUMENT_API void lument_cube_get_mesh_bounds(LumentMesh mesh,LumentAABB* out){ MeshData* m=g_meshes.get(mesh); if(m&&out)*out=m->bounds; }
LUMENT_API int lument_cube_get_mesh_vertex_count(LumentMesh mesh){ MeshData* m=g_meshes.get(mesh); return m?(int)(m->positions.size()/3):0; }
LUMENT_API int lument_cube_get_mesh_index_count(LumentMesh mesh){ MeshData* m=g_meshes.get(mesh); return m?(int)m->indices.size():0; }

// --- 材质 ---
LUMENT_API LumentMaterial lument_cube_create_material(const LumentCubeMaterial* d){
    uint32_t h=g_materials.alloc(); if(d) g_materials.get(h)->desc=*d; return h;
}
LUMENT_API void lument_cube_destroy_material(LumentMaterial mat){ g_materials.release(mat); }
LUMENT_API void lument_cube_material_set_color(LumentMaterial mat,LumentColor color){ MaterialData* m=g_materials.get(mat); if(m) m->desc.baseColor=color; }
LUMENT_API void lument_cube_material_set_map(LumentMaterial mat,uint32_t albedo,uint32_t normal,uint32_t emissive){ MaterialData* m=g_materials.get(mat); if(m){ m->desc.albedoMap=albedo;m->desc.normalMap=normal;m->desc.emissiveMap=emissive; } }
LUMENT_API void lument_cube_material_set_pbr(LumentMaterial mat,float metallic,float roughness){ MaterialData* m=g_materials.get(mat); if(m){ m->desc.metallic=metallic;m->desc.roughness=roughness; } }

// --- 模型加载 ---
LUMENT_API LumentModel lument_cube_load_model(const char* path){
    if(!path) return 0;
    LumentCubeFormat fmt=detect_format(path);
    return lument_cube_load_model_format(path,fmt);
}
LUMENT_API LumentModel lument_cube_load_model_format(const char* path,LumentCubeFormat fmt){
    if(!path) return 0;
    ModelData* md=dispatch_load(path,fmt);
    if(!md) return 0;
    uint32_t h=g_models.alloc(); ModelData* dst=g_models.get(h); *dst=*md; delete md; return h;
}
LUMENT_API LumentModel lument_cube_load_model_memory(const void* data,int size,LumentCubeFormat fmt,const char* hintName){
    if(!data||size<=0) return 0;
    const uint8_t* p=(const uint8_t*)data;
    std::vector<uint8_t> blob(p,p+size);
    ModelData* md=nullptr;
    if(fmt==LUMENT_CUBE_FORMAT_GLB) md=load_glb(blob);
    else if(fmt==LUMENT_CUBE_FORMAT_GLTF){ std::vector<uint8_t> e; md=load_gltf(blob,e); }
    else if(fmt==LUMENT_CUBE_FORMAT_OBJ) md=load_obj(blob,"");
    else if(fmt==LUMENT_CUBE_FORMAT_STL) md=load_stl(blob);
    else if(fmt==LUMENT_CUBE_FORMAT_PLY) md=load_ply(blob);
    else if(fmt==LUMENT_CUBE_FORMAT_DAE) md=load_dae(blob);
    if(!md) return 0;
    uint32_t h=g_models.alloc(); ModelData* dst=g_models.get(h); *dst=*md; delete md; return h;
}
LUMENT_API void lument_cube_destroy_model(LumentModel model){ g_models.release(model); }
LUMENT_API bool lument_cube_model_ready(LumentModel model){ ModelData* m=g_models.get(model); return m?!m->ready:false; }
LUMENT_API int lument_cube_model_mesh_count(LumentModel model){ ModelData* m=g_models.get(model); return m?(int)m->meshes.size():0; }
LUMENT_API LumentMesh lument_cube_model_get_mesh(LumentModel model,int index){ ModelData* m=g_models.get(model); if(m&&index>=0&&index<(int)m->meshes.size()) return m->meshes[index]; return 0; }
LUMENT_API LumentMaterial lument_cube_model_get_material(LumentModel model,int index){ ModelData* m=g_models.get(model); if(m&&index>=0&&index<(int)m->materials.size()) return m->materials[index]; return 0; }
LUMENT_API void lument_cube_model_get_bounds(LumentModel model,LumentAABB* out){ ModelData* m=g_models.get(model); if(m&&out)*out=m->bounds; }
LUMENT_API const char* lument_cube_format_name(LumentCubeFormat fmt){
    switch(fmt){
        case LUMENT_CUBE_FORMAT_GLTF: return "glTF";
        case LUMENT_CUBE_FORMAT_GLB: return "glTF Binary";
        case LUMENT_CUBE_FORMAT_OBJ: return "Wavefront OBJ";
        case LUMENT_CUBE_FORMAT_STL: return "STL";
        case LUMENT_CUBE_FORMAT_PLY: return "PLY";
        case LUMENT_CUBE_FORMAT_DAE: return "COLLADA";
        case LUMENT_CUBE_FORMAT_FBX: return "FBX";
        case LUMENT_CUBE_FORMAT_BLEND: return "Blender";
        default: return "Unknown";
    }
}
LUMENT_API int lument_cube_supported_format_count(void){ return 8; }
LUMENT_API void lument_cube_get_supported_formats(LumentCubeFormat* out,int maxCount,int* outCount){
    LumentCubeFormat all[8]={ LUMENT_CUBE_FORMAT_GLTF,LUMENT_CUBE_FORMAT_GLB,LUMENT_CUBE_FORMAT_OBJ,
        LUMENT_CUBE_FORMAT_STL,LUMENT_CUBE_FORMAT_PLY,LUMENT_CUBE_FORMAT_DAE,LUMENT_CUBE_FORMAT_FBX,LUMENT_CUBE_FORMAT_BLEND };
    int n=0; for(int i=0;i<8&&i<maxCount;++i) out[i]=all[i]; n=std::min(8,maxCount);
    if(outCount)*outCount=n;
}

// --- 场景图 ---
LUMENT_API LumentNode3D lument_cube_create_node(void){
    uint32_t h=g_nodes.alloc(); NodeData* n=g_nodes.get(h);
    math3d::mat4_identity(n->worldMat);
    g_sceneRoots.push_back((int)h-1);
    return h;
}
LUMENT_API void lument_cube_destroy_node(LumentNode3D node){ g_nodes.release(node); }
LUMENT_API void lument_cube_node_set_transform(LumentNode3D node,const LumentVec3* pos,const LumentQuat* rot,const LumentVec3* scl){
    NodeData* n=g_nodes.get(node); if(!n) return;
    if(pos){ n->pos[0]=pos->x;n->pos[1]=pos->y;n->pos[2]=pos->z; }
    if(rot){ n->rot[0]=rot->x;n->rot[1]=rot->y;n->rot[2]=rot->z;n->rot[3]=rot->w; }
    if(scl){ n->scl[0]=scl->x;n->scl[1]=scl->y;n->scl[2]=scl->z; }
}
LUMENT_API void lument_cube_node_set_position(LumentNode3D node,LumentVec3 pos){ NodeData* n=g_nodes.get(node); if(n){ n->pos[0]=pos.x;n->pos[1]=pos.y;n->pos[2]=pos.z; } }
LUMENT_API void lument_cube_node_set_rotation_euler(LumentNode3D node,float p,float y,float r){ NodeData* n=g_nodes.get(node); if(n){ math3d::quat_from_euler(n->rot,p,y,r); } }
LUMENT_API void lument_cube_node_set_scale(LumentNode3D node,LumentVec3 s){ NodeData* n=g_nodes.get(node); if(n){ n->scl[0]=s.x;n->scl[1]=s.y;n->scl[2]=s.z; } }
LUMENT_API void lument_cube_node_get_world_position(LumentNode3D node,LumentVec3* out){ NodeData* n=g_nodes.get(node); if(n&&out){ out->x=n->worldPos[0];out->y=n->worldPos[1];out->z=n->worldPos[2]; } }
LUMENT_API void lument_cube_node_set_mesh(LumentNode3D node,LumentMesh mesh){ NodeData* n=g_nodes.get(node); if(n) n->mesh=mesh; }
LUMENT_API void lument_cube_node_set_material(LumentNode3D node,LumentMaterial mat){ NodeData* n=g_nodes.get(node); if(n) n->material=mat; }
LUMENT_API void lument_cube_node_set_model(LumentNode3D node,LumentModel model){ NodeData* n=g_nodes.get(node); if(n) n->model=model; }
LUMENT_API void lument_cube_node_set_visible(LumentNode3D node,bool vis){ NodeData* n=g_nodes.get(node); if(n) n->visible=vis; }
LUMENT_API LumentNode3D lument_cube_node_add_child(LumentNode3D parent,LumentNode3D child){
    NodeData* p=g_nodes.get(parent); NodeData* c=g_nodes.get(child); if(!p||!c) return 0;
    lument_cube_node_set_parent(child,parent); return child;
}
LUMENT_API void lument_cube_node_set_parent(LumentNode3D node,LumentNode3D parent){
    NodeData* n=g_nodes.get(node); NodeData* p=g_nodes.get(parent); if(!n||!p) return;
    // 从旧父/根移除
    if(n->parent>=0){ NodeData* op=g_nodes.get((uint32_t)(n->parent+1)); if(op){ for(size_t i=0;i<op->children.size();++i) if(op->children[i]==(int)node-1){ op->children.erase(op->children.begin()+i); break; } } }
    else { for(size_t i=0;i<g_sceneRoots.size();++i) if(g_sceneRoots[i]==(int)node-1){ g_sceneRoots.erase(g_sceneRoots.begin()+i); break; } }
    n->parent=(int)parent-1; p->children.push_back((int)node-1);
}
LUMENT_API void lument_cube_node_detach(LumentNode3D node){
    NodeData* n=g_nodes.get(node); if(!n) return;
    if(n->parent>=0){ NodeData* op=g_nodes.get((uint32_t)(n->parent+1)); if(op){ for(size_t i=0;i<op->children.size();++i) if(op->children[i]==(int)node-1){ op->children.erase(op->children.begin()+i); break; } } n->parent=-1; }
    g_sceneRoots.push_back((int)node-1);
}

// --- 光照 ---
LUMENT_API int lument_cube_add_light(LumentCubeLightType type,LumentVec3 pOrD,LumentColor color,float intensity,float range){
    LightData l; l.type=type; l.posOrDir[0]=pOrD.x;l.posOrDir[1]=pOrD.y;l.posOrDir[2]=pOrD.z; l.color=color; l.intensity=intensity; l.range=range;
    g_lights.push_back(l); return (int)g_lights.size()-1;
}
LUMENT_API void lument_cube_set_light_position(int id,LumentVec3 pOrD){ if(id>=0&&id<(int)g_lights.size()){ g_lights[id].posOrDir[0]=pOrD.x;g_lights[id].posOrDir[1]=pOrD.y;g_lights[id].posOrDir[2]=pOrD.z; } }
LUMENT_API void lument_cube_set_light_intensity(int id,float i){ if(id>=0&&id<(int)g_lights.size()) g_lights[id].intensity=i; }
LUMENT_API void lument_cube_set_light_color(int id,LumentColor c){ if(id>=0&&id<(int)g_lights.size()) g_lights[id].color=c; }
LUMENT_API void lument_cube_set_ambient(LumentColor color,float intensity){ g_ambientColor[0]=color.r/255.0f;g_ambientColor[1]=color.g/255.0f;g_ambientColor[2]=color.b/255.0f; g_ambientI=intensity; }
LUMENT_API void lument_cube_remove_light(int id){ if(id>=0&&id<(int)g_lights.size()) g_lights.erase(g_lights.begin()+id); }
LUMENT_API void lument_cube_clear_lights(void){ g_lights.clear(); }

// --- 渲染 ---
LUMENT_API void lument_cube_set_background(LumentColor color){ g_bg=color; }
LUMENT_API void lument_cube_set_wireframe(bool on){ g_wireframe=on; }
LUMENT_API bool lument_cube_get_wireframe(void){ return g_wireframe; }
LUMENT_API void lument_cube_get_cull_stats(int* total,int* visible){
    if(total)*total=g_cullTotal; if(visible)*visible=g_cullVisible;
}
LUMENT_API void lument_cube_clear(LumentColor color){ g_bg=color; (void)color; }
LUMENT_API void lument_cube_render(LumentCamera3DHandle cam){
    CamData* c=g_cameras.get(cam); if(!c) return;
    float eye[3]={c->desc.position.x,c->desc.position.y,c->desc.position.z};
    float ctr[3]={c->desc.target.x,c->desc.target.y,c->desc.target.z};
    float up[3]={c->desc.up.x,c->desc.up.y,c->desc.up.z};
    math3d::mat4_look_at(c->view,eye,ctr,up);
    float dist=-c->view[14]; if(dist<=0.0f) dist=5.0f;
    if(c->desc.projection==LUMENT_CUBE_PROJECTION_ORTHO){
        float halfH=std::tan(c->desc.fovY*3.14159265f/180.0f*0.5f)*dist;
        float halfW=halfH*c->desc.aspect;
        math3d::mat4_ortho(c->proj,-halfW,halfW,-halfH,halfH,c->desc.nearPlane,c->desc.farPlane);
    } else {
        math3d::mat4_perspective(c->proj,c->desc.fovY,c->desc.aspect,c->desc.nearPlane,c->desc.farPlane);
    }
    float viewProj[16]; math3d::mat4_mul(viewProj,c->proj,c->view);
    float planes[24]; extract_frustum(viewProj, planes);
    g_cullTotal=0; g_cullVisible=0;
    float identity[16]; math3d::mat4_identity(identity);
    for(int r:g_sceneRoots){ NodeData* n=g_nodes.get((uint32_t)(r+1)); if(!n) continue; compute_world(n,identity); draw_node(n,viewProj,planes); }
}
LUMENT_API void lument_cube_render_node(LumentCamera3DHandle cam,LumentNode3D root){
    CamData* c=g_cameras.get(cam); NodeData* n=g_nodes.get(root); if(!c||!n) return;
    float eye[3]={c->desc.position.x,c->desc.position.y,c->desc.position.z};
    float ctr[3]={c->desc.target.x,c->desc.target.y,c->desc.target.z};
    float up[3]={c->desc.up.x,c->desc.up.y,c->desc.up.z};
    math3d::mat4_look_at(c->view,eye,ctr,up);
    float dist=-c->view[14]; if(dist<=0.0f) dist=5.0f;
    if(c->desc.projection==LUMENT_CUBE_PROJECTION_ORTHO){
        float halfH=std::tan(c->desc.fovY*3.14159265f/180.0f*0.5f)*dist;
        float halfW=halfH*c->desc.aspect;
        math3d::mat4_ortho(c->proj,-halfW,halfW,-halfH,halfH,c->desc.nearPlane,c->desc.farPlane);
    } else {
        math3d::mat4_perspective(c->proj,c->desc.fovY,c->desc.aspect,c->desc.nearPlane,c->desc.farPlane);
    }
    float viewProj[16]; math3d::mat4_mul(viewProj,c->proj,c->view);
    float planes[24]; extract_frustum(viewProj, planes);
    g_cullTotal=0; g_cullVisible=0;
    float identity[16]; math3d::mat4_identity(identity);
    compute_world(n,identity); draw_node(n,viewProj,planes);
}
LUMENT_API void lument_cube_render_model(LumentCamera3DHandle cam,LumentModel model,const LumentVec3* pos,const LumentQuat* rot,const LumentVec3* scl){
    LumentNode3D n=lument_cube_create_node();
    if(pos){ LumentVec3 p=*pos; lument_cube_node_set_position(n,p); }
    if(rot){ LumentQuat q=*rot; lument_cube_node_set_transform(n,nullptr,&q,nullptr); }
    if(scl){ LumentVec3 s=*scl; lument_cube_node_set_scale(n,s); }
    lument_cube_node_set_model(n,model);
    lument_cube_render_node(cam,n);
    lument_cube_destroy_node(n);
}
LUMENT_API void lument_cube_init(void){ ue::init_cube(); }
LUMENT_API void lument_cube_shutdown(void){ ue::shutdown_cube(); }
LUMENT_API int lument_cube_get_mesh_total(void){ return (int)g_meshes.items.size(); }
} // extern "C"
