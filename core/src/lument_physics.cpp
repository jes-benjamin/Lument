// ============================================================
// lument_physics.cpp - 2D 物理模拟系统
// ------------------------------------------------------------
// 实现 C ABI：
//   物理世界：lument_physics_set_gravity / get_gravity
//             lument_physics_set_iterations / step / reset
//   物理体管理：lument_physics_create_body / destroy_body
//             set_shape / set_mass / set_restitution / set_friction
//             set_gravity_scale / set_damping
//             set_custom_damping / clear_custom_damping
//   物理体状态：get_state / set_state
//             get_position / set_position / get_velocity / set_velocity
//             apply_force / apply_impulse / apply_torque / apply_angular_impulse
//   碰撞检测：check_collision / get_collisions
//             raycast / point_query / on_collision
//
// 设计：
//   - 物理体采用固定容量对象池（数组 + alive 标志），id 为 1-based，
//     0 表示失败/无效。热路径零动态分配。
//   - 位置 (x,y) 视为物理体几何中心；AABB 用 (w,h) 表示完整宽高，
//     Circle 用 radius。AABB 为轴对齐，忽略旋转对碰撞形状的影响。
//   - 步进采用半隐式欧拉：施加重力 -> 阻尼 -> v += a*dt -> pos += v*dt
//     -> 清除力。随后做碰撞检测与基于冲量的响应（含位置修正与摩擦）。
//   - 重力为加速度：对动态体 a += g * gravityScale（质量在重力项中
//     相消，概念上等效力 F = m * g * gravityScale）。
//   - apply_force 把力转为加速度累加（F/m），apply_impulse 直接改
//     速度（J/m）；二者仅对质量>0 的动态体生效。
//   - 碰撞响应 invMass：动态体(质量>0)为 1/m，静态/运动学体为 0
//     （运动学体仍可由自身速度推动动态体）。
// ============================================================
#include "lument_internal.h"

#include <cmath>
#include <vector>
#include <algorithm>
#include <string>
#include <cstring>

namespace {

// ---------- 常量 ----------
constexpr int   MAX_BODIES = 512;            // 物理体池容量
constexpr float DEFAULT_GRAVITY_X = 0.0f;   // 默认重力 X
constexpr float DEFAULT_GRAVITY_Y = 9.8f;   // 默认重力 Y（m/s^2，dt 以秒计）
constexpr int   DEFAULT_VELOCITY_ITER = 8;  // 默认速度求解迭代
constexpr int   DEFAULT_POSITION_ITER = 3;  // 默认位置修正迭代
constexpr float POS_CORRECTION_PERCENT = 0.8f; // 位置修正比例（Baumgarte）
constexpr float POS_SLOP = 0.01f;           // 允许穿透余量，避免抖动
constexpr float EPS = 1e-6f;                // 浮点零阈值

inline float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// ---------- 物理体 ----------
struct PhysicsBody {
    bool            alive = false;            // 槽位是否被占用
    LumentBodyType  type = LUMENT_BODY_STATIC;
    float           mass = 0.0f;
    float           restitution = 0.0f;       // 弹性 0~1
    float           friction = 0.0f;         // 摩擦 0~1
    float           linearDamping = 0.0f;     // 线性阻尼 0~1
    float           angularDamping = 0.0f;   // 角阻尼 0~1
    float           gravityScale = 1.0f;     // 重力缩放

    LumentShape     shape;                   // 碰撞形状

    // 状态
    float x = 0.0f, y = 0.0f;               // 中心位置
    float vx = 0.0f, vy = 0.0f;             // 线速度
    float ax = 0.0f, ay = 0.0f;             // 线加速度（力累积器）
    float angle = 0.0f;                      // 旋转角度
    float angularVel = 0.0f;                // 角速度
    float torqueAccum = 0.0f;               // 扭矩累积器（内部）

    // 自定义阻尼
    LumentDampingFunc dampingFunc = nullptr;
    void*             dampingUserData = nullptr;

