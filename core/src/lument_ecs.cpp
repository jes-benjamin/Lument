// ============================================================
// lument_ecs.cpp - 实体组件系统（Entity Component System）
// ------------------------------------------------------------
// 实现 C ABI：
//   lument_create_entity / lument_destroy_entity / lument_entity_alive
//   lument_set_position / lument_get_position / lument_set_scale      (Transform)
//   lument_set_sprite / lument_set_sprite_color / lument_set_visible (Sprite)
//   lument_set_collider / lument_check_collision                 (Collider)
//   lument_set_script                                         (Script)
//
// 设计：
//   - 实体：32 位 ID = 代(generation, 12bit) | 索引(index, 20bit)。
//     销毁后代数递增，旧句柄自动失效。索引池用空闲链表（数组实现），
//     零动态分配。
//   - 组件存储：每个组件类型一个 SparseSet<T>。
//       sparse[MAX]  : 实体索引 -> 紧凑数组下标   (O(1) 查找)
//       dense[]      : 连续的组件数据              (缓存友好遍历)
//       entities[]   : 与 dense 平行的实体 ID       (反向映射)
//     增删为 O(1)（交换删除）；遍历为线性连续访问，热路径零分配。
//   - Transform 位置视为精灵包围盒左上角；碰撞用 AABB。
// ============================================================
#include "lument_internal.h"

namespace {

constexpr uint32_t INVALID_DENSE = 0xFFFFFFFFu;

inline uint32_t entity_index(LumentEntity e) { return (e & LUMENT_ENTITY_INDEX_MASK) - 1u; }
inline uint16_t  entity_gen(LumentEntity e)   { return uint16_t((e >> LUMENT_ENTITY_INDEX_BITS) & LUMENT_ENTITY_GEN_MASK); }

// ---------- 实体池 ----------
struct EntityPool {
    bool     used[LUMENT_MAX_ENTITIES];
    uint16_t gen[LUMENT_MAX_ENTITIES];
    uint32_t freeNext[LUMENT_MAX_ENTITIES]; // 空闲链表
    uint32_t freeHead;
    uint32_t liveCount;
};
EntityPool g_pool;

void pool_reset() {
    for (uint32_t i = 0; i < LUMENT_MAX_ENTITIES; ++i) {
        g_pool.used[i] = false;
        g_pool.gen[i] = 0;
        g_pool.freeNext[i] = i + 1;       // 串联
    }
    g_pool.freeNext[LUMENT_MAX_ENTITIES - 1] = INVALID_DENSE; // 链尾
    g_pool.freeHead = 0;
    g_pool.liveCount = 0;
}

uint32_t pool_alloc() {
    if (g_pool.freeHead == INVALID_DENSE) return INVALID_DENSE;
    uint32_t idx = g_pool.freeHead;
    g_pool.freeHead = g_pool.freeNext[idx];
    g_pool.used[idx] = true;
    g_pool.gen[idx]++;                   // 代数递增（首用时 0->1）
    ++g_pool.liveCount;
    return idx;
}

void pool_free(uint32_t idx) {
    g_pool.used[idx] = false;
    g_pool.gen[idx]++;                   // 使旧句柄失效
    g_pool.freeNext[idx] = g_pool.freeHead;
    g_pool.freeHead = idx;
    --g_pool.liveCount;
}

inline LumentEntity make_entity(uint32_t idx) {
    return (LumentEntity(g_pool.gen[idx]) << LUMENT_ENTITY_INDEX_BITS) | LumentEntity(idx + 1);
}

// ---------- 通用稀疏集合 ----------
template <typename T>
struct SparseSet {
    std::array<uint32_t, LUMENT_MAX_ENTITIES> sparse{};
    std::vector<T>        dense;
    std::vector<LumentEntity> entities; // 平行：dense[i] 对应 entities[i]

    SparseSet() {
        sparse.fill(INVALID_DENSE);
        dense.reserve(256);
        entities.reserve(256);
    }

    void clear() {
        sparse.fill(INVALID_DENSE);
        dense.clear();
        entities.clear();
    }

    T* add(LumentEntity e, const T& v) {
        uint32_t idx = entity_index(e);
        if (idx >= LUMENT_MAX_ENTITIES) return nullptr;
        if (sparse[idx] != INVALID_DENSE) {
            T& existing = dense[sparse[idx]];
            existing = v;
            return &existing;
        }
        uint32_t d = static_cast<uint32_t>(dense.size());
        dense.push_back(v);
        entities.push_back(e);
        sparse[idx] = d;
        return &dense[d];
    }

    T* get(LumentEntity e) {
        uint32_t idx = entity_index(e);
        if (idx >= LUMENT_MAX_ENTITIES) return nullptr;
        uint32_t d = sparse[idx];
        if (d == INVALID_DENSE) return nullptr;
        return &dense[d];
    }

