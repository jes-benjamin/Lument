// ============================================================
// lument_ai.cpp - AI 模块：行为树 / 有限状态机 / A*寻路 / 黑板 / Agent
// ------------------------------------------------------------
// 实现 C ABI（见 lument.h AI 模块部分）：
//   行为树：lument_ai_create_tree / destroy_tree / create_node /
//           add_child / set_entity / tick
//   状态机：lument_ai_create_fsm / destroy_fsm / add_state /
//           add_transition / set_state / get_state / tick / get_state_name
//   寻路  ：lument_ai_create_grid / destroy_grid / set_blocked /
//           is_blocked / set_cost / find_path / path_length
//   黑板  ：lument_ai_create_blackboard / bb_set_* / bb_get_* /
//           bb_remove / bb_clear
//   Agent ：lument_ai_register_agent / unregister_agent / set_target /
//           get_target / agent_tick / agent_query
//
// 设计：
//   - 对象池：行为树(64)、节点(64*128=8192)、状态机(32)、
//     网格(16)、黑板(32)、Agent(16) 均使用固定大小数组，
//     通过 used 标志管理，分配时线性扫描首个空闲槽。
//   - 行为树节点全局唯一 ID（1-based），跨树共享节点池。
//     每棵树的首个节点自动成为根节点。
//   - A* 使用开放列表（线性扫描最小 f）与关闭列表（布尔数组），
//     8 方向移动，对角线代价 1.414，曼哈顿距离启发式。
//   - 黑板使用 unordered_map 存储 int/float/string/bool 变体。
//   - 字符串返回值使用静态缓冲区或 map 内部 c_str()（线程不安全
//     但简单可靠，与引擎 storage 模块风格一致）。
// ============================================================
#include "lument_internal.h"

#include <string>
#include <vector>
#include <map>
#include <queue>
#include <cmath>
#include <cstring>
#include <algorithm>
#include <limits>
#include <unordered_map>
#include <cstdio>