    void reset() {
        alive = false;
        type = LUMENT_BODY_STATIC;
        mass = 0.0f;
        restitution = 0.0f;
        friction = 0.0f;
        linearDamping = 0.0f;
        angularDamping = 0.0f;
        gravityScale = 1.0f;
        shape.type = LUMENT_SHAPE_AABB;
        shape.w = 1.0f; shape.h = 1.0f; shape.radius = 0.0f;
        x = y = 0.0f;
        vx = vy = 0.0f;
        ax = ay = 0.0f;
        angle = 0.0f;
        angularVel = 0.0f;
        torqueAccum = 0.0f;
        dampingFunc = nullptr;
        dampingUserData = nullptr;
    }
};

// ---------- 物理世界 ----------
struct PhysicsWorld {
    float gravityX = DEFAULT_GRAVITY_X;
    float gravityY = DEFAULT_GRAVITY_Y;
    int   velocityIter = DEFAULT_VELOCITY_ITER;
    int   positionIter = DEFAULT_POSITION_ITER;

    PhysicsBody pool[MAX_BODIES];
    bool initialized = false;

    std::vector<LumentCollision> frameCollisions; // 本帧发生的碰撞
    LumentCollisionCallback callback = nullptr;
    void* callbackUserData = nullptr;
};

PhysicsWorld g_world;

// 碰撞接触（检测阶段缓存，供求解迭代使用）
struct Contact {
    int idxA;            // 池索引
    int idxB;
    LumentCollision info;
};
std::vector<Contact> g_contacts;

// ---------- 池操作 ----------
int alloc_body() {
    // 线性扫描空闲槽位（池小，O(n) 可接受）
    for (int i = 0; i < MAX_BODIES; ++i) {
        if (!g_world.pool[i].alive) {
            g_world.pool[i].reset();
            g_world.pool[i].alive = true;
            return i + 1; // id 从 1 开始，0 = 无效
        }
    }
    return 0;
}

PhysicsBody* find_body(int id) {
    if (id <= 0 || id > MAX_BODIES) return nullptr;
    PhysicsBody& b = g_world.pool[id - 1];
    return b.alive ? &b : nullptr;
}

// 动态体有效质量倒数；静态/运动学体为 0（不可被冲量推动）
inline float inv_mass(const PhysicsBody& b) {
    return (b.type == LUMENT_BODY_DYNAMIC && b.mass > 0.0f) ? (1.0f / b.mass) : 0.0f;
}

// ---------- 碰撞流形计算 ----------
// 所有法线方向均规定为“从 A 指向 B”。

// AABB vs AABB
bool manifold_box_box(const PhysicsBody& a, int idA,
                      const PhysicsBody& b, int idB,
                      LumentCollision& out) {
    out.bodyA = idA; out.bodyB = idB;
    float halfAx = a.shape.w * 0.5f, halfAy = a.shape.h * 0.5f;
    float halfBx = b.shape.w * 0.5f, halfBy = b.shape.h * 0.5f;
    float dx = b.x - a.x, dy = b.y - a.y;
    float ox = (halfAx + halfBx) - std::fabs(dx);
    if (ox <= 0.0f) return false;
    float oy = (halfAy + halfBy) - std::fabs(dy);
    if (oy <= 0.0f) return false;
    // 取最小重叠轴作为碰撞法线
    if (ox < oy) {
        out.penetration = ox;
        out.normal.x = (dx >= 0.0f) ? 1.0f : -1.0f;
        out.normal.y = 0.0f;
    } else {
        out.penetration = oy;
        out.normal.x = 0.0f;
        out.normal.y = (dy >= 0.0f) ? 1.0f : -1.0f;
    }
    out.point.x = (a.x + b.x) * 0.5f;
    out.point.y = (a.y + b.y) * 0.5f;
    return true;
}

// Circle vs Circle
bool manifold_circle_circle(const PhysicsBody& a, int idA,
                            const PhysicsBody& b, int idB,
                            LumentCollision& out) {
    out.bodyA = idA; out.bodyB = idB;
    float dx = b.x - a.x, dy = b.y - a.y;
    float r = a.shape.radius + b.shape.radius;
    float d2 = dx * dx + dy * dy;
    if (d2 >= r * r) return false;
    float d = std::sqrt(d2);
    if (d > EPS) {
        out.normal.x = dx / d;
        out.normal.y = dy / d;
        out.penetration = r - d;
    } else {
        // 两圆心重合，任取方向
        out.normal.x = 1.0f; out.normal.y = 0.0f;
        out.penetration = r;
    }
    // 接触点取 A 表面朝 B 方向的点
    out.point.x = a.x + out.normal.x * a.shape.radius;
    out.point.y = a.y + out.normal.y * a.shape.radius;
    return true;
}

// AABB(box) vs Circle：法线从 box 指向 circle
bool manifold_box_circle(const PhysicsBody& box, int idBox,
                         const PhysicsBody& circle, int idCircle,
                         LumentCollision& out) {
    out.bodyA = idBox; out.bodyB = idCircle;
    float hx = box.shape.w * 0.5f, hy = box.shape.h * 0.5f;
    // 圆心在 box 上的最近点（裁剪到 box 范围）
    float cx = clampf(circle.x, box.x - hx, box.x + hx);
    float cy = clampf(circle.y, box.y - hy, box.y + hy);
    float rx = circle.x - cx, ry = circle.y - cy;
    float d2 = rx * rx + ry * ry;
    float r = circle.shape.radius;
    if (d2 >= r * r) return false; // 最近点到圆边距离 >= 半径
    float d = std::sqrt(d2);
    if (d > EPS) {
        // 圆心在 box 外：法线从最近点指向圆心 = 从 box 指向 circle
        out.normal.x = rx / d;
        out.normal.y = ry / d;
        out.penetration = r - d;
        out.point.x = cx;
        out.point.y = cy;
    } else {
        // 圆心在 box 内：沿最小穿透轴推出
        float dx = circle.x - box.x, dy = circle.y - box.y;
        float penX = hx - std::fabs(dx); // 沿 X 推出需要的穿透
        float penY = hy - std::fabs(dy);
        if (penX < penY) {
            out.normal.x = (dx >= 0.0f) ? 1.0f : -1.0f;
            out.normal.y = 0.0f;
            out.penetration = penX + r;
        } else {
            out.normal.x = 0.0f;
            out.normal.y = (dy >= 0.0f) ? 1.0f : -1.0f;
            out.penetration = penY + r;
        }
        out.point.x = circle.x;
        out.point.y = circle.y;
    }
    return true;
}

// 统一入口：根据形状组合计算流形。法线从 A 指向 B。
bool compute_manifold(const PhysicsBody& a, int idA,
                      const PhysicsBody& b, int idB,
                      LumentCollision& out) {
    out.bodyA = idA; out.bodyB = idB;
    out.point.x = out.point.y = 0.0f;
    out.normal.x = out.normal.y = 0.0f;
    out.penetration = 0.0f;

    if (a.shape.type == LUMENT_SHAPE_AABB && b.shape.type == LUMENT_SHAPE_AABB) {
        return manifold_box_box(a, idA, b, idB, out);
    }
    if (a.shape.type == LUMENT_SHAPE_CIRCLE && b.shape.type == LUMENT_SHAPE_CIRCLE) {
        return manifold_circle_circle(a, idA, b, idB, out);
    }
    if (a.shape.type == LUMENT_SHAPE_AABB && b.shape.type == LUMENT_SHAPE_CIRCLE) {
        // A=box, B=circle：法线 box->circle 即 A->B
        return manifold_box_circle(a, idA, b, idB, out);
    }
    // A=circle, B=AABB：以 box=B、circle=A 计算（法线 box->circle = B->A），再翻转
    if (manifold_box_circle(b, idB, a, idA, out)) {
        // 翻转为主体：bodyA=A(circle), bodyB=B(box)，法线 A->B = 反向
        out.bodyA = idA;
        out.bodyB = idB;
        out.normal.x = -out.normal.x;
        out.normal.y = -out.normal.y;
        return true;
    }
    return false;
}

// ---------- 碰撞响应 ----------
// 速度求解：基于冲量，含弹性与摩擦
void solve_velocity(Contact& c) {
    PhysicsBody& a = g_world.pool[c.idxA];
    PhysicsBody& b = g_world.pool[c.idxB];
    float invMassA = inv_mass(a);
    float invMassB = inv_mass(b);
    if (invMassA == 0.0f && invMassB == 0.0f) return;

    LumentVec2 n = c.info.normal;
    // 相对速度 rv = vB - vA
    float rvx = b.vx - a.vx, rvy = b.vy - a.vy;
    float vn = rvx * n.x + rvy * n.y;
    if (vn > 0.0f) return; // 已在分离，不施加冲量

    float e = clampf(std::min(a.restitution, b.restitution), 0.0f, 1.0f);
    float j = -(1.0f + e) * vn / (invMassA + invMassB);
    float ix = j * n.x, iy = j * n.y;
    a.vx -= invMassA * ix; a.vy -= invMassA * iy;
    b.vx += invMassB * ix; b.vy += invMassB * iy;

    // 摩擦（切向冲量，库仑限制）
    rvx = b.vx - a.vx; rvy = b.vy - a.vy;
    float vn2 = rvx * n.x + rvy * n.y;
    float tx = rvx - vn2 * n.x;
    float ty = rvy - vn2 * n.y;
    float tl = std::sqrt(tx * tx + ty * ty);
    if (tl > EPS) {
        tx /= tl; ty /= tl;
        float jt = -(rvx * tx + rvy * ty) / (invMassA + invMassB);
        float mu = std::sqrt(a.friction * b.friction);
        float maxF = j * mu;
        if (jt > maxF) jt = maxF;
        else if (jt < -maxF) jt = -maxF;
        a.vx -= invMassA * jt * tx; a.vy -= invMassA * jt * ty;
        b.vx += invMassB * jt * tx; b.vy += invMassB * jt * ty;
    }
}

// 位置修正：基于当前穿透量分离（重算流形，自收敛、不过度）
void solve_position(Contact& c) {
    PhysicsBody& a = g_world.pool[c.idxA];
    PhysicsBody& b = g_world.pool[c.idxB];
    float invMassA = inv_mass(a);
    float invMassB = inv_mass(b);
    if (invMassA == 0.0f && invMassB == 0.0f) return;

    LumentCollision cur;
    if (!compute_manifold(a, c.info.bodyA, b, c.info.bodyB, cur)) return; // 已分离
    float pen = cur.penetration - POS_SLOP;
    if (pen <= 0.0f) return;
    float corr = pen / (invMassA + invMassB) * POS_CORRECTION_PERCENT;
    a.x -= invMassA * corr * cur.normal.x;
    a.y -= invMassA * corr * cur.normal.y;
    b.x += invMassB * corr * cur.normal.x;
    b.y += invMassB * corr * cur.normal.y;
}

// ---------- 射线检测 ----------
// 射线 vs AABB（slab 法），t 为线段参数 [0,1]
bool ray_aabb(const PhysicsBody& b, float x1, float y1, float x2, float y2,
              float& tHit, float& nx, float& ny) {
    float hx = b.shape.w * 0.5f, hy = b.shape.h * 0.5f;
    float minX = b.x - hx, maxX = b.x + hx;
    float minY = b.y - hy, maxY = b.y + hy;
    float dx = x2 - x1, dy = y2 - y1;
    float tmin = 0.0f, tmax = 1.0f;
    int axis = -1;
    float sign = 0.0f;

    // X 轴
    if (std::fabs(dx) < EPS) {
        if (x1 < minX || x1 > maxX) return false;
    } else {
        float ood = 1.0f / dx;
        float t1 = (minX - x1) * ood;
        float t2 = (maxX - x1) * ood;
        float n1 = -1.0f, n2 = 1.0f; // t1 命中 min 面(外法线 -x)，t2 命中 max 面(外法线 +x)
        if (t1 > t2) { std::swap(t1, t2); std::swap(n1, n2); }
        if (t1 > tmin) { tmin = t1; axis = 0; sign = n1; }
        tmax = std::min(tmax, t2);
        if (tmin > tmax) return false;
    }
    // Y 轴
    if (std::fabs(dy) < EPS) {
        if (y1 < minY || y1 > maxY) return false;
    } else {
        float ood = 1.0f / dy;
        float t1 = (minY - y1) * ood;
        float t2 = (maxY - y1) * ood;
        float n1 = -1.0f, n2 = 1.0f;
        if (t1 > t2) { std::swap(t1, t2); std::swap(n1, n2); }
        if (t1 > tmin) { tmin = t1; axis = 1; sign = n1; }
        tmax = std::min(tmax, t2);
        if (tmin > tmax) return false;
    }
    if (axis < 0) return false; // 起点在内部等退化情形
    tHit = tmin;
    if (axis == 0) { nx = sign; ny = 0.0f; }
    else            { nx = 0.0f; ny = sign; }
    return true;
}

// 射线 vs Circle
bool ray_circle(const PhysicsBody& b, float x1, float y1, float x2, float y2,
                float& tHit, float& nx, float& ny) {
    float dx = x2 - x1, dy = y2 - y1;
    float fx = x1 - b.x, fy = y1 - b.y;
    float a = dx * dx + dy * dy;
    if (a < EPS * EPS) return false; // 零长度射线
    float bb = fx * dx + fy * dy;
    float r = b.shape.radius;
    float c = fx * fx + fy * fy - r * r;
    float disc = bb * bb - a * c;
    if (disc < 0.0f) return false;
    float sq = std::sqrt(disc);
    float t = (-bb - sq) / a;
    if (t < 0.0f || t > 1.0f) {
        t = (-bb + sq) / a;
        if (t < 0.0f || t > 1.0f) return false;
    }
    tHit = t;
    float px = x1 + dx * t, py = y1 + dy * t;
    // 外法线：从圆心指向命中点
    nx = px - b.x; ny = py - b.y;
    float len = std::sqrt(nx * nx + ny * ny);
    if (len > EPS) { nx /= len; ny /= len; }
    else            { nx = 1.0f; ny = 0.0f; }
    return true;
}

// 延迟初始化：保证物理子系统可独立使用（即使 lument_init 未调用）
void ensure_init() {
    if (!g_world.initialized) ue::init_physics();
}

} // namespace

