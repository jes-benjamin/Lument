// ============================================================
// joystick.js - 虚拟摇杆控制系统（Lument 移植版）
// 左侧摇杆控制移动
// 触摸处理和视觉渲染
// 额外通过 Lument._setJoystick() 和 _setKey()
// 将输入状态同步到引擎输入系统
// ============================================================

const Joystick = (function() {

    // ========== 引擎 API 引用 ==========
    const UE = (typeof Lument !== 'undefined') ? Lument : null;

    // 方向阈值：摇杆偏移超过此值时触发对应数字方向键
    const DIR_THRESHOLD = 0.5;

    let canvas, ctx;
    let centerX, centerY;
    let knobX, knobY;
    let radius = 60;
    let knobRadius = 25;
    let isActive = false;
    let touchId = null;
    let outputX = 0;
    let outputY = 0;
    let visible = false;

    // ========== 引擎输入同步辅助 ==========

    // 将摇杆模拟值和方向同步到引擎输入系统
    function syncJoystickToEngine() {
        if (!UE) return;
        UE._setJoystick(outputX, outputY);
        UE._setKey(UE.KEY.LEFT,  outputX < -DIR_THRESHOLD);
        UE._setKey(UE.KEY.RIGHT, outputX >  DIR_THRESHOLD);
        UE._setKey(UE.KEY.UP,    outputY < -DIR_THRESHOLD);
        UE._setKey(UE.KEY.DOWN,  outputY >  DIR_THRESHOLD);
    }

    // 清除摇杆相关的引擎输入（归零）
    function clearJoystickEngineInput() {
        if (!UE) return;
        UE._setJoystick(0, 0);
        UE._setKey(UE.KEY.LEFT,  false);
        UE._setKey(UE.KEY.RIGHT, false);
        UE._setKey(UE.KEY.UP,    false);
        UE._setKey(UE.KEY.DOWN, false);
    }

    // ========== 初始化 ==========

    function init() {
        canvas = document.getElementById('joystick-canvas');
        if (!canvas) return;
        ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;

        resize();
        window.addEventListener('resize', resize);

        // 触摸事件
        canvas.addEventListener('touchstart', onTouchStart, { passive: false });
        canvas.addEventListener('touchmove', onTouchMove, { passive: false });
        canvas.addEventListener('touchend', onTouchEnd, { passive: false });
        canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

        // 鼠标事件（桌面端测试）
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);

        // 键盘事件：Space/Enter 映射到 action，方向键映射到引擎方向键
        document.addEventListener('keydown', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                UE && UE._setKey(UE.KEY.ACTION, true);
            } else if (e.key === 'ArrowLeft') {
                UE && UE._setKey(UE.KEY.LEFT, true);
            } else if (e.key === 'ArrowRight') {
                UE && UE._setKey(UE.KEY.RIGHT, true);
            } else if (e.key === 'ArrowUp') {
                UE && UE._setKey(UE.KEY.UP, true);
            } else if (e.key === 'ArrowDown') {
                UE && UE._setKey(UE.KEY.DOWN, true);
            }
        });
        document.addEventListener('keyup', (e) => {
            if (e.key === ' ' || e.key === 'Enter') {
                UE && UE._setKey(UE.KEY.ACTION, false);
            } else if (e.key === 'ArrowLeft') {
                UE && UE._setKey(UE.KEY.LEFT, false);
            } else if (e.key === 'ArrowRight') {
                UE && UE._setKey(UE.KEY.RIGHT, false);
            } else if (e.key === 'ArrowUp') {
                UE && UE._setKey(UE.KEY.UP, false);
            } else if (e.key === 'ArrowDown') {
                UE && UE._setKey(UE.KEY.DOWN, false);
            }
        });
    }

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        centerX = 100;
        centerY = canvas.height - 100;
        knobX = centerX;
        knobY = centerY;
    }

    function show() {
        visible = true;
        canvas.style.display = 'block';
    }

    function hide() {
        visible = false;
        canvas.style.display = 'none';
        outputX = 0;
        outputY = 0;
        isActive = false;
        touchId = null;
        knobX = centerX;
        knobY = centerY;
        // 清除引擎中的摇杆和方向键输入
        clearJoystickEngineInput();
    }

    function getDist(x1, y1, x2, y2) {
        return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2);
    }

    // ========== 触摸处理 ==========

    function onTouchStart(e) {
        // 暂停菜单可见时不处理任何触摸
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu && !pauseMenu.classList.contains('hidden')) {
            return;
        }

        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];

            // 跳过暂停按钮区域的触摸，让事件穿透到按钮
            const pauseBtn = document.getElementById('btn-pause');
            if (pauseBtn && pauseBtn.style.display !== 'none') {
                const rect = pauseBtn.getBoundingClientRect();
                if (t.clientX >= rect.left - 5 && t.clientX <= rect.right + 5 &&
                    t.clientY >= rect.top - 5 && t.clientY <= rect.bottom + 5) {
                    continue; // 不拦截此触摸
                }
            }

            // 检查是否点在摇杆区域
            if (getDist(t.clientX, t.clientY, centerX, centerY) < radius + 30 && touchId === null) {
                e.preventDefault();
                touchId = t.identifier;
                isActive = true;
                updateKnob(t.clientX, t.clientY);
            }
        }
    }

    function onTouchMove(e) {
        // 暂停菜单可见时不处理
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu && !pauseMenu.classList.contains('hidden')) {
            return;
        }
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === touchId) {
                e.preventDefault();
                updateKnob(t.clientX, t.clientY);
            }
        }
    }

    function onTouchEnd(e) {
        // 暂停菜单可见时不处理
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu && !pauseMenu.classList.contains('hidden')) {
            return;
        }
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            if (t.identifier === touchId) {
                e.preventDefault();
                touchId = null;
                isActive = false;
                knobX = centerX;
                knobY = centerY;
                outputX = 0;
                outputY = 0;
                // 清除引擎中的摇杆和方向键输入
                clearJoystickEngineInput();
            }
        }
    }

    // ========== 鼠标支持 ==========

    let mouseDown = false;
    function onMouseDown(e) {
        if (getDist(e.clientX, e.clientY, centerX, centerY) < radius + 30) {
            mouseDown = true;
            isActive = true;
            updateKnob(e.clientX, e.clientY);
        }
    }

    function onMouseMove(e) {
        if (mouseDown) {
            updateKnob(e.clientX, e.clientY);
        }
    }

    function onMouseUp(e) {
        mouseDown = false;
        isActive = false;
        knobX = centerX;
        knobY = centerY;
        outputX = 0;
        outputY = 0;
        // 清除引擎中的摇杆、方向键输入
        clearJoystickEngineInput();
    }

    // ========== 摇杆位置更新 ==========

    function updateKnob(x, y) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist > radius) {
            knobX = centerX + (dx / dist) * radius;
            knobY = centerY + (dy / dist) * radius;
        } else {
            knobX = x;
            knobY = y;
        }

        outputX = (knobX - centerX) / radius;
        outputY = (knobY - centerY) / radius;

        // 将摇杆模拟值和方向同步到引擎输入系统
        syncJoystickToEngine();
    }

    function getInput() {
        return {
            joystickX: outputX,
            joystickY: outputY,
            action: false,
            justPressedAction: false,
        };
    }

    function clearJustPressed() {}

    // ========== 视觉渲染 ==========

    function render() {
        if (!visible || !ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 摇杆外圈
        ctx.strokeStyle = 'rgba(60, 70, 90, 0.6)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.stroke();

        ctx.fillStyle = 'rgba(20, 25, 40, 0.4)';
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
        ctx.fill();

        // 摇杆方向指示线
        if (isActive) {
            ctx.strokeStyle = 'rgba(100, 120, 160, 0.5)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(centerX, centerY);
            ctx.lineTo(knobX, knobY);
            ctx.stroke();
        }

        // 摇杆头
        const knobColor = isActive ? '#6a8aba' : '#3a4a6a';
        ctx.fillStyle = knobColor;
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobRadius, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = 'rgba(100, 130, 170, 0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(knobX, knobY, knobRadius, 0, Math.PI * 2);
        ctx.stroke();
    }

    return {
        init,
        show,
        hide,
        getInput,
        clearJustPressed,
        render,
        get isVisible() { return visible; },
    };
})();
