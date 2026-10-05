// cube_loader_test.cpp - Lument Cube 加载器与数学单元测试
// 通过内存加载验证 3D 加载器与图元生成逻辑（无需 GPU）。
#include "lument_internal.h"
#include <cstdio>
#include <cstring>
#include <cstdint>
#include <string>
#include <vector>

static int g_fail=0;
#define CHECK(cond,msg) do{ if(!(cond)){ printf("  [FAIL] %s\n",msg); ++g_fail; } else printf("  [ ok ] %s\n",msg); }while(0)

// 简易 base64 编码（供 glTF data URI 测试用）
static std::string b64(const std::vector<uint8_t>& in){
    static const char t[]="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out; size_t i=0;
    while(i+3<=in.size()){ uint32_t v=(in[i]<<16)|(in[i+1]<<8)|in[i+2];
        out+=t[(v>>18)&63];out+=t[(v>>12)&63];out+=t[(v>>6)&63];out+=t[v&63]; i+=3; }
    if(in.size()-i==1){ uint32_t v=in[i]<<16; out+=t[(v>>18)&63];out+=t[(v>>12)&63];out+="=="; }
    else if(in.size()-i==2){ uint32_t v=(in[i]<<16)|(in[i+1]<<8); out+=t[(v>>18)&63];out+=t[(v>>12)&63];out+=t[(v>>6)&63];out+="="; }
    return out;
}