// ============================================================
// 内部接口（ue 命名空间）
// ============================================================
namespace ue {

bool init_physics() {
    if (g_world.initialized) return true;
    g_world = PhysicsWorld{};
    g_world.gravityX = DEFAULT_GRAVITY_X;
    g_world.gravityY = DEFAULT_GRAVITY_Y;
    g_world.velocityIter = DEFAULT_VELOCITY_ITER;
    g_world.positionIter = DEFAULT_POSITION_ITER;
    g_world.frameCollisions.reserve(64);
    g_contacts.reserve(64);
    g_world.initialized = true;
    return true;
}

void shutdown_physics() {
    g_world = PhysicsWorld{};
    g_contacts.clear();
    g_contacts.shrink_to_fit();
}

// 物理世界步进：积分 -> 检测 -> 求解 -> 回调
void physics_step(float dt) {
    if (!g_world.initialized) return;

    // ---- 1. 积分 ----
    for (int i = 0; i < MAX_BODIES; ++i) {
        PhysicsBody& b = g_world.pool[i];
        if (!b.alive) continue;

        if (b.type == LUMENT_BODY_DYNAMIC) {
            // 施加重力（加速度形式，质量相消；概念力 F = m*g*gravityScale）
            b.ax += g_world.gravityX * b.gravityScale;
            b.ay += g_world.gravityY * b.gravityScale;

            // 阻尼
            float speed = std::sqrt(b.vx * b.vx + b.vy * b.vy);
            if (b.dampingFunc) {
                // 自定义阻尼函数返回阻尼系数（建议 0~1，0=完全停止，1=无阻尼）
                float f = b.dampingFunc(speed, b.mass, dt, b.dampingUserData);
                f = clampf(f, 0.0f, 1.0f);
                b.vx *= f; b.vy *= f;
            } else {
                // 默认线性阻尼（与 dt 相关，避免帧率敏感）
                float damp = 1.0f - b.linearDamping * dt;
                if (damp < 0.0f) damp = 0.0f;
                b.vx *= damp; b.vy *= damp;
            }

            // 更新速度：v += a * dt
            b.vx += b.ax * dt;
            b.vy += b.ay * dt;

            // 角速度：扭矩 -> 角加速度，叠加角阻尼
            float angAcc = (b.mass > 0.0f) ? (b.torqueAccum / b.mass) : 0.0f;
            float adamp = 1.0f - b.angularDamping * dt;
            if (adamp < 0.0f) adamp = 0.0f;
            b.angularVel *= adamp;
            b.angularVel += angAcc * dt;

            // 更新位置：pos += v * dt
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.angle += b.angularVel * dt;

            // 清除力（加速度归零）
            b.ax = 0.0f; b.ay = 0.0f; b.torqueAccum = 0.0f;
        } else if (b.type == LUMENT_BODY_KINEMATIC) {
            // 运动学体：不受力/重力，仅按设定速度移动
            b.x += b.vx * dt;
            b.y += b.vy * dt;
            b.angle += b.angularVel * dt;
            b.ax = 0.0f; b.ay = 0.0f; b.torqueAccum = 0.0f;
        }
        // 静态体：不移动
    }

    // ---- 2. 碰撞检测（O(n^2) 宽相 + 窄相，池小可接受）----
    g_world.frameCollisions.clear();
    g_contacts.clear();
    for (int i = 0; i < MAX_BODIES; ++i) {
        PhysicsBody& A = g_world.pool[i];
        if (!A.alive) continue;
        for (int j = i + 1; j < MAX_BODIES; ++j) {
            PhysicsBody& B = g_world.pool[j];
            if (!B.alive) continue;
            // 两者均非动态体则无响应意义，跳过
            if (A.type != LUMENT_BODY_DYNAMIC && B.type != LUMENT_BODY_DYNAMIC) continue;
            LumentCollision col;
            if (compute_manifold(A, i + 1, B, j + 1, col)) {
                g_contacts.push_back({i, j, col});
            }
        }
    }

    // ---- 3. 速度求解（冲量迭代）----
    for (int it = 0; it < g_world.velocityIter; ++it) {
        for (Contact& c : g_contacts) solve_velocity(c);
    }

    // ---- 4. 位置修正（分离迭代）----
    for (int it = 0; it < g_world.positionIter; ++it) {
        for (Contact& c : g_contacts) solve_position(c);
    }

    // ---- 5. 碰撞回调与本帧记录 ----
    for (Contact& c : g_contacts) {
        g_world.frameCollisions.push_back(c.info);
        if (g_world.callback) {
            g_world.callback(&c.info, g_world.callbackUserData);
        }
    }
}

} // namespace ue