    void remove(LumentEntity e) {
        uint32_t idx = entity_index(e);
        if (idx >= LUMENT_MAX_ENTITIES) return;
        uint32_t d = sparse[idx];
        if (d == INVALID_DENSE) return;
        // 交换删除：把末尾元素搬到被删位置
        uint32_t last = static_cast<uint32_t>(dense.size() - 1);
        if (d != last) {
            dense[d] = dense[last];
            entities[d] = entities[last];
            sparse[entity_index(entities[d])] = d;
        }
        dense.pop_back();
        entities.pop_back();
        sparse[idx] = INVALID_DENSE;
    }
};

// ---------- 组件定义 ----------
struct Transform {
    float x = 0.0f, y = 0.0f;
    float rotation = 0.0f;
    float scaleX = 1.0f, scaleY = 1.0f;
};

struct Sprite {
    uint32_t textureId = 0;
    float    w = 0.0f, h = 0.0f;
    LumentColor  color = { 255, 255, 255, 255 };
    bool     visible = true;
};

struct Collider {
    float w = 0.0f, h = 0.0f;
};

struct Script {
    UEUpdateCallback onUpdate = nullptr;
};

// 组件池
SparseSet<Transform>* g_transforms = nullptr;
SparseSet<Sprite>*    g_sprites    = nullptr;
SparseSet<Collider>*  g_colliders  = nullptr;
SparseSet<Script>*    g_scripts    = nullptr;

bool g_initialized = false;

void remove_all_components(uint32_t idx) {
    LumentEntity e = make_entity(idx);
    g_transforms->remove(e);
    g_sprites->remove(e);
    g_colliders->remove(e);
    g_scripts->remove(e);
}

} // namespace

namespace ue {

bool init_ecs() {
    pool_reset();
    g_transforms = new SparseSet<Transform>();
    g_sprites    = new SparseSet<Sprite>();
    g_colliders  = new SparseSet<Collider>();
    g_scripts    = new SparseSet<Script>();
    g_initialized = true;
    return true;
}

void shutdown_ecs() {
    delete g_transforms; g_transforms = nullptr;
    delete g_sprites;    g_sprites    = nullptr;
    delete g_colliders;  g_colliders  = nullptr;
    delete g_scripts;    g_scripts    = nullptr;
    g_initialized = false;
}

void ecs_clear() {
    if (!g_initialized) return;
    // 销毁所有存活实体（连带移除组件）
    for (uint32_t i = 0; i < LUMENT_MAX_ENTITIES; ++i) {
        if (g_pool.used[i]) {
            remove_all_components(i);
            pool_free(i);
        }
    }
    // 兜底清空组件池
    g_transforms->clear();
    g_sprites->clear();
    g_colliders->clear();
    g_scripts->clear();
}

uint32_t ecs_entity_count() { return g_pool.liveCount; }

size_t ecs_memory_bytes() {
    size_t s = sizeof(g_pool);
    if (g_transforms) s += g_transforms->dense.size() * sizeof(Transform);
    if (g_sprites)    s += g_sprites->dense.size()    * sizeof(Sprite);
    if (g_colliders)  s += g_colliders->dense.size()  * sizeof(Collider);
    if (g_scripts)    s += g_scripts->dense.size()    * sizeof(Script);
    return s;
}

// 每帧调用所有脚本 onUpdate 回调。
void ecs_update_scripts(float dt) {
    if (!g_initialized || g_scripts->dense.empty()) return;
    // 拷贝一份实体列表，避免回调中增删组件导致迭代失效。
    // 实体列表小，开销可接受。
    const size_t n = g_scripts->dense.size();
    for (size_t i = 0; i < n; ++i) {
        Script& s = g_scripts->dense[i];
        if (s.onUpdate) {
            s.onUpdate(g_scripts->entities[i], dt);
        }
    }
}

// 自动渲染所有 visible 且带变换的精灵。
// src 传 {0,0,0,0} 表示使用整张纹理（由渲染层解释）。
void ecs_render_sprites() {
    if (!g_initialized || g_sprites->dense.empty()) return;
    const size_t n = g_sprites->dense.size();
    for (size_t i = 0; i < n; ++i) {
        Sprite& sp = g_sprites->dense[i];
        if (!sp.visible) continue;
        LumentEntity e = g_sprites->entities[i];
        Transform* t = g_transforms->get(e);
        float x = 0, y = 0, sx = 1, sy = 1;
        if (t) { x = t->x; y = t->y; sx = t->scaleX; sy = t->scaleY; }
        LumentRect dest{ x, y, sp.w * sx, sp.h * sy };
        LumentRect src{ 0, 0, 0, 0 }; // 整张纹理（渲染层解释 w/h<=0 为全图）
        // 通过公共 ABI 提交（渲染层负责按纹理分批，颜色来自 set_sprite_color）。
        lument_draw_sprite(sp.textureId, dest, src);
    }
}

} // namespace ue