namespace {

// ===== 常量 =====
constexpr int MAX_AI_TREES           = 64;      // 最大行为树数
constexpr int MAX_AI_NODES_PER_TREE  = 128;     // 每棵树最大节点数
constexpr int MAX_AI_NODES_TOTAL     = MAX_AI_TREES * MAX_AI_NODES_PER_TREE; // 8192
constexpr int MAX_AI_FSMS            = 32;      // 最大状态机数
constexpr int MAX_AI_FSM_STATES      = 32;      // 每个 FSM 最大状态数
constexpr int MAX_AI_FSM_TRANS       = 128;     // 每个 FSM 最大转换数
constexpr int MAX_AI_GRIDS           = 16;      // 最大网格数
constexpr int MAX_AI_BLACKBOARDS     = 32;      // 最大黑板数
constexpr int MAX_AI_AGENTS         = 16;      // 最大 Agent 数

// 静态字符串缓冲区（用于返回字符串 API）
static char g_strBuf[4096];   // 大缓冲区：Agent 查询 JSON
static char g_strBuf2[256];   // 小缓冲区：FSM 状态名等

bool g_aiInitialized = false;

// ============================================================
// 行为树
// ============================================================

// 行为树节点
struct AiNode {
    int               id       = 0;    // 节点 ID（1-based，0=无效）
    int               treeId   = 0;    // 所属树 ID
    LumentAiNodeType  type     = LUMENT_AI_NODE_ACTION;
    LumentAiNodeFunc  func     = nullptr;
    void*             userData = nullptr;
    std::vector<int>  children;        // 子节点 ID 列表
    int               parent   = 0;    // 父节点 ID（0=根/无父）
    LumentAiStatus    status   = LUMENT_AI_FAILURE;
    bool              used     = false;
};

// 行为树
struct AiTree {
    bool         used    = false;
    int          rootId  = 0;   // 根节点 ID（0=无）
    LumentEntity entity  = LUMENT_INVALID_ENTITY;  // 绑定的实体
};

AiTree g_trees[MAX_AI_TREES];
AiNode g_nodes[MAX_AI_NODES_TOTAL];

// 通过 ID 获取节点
AiNode* node_get(int nodeId) {
    if (nodeId <= 0 || nodeId > MAX_AI_NODES_TOTAL) return nullptr;
    AiNode& n = g_nodes[nodeId - 1];
    return n.used ? &n : nullptr;
}

// 通过 ID 获取树
AiTree* tree_get(int treeId) {
    if (treeId <= 0 || treeId > MAX_AI_TREES) return nullptr;
    return g_trees[treeId - 1].used ? &g_trees[treeId - 1] : nullptr;
}

// 分配节点，返回 1-based ID（0=失败）
int node_alloc() {
    for (int i = 0; i < MAX_AI_NODES_TOTAL; ++i) {
        if (!g_nodes[i].used) {
            AiNode& n = g_nodes[i];
            n.used     = true;
            n.id       = i + 1;
            n.treeId   = 0;
            n.type     = LUMENT_AI_NODE_ACTION;
            n.func     = nullptr;
            n.userData = nullptr;
            n.children.clear();
            n.parent   = 0;
            n.status   = LUMENT_AI_FAILURE;
            return n.id;
        }
    }
    return 0; // 节点池已满
}

// 行为树节点 tick 递归执行
LumentAiStatus tick_node(int nodeId, LumentEntity entity, float dt) {
    AiNode* node = node_get(nodeId);
    if (!node) return LUMENT_AI_FAILURE;

    switch (node->type) {
    // ---- 动作 / 条件节点：直接调用 func ----
    case LUMENT_AI_NODE_ACTION:
    case LUMENT_AI_NODE_CONDITION: {
        if (node->func) {
            node->status = node->func(entity, dt, node->userData);
        } else {
            node->status = LUMENT_AI_FAILURE;
        }
        return node->status;
    }

    // ---- 顺序节点：依次执行子节点 ----
    // 全部 SUCCESS 才 SUCCESS；遇到 FAILURE 则 FAILURE；
    // 遇到 RUNNING 则 RUNNING
    case LUMENT_AI_NODE_SEQUENCE: {
        for (int childId : node->children) {
            LumentAiStatus s = tick_node(childId, entity, dt);
            if (s == LUMENT_AI_FAILURE) {
                node->status = LUMENT_AI_FAILURE;
                return node->status;
            }
            if (s == LUMENT_AI_RUNNING) {
                node->status = LUMENT_AI_RUNNING;
                return node->status;
            }
            // SUCCESS：继续执行下一个子节点
        }
        node->status = LUMENT_AI_SUCCESS;
        return node->status;
    }

    // ---- 选择节点：依次执行子节点 ----
    // 任一 SUCCESS 则 SUCCESS；全部 FAILURE 才 FAILURE；
    // 遇到 RUNNING 则 RUNNING
    case LUMENT_AI_NODE_SELECTOR: {
        for (int childId : node->children) {
            LumentAiStatus s = tick_node(childId, entity, dt);
            if (s == LUMENT_AI_SUCCESS) {
                node->status = LUMENT_AI_SUCCESS;
                return node->status;
            }
            if (s == LUMENT_AI_RUNNING) {
                node->status = LUMENT_AI_RUNNING;
                return node->status;
            }
            // FAILURE：尝试下一个子节点
        }
        node->status = LUMENT_AI_FAILURE;
        return node->status;
    }

    // ---- 并行节点：同时执行所有子节点 ----
    // 多数 SUCCESS 则 SUCCESS；有 RUNNING 则 RUNNING；
    // 否则 FAILURE
    case LUMENT_AI_NODE_PARALLEL: {
        int successCount = 0;
        int runningCount = 0;
        int total = static_cast<int>(node->children.size());
        for (int childId : node->children) {
            LumentAiStatus s = tick_node(childId, entity, dt);
            if (s == LUMENT_AI_SUCCESS) ++successCount;
            else if (s == LUMENT_AI_RUNNING) ++runningCount;
        }
        if (total == 0) {
            node->status = LUMENT_AI_SUCCESS;     // 空并行视为成功
        } else if (successCount > total / 2) {
            node->status = LUMENT_AI_SUCCESS;     // 多数成功
        } else if (runningCount > 0) {
            node->status = LUMENT_AI_RUNNING;
        } else {
            node->status = LUMENT_AI_FAILURE;
        }
        return node->status;
    }

    // ---- 装饰节点：调用单个子节点并修改结果 ----
    // 实现为反转器（Inverter）：SUCCESS<->FAILURE，RUNNING 不变
    case LUMENT_AI_NODE_DECORATOR: {
        if (node->children.empty()) {
            node->status = LUMENT_AI_FAILURE;
            return node->status;
        }
        LumentAiStatus s = tick_node(node->children[0], entity, dt);
        if (s == LUMENT_AI_SUCCESS)       node->status = LUMENT_AI_FAILURE;
        else if (s == LUMENT_AI_FAILURE)  node->status = LUMENT_AI_SUCCESS;
        else                              node->status = LUMENT_AI_RUNNING;
        return node->status;
    }

    default:
        node->status = LUMENT_AI_FAILURE;
        return node->status;
    }
}

// ============================================================
// 有限状态机
// ============================================================

struct FsmState {
    bool              used     = false;
    int               id       = 0;   // 状态 ID（FSM 内 1-based）
    std::string       name;
    LumentAiNodeFunc  onUpdate = nullptr;
    void*             userData = nullptr;
};

struct FsmTransition {
    bool              used      = false;
    int               fromState = 0;
    int               toState   = 0;
    LumentAiNodeFunc  condition = nullptr;
    void*             userData  = nullptr;
};

struct AiFsm {
    bool          used        = false;
    FsmState      states[MAX_AI_FSM_STATES];
    FsmTransition transitions[MAX_AI_FSM_TRANS];
    int           stateCount    = 0;
    int           transCount    = 0;
    int           currentState  = 0;   // 当前状态 ID（0=无）
    LumentEntity  entity        = LUMENT_INVALID_ENTITY;
};

AiFsm g_fsms[MAX_AI_FSMS];

AiFsm* fsm_get(int fsmId) {
    if (fsmId <= 0 || fsmId > MAX_AI_FSMS) return nullptr;
    return g_fsms[fsmId - 1].used ? &g_fsms[fsmId - 1] : nullptr;
}

FsmState* fsm_get_state(AiFsm* fsm, int stateId) {
    if (!fsm || stateId <= 0 || stateId > MAX_AI_FSM_STATES) return nullptr;
    return fsm->states[stateId - 1].used ? &fsm->states[stateId - 1] : nullptr;
}

// ============================================================
// A* 寻路网格
// ============================================================

struct AiGrid {
    bool               used     = false;
    int                width    = 0;
    int                height   = 0;
    float              cellSize = 1.0f;
    std::vector<bool>  blocked;   // width*height，默认 false
    std::vector<float> cost;      // width*height，默认 1.0f
};

AiGrid g_grids[MAX_AI_GRIDS];

AiGrid* grid_get(int gridId) {
    if (gridId <= 0 || gridId > MAX_AI_GRIDS) return nullptr;
    return g_grids[gridId - 1].used ? &g_grids[gridId - 1] : nullptr;
}

inline int grid_index(const AiGrid* g, int x, int y) {
    return y * g->width + x;
}

inline bool grid_in_bounds(const AiGrid* g, int x, int y) {
    return x >= 0 && x < g->width && y >= 0 && y < g->height;
}

// ============================================================
// 黑板系统
// ============================================================

enum BbType { BB_INT, BB_FLOAT, BB_STRING, BB_BOOL };

struct BbValue {
    BbType      type     = BB_INT;
    int         intVal   = 0;
    float       floatVal = 0.0f;
    bool        boolVal  = false;
    std::string strVal;
};

struct Blackboard {
    bool used = false;
    std::unordered_map<std::string, BbValue> data;
};

Blackboard g_blackboards[MAX_AI_BLACKBOARDS];

Blackboard* bb_get(int bbId) {
    if (bbId <= 0 || bbId > MAX_AI_BLACKBOARDS) return nullptr;
    return g_blackboards[bbId - 1].used ? &g_blackboards[bbId - 1] : nullptr;
}

// ============================================================
// AI Agent
// ============================================================

struct AiAgent {
    bool              used         = false;
    std::string       name;
    LumentAiNodeFunc  think        = nullptr;
    void*             userData     = nullptr;
    LumentEntity      targetEntity = LUMENT_INVALID_ENTITY;
};

AiAgent g_agents[MAX_AI_AGENTS];

AiAgent* agent_get(int agentId) {
    if (agentId <= 0 || agentId > MAX_AI_AGENTS) return nullptr;
    return g_agents[agentId - 1].used ? &g_agents[agentId - 1] : nullptr;
}

} // namespace