// ============================================================
// C ABI
// ============================================================
extern "C" {

// ---- 物理世界 ----
LUMENT_API void lument_physics_set_gravity(float gx, float gy) {
    ensure_init();
    g_world.gravityX = gx;
    g_world.gravityY = gy;
}

LUMENT_API void lument_physics_get_gravity(float* gx, float* gy) {
    ensure_init();
    if (gx) *gx = g_world.gravityX;
    if (gy) *gy = g_world.gravityY;
}

LUMENT_API void lument_physics_set_iterations(int velocityIter, int positionIter) {
    ensure_init();
    g_world.velocityIter = velocityIter < 0 ? 0 : velocityIter;
    g_world.positionIter = positionIter < 0 ? 0 : positionIter;
}

LUMENT_API void lument_physics_step(float dt) {
    ensure_init();
    ue::physics_step(dt);
}

LUMENT_API void lument_physics_reset(void) {
    ensure_init();
    // 清空所有物理体，保留重力与迭代配置
    for (int i = 0; i < MAX_BODIES; ++i) {
        g_world.pool[i].reset();
    }
    g_world.frameCollisions.clear();
    g_contacts.clear();
}

// ---- 物理体管理 ----
LUMENT_API int lument_physics_create_body(const LumentBodyDef* def, float x, float y) {
    ensure_init();
    if (!def) return 0;
    int id = alloc_body();
    if (id == 0) {
        lument_log("lument_physics_create_body: physics body pool full");
        return 0;
    }
    PhysicsBody& b = g_world.pool[id - 1];
    b.type = def->type;
    b.mass = (def->type == LUMENT_BODY_STATIC) ? 0.0f : (def->mass < 0.0f ? 0.0f : def->mass);
    b.restitution = clampf(def->restitution, 0.0f, 1.0f);
    b.friction = clampf(def->friction, 0.0f, 1.0f);
    b.linearDamping = clampf(def->linearDamping, 0.0f, 1.0f);
    b.angularDamping = clampf(def->angularDamping, 0.0f, 1.0f);
    b.gravityScale = def->gravityScale;
    b.x = x; b.y = y;
    return id;
}

LUMENT_API void lument_physics_destroy_body(int bodyId) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->reset();
}