// ----------------------------------------------------------------
// C ABI
// ----------------------------------------------------------------
extern "C" {

LUMENT_API LumentEntity lument_create_entity(void) {
    if (!g_initialized) return LUMENT_INVALID_ENTITY;
    uint32_t idx = pool_alloc();
    if (idx == INVALID_DENSE) return LUMENT_INVALID_ENTITY;
    return make_entity(idx);
}

LUMENT_API void lument_destroy_entity(LumentEntity entity) {
    if (!g_initialized || entity == LUMENT_INVALID_ENTITY) return;
    uint32_t idx = entity_index(entity);
    if (idx >= LUMENT_MAX_ENTITIES || !g_pool.used[idx]) return;
    if (g_pool.gen[idx] != entity_gen(entity)) return; // 句柄过期
    remove_all_components(idx);
    pool_free(idx);
}

LUMENT_API bool lument_entity_alive(LumentEntity entity) {
    if (entity == LUMENT_INVALID_ENTITY) return false;
    uint32_t idx = entity_index(entity);
    if (idx >= LUMENT_MAX_ENTITIES) return false;
    return g_pool.used[idx] && g_pool.gen[idx] == entity_gen(entity);
}

// ---- Transform ----
LUMENT_API void lument_set_position(LumentEntity e, float x, float y) {
    if (!g_initialized || !lument_entity_alive(e)) return;
    Transform* t = g_transforms->get(e);
    if (!t) {
        Transform nt{}; nt.x = x; nt.y = y;
        g_transforms->add(e, nt);
    } else { t->x = x; t->y = y; }
}

LUMENT_API void lument_get_position(LumentEntity e, LumentVec2* pos) {
    if (pos) pos->x = pos->y = 0.0f;
    if (!g_initialized || !pos || !lument_entity_alive(e)) return;
    Transform* t = g_transforms->get(e);
    if (t) { pos->x = t->x; pos->y = t->y; }
}

LUMENT_API void lument_set_scale(LumentEntity e, float sx, float sy) {
    if (!g_initialized || !lument_entity_alive(e)) return;
    Transform* t = g_transforms->get(e);
    if (!t) {
        Transform nt{}; nt.scaleX = sx; nt.scaleY = sy;
        g_transforms->add(e, nt);
    } else { t->scaleX = sx; t->scaleY = sy; }
}

// ---- Sprite ----
LUMENT_API void lument_set_sprite(LumentEntity e, uint32_t textureId, float w, float h) {
    if (!g_initialized || !lument_entity_alive(e)) return;
    Sprite* s = g_sprites->get(e);
    if (!s) {
        Sprite ns; ns.textureId = textureId; ns.w = w; ns.h = h;
        g_sprites->add(e, ns);
    } else {
        s->textureId = textureId; s->w = w; s->h = h;
        s->visible = true; // 重新设置精灵时恢复可见
    }
}

LUMENT_API void lument_set_sprite_color(LumentEntity e, LumentColor color) {
    if (!g_initialized || !lument_entity_alive(e)) return;
    Sprite* s = g_sprites->get(e);
    if (!s) {
        Sprite ns; ns.color = color;
        g_sprites->add(e, ns);
    } else {
        s->color = color;
    }
}

LUMENT_API void lument_set_visible(LumentEntity e, bool visible) {
    if (!g_initialized || !lument_entity_alive(e)) return;
    Sprite* s = g_sprites->get(e);
    if (!s) {
        Sprite ns; ns.visible = visible;
        g_sprites->add(e, ns);
    } else {
        s->visible = visible;
    }
}

// ---- Collider ----
LUMENT_API void lument_set_collider(LumentEntity e, float w, float h) {
    if (!g_initialized || !lument_entity_alive(e)) return;
    Collider* c = g_colliders->get(e);
    if (!c) {
        Collider nc; nc.w = w; nc.h = h;
        g_colliders->add(e, nc);
    } else { c->w = w; c->h = h; }
}

// AABB 碰撞检测。位置取自 Transform（左上角），尺寸取自 Collider。
LUMENT_API bool lument_check_collision(LumentEntity a, LumentEntity b) {
    if (!g_initialized) return false;
    if (!lument_entity_alive(a) || !lument_entity_alive(b)) return false;
    Transform* ta = g_transforms->get(a);
    Transform* tb = g_transforms->get(b);
    Collider*  ca = g_colliders->get(a);
    Collider*  cb = g_colliders->get(b);
    if (!ca || !cb) return false; // 无碰撞体视为不发生碰撞
    float ax = ta ? ta->x : 0.0f, ay = ta ? ta->y : 0.0f;
    float bx = tb ? tb->x : 0.0f, by = tb ? tb->y : 0.0f;
    // 标准 AABB 重叠判定
    return ax < bx + cb->w && ax + ca->w > bx &&
           ay < by + cb->h && ay + ca->h > by;
}

// ---- Script ----
LUMENT_API void lument_set_script(LumentEntity e, UEUpdateCallback onUpdate) {
    if (!g_initialized || !lument_entity_alive(e)) return;
    Script* s = g_scripts->get(e);
    if (!s) {
        Script ns; ns.onUpdate = onUpdate;
        g_scripts->add(e, ns);
    } else {
        s->onUpdate = onUpdate;
    }
}

} // extern "C"