// ============================================================
// 内部接口（ue 命名空间）
// ============================================================
namespace ue {

bool init_ai() {
    // 行为树池
    for (int i = 0; i < MAX_AI_TREES; ++i) {
        g_trees[i].used   = false;
        g_trees[i].rootId = 0;
        g_trees[i].entity = LUMENT_INVALID_ENTITY;
    }
    // 节点池
    for (int i = 0; i < MAX_AI_NODES_TOTAL; ++i) {
        g_nodes[i].used     = false;
        g_nodes[i].id       = 0;
        g_nodes[i].treeId   = 0;
        g_nodes[i].children.clear();
        g_nodes[i].children.shrink_to_fit();
    }
    // 状态机池
    for (int i = 0; i < MAX_AI_FSMS; ++i) {
        g_fsms[i].used         = false;
        g_fsms[i].stateCount  = 0;
        g_fsms[i].transCount  = 0;
        g_fsms[i].currentState = 0;
        g_fsms[i].entity      = LUMENT_INVALID_ENTITY;
        for (int j = 0; j < MAX_AI_FSM_STATES; ++j) {
            g_fsms[i].states[j].used     = false;
            g_fsms[i].states[j].name.clear();
            g_fsms[i].states[j].name.shrink_to_fit();
        }
        for (int j = 0; j < MAX_AI_FSM_TRANS; ++j) {
            g_fsms[i].transitions[j].used = false;
        }
    }
    // 网格池
    for (int i = 0; i < MAX_AI_GRIDS; ++i) {
        g_grids[i].used     = false;
        g_grids[i].width    = 0;
        g_grids[i].height   = 0;
        g_grids[i].cellSize = 1.0f;
        g_grids[i].blocked.clear();
        g_grids[i].blocked.shrink_to_fit();
        g_grids[i].cost.clear();
        g_grids[i].cost.shrink_to_fit();
    }
    // 黑板池
    for (int i = 0; i < MAX_AI_BLACKBOARDS; ++i) {
        g_blackboards[i].used = false;
        g_blackboards[i].data.clear();
    }
    // Agent 池
    for (int i = 0; i < MAX_AI_AGENTS; ++i) {
        g_agents[i].used         = false;
        g_agents[i].name.clear();
        g_agents[i].name.shrink_to_fit();
        g_agents[i].think        = nullptr;
        g_agents[i].userData     = nullptr;
        g_agents[i].targetEntity = LUMENT_INVALID_ENTITY;
    }

    g_aiInitialized = true;
    return true;
}

void shutdown_ai() {
    g_aiInitialized = false;

    // 释放所有节点（children 向量等）
    for (int i = 0; i < MAX_AI_NODES_TOTAL; ++i) {
        g_nodes[i].used = false;
        g_nodes[i].children.clear();
        g_nodes[i].children.shrink_to_fit();
    }
    // 状态机
    for (int i = 0; i < MAX_AI_FSMS; ++i) {
        g_fsms[i].used = false;
        for (int j = 0; j < MAX_AI_FSM_STATES; ++j) {
            g_fsms[i].states[j].used = false;
            g_fsms[i].states[j].name.clear();
            g_fsms[i].states[j].name.shrink_to_fit();
        }
    }
    // 网格
    for (int i = 0; i < MAX_AI_GRIDS; ++i) {
        g_grids[i].used = false;
        g_grids[i].blocked.clear();
        g_grids[i].blocked.shrink_to_fit();
        g_grids[i].cost.clear();
        g_grids[i].cost.shrink_to_fit();
    }
    // 黑板
    for (int i = 0; i < MAX_AI_BLACKBOARDS; ++i) {
        g_blackboards[i].used = false;
        g_blackboards[i].data.clear();
    }
    // Agent
    for (int i = 0; i < MAX_AI_AGENTS; ++i) {
        g_agents[i].used = false;
        g_agents[i].name.clear();
        g_agents[i].name.shrink_to_fit();
    }
}

} // namespace ue