LUMENT_API void lument_physics_set_shape(int bodyId, LumentShape shape) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    if (shape.type != LUMENT_SHAPE_AABB && shape.type != LUMENT_SHAPE_CIRCLE) {
        shape.type = LUMENT_SHAPE_AABB;
    }
    shape.w = shape.w < 0.0f ? 0.0f : shape.w;
    shape.h = shape.h < 0.0f ? 0.0f : shape.h;
    shape.radius = shape.radius < 0.0f ? 0.0f : shape.radius;
    b->shape = shape;
}

LUMENT_API void lument_physics_set_mass(int bodyId, float mass) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    if (b->type == LUMENT_BODY_STATIC) {
        b->mass = 0.0f; // 静态体质量恒为 0
        return;
    }
    b->mass = mass < 0.0f ? 0.0f : mass;
}

LUMENT_API void lument_physics_set_restitution(int bodyId, float restitution) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->restitution = clampf(restitution, 0.0f, 1.0f);
}

LUMENT_API void lument_physics_set_friction(int bodyId, float friction) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->friction = clampf(friction, 0.0f, 1.0f);
}

LUMENT_API void lument_physics_set_gravity_scale(int bodyId, float scale) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->gravityScale = scale;
}

LUMENT_API void lument_physics_set_damping(int bodyId, float linear, float angular) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->linearDamping = clampf(linear, 0.0f, 1.0f);
    b->angularDamping = clampf(angular, 0.0f, 1.0f);
}