int main(){
    printf("=== Lument Cube 3D 加载器单元测试 ===\n");

    // 1. 程序化图元
    printf("[图元]\n");
    LumentMesh box=lument_cube_create_box(2,2,2);
    CHECK(lument_cube_get_mesh_vertex_count(box)==24, "box 顶点数=24");
    CHECK(lument_cube_get_mesh_index_count(box)==36, "box 索引数=36");
    LumentAABB bb; lument_cube_get_mesh_bounds(box,&bb);
    CHECK(bb.min.x==-1 && bb.max.x==1, "box 包围盒 x=[-1,1]");
    LumentMesh sph=lument_cube_create_sphere(1.0f,8);
    CHECK(lument_cube_get_mesh_vertex_count(sph)==81, "sphere(8) 顶点数=81");
    CHECK(lument_cube_get_mesh_index_count(sph)==384, "sphere(8) 索引数=384");
    LumentMesh pl=lument_cube_create_plane(4,4);
    CHECK(lument_cube_get_mesh_index_count(pl)==6, "plane 索引数=6");
    LumentMesh cyl=lument_cube_create_cylinder(1.0f,1.0f,2.0f,12);
    CHECK(lument_cube_get_mesh_vertex_count(cyl)==54, "cylinder(12) 顶点数=54 (侧壁26+顶盖14+底盖14)");
    CHECK(lument_cube_get_mesh_index_count(cyl)==144, "cylinder(12) 索引数=144");
    LumentMesh cone=lument_cube_create_cone(1.0f,2.0f,12);
    CHECK(lument_cube_get_mesh_vertex_count(cone)==40, "cone(12) 顶点数=40 (无顶盖)");
    CHECK(lument_cube_get_mesh_index_count(cone)==108, "cone(12) 索引数=108");
    LumentMesh tor=lument_cube_create_torus(1.0f,0.3f,8,16);
    CHECK(lument_cube_get_mesh_vertex_count(tor)==153, "torus(8,16) 顶点数=153");
    CHECK(lument_cube_get_mesh_index_count(tor)==768, "torus(8,16) 索引数=768");

    // 2. OBJ（内存）
    printf("[OBJ]\n");
    const char* obj="v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n";
    LumentModel mObj=lument_cube_load_model_memory(obj,(int)strlen(obj),LUMENT_CUBE_FORMAT_OBJ,"tri.obj");
    CHECK(mObj!=0, "OBJ 模型加载成功");
    if(mObj){ CHECK(lument_cube_model_mesh_count(mObj)==1,"OBJ 子网格=1");
        LumentMesh mo=lument_cube_model_get_mesh(mObj,0);
        CHECK(lument_cube_get_mesh_vertex_count(mo)==3,"OBJ 顶点=3");
        CHECK(lument_cube_get_mesh_index_count(mo)==3,"OBJ 索引=3"); }

    // 3. STL 二进制（内存）
    printf("[STL binary]\n");
    { std::vector<uint8_t> s; s.resize(84,0); uint32_t n=1; memcpy(s.data()+80,&n,4);
      float tri[12]={0,0,0, 1,0,0, 0,1,0, 0,0,0}; // 法线(3)+3顶点(9)
      s.insert(s.end(),(uint8_t*)tri,(uint8_t*)tri+48); uint16_t attr=0; s.insert(s.end(),(uint8_t*)&attr,(uint8_t*)&attr+2);
      LumentModel mStl=lument_cube_load_model_memory(s.data(),(int)s.size(),LUMENT_CUBE_FORMAT_STL,"t.stl");
      CHECK(mStl!=0,"STL 模型加载成功");
      if(mStl){ LumentMesh ms=lument_cube_model_get_mesh(mStl,0);
        CHECK(lument_cube_get_mesh_vertex_count(ms)==3,"STL 顶点=3");
        CHECK(lument_cube_get_mesh_index_count(ms)==3,"STL 索引=3"); } }

    // 4. PLY ASCII（内存）
    printf("[PLY ascii]\n");
    const char* ply=
      "ply\nformat ascii 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\n"
      "element face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n1 0 0\n0 1 0\n3 0 1 2\n";
    LumentModel mPly=lument_cube_load_model_memory(ply,(int)strlen(ply),LUMENT_CUBE_FORMAT_PLY,"t.ply");
    CHECK(mPly!=0,"PLY 模型加载成功");
    if(mPly){ LumentMesh mp=lument_cube_model_get_mesh(mPly,0);
      CHECK(lument_cube_get_mesh_vertex_count(mp)==3,"PLY 顶点=3");
      CHECK(lument_cube_get_mesh_index_count(mp)==3,"PLY 索引=3"); }

    // 5. glTF 2.0（内存，data URI 内嵌二进制）
    printf("[glTF]\n");
    {
      // 单个三角形：positions(3*3 float) + indices(3 * ushort)
      std::vector<uint8_t> bin;
      float pos[9]={0,0,0, 1,0,0, 0,1,0};
      for(int i=0;i<9;i++){ uint8_t* p=(uint8_t*)&pos[i]; bin.insert(bin.end(),p,p+4); }
      uint16_t idx[3]={0,1,2};
      for(int i=0;i<3;i++){ uint8_t* p=(uint8_t*)&idx[i]; bin.insert(bin.end(),p,p+2); }
      // bufferView0: positions offset0 len36 ; bufferView1: indices offset36 len6
      std::string uri="data:application/octet-stream;base64,"+b64(bin);
      std::string gltf=
        "{\"asset\":{\"version\":\"2.0\"},"
        "\"buffers\":[{\"byteLength\":"+std::to_string(bin.size())+",\"uri\":\""+uri+"\"}],"
        "\"bufferViews\":[{\"buffer\":0,\"byteOffset\":0,\"byteLength\":36},"
        "{\"buffer\":0,\"byteOffset\":36,\"byteLength\":6}],"
        "\"accessors\":[{\"bufferView\":0,\"componentType\":5126,\"count\":3,\"type\":\"VEC3\"},"
        "{\"bufferView\":1,\"componentType\":5123,\"count\":3,\"type\":\"SCALAR\"}],"
        "\"meshes\":[{\"primitives\":[{\"attributes\":{\"POSITION\":0},\"indices\":1}]}]}";
      LumentModel mG=lument_cube_load_model_memory(gltf.data(),(int)gltf.size(),LUMENT_CUBE_FORMAT_GLTF,"t.gltf");
      CHECK(mG!=0,"glTF 模型加载成功");
      if(mG){ LumentMesh mg=lument_cube_model_get_mesh(mG,0);
        CHECK(lument_cube_get_mesh_vertex_count(mg)==3,"glTF 顶点=3");
        CHECK(lument_cube_get_mesh_index_count(mg)==3,"glTF 索引=3"); }
    }

    // 6. 数学
    printf("[数学]\n");
    LumentMat4 I; lument_cube_mat4_identity(&I);
    CHECK(I.m[0]==1&&I.m[5]==1&&I.m[10]==1&&I.m[15]==1,"单位矩阵对角线");
    LumentMat4 P; lument_cube_mat4_perspective(&P,60.0f,1.5f,0.1f,100.0f);
    CHECK(P.m[11]==-1.0f,"透视矩阵 m[11]=-1");
    LumentMat4 V; LumentVec3 eye={0,0,5},ctr={0,0,0},up={0,1,0};
    lument_cube_mat4_look_at(&V,&eye,&ctr,&up);
    CHECK(V.m[14]<0,"look_at 摄像机后退 z"); // -dot(z,eye) <0
    LumentQuat q; lument_cube_quat_from_euler(&q,0,90,0); lument_cube_quat_normalize(&q);
    CHECK(q.w>0.7f&&q.y>0.7f,"四元数 绕Y 90° ≈ (0,0.707,0,0.707)");
    LumentMat4 O; lument_cube_mat4_ortho(&O,-2.0f,2.0f,-1.0f,1.0f,0.1f,100.0f);
    CHECK(O.m[0]>0.49f&&O.m[0]<0.51f,"正交矩阵 m[0]=2/(r-l)=0.5");
    CHECK(O.m[5]>0.99f&&O.m[5]<1.01f,"正交矩阵 m[5]=2/(t-b)=1");
    CHECK(O.m[11]==0.0f,"正交矩阵 m[11]=0（区别于透视的 -1）");

    // 7. 相机投影与渲染状态
    printf("[相机/渲染状态]\n");
    LumentCamera3DHandle cam=lument_cube_create_camera();
    CHECK(cam!=0,"创建相机成功");
    LumentCamera3D cd; lument_cube_get_camera(cam,&cd);
    CHECK(cd.projection==LUMENT_CUBE_PROJECTION_PERSPECTIVE,"相机默认透视投影");
    lument_cube_set_camera_projection(cam,LUMENT_CUBE_PROJECTION_ORTHO);
    lument_cube_get_camera(cam,&cd);
    CHECK(cd.projection==LUMENT_CUBE_PROJECTION_ORTHO,"切换为正交投影成功");
    CHECK(lument_cube_get_wireframe()==false,"默认关闭线框");
    lument_cube_set_wireframe(true);
    CHECK(lument_cube_get_wireframe()==true,"开启线框成功");
    lument_cube_set_wireframe(false);
    CHECK(lument_cube_get_wireframe()==false,"关闭线框成功");

    // 7. 格式枚举
    printf("[格式]\n");
    CHECK(lument_cube_supported_format_count()==8,"支持 8 种格式");
    CHECK(std::string(lument_cube_format_name(LUMENT_CUBE_FORMAT_BLEND))=="Blender","BLEND 格式名");

    printf("\n=== 结果：%s (%d 项失败) ===\n", g_fail==0?"全部通过":"存在失败", g_fail);
    return g_fail==0?0:1;
}