// ============================================================
// C ABI
// ============================================================
extern "C" {

// ===== 行为树 =====

// 创建行为树，返回 treeId（0=失败）
LUMENT_API int lument_ai_create_tree(void) {
    for (int i = 0; i < MAX_AI_TREES; ++i) {
        if (!g_trees[i].used) {
            g_trees[i].used   = true;
            g_trees[i].rootId = 0;
            g_trees[i].entity = LUMENT_INVALID_ENTITY;
            return i + 1;  // 1-based
        }
    }
    return 0;
}

// 销毁行为树（连带释放其所有节点）
LUMENT_API void lument_ai_destroy_tree(int treeId) {
    AiTree* t = tree_get(treeId);
    if (!t) return;
    // 释放该树的所有节点
    for (int i = 0; i < MAX_AI_NODES_TOTAL; ++i) {
        if (g_nodes[i].used && g_nodes[i].treeId == treeId) {
            g_nodes[i].used     = false;
            g_nodes[i].id       = 0;
            g_nodes[i].treeId   = 0;
            g_nodes[i].children.clear();
            g_nodes[i].parent   = 0;
        }
    }
    t->used   = false;
    t->rootId = 0;
    t->entity = LUMENT_INVALID_ENTITY;
}

// 创建行为树节点，返回 nodeId（0=失败）
LUMENT_API int lument_ai_create_node(int treeId, LumentAiNodeType type,
                                      LumentAiNodeFunc func, void* userData) {
    AiTree* t = tree_get(treeId);
    if (!t) return 0;
    int nodeId = node_alloc();
    if (nodeId == 0) return 0;
    AiNode* n = node_get(nodeId);
    n->treeId   = treeId;
    n->type     = type;
    n->func     = func;
    n->userData = userData;
    // 树尚无根节点时，首个节点自动成为根
    if (t->rootId == 0) {
        t->rootId = nodeId;
    }
    return nodeId;
}

// 添加子节点（将 childId 作为 parentId 的子节点）
LUMENT_API void lument_ai_add_child(int parentId, int childId) {
    AiNode* parent = node_get(parentId);
    AiNode* child  = node_get(childId);
    if (!parent || !child) return;
    // 避免重复添加
    for (int c : parent->children) {
        if (c == childId) return;
    }
    parent->children.push_back(childId);
    child->parent = parentId;
}

// 设置行为树绑定的实体
LUMENT_API void lument_ai_set_entity(int treeId, LumentEntity entity) {
    AiTree* t = tree_get(treeId);
    if (!t) return;
    t->entity = entity;
}

// 执行行为树 tick，返回根节点状态
LUMENT_API LumentAiStatus lument_ai_tick(int treeId, float dt) {
    AiTree* t = tree_get(treeId);
    if (!t || t->rootId == 0) return LUMENT_AI_FAILURE;
    return tick_node(t->rootId, t->entity, dt);
}

// ===== 有限状态机 =====

// 创建 FSM，返回 fsmId（0=失败）
LUMENT_API int lument_ai_create_fsm(void) {
    for (int i = 0; i < MAX_AI_FSMS; ++i) {
        if (!g_fsms[i].used) {
            AiFsm& f = g_fsms[i];
            f.used         = true;
            f.stateCount   = 0;
            f.transCount   = 0;
            f.currentState = 0;
            f.entity       = LUMENT_INVALID_ENTITY;
            for (int j = 0; j < MAX_AI_FSM_STATES; ++j) {
                f.states[j].used = false;
            }
            for (int j = 0; j < MAX_AI_FSM_TRANS; ++j) {
                f.transitions[j].used = false;
            }
            return i + 1;
        }
    }
    return 0;
}

// 销毁 FSM
LUMENT_API void lument_ai_destroy_fsm(int fsmId) {
    AiFsm* fsm = fsm_get(fsmId);
    if (!fsm) return;
    for (int j = 0; j < MAX_AI_FSM_STATES; ++j) {
        fsm->states[j].used = false;
        fsm->states[j].name.clear();
    }
    for (int j = 0; j < MAX_AI_FSM_TRANS; ++j) {
        fsm->transitions[j].used = false;
    }
    fsm->used         = false;
    fsm->stateCount   = 0;
    fsm->transCount   = 0;
    fsm->currentState = 0;
}

// 添加状态，返回 stateId（0=失败）
LUMENT_API int lument_ai_fsm_add_state(int fsmId, const char* name,
                                        LumentAiNodeFunc onUpdate, void* userData) {
    AiFsm* fsm = fsm_get(fsmId);
    if (!fsm) return 0;
    for (int i = 0; i < MAX_AI_FSM_STATES; ++i) {
        if (!fsm->states[i].used) {
            FsmState& s = fsm->states[i];
            s.used     = true;
            s.id       = i + 1;
            s.name     = name ? name : "";
            s.onUpdate = onUpdate;
            s.userData = userData;
            ++fsm->stateCount;
            return s.id;
        }
    }
    return 0;  // 状态数已满
}

// 添加转换（condition 返回 SUCCESS 时触发 fromState -> toState）
LUMENT_API void lument_ai_fsm_add_transition(int fsmId, int fromState, int toState,
                                              LumentAiNodeFunc condition, void* userData) {
    AiFsm* fsm = fsm_get(fsmId);
    if (!fsm) return;
    for (int i = 0; i < MAX_AI_FSM_TRANS; ++i) {
        if (!fsm->transitions[i].used) {
            FsmTransition& t = fsm->transitions[i];
            t.used      = true;
            t.fromState = fromState;
            t.toState   = toState;
            t.condition = condition;
            t.userData  = userData;
            ++fsm->transCount;
            return;
        }
    }
}

// 设置当前状态
LUMENT_API void lument_ai_fsm_set_state(int fsmId, int stateId) {
    AiFsm* fsm = fsm_get(fsmId);
    if (!fsm) return;
    FsmState* st = fsm_get_state(fsm, stateId);
    if (!st) return;
    fsm->currentState = stateId;
}

// 获取当前状态 ID
LUMENT_API int lument_ai_fsm_get_state(int fsmId) {
    AiFsm* fsm = fsm_get(fsmId);
    if (!fsm) return 0;
    return fsm->currentState;
}

// 执行 FSM tick：检查转换条件，执行当前状态 onUpdate
LUMENT_API void lument_ai_fsm_tick(int fsmId, float dt) {
    AiFsm* fsm = fsm_get(fsmId);
    if (!fsm) return;

    // 检查当前状态的所有转换条件
    if (fsm->currentState > 0) {
        for (int i = 0; i < MAX_AI_FSM_TRANS; ++i) {
            FsmTransition& t = fsm->transitions[i];
            if (!t.used) continue;
            if (t.fromState != fsm->currentState) continue;
            if (!t.condition) continue;
            // 条件返回 SUCCESS 表示触发转换
            LumentAiStatus s = t.condition(fsm->entity, dt, t.userData);
            if (s == LUMENT_AI_SUCCESS) {
                fsm->currentState = t.toState;
                break;  // 一次 tick 只转换一次
            }
        }
    }

    // 执行当前状态的 onUpdate
    if (fsm->currentState > 0) {
        FsmState* st = fsm_get_state(fsm, fsm->currentState);
        if (st && st->onUpdate) {
            st->onUpdate(fsm->entity, dt, st->userData);
        }
    }
}

// 获取当前状态名（使用静态缓冲区）
LUMENT_API const char* lument_ai_fsm_get_state_name(int fsmId) {
    AiFsm* fsm = fsm_get(fsmId);
    if (!fsm || fsm->currentState <= 0) return "";
    FsmState* st = fsm_get_state(fsm, fsm->currentState);
    if (!st) return "";
    std::strncpy(g_strBuf2, st->name.c_str(), sizeof(g_strBuf2) - 1);
    g_strBuf2[sizeof(g_strBuf2) - 1] = '\0';
    return g_strBuf2;
}

// ===== A* 寻路 =====

// 创建网格，返回 gridId（0=失败）
LUMENT_API int lument_ai_create_grid(int width, int height, float cellSize) {
    if (width <= 0 || height <= 0) return 0;
    for (int i = 0; i < MAX_AI_GRIDS; ++i) {
        if (!g_grids[i].used) {
            AiGrid& g = g_grids[i];
            g.used     = true;
            g.width    = width;
            g.height   = height;
            g.cellSize = cellSize > 0.0f ? cellSize : 1.0f;
            g.blocked.assign(static_cast<size_t>(width) * height, false);
            g.cost.assign(static_cast<size_t>(width) * height, 1.0f);
            return i + 1;
        }
    }
    return 0;
}

// 销毁网格
LUMENT_API void lument_ai_destroy_grid(int gridId) {
    AiGrid* g = grid_get(gridId);
    if (!g) return;
    g->used     = false;
    g->width    = 0;
    g->height   = 0;
    g->cellSize = 1.0f;
    g->blocked.clear();
    g->blocked.shrink_to_fit();
    g->cost.clear();
    g->cost.shrink_to_fit();
}

// 设置格子阻挡
LUMENT_API void lument_ai_grid_set_blocked(int gridId, int x, int y, bool blocked) {
    AiGrid* g = grid_get(gridId);
    if (!g || !grid_in_bounds(g, x, y)) return;
    g->blocked[grid_index(g, x, y)] = blocked;
}

// 查询格子阻挡（越界视为阻挡）
LUMENT_API bool lument_ai_grid_is_blocked(int gridId, int x, int y) {
    AiGrid* g = grid_get(gridId);
    if (!g || !grid_in_bounds(g, x, y)) return true;
    return g->blocked[grid_index(g, x, y)];
}

// 设置格子通行代价
LUMENT_API void lument_ai_grid_set_cost(int gridId, int x, int y, float cost) {
    AiGrid* g = grid_get(gridId);
    if (!g || !grid_in_bounds(g, x, y)) return;
    g->cost[grid_index(g, x, y)] = cost;
}

// A* 寻路，返回路径长度（0=无路径）
// 输出路径从起点到终点
LUMENT_API int lument_ai_find_path(int gridId, int startX, int startY,
                                    int endX, int endY,
                                    LumentGridPos* outPath, int maxPathLen) {
    AiGrid* g = grid_get(gridId);
    if (!g || !outPath || maxPathLen <= 0) return 0;
    if (!grid_in_bounds(g, startX, startY)) return 0;
    if (!grid_in_bounds(g, endX, endY)) return 0;
    int startIdx = grid_index(g, startX, startY);
    int endIdx   = grid_index(g, endX, endY);
    if (g->blocked[startIdx]) return 0;  // 起点被阻挡
    if (g->blocked[endIdx])   return 0;  // 终点被阻挡

    // 起点即终点
    if (startX == endX && startY == endY) {
        outPath[0].x = startX;
        outPath[0].y = startY;
        return 1;
    }

    const int w = g->width;
    const int h = g->height;
    const int total = w * h;

    // A* 数据结构
    std::vector<float> gScore(total, std::numeric_limits<float>::infinity());
    std::vector<float> fScore(total, std::numeric_limits<float>::infinity());
    std::vector<int>   parentX(total, -1);
    std::vector<int>   parentY(total, -1);
    std::vector<bool>  inOpen(total, false);
    std::vector<bool>  inClosed(total, false);

    // 开放列表（线性索引存储，线性扫描最小 f）
    std::vector<int> openList;
    openList.reserve(static_cast<size_t>(total) / 4);

    auto idx = [w](int x, int y) { return y * w + x; };

    // 曼哈顿距离启发式
    auto heuristic = [endX, endY](int x, int y) -> float {
        return static_cast<float>(std::abs(x - endX) + std::abs(y - endY));
    };

    // 初始化起点
    int sIdx = idx(startX, startY);
    gScore[sIdx] = 0.0f;
    fScore[sIdx] = heuristic(startX, startY);
    inOpen[sIdx] = true;
    openList.push_back(sIdx);

    // 8 方向：前 4 个正交，后 4 个对角
    const int dx[8] = {0,  0, 1, -1, 1,  1, -1, -1};
    const int dy[8] = {1, -1, 0,  0, 1, -1,  1, -1};
    const float diagCost = 1.414f;  // 对角线移动代价 sqrt(2)

    bool found = false;

    while (!openList.empty()) {
        // 在开放列表中找 f 最小的节点
        size_t bestPos = 0;
        float  bestF   = fScore[openList[0]];
        for (size_t i = 1; i < openList.size(); ++i) {
            if (fScore[openList[i]] < bestF) {
                bestF   = fScore[openList[i]];
                bestPos = i;
            }
        }

        int current = openList[bestPos];
        int cx = current % w;
        int cy = current / w;

        // 到达终点
        if (cx == endX && cy == endY) {
            found = true;
            break;
        }

        // 从开放列表移除，加入关闭列表
        openList[bestPos] = openList.back();
        openList.pop_back();
        inOpen[current]  = false;
        inClosed[current] = true;

        // 遍历 8 个邻居
        for (int d = 0; d < 8; ++d) {
            int nx = cx + dx[d];
            int ny = cy + dy[d];
            if (!grid_in_bounds(g, nx, ny)) continue;

            int nIdx = idx(nx, ny);
            if (g->blocked[nIdx]) continue;
            if (inClosed[nIdx])   continue;

            bool isDiagonal = (d >= 4);
            float moveCost = isDiagonal ? diagCost : 1.0f;
            float cellCost = g->cost[nIdx];  // 进入该格子的通行代价
            float tentativeG = gScore[current] + cellCost * moveCost;

            // 对角线移动防止穿墙：两个相邻正交格子都不能被阻挡
            if (isDiagonal) {
                int adj1 = idx(cx + dx[d], cy);     // 水平相邻
                int adj2 = idx(cx, cy + dy[d]);      // 垂直相邻
                if (g->blocked[adj1] || g->blocked[adj2]) continue;
            }

            if (tentativeG < gScore[nIdx]) {
                parentX[nIdx] = cx;
                parentY[nIdx] = cy;
                gScore[nIdx]  = tentativeG;
                fScore[nIdx]  = tentativeG + heuristic(nx, ny);
                if (!inOpen[nIdx]) {
                    inOpen[nIdx] = true;
                    openList.push_back(nIdx);
                }
            }
        }
    }

    if (!found) return 0;

    // 回溯路径：从终点沿 parent 回到起点
    std::vector<LumentGridPos> path;
    int cx = endX, cy = endY;
    while (cx != -1 && cy != -1) {
        path.push_back({cx, cy});
        int ci = idx(cx, cy);
        int px = parentX[ci];
        int py = parentY[ci];
        if (px == -1 || py == -1) break;  // 到达起点（起点无父节点）
        cx = px;
        cy = py;
    }

    // 反转路径：从起点到终点
    std::reverse(path.begin(), path.end());

    // 输出路径（截断至 maxPathLen）
    int len = static_cast<int>(path.size());
    if (len > maxPathLen) len = maxPathLen;
    for (int i = 0; i < len; ++i) {
        outPath[i] = path[i];
    }
    return len;
}

// 计算路径总长度（欧几里得距离，网格坐标单位）
LUMENT_API float lument_ai_path_length(LumentGridPos* path, int pathLen) {
    if (!path || pathLen <= 1) return 0.0f;
    float total = 0.0f;
    for (int i = 1; i < pathLen; ++i) {
        float ddx = static_cast<float>(path[i].x - path[i - 1].x);
        float ddy = static_cast<float>(path[i].y - path[i - 1].y);
        total += std::sqrt(ddx * ddx + ddy * ddy);
    }
    return total;
}

// ===== 黑板系统 =====

// 创建黑板，返回 bbId（0=失败）
LUMENT_API int lument_ai_create_blackboard(void) {
    for (int i = 0; i < MAX_AI_BLACKBOARDS; ++i) {
        if (!g_blackboards[i].used) {
            g_blackboards[i].used = true;
            g_blackboards[i].data.clear();
            return i + 1;
        }
    }
    return 0;
}

LUMENT_API void lument_ai_bb_set_int(int bbId, const char* key, int value) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return;
    BbValue v;
    v.type   = BB_INT;
    v.intVal = value;
    bb->data[key] = std::move(v);
}