// ---- 自定义阻尼 ----
LUMENT_API void lument_physics_set_custom_damping(int bodyId, LumentDampingFunc func, void* userData) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->dampingFunc = func;
    b->dampingUserData = userData;
}

LUMENT_API void lument_physics_clear_custom_damping(int bodyId) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->dampingFunc = nullptr;
    b->dampingUserData = nullptr;
}

// ---- 物理体状态 ----
LUMENT_API void lument_physics_get_state(int bodyId, LumentBodyState* state) {
    if (state) {
        state->x = state->y = 0.0f;
        state->vx = state->vy = 0.0f;
        state->ax = state->ay = 0.0f;
        state->angle = 0.0f;
        state->angularVel = 0.0f;
    }
    PhysicsBody* b = find_body(bodyId);
    if (!b || !state) return;
    state->x = b->x; state->y = b->y;
    state->vx = b->vx; state->vy = b->vy;
    state->ax = b->ax; state->ay = b->ay;
    state->angle = b->angle;
    state->angularVel = b->angularVel;
}

LUMENT_API void lument_physics_set_state(int bodyId, const LumentBodyState* state) {
    PhysicsBody* b = find_body(bodyId);
    if (!b || !state) return;
    b->x = state->x; b->y = state->y;
    b->vx = state->vx; b->vy = state->vy;
    b->ax = state->ax; b->ay = state->ay;
    b->angle = state->angle;
    b->angularVel = state->angularVel;
}

