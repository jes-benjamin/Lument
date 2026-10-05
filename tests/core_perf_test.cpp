// core_perf_test.cpp - Lument v2.1.0 引擎本体性能增强验证
// 重点验证：
//   1. 物理宽相真正接线（候选对数远小于 O(n^2) 全对比）
//   2. 空闲槽位池 O(1) 分配（销毁/复用正确，不会泄漏槽位）
//   3. 渲染 2D 视锥剔除（视野外精灵被剔除，视野内不被误剔）
//   4. 时间缩放 API 与新增统计字段
#include "lument_internal.h"
#include <cstdio>
#include <cmath>

static int g_fail = 0;
#define CHECK(cond,msg) do{ if(!(cond)){ printf("  [FAIL] %s\n",msg); ++g_fail; } \
                            else printf("  [ ok ] %s\n",msg); }while(0)

int main(){
    printf("=== Lument %s 引擎本体性能增强验证 ===\n", LUMENT_VERSION_STRING);

    // ---------------- 1. 物理宽相接线验证 ----------------
    printf("[物理 · 宽相]\n");
    lument_physics_reset();
    const int N = 200;
    // 混合场景：前 20 个紧密聚集在一小块区域（必然产生大量候选对），
    // 其余 180 个远距散布（彼此不可能相交）。
    for (int i = 0; i < N; ++i) {
        LumentBodyDef def{};
        def.type = LUMENT_BODY_DYNAMIC;
        def.mass = 1.0f;
        def.restitution = 0.0f;
        def.friction = 0.5f;
        float x, y;
        if (i < 20) { x = float(i) * 2.0f; y = 0.0f; }        // 密集簇
        else        { x = 1000.0f + (i % 20) * 300.0f;        // 远距散布
                      y = 1000.0f + (i / 20) * 300.0f; }
        lument_physics_create_body(&def, x, y);
    }
    for (int i = 1; i <= N; ++i) {
        LumentShape s{};
        s.type = LUMENT_SHAPE_AABB;
        s.w = 8.0f; s.h = 8.0f;
        lument_physics_set_shape(i, s);
    }
    lument_physics_set_gravity(0.0f, 0.0f);   // 关重力，避免位置漂移影响可复现性
    lument_physics_step(0.016f);

    const int pairs = lument_physics_get_broadphase_pairs();
    const int brute = N * (N - 1) / 2;        // O(n^2) 全对比数量
    printf("  刚体数=%d  宽相候选对=%d  O(n^2)全对比=%d\n", N, pairs, brute);
    // 必须 > 0：证明宽相确实产出了候选集（若仍是全 0，说明管线没走通或全部被剪掉）
    CHECK(pairs > 0, "宽相产出了非零候选对（管线确实参与）");
    // 必须远小于全对比：证明空间分区生效，而非退回 O(n^2)
    CHECK(pairs < brute / 5, "候选对远少于 O(n^2) 全对比（空间分区生效）");

    // ---------------- 2. 空闲槽位池 ----------------
    printf("[物理 · 槽位池]\n");
    lument_physics_reset();
    int ids[8];
    for (int i = 0; i < 8; ++i) {
        LumentBodyDef def{}; def.type = LUMENT_BODY_STATIC; def.mass = 0.0f;
        ids[i] = lument_physics_create_body(&def, float(i) * 10.0f, 0.0f);
    }
    CHECK(ids[0] == 1 && ids[7] == 8, "顺序分配 8 个槽位 id=1..8");
    lument_physics_destroy_body(ids[3]);            // 释放第 4 个
    LumentBodyDef def{}; def.type = LUMENT_BODY_STATIC; def.mass = 0.0f;
    int reused = lument_physics_create_body(&def, 0.0f, 0.0f);
    CHECK(reused == ids[3], "销毁后的槽位被正确复用（空闲栈生效）");
    // 全部销毁后可再次完整分配
    for (int i = 0; i < 8; ++i) lument_physics_destroy_body(ids[i]);
    int ok = 1;
    for (int i = 0; i < 8; ++i) {
        int id = lument_physics_create_body(&def, 0.0f, 0.0f);
        if (id == 0) ok = 0;
    }
    CHECK(ok == 1, "全量销毁后可重新分配全部槽位（无泄漏）");
    lument_physics_reset();

    // ---------------- 3. 渲染视锥剔除 ----------------
    printf("[渲染 · 视锥剔除]\n");
    LumentConfig cfg{};
    cfg.width = 800; cfg.height = 600;
    cfg.targetFPS = 0.0f;
    cfg.rendererType = LUMENT_RENDERER_OPENGL;
    if (lument_init(&cfg)) {
        lument_begin_frame();                       // 重置统计
        CHECK(lument_get_render_culling() == true, "默认开启视锥剔除");

        LumentRect all{0,0,1,1};
        // 相机默认 (0,0,zoom=1) → 世界可见区 = [0,800]x[0,600]
        LumentRect inView{100.0f, 100.0f, 50.0f, 50.0f};   // 完全在视野内
        LumentRect outL{-500.0f, 100.0f, 50.0f, 50.0f};    // 左侧视野外
        LumentRect outR{900.0f, 100.0f, 50.0f, 50.0f};     // 右侧视野外
        LumentRect outB{100.0f, 800.0f, 50.0f, 50.0f};     // 下方视野外
        uint32_t tex = 0;
        lument_draw_sprite(tex, inView,  all);
        uint32_t afterIn = lument_get_culled_count();
        CHECK(afterIn == 0, "视野内精灵未被剔除（无误剔）");

        lument_draw_sprite(tex, outL, all);
        uint32_t afterOut = lument_get_culled_count();
        CHECK(afterOut == afterIn + 1, "左侧视野外精灵被剔除");

        lument_draw_sprite(tex, outR, all);
        CHECK(lument_get_culled_count() == afterOut + 1, "右侧视野外精灵被剔除");

        lument_draw_sprite(tex, outB, all);
        CHECK(lument_get_culled_count() == afterOut + 2, "下方视野外精灵被剔除");

        // 关闭剔除后不应再统计
        lument_set_render_culling(false);
        CHECK(lument_get_render_culling() == false, "可关闭视锥剔除");
        uint32_t before = lument_get_culled_count();
        lument_draw_sprite(tex, outL, all);
        CHECK(lument_get_culled_count() == before, "关闭剔除后不再累加");
        lument_set_render_culling(true);

        // 边界：部分重叠不应被剔除
        lument_begin_frame();
        LumentRect partial{780.0f, 580.0f, 100.0f, 100.0f};  // 与可见区右下角相交
        lument_draw_sprite(tex, partial, all);
        CHECK(lument_get_culled_count() == 0, "部分相交的精灵不被剔除（边界正确）");

        // ---------------- 4. 时间缩放 ----------------
        printf("[时间控制]\n");
        CHECK(std::fabs(lument_get_time_scale() - 1.0f) < 1e-6f, "默认时间缩放=1.0");
        lument_set_time_scale(0.5f);
        CHECK(std::fabs(lument_get_time_scale() - 0.5f) < 1e-6f, "设置时间缩放=0.5");
        lument_set_time_scale(0.0f);
        CHECK(lument_get_time_scale() == 0.0f, "可设为 0（暂停）");
        lument_set_time_scale(-3.0f);
        CHECK(lument_get_time_scale() == 0.0f, "负值被钳制为 0（防止 dt 反向发散）");
        lument_set_time_scale(100.0f);
        CHECK(lument_get_time_scale() <= 16.0f, "超大值被钳制到上限 16");
        lument_set_time_scale(1.0f);

        // ---------------- 5. 统计字段 ----------------
        printf("[统计字段]\n");
        lument_begin_frame();
        LumentStats st{};
        lument_get_stats(&st);
        printf("  culledSprites=%u physicsPairs=%d physicsMs=%.3f cpuTimeMs=%.3f\n",
               st.culledSprites, st.physicsPairs, st.physicsMs, st.cpuTimeMs);
        CHECK(st.culledSprites == 0, "begin_frame 重置剔除计数");
        CHECK(st.physicsPairs >= 0, "physicsPairs 字段有效");
        CHECK(st.physicsMs >= 0.0f, "physicsMs 字段有效");

        lument_end_frame();
        lument_shutdown();
    } else {
        printf("  [skip] 渲染器初始化失败（无可用后端），跳过渲染相关断言\n");
    }

    printf("\n=== 结果：%s (%d 项失败) ===\n", g_fail == 0 ? "全部通过" : "存在失败", g_fail);
    return g_fail == 0 ? 0 : 1;
}