LUMENT_API void lument_ai_bb_set_float(int bbId, const char* key, float value) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return;
    BbValue v;
    v.type     = BB_FLOAT;
    v.floatVal = value;
    bb->data[key] = std::move(v);
}

LUMENT_API void lument_ai_bb_set_string(int bbId, const char* key, const char* value) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return;
    BbValue v;
    v.type   = BB_STRING;
    v.strVal = value ? value : "";
    bb->data[key] = std::move(v);
}

LUMENT_API void lument_ai_bb_set_bool(int bbId, const char* key, bool value) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return;
    BbValue v;
    v.type    = BB_BOOL;
    v.boolVal = value;
    bb->data[key] = std::move(v);
}

LUMENT_API int lument_ai_bb_get_int(int bbId, const char* key, int defVal) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return defVal;
    auto it = bb->data.find(key);
    if (it == bb->data.end() || it->second.type != BB_INT) return defVal;
    return it->second.intVal;
}

LUMENT_API float lument_ai_bb_get_float(int bbId, const char* key, float defVal) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return defVal;
    auto it = bb->data.find(key);
    if (it == bb->data.end() || it->second.type != BB_FLOAT) return defVal;
    return it->second.floatVal;
}

// 返回 map 内部 c_str()（在下次 set/remove/clear 前保持有效）
LUMENT_API const char* lument_ai_bb_get_string(int bbId, const char* key) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return "";
    auto it = bb->data.find(key);
    if (it == bb->data.end() || it->second.type != BB_STRING) return "";
    return it->second.strVal.c_str();
}