LUMENT_API void lument_physics_get_position(int bodyId, float* x, float* y) {
    if (x) *x = 0.0f;
    if (y) *y = 0.0f;
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    if (x) *x = b->x;
    if (y) *y = b->y;
}

LUMENT_API void lument_physics_set_position(int bodyId, float x, float y) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->x = x; b->y = y;
}

LUMENT_API void lument_physics_get_velocity(int bodyId, float* vx, float* vy) {
    if (vx) *vx = 0.0f;
    if (vy) *vy = 0.0f;
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    if (vx) *vx = b->vx;
    if (vy) *vy = b->vy;
}

LUMENT_API void lument_physics_set_velocity(int bodyId, float vx, float vy) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    b->vx = vx; b->vy = vy;
}

LUMENT_API void lument_physics_apply_force(int bodyId, float fx, float fy) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    // 力转为加速度累加（F/m），仅对质量>0 的动态体生效
    if (b->type == LUMENT_BODY_DYNAMIC && b->mass > 0.0f) {
        b->ax += fx / b->mass;
        b->ay += fy / b->mass;
    }
}

LUMENT_API void lument_physics_apply_impulse(int bodyId, float ix, float iy) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    // 冲量直接改速度（J/m），仅对质量>0 的动态体生效
    if (b->type == LUMENT_BODY_DYNAMIC && b->mass > 0.0f) {
        b->vx += ix / b->mass;
        b->vy += iy / b->mass;
    }
}