LUMENT_API bool lument_ai_bb_get_bool(int bbId, const char* key, bool defVal) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return defVal;
    auto it = bb->data.find(key);
    if (it == bb->data.end() || it->second.type != BB_BOOL) return defVal;
    return it->second.boolVal;
}

LUMENT_API void lument_ai_bb_remove(int bbId, const char* key) {
    Blackboard* bb = bb_get(bbId);
    if (!bb || !key) return;
    bb->data.erase(key);
}

LUMENT_API void lument_ai_bb_clear(int bbId) {
    Blackboard* bb = bb_get(bbId);
    if (!bb) return;
    bb->data.clear();
}

// ===== AI Agent 接口 =====

// 注册 agent，返回 agentId（0=失败）
LUMENT_API int lument_ai_register_agent(const char* name, LumentAiNodeFunc think, void* userData) {
    for (int i = 0; i < MAX_AI_AGENTS; ++i) {
        if (!g_agents[i].used) {
            AiAgent& a = g_agents[i];
            a.used         = true;
            a.name         = name ? name : "";
            a.think        = think;
            a.userData     = userData;
            a.targetEntity = LUMENT_INVALID_ENTITY;
            return i + 1;
        }
    }
    return 0;
}

// 注销 agent
LUMENT_API void lument_ai_unregister_agent(int agentId) {
    AiAgent* a = agent_get(agentId);
    if (!a) return;
    a->used         = false;
    a->name.clear();
    a->think        = nullptr;
    a->userData     = nullptr;
    a->targetEntity = LUMENT_INVALID_ENTITY;
}