LUMENT_API void lument_physics_apply_torque(int bodyId, float torque) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    if (b->type == LUMENT_BODY_DYNAMIC && b->mass > 0.0f) {
        b->torqueAccum += torque;
    }
}

LUMENT_API void lument_physics_apply_angular_impulse(int bodyId, float impulse) {
    PhysicsBody* b = find_body(bodyId);
    if (!b) return;
    if (b->type == LUMENT_BODY_DYNAMIC && b->mass > 0.0f) {
        b->angularVel += impulse / b->mass;
    }
}

// ---- 碰撞检测 ----
LUMENT_API bool lument_physics_check_collision(int bodyA, int bodyB, LumentCollision* outCollision) {
    ensure_init();
    PhysicsBody* a = find_body(bodyA);
    PhysicsBody* b = find_body(bodyB);
    if (!a || !b) return false;
    LumentCollision col;
    if (compute_manifold(*a, bodyA, *b, bodyB, col)) {
        if (outCollision) *outCollision = col;
        return true;
    }
    return false;
}

LUMENT_API int lument_physics_get_collisions(int bodyId, LumentCollision* outCollisions, int maxCount) {
    ensure_init();
    if (bodyId <= 0 || bodyId > MAX_BODIES || !g_world.pool[bodyId - 1].alive) return 0;
    if (maxCount <= 0 || !outCollisions) return 0;
    int count = 0;
    for (const LumentCollision& c : g_world.frameCollisions) {
        if (c.bodyA == bodyId || c.bodyB == bodyId) {
            if (count >= maxCount) break;
            outCollisions[count++] = c;
        }
    }
    return count;
}

LUMENT_API bool lument_physics_raycast(float x1, float y1, float x2, float y2,
                                       LumentCollision* outHit, int* outBodyId) {
    ensure_init();
    float bestT = 2.0f;            // 超过 1 即未命中
    int bestId = 0;
    LumentCollision bestHit{};
    float dx = x2 - x1, dy = y2 - y1;
    float segLen = std::sqrt(dx * dx + dy * dy);

    for (int i = 0; i < MAX_BODIES; ++i) {
        PhysicsBody& b = g_world.pool[i];
        if (!b.alive) continue;
        float t, nx, ny;
        bool hit = (b.shape.type == LUMENT_SHAPE_CIRCLE)
                   ? ray_circle(b, x1, y1, x2, y2, t, nx, ny)
                   : ray_aabb(b, x1, y1, x2, y2, t, nx, ny);
        if (hit && t < bestT) {
            bestT = t;
            bestId = i + 1;
            bestHit.bodyA = i + 1;
            bestHit.bodyB = 0;
            bestHit.point.x = x1 + dx * t;
            bestHit.point.y = y1 + dy * t;
            bestHit.normal.x = nx;
            bestHit.normal.y = ny;
            bestHit.penetration = t * segLen; // 复用为命中距离
        }
    }
    if (bestId == 0) return false;
    if (outHit) *outHit = bestHit;
    if (outBodyId) *outBodyId = bestId;
    return true;
}

LUMENT_API bool lument_physics_point_query(float x, float y, int* outBodyId) {
    ensure_init();
    for (int i = 0; i < MAX_BODIES; ++i) {
        PhysicsBody& b = g_world.pool[i];
        if (!b.alive) continue;
        if (b.shape.type == LUMENT_SHAPE_CIRCLE) {
            float dx = x - b.x, dy = y - b.y;
            if (dx * dx + dy * dy <= b.shape.radius * b.shape.radius) {
                if (outBodyId) *outBodyId = i + 1;
                return true;
            }
        } else {
            float hx = b.shape.w * 0.5f, hy = b.shape.h * 0.5f;
            if (std::fabs(x - b.x) <= hx && std::fabs(y - b.y) <= hy) {
                if (outBodyId) *outBodyId = i + 1;
                return true;
            }
        }
    }
    return false;
}

// ---- 碰撞回调 ----
LUMENT_API void lument_physics_on_collision(LumentCollisionCallback callback, void* userData) {
    ensure_init();
    g_world.callback = callback;
    g_world.callbackUserData = userData;
}

} // extern "C"