// 设置目标实体
LUMENT_API void lument_ai_agent_set_target(int agentId, LumentEntity target) {
    AiAgent* a = agent_get(agentId);
    if (!a) return;
    a->targetEntity = target;
}

// 获取目标实体
LUMENT_API LumentEntity lument_ai_agent_get_target(int agentId) {
    AiAgent* a = agent_get(agentId);
    if (!a) return LUMENT_INVALID_ENTITY;
    return a->targetEntity;
}

// 执行 agent 思考（调用 think 函数）
LUMENT_API void lument_ai_agent_tick(int agentId, float dt) {
    AiAgent* a = agent_get(agentId);
    if (!a || !a->think) return;
    a->think(a->targetEntity, dt, a->userData);
}

// 查询引擎 AI 状态（返回 JSON 格式字符串，使用静态缓冲区）
LUMENT_API const char* lument_ai_agent_query(const char* query) {
    (void)query;  // 暂不解析 query，返回 AI 模块整体状态

    // 统计各子系统使用情况
    int treeCount = 0, nodeCount = 0, fsmCount = 0;
    int gridCount = 0, bbCount = 0, agentCount = 0;
    for (int i = 0; i < MAX_AI_TREES; ++i)
        if (g_trees[i].used) ++treeCount;
    for (int i = 0; i < MAX_AI_NODES_TOTAL; ++i)
        if (g_nodes[i].used) ++nodeCount;
    for (int i = 0; i < MAX_AI_FSMS; ++i)
        if (g_fsms[i].used) ++fsmCount;
    for (int i = 0; i < MAX_AI_GRIDS; ++i)
        if (g_grids[i].used) ++gridCount;
    for (int i = 0; i < MAX_AI_BLACKBOARDS; ++i)
        if (g_blackboards[i].used) ++bbCount;
    for (int i = 0; i < MAX_AI_AGENTS; ++i)
        if (g_agents[i].used) ++agentCount;

    std::snprintf(g_strBuf, sizeof(g_strBuf),
        "{\"engine\":\"Lument\",\"version\":\"%s\",\"ai\":{"
        "\"trees\":%d,\"nodes\":%d,\"fsms\":%d,\"grids\":%d,"
        "\"blackboards\":%d,\"agents\":%d,"
        "\"maxTrees\":%d,\"maxNodes\":%d,\"maxFsms\":%d,"
        "\"maxGrids\":%d,\"maxBlackboards\":%d,\"maxAgents\":%d"
        "}}",
        LUMENT_VERSION_STRING,
        treeCount, nodeCount, fsmCount, gridCount,
        bbCount, agentCount,
        MAX_AI_TREES, MAX_AI_NODES_TOTAL, MAX_AI_FSMS,
        MAX_AI_GRIDS, MAX_AI_BLACKBOARDS, MAX_AI_AGENTS);
    return g_strBuf;
}

} // extern "C"
