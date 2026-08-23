// ============================================================
// game.js - 主游戏控制器（Lument 版）
// 使用 Lument API 驱动渲染、输入、音频、存储
// 游戏循环、状态管理、存档、成就系统
// ============================================================

const Game = (function() {

    const STATE = {
        MENU: 'menu',
        PLAYING: 'playing',
        DIALOGUE: 'dialogue',
        CHAPTER_INTRO: 'chapter_intro',
        ENDING: 'ending',
        GAME_OVER: 'game_over',
        ACHIEVEMENTS: 'achievements',
        PAUSED: 'paused',
    };

    let state = STATE.MENU;
    let savedState = null;
    let canvas, ctx;
    let canvasWidth, canvasHeight;
    let player, npcManager, rainSystem;
    let buffItems = [];
    let storyNPCs = [];
    let corridorPlayerX = 1900;
    let currentSubScene = null;

    const input = {
        left: false, right: false, up: false, down: false,
        action: false,
        joystickX: 0, joystickY: 0,
        justPressed: { up: false, down: false, left: false, right: false, action: false },
    };

    let joyPrevUp = false;
    let joyPrevDown = false;
    let kbAction = false; // 键盘 action 按键状态（独立追踪，避免与摇杆 OR 后粘滞）

    // ========== 初始化 ==========
    function init() {
        // 通过 Lument 初始化引擎
        canvas = document.getElementById('game-canvas');
        Lument.init({
            platform: Lument.PLATFORM.WEB,
            rendererType: Lument.RENDERER.CANVAS2D,
            width: 960,
            height: 540,
            targetFPS: 60,
            fullscreen: false,
        });

        // 获取引擎管理的画布上下文
        ctx = Lument.getContext();
        canvas = Lument.getCanvas();

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        setupInput();
        setupUI();
        setupAutoSaveOnExit();
        Joystick.init();

        player = new Player(100, 400);
        npcManager = new NPCManager();
        rainSystem = new RainSystem();

        Story.loadAchievements();
        updateContinueButton();
        updateAchievementsCount();

        // 使用引擎主循环
        Lument.run(updateFrame, renderFrame);

        // 开头Logo动画：显示一段时间后淡出
        setTimeout(() => {
            const splash = document.getElementById('splash-screen');
            if (splash) {
                splash.classList.add('fade-out');
                setTimeout(() => {
                    splash.style.display = 'none';
                }, 800);
            }
        }, 2800);

        // 对话结束时重置输入状态，防止摇杆/按钮卡死
        DialogueSystem.onResetInput = () => {
            input.action = false;
            input.justPressed.action = false;
            input.justPressed.up = false;
            input.justPressed.down = false;
            input.justPressed.left = false;
            input.justPressed.right = false;
            kbAction = false;
        };
    }

    function resizeCanvas() {
        const container = document.getElementById('game-container');
        const w = container.clientWidth;
        const h = container.clientHeight;

        const targetRatio = 16 / 9;
        let cw, ch;
        if (w / h > targetRatio) {
            ch = h;
            cw = h * targetRatio;
        } else {
            cw = w;
            ch = w / targetRatio;
        }

        canvas.width = cw;
        canvas.height = ch;
        canvasWidth = cw;
        canvasHeight = ch;
        ctx.imageSmoothingEnabled = false;
    }

    // ========== 输入处理 ==========
    function setupInput() {
        const keyMap = {
            'ArrowLeft': 'left', 'a': 'left', 'A': 'left',
            'ArrowRight': 'right', 'd': 'right', 'D': 'right',
            'ArrowUp': 'up', 'w': 'up', 'W': 'up',
            'ArrowDown': 'down', 's': 'down', 'S': 'down',
            ' ': 'action', 'Enter': 'action', 'e': 'action', 'E': 'action',
        };

        document.addEventListener('keydown', (e) => {
            const key = keyMap[e.key];
            if (key) {
                e.preventDefault();
                if (key === 'action') {
                    if (!kbAction) input.justPressed.action = true;
                    kbAction = true;
                } else {
                    if (!input[key]) input.justPressed[key] = true;
                    input[key] = true;
                }
                // 同步到引擎输入
                const engineKey = _mapKeyToEngine(key);
                if (engineKey) Lument._setKey(engineKey, true);
            }
        });

        document.addEventListener('keyup', (e) => {
            const key = keyMap[e.key];
            if (key) {
                e.preventDefault();
                if (key === 'action') {
                    kbAction = false;
                } else {
                    input[key] = false;
                }
                const engineKey = _mapKeyToEngine(key);
                if (engineKey) Lument._setKey(engineKey, false);
            }
        });
    }

    function _mapKeyToEngine(keyName) {
        switch(keyName) {
            case 'left': return Lument.KEY.LEFT;
            case 'right': return Lument.KEY.RIGHT;
            case 'up': return Lument.KEY.UP;
            case 'down': return Lument.KEY.DOWN;
            case 'action': return Lument.KEY.ACTION;
            default: return null;
        }
    }

    // ========== UI 事件 ==========
    function setupUI() {
        document.getElementById('btn-start').addEventListener('click', () => {
            AudioSystem.init();
            AudioSystem.resume();
            startNewGame();
        });

        document.getElementById('btn-continue').addEventListener('click', () => {
            AudioSystem.init();
            AudioSystem.resume();
            if (loadGame()) {
                document.getElementById('main-menu').classList.add('hidden');
                Joystick.show();
                startChapter(Story.currentChapterIdx, true);
            } else {
                startNewGame();
            }
        });

        document.getElementById('btn-about').addEventListener('click', () => {
            document.getElementById('main-menu').classList.add('hidden');
            document.getElementById('about-screen').classList.remove('hidden');
        });

        document.getElementById('btn-back-menu').addEventListener('click', () => {
            document.getElementById('about-screen').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        });

        document.getElementById('btn-achievements').addEventListener('click', () => {
            document.getElementById('main-menu').classList.add('hidden');
            showAchievementsScreen();
        });

        document.getElementById('btn-achievements-back').addEventListener('click', () => {
            document.getElementById('achievements-screen').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        });

        // 制作组名单
        document.getElementById('btn-credits').addEventListener('click', () => {
            document.getElementById('main-menu').classList.add('hidden');
            const creditsScreen = document.getElementById('credits-screen');
            const scrollContent = creditsScreen.querySelector('.credits-content');
            const scrollContainer = creditsScreen.querySelector('.credits-scroll-container');
            // 重置滚动动画
            if (scrollContent) {
                scrollContent.classList.remove('scroll-done');
                scrollContent.style.animation = 'none';
                void scrollContent.offsetWidth; // 强制 reflow
                scrollContent.style.animation = '';
            }
            if (scrollContainer) {
                scrollContainer.classList.remove('scroll-done');
                scrollContainer.scrollTop = 0;
            }
            // 动画结束后允许手动滚动
            if (scrollContent) {
                scrollContent.onanimationend = () => {
                    scrollContent.classList.add('scroll-done');
                    if (scrollContainer) scrollContainer.classList.add('scroll-done');
                };
            }
            creditsScreen.classList.remove('hidden');
        });

        document.getElementById('btn-credits-back').addEventListener('click', () => {
            document.getElementById('credits-screen').classList.add('hidden');
            document.getElementById('main-menu').classList.remove('hidden');
        });

        // 成就详情弹窗关闭
        document.getElementById('btn-ach-detail-close').addEventListener('click', () => {
            document.getElementById('achievement-detail-overlay').classList.add('hidden');
        });

        const btnEndingMenu = document.getElementById('btn-ending-menu');
        if (btnEndingMenu) {
            const handleEndingMenu = (e) => {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                document.getElementById('ending-screen').classList.add('hidden');
                document.getElementById('main-menu').classList.remove('hidden');
                state = STATE.MENU;
                updateContinueButton();
                updateAchievementsCount();
            };
            btnEndingMenu.addEventListener('click', handleEndingMenu);
            btnEndingMenu.addEventListener('touchstart', handleEndingMenu, { passive: false });
        }

        // 暂停按钮
        const pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) {
            const handlePause = (e) => {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                if (state === STATE.PLAYING || state === STATE.DIALOGUE) {
                    showPauseMenu();
                }
            };
            pauseBtn.addEventListener('click', handlePause);
            pauseBtn.addEventListener('touchstart', handlePause, { passive: false });
            pauseBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
        }

        // 暂停菜单 - 继续
        const btnResume = document.getElementById('btn-resume');
        if (btnResume) {
            const handleResume = (e) => {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                document.getElementById('pause-menu').classList.add('hidden');
                if (savedState) { state = savedState; savedState = null; }
                else { state = STATE.PLAYING; }
            };
            btnResume.addEventListener('click', handleResume);
            btnResume.addEventListener('touchstart', handleResume, { passive: false });
        }

        // 暂停菜单 - 返回主菜单
        const btnPauseMenu = document.getElementById('btn-pause-to-menu');
        if (btnPauseMenu) {
            const handlePauseToMenu = (e) => {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                saveGame();
                savedState = null;
                document.getElementById('pause-menu').classList.add('hidden');
                document.getElementById('hud').classList.add('hidden');
                const pb = document.getElementById('btn-pause');
                if (pb) pb.style.display = 'none';
                Joystick.hide();
                document.getElementById('main-menu').classList.remove('hidden');
                state = STATE.MENU;
                updateContinueButton();
            };
            btnPauseMenu.addEventListener('click', handlePauseToMenu);
            btnPauseMenu.addEventListener('touchstart', handlePauseToMenu, { passive: false });
        }
    }

    // ========== 暂停菜单 ==========
    function showPauseMenu() {
        savedState = state;
        state = STATE.PAUSED;
        const pauseMenu = document.getElementById('pause-menu');
        if (pauseMenu) pauseMenu.classList.remove('hidden');
    }

    // ========== 自动存档 ==========
    let autoSaveTimer = 0;
    const AUTO_SAVE_INTERVAL = 30000;

    function autoSave(dt) {
        if (state !== STATE.PLAYING && state !== STATE.DIALOGUE) return;
        autoSaveTimer += dt;
        if (autoSaveTimer >= AUTO_SAVE_INTERVAL) {
            saveGame();
            autoSaveTimer = 0;
        }
    }

    function setupAutoSaveOnExit() {
        window.addEventListener('beforeunload', () => {
            if (state === STATE.PLAYING || state === STATE.DIALOGUE) saveGame();
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && (state === STATE.PLAYING || state === STATE.DIALOGUE)) saveGame();
        });
    }

    // ========== UI 更新 ==========
    function updateContinueButton() {
        const btn = document.getElementById('btn-continue');
        if (Story.hasSave()) {
            btn.classList.remove('disabled');
            btn.style.opacity = '1';
        } else {
            btn.classList.add('disabled');
            btn.style.opacity = '0.4';
        }
    }

    function updateAchievementsCount() {
        const el = document.getElementById('achievement-count');
        if (el) {
            const { defs, unlocked } = Story.getAchievements();
            el.textContent = `${Object.keys(unlocked).length} / ${Object.keys(defs).length}`;
        }
    }

    function showAchievementsScreen() {
        const screen = document.getElementById('achievements-screen');
        const listEl = document.getElementById('achievements-list');
        listEl.innerHTML = '';
        const { defs, unlocked } = Story.getAchievements();
        const endingCount = Story.getEndingCount();
        const progressEl = document.createElement('div');
        progressEl.className = 'achievement-progress';
        progressEl.textContent = `已解锁结局：${endingCount} / 7`;
        listEl.appendChild(progressEl);
        for (const [id, def] of Object.entries(defs)) {
            const item = document.createElement('div');
            item.className = 'achievement-item' + (unlocked[id] ? ' unlocked' : ' locked');
            item.style.cursor = 'pointer';
            const icon = document.createElement('span');
            icon.className = 'achievement-icon';
            icon.textContent = unlocked[id] ? def.icon : '?';
            const info = document.createElement('div');
            info.className = 'achievement-info';
            const name = document.createElement('div');
            name.className = 'achievement-name';
            name.textContent = unlocked[id] ? def.name : '???';
            const desc = document.createElement('div');
            desc.className = 'achievement-desc';
            desc.textContent = unlocked[id] ? def.desc : '尚未解锁';
            info.appendChild(name);
            info.appendChild(desc);
            item.appendChild(icon);
            item.appendChild(info);

            // 点击查看成就详情（仅用 click，避免 touchstart 阻止滚动）
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                showAchievementDetail(id, def, unlocked[id]);
            });

            listEl.appendChild(item);
        }
        screen.classList.remove('hidden');
    }

    function showAchievementDetail(id, def, isUnlocked) {
        const overlay = document.getElementById('achievement-detail-overlay');
        const iconEl = document.getElementById('ach-detail-icon');
        const nameEl = document.getElementById('ach-detail-name');
        const descEl = document.getElementById('ach-detail-desc');
        const infoEl = document.getElementById('ach-detail-info');

        if (isUnlocked) {
            iconEl.textContent = def.icon;
            iconEl.classList.remove('locked');
            nameEl.textContent = def.name;
            descEl.textContent = def.desc;
            infoEl.textContent = def.info || def.desc;
            infoEl.classList.remove('locked-info');
        } else {
            iconEl.textContent = '?';
            iconEl.classList.add('locked');
            nameEl.textContent = '???';
            descEl.textContent = '尚未解锁';
            infoEl.textContent = '此成就尚未解锁，完成游戏中的相关条件后即可查看详细信息。';
            infoEl.classList.add('locked-info');
        }

        overlay.classList.remove('hidden');
    }

    // ========== 游戏流程 ==========
    function startNewGame() {
        document.getElementById('main-menu').classList.add('hidden');
        Story.init();
        player = new Player(100, 400);
        Joystick.show();
        const pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) pauseBtn.style.display = 'block';
        startChapter(0);
    }

    function loadGame() {
        const save = localStorage.getItem('lumentWorld_save');
        if (!save) return false;
        try {
            const data = JSON.parse(save);
            Story.init();
            player = new Player(data.playerX || 100, 400);
            Story.loadSaveData(data, player);
            const pauseBtn = document.getElementById('btn-pause');
            if (pauseBtn) pauseBtn.style.display = 'block';
            return true;
        } catch (e) { return false; }
    }

    function saveGame() {
        try {
            const data = Story.getSaveData(player);
            localStorage.setItem('lumentWorld_save', JSON.stringify(data));
        } catch (e) {}
    }

    // ========== NPC 颜色 ==========
    const SHIRT_PALETTE = ['#4a3a2a','#3a2a4a','#2a4a3a','#4a2a2a','#2a3a4a','#4a4a2a','#3a4a4a','#4a2a4a','#2a4a4a','#4a3a2e'];
    let shirtColorIdx = 0;
    function nextShirtColor() { return SHIRT_PALETTE[shirtColorIdx++ % SHIRT_PALETTE.length]; }

    // ========== 生成故事NPC ==========
    function spawnStoryNPCs() {
        storyNPCs = [];
        shirtColorIdx = 0;
        const encounters = Story.getCurrentEncounters();
        for (let i = 0; i < encounters.length; i++) {
            const enc = encounters[i];
            if (Story.encounterHasNPC(enc) && !Story.isEncounterTriggered(i)) {
                const npcType = Story.getEncounterNPCType(enc);
                const y = 400;
                const shirtColor = nextShirtColor();
                const lumentColor = npcType === 'lument' ? (i % 3 === 0 ? 'gold' : 'red') : null;
                const isFallen = enc.npcFallen === true;
                // 提取NPC名字（第一个非旁白/非玩家角色的对话行name）
                let npcName = null;
                if (enc.dialogue) {
                    for (const line of enc.dialogue) {
                        if (line.portrait && line.portrait !== 'narrator' && line.portrait !== 'player' && line.name) {
                            // 过滤掉群体称呼（"撑伞同学群"等），保留个体名字
                            if (!line.name.includes('群') && line.name.length <= 6) {
                                npcName = line.name;
                            }
                            break;
                        }
                    }
                }
                const mainNpc = new StoryNPC(enc.triggerX, y, npcType, i, shirtColor, lumentColor, isFallen, npcName);
                storyNPCs.push(mainNpc);
                if (Story.isGroupEncounter(enc)) {
                    const offsets = [{dx:-35,dy:-20},{dx:35,dy:-20},{dx:0,dy:35}];
                    for (let j = 0; j < offsets.length; j++) {
                        const bullyNpc = new StoryNPC(enc.triggerX + offsets[j].dx, y + offsets[j].dy, 'normal', i, nextShirtColor(), null);
                        bullyNpc.isDecoration = true;
                        bullyNpc.encounterIndex = i;
                        storyNPCs.push(bullyNpc);
                    }
                }
            }
        }
    }

    // ========== 触发encounter对话 ==========
    function startEncounter(encounter) {
        state = STATE.DIALOGUE;
        let selectedEnding = null;
        let encounterChoiceMade = null;
        const isGroup = Story.isGroupEncounter(encounter);

        DialogueSystem.start(encounter.dialogue, () => {
            if (encounter.buffReward) {
                player.addBuff(encounter.buffReward.type, encounter.buffReward.amount);
                updateHUD();
            }
            checkChoiceAchievements();
            if (isGroup && encounterChoiceMade === 'help_student') {
                for (const snpc of storyNPCs) {
                    if (snpc.isDecoration && !snpc.removed) snpc.scatter();
                }
            }
            const choices = Story.getPlayerChoices();
            if (choices.becameBoss === true && !player.hasLument) player.hasLument = true;

            // 结局优先
            if (selectedEnding) { showEnding(selectedEnding); return; }

            // 章节跳转
            let shouldNextChapter = false;
            if (typeof encounter.nextChapter === 'function') shouldNextChapter = encounter.nextChapter();
            else if (encounter.nextChapter === true) shouldNextChapter = true;

            if (shouldNextChapter) {
                saveGame();
                const hasNext = Story.nextChapter();
                if (hasNext) startChapter(Story.currentChapterIdx);
                else checkFinalEnding();
                return;
            }

            // 场景转换
            if (encounter.sceneTransition) { transitionToScene(encounter.sceneTransition); return; }

            // 重新解析遭遇列表（用于章节内选择后动态生成分支遭遇）
            if (encounter.reResolveOnChoice) {
                Story.resolveEncounters();
                storyNPCs = [];
                spawnStoryNPCs();
            }

            state = STATE.PLAYING;
        }, (choice) => {
            if (choice.ending) selectedEnding = choice.ending;
            if (isGroup && choice.choiceKey) encounterChoiceMade = choice.choiceKey;
            if (encounter.onChoice && typeof encounter.onChoice === 'function') encounter.onChoice(choice);
        });
    }

    // ========== 开始章节 ==========
    function startChapter(chapterIdx, isContinue = false) {
        const chapter = Story.chapters[chapterIdx];
        // theme 和 rainIntensity 支持函数形式（动态场景）
        const theme = typeof chapter.theme === 'function' ? chapter.theme() : chapter.theme;
        const rainIntensity = typeof chapter.rainIntensity === 'function' ? chapter.rainIntensity() : chapter.rainIntensity;
        World.init(theme);
        npcManager.init(theme, World.getConfig().width);
        rainSystem.init(rainIntensity);
        if (!isContinue) {
            player.x = chapter.startX;
        }
        player.y = 400;
        generateBuffItems(theme, chapter.endX);
        spawnStoryNPCs();
        state = STATE.CHAPTER_INTRO;
        showChapterTitle(chapter.title, chapter.subtitle);
        AudioSystem.playBGM(theme);
        AudioSystem.playSfx('chapter');
        if (chapterIdx === 1) Story.unlockAchievement('first_rain');
        const pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) pauseBtn.style.display = 'block';
    }

    function showChapterTitle(title, subtitle) {
        const titleEl = document.getElementById('chapter-title');
        document.getElementById('chapter-title-text').textContent = title;
        document.getElementById('chapter-title-sub').textContent = subtitle;
        titleEl.classList.remove('hidden');
        setTimeout(() => {
            titleEl.classList.add('hidden');
            state = STATE.DIALOGUE;
            const chapter = Story.getCurrentChapter();
            const introLines = typeof chapter.intro === 'function' ? chapter.intro() : chapter.intro;
            DialogueSystem.start(introLines, () => {
                state = STATE.PLAYING;
                document.getElementById('hud').classList.remove('hidden');
                updateHUD();
            });
        }, 3000);
    }

    // ========== 场景转换（走廊↔天台）==========
    function transitionToScene(scene) {
        if (scene === 'rooftop') {
            corridorPlayerX = player.x;
            currentSubScene = 'rooftop';
            World.init('rooftop');
            npcManager.init('rooftop', World.getConfig().width);
            buffItems = [];
            storyNPCs = [];
            rainSystem.init(0.9);
            player.x = 80;
            player.y = 400;
            Story.setRooftopEncounters();
            state = STATE.PLAYING;
            updateHUD();
        } else if (scene === 'school_corridor') {
            currentSubScene = 'corridor';
            const chapter = Story.getCurrentChapter();
            World.init(chapter.theme);
            npcManager.init(chapter.theme, World.getConfig().width);
            rainSystem.init(chapter.rainIntensity);
            generateBuffItems(chapter.theme, chapter.endX);
            player.x = Math.max(2100, corridorPlayerX + 120);
            player.y = 400;
            Story.setCorridorEncounters();
            spawnStoryNPCs();
            state = STATE.PLAYING;
            updateHUD();
        }
    }

    function generateBuffItems(theme, endX) {
        buffItems = [];
        const isIndoor = theme === 'school_corridor' || theme === 'company_office' || theme === 'home';
        const types = isIndoor ? [
            { type: 'book', buff: 'knowledge' }, { type: 'medal', buff: 'ability' },
            { type: 'heart', buff: 'willpower' }, { type: 'heart', buff: 'endurance' },
        ] : [
            { type: 'book', buff: 'knowledge' }, { type: 'book', buff: 'experience' },
            { type: 'medal', buff: 'ability' }, { type: 'medal', buff: 'resume' },
            { type: 'heart', buff: 'willpower' }, { type: 'heart', buff: 'endurance' },
        ];
        for (let i = 0; i < types.length; i++) {
            const x = 300 + (i * (endX - 400) / types.length) + Math.random() * 80;
            const y = isIndoor ? (320 + Math.random() * 80) : (340 + Math.random() * 120);
            buffItems.push(new BuffItem(x, y, types[i].type, types[i].buff));
        }
    }

    // ========== 帧循环（引擎驱动）==========
    function updateFrame(dt) {
        if (state === STATE.PAUSED) return;

        syncJoystickInput();

        if (state === STATE.PLAYING) {
            updatePlaying(dt);
        } else if (state === STATE.DIALOGUE) {
            DialogueSystem.update(dt, input);
        }

        autoSave(dt);

        if (state !== STATE.MENU && state !== STATE.ENDING && state !== STATE.PAUSED) {
            const camera = World.getCamera();
            if (!World.isIndoor()) {
                rainSystem.update(canvasWidth, canvasHeight, camera, dt);
            }
            for (const item of buffItems) item.update(dt);
        }

        // 每帧末尾重置 justPressed 标志，防止标志位粘滞导致对话 uncontrollably 推进
        resetJustPressed();
    }

    function syncJoystickInput() {
        const joy = Joystick.getInput();
        input.joystickX = joy.joystickX;
        input.joystickY = joy.joystickY;
        if (joy.joystickY < -0.5 && !joyPrevUp) input.justPressed.up = true;
        joyPrevUp = joy.joystickY < -0.5;
        if (joy.joystickY > 0.5 && !joyPrevDown) input.justPressed.down = true;
        joyPrevDown = joy.joystickY > 0.5;
        // action 仅来自键盘（Space/Enter），摇杆不再有确认按钮
        input.action = kbAction;
    }

    function resetJustPressed() {
        input.justPressed.up = false;
        input.justPressed.down = false;
        input.justPressed.left = false;
        input.justPressed.right = false;
        input.justPressed.action = false;
    }

    function updatePlaying(dt) {
        player.update(input, World, dt);
        World.updateCamera(player.x, player.y, canvasWidth, canvasHeight);
        npcManager.update(World, dt);
        for (const snpc of storyNPCs) snpc.update(player, dt);
        for (const item of buffItems) {
            if (item.checkPickup(player)) {
                AudioSystem.playSfx('pickup');
                updateHUD();
            }
        }
        for (const snpc of storyNPCs) {
            if (snpc.checkCollision(player)) {
                const enc = Story.triggerEncounterByIndex(snpc.encounterIndex);
                if (enc) { snpc.triggered = true; startEncounter(enc); return; }
            }
        }
        const encounter = Story.checkEncounter(player.x);
        if (encounter) { startEncounter(encounter); return; }

        if (Story.isChapterEnd(player.x)) {
            const chapter = Story.getCurrentChapter();
            if (Story.currentChapterIdx === Story.getChapterCount() - 1) {
                checkFinalEnding();
                return;
            }
            state = STATE.DIALOGUE;
            const endLines = typeof chapter.endDialogue === 'function' ? chapter.endDialogue() : chapter.endDialogue;
            DialogueSystem.start(endLines, () => {
                saveGame();
                const hasNext = Story.nextChapter();
                if (hasNext) startChapter(Story.currentChapterIdx);
                else checkFinalEnding();
            });
            return;
        }
        updateHUD();
    }

    function checkChoiceAchievements() {
        const choices = Story.getPlayerChoices();
        if (choices.helpedOldMan === true) Story.unlockAchievement('kind_heart');
        if (choices.helpedBulliedStudent === true) Story.unlockAchievement('bully_helper');
        if (choices.startedCompany === true) Story.unlockAchievement('entrepreneur');
    }

    function checkFinalEnding() {
        const endingType = Story.determineEnding(player.buffs);
        showEnding(endingType);
    }

    function showEnding(type) {
        state = STATE.ENDING;
        Joystick.hide();
        const ending = Story.getEnding(type);
        document.getElementById('hud').classList.add('hidden');
        document.getElementById('ending-title').textContent = ending.title;
        document.getElementById('ending-text').textContent = ending.text;
        const pauseBtn = document.getElementById('btn-pause');
        if (pauseBtn) pauseBtn.style.display = 'none';
        const achievementEl = document.getElementById('ending-achievement');
        const buttonsEl = document.getElementById('ending-buttons');
        const scrollContainer = document.querySelector('.ending-scroll-container');
        const scrollContent = document.querySelector('.ending-scroll-content');
        if (achievementEl) achievementEl.classList.add('hidden');
        if (buttonsEl) buttonsEl.classList.add('hidden');
        const endingScreen = document.getElementById('ending-screen');
        // 清除之前的场景主题类，应用新主题
        endingScreen.className = 'screen' + (ending.type === 'true' ? ' true-ending' : ' false-ending');
        if (ending.sceneTheme) {
            endingScreen.classList.add('scene-' + ending.sceneTheme);
        }
        endingScreen.classList.remove('hidden');
        AudioSystem.stopBGM();
        AudioSystem.playSfx('ending');
        updateAchievementsCount();
        Story.clearSave();

        // 计算滚动时长：基于文本长度，确保用户有足够时间阅读
        const textLen = (ending.title.length + ending.text.length);
        const duration = Math.max(30, Math.min(80, Math.ceil(textLen * 0.12)));

        if (scrollContent) {
            // 清除之前的完成状态
            scrollContent.classList.remove('scroll-done');
            if (scrollContainer) scrollContainer.classList.remove('scroll-done');
            // 设置滚动时长
            scrollContent.style.setProperty('--ending-duration', duration + 's');
            // 重置动画
            scrollContent.style.animation = 'none';
            void scrollContent.offsetWidth;
            scrollContent.style.animation = '';
        }

        // 在滚动动画结束后显示按钮和成就
        const showEndUI = () => {
            if (state !== STATE.ENDING) return;
            if (scrollContent) scrollContent.classList.add('scroll-done');
            if (scrollContainer) scrollContainer.classList.add('scroll-done');
            if (achievementEl) {
                const parts = ending.title.split('·');
                achievementEl.innerHTML = '获得成就：<span>（' + (parts[0]||'') + '——' + (parts[1]||'') + '）</span>';
                achievementEl.classList.remove('hidden');
            }
            if (buttonsEl) buttonsEl.classList.remove('hidden');
        };

        if (scrollContent) {
            scrollContent.addEventListener('animationend', function handler() {
                scrollContent.removeEventListener('animationend', handler);
                showEndUI();
            });
            // 兜底：如果 animationend 没触发，用 setTimeout
            setTimeout(showEndUI, (duration + 2) * 1000);
        } else {
            setTimeout(showEndUI, 3000);
        }
    }

    function handleGameOver() {
        state = STATE.DIALOGUE;
        DialogueSystem.start([
            { name: '旁白', portrait: 'narrator', text: '你倒在了雨中。' },
            { name: '旁白', portrait: 'narrator', text: '但你还没有走完这条路。' },
            { name: '旁白', portrait: 'narrator', text: '站起来，继续走。' },
        ], () => { startChapter(Story.currentChapterIdx); });
    }

    function updateHUD() {
        document.getElementById('hud-chapter').textContent = Story.getCurrentChapter().title;
        const buffsEl = document.getElementById('hud-buffs');
        buffsEl.innerHTML = '';
        const buffNames = { experience:'阅历',ability:'能力',knowledge:'学识',mindset:'心态',resume:'履历',endurance:'抗压',willpower:'毅力' };
        for (const [key, val] of Object.entries(player.buffs)) {
            if (val > 0) {
                const span = document.createElement('span');
                span.className = 'hud-buff';
                span.textContent = `${buffNames[key]}+${val}`;
                buffsEl.appendChild(span);
            }
        }
    }

    // ========== 渲染（引擎驱动）==========
    function renderFrame() {
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        if (state === STATE.MENU) return;

        World.render(ctx, canvasWidth, canvasHeight);
        const camera = World.getCamera();
        for (const item of buffItems) item.render(ctx, camera);

        if (state === STATE.PLAYING || state === STATE.DIALOGUE || state === STATE.CHAPTER_INTRO) {
            const entities = [];
            for (const npc of [...npcManager.npcs, ...npcManager.storyNPCs]) {
                entities.push({ y: npc.y, render: (ctx, cam) => npc.render(ctx, cam) });
            }
            for (const snpc of storyNPCs) {
                entities.push({ y: snpc.y, render: (ctx, cam) => snpc.render(ctx, cam) });
            }
            entities.push({ y: player.y, render: (ctx, cam) => player.render(ctx, cam) });
            entities.sort((a, b) => a.y - b.y);
            for (const e of entities) e.render(ctx, camera);
        }

        if (!World.isIndoor()) {
            rainSystem.render(ctx, camera);
            ctx.fillStyle = 'rgba(20, 30, 50, 0.08)';
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
        }

        Joystick.render();
    }

    return { init };
})();

window.addEventListener('DOMContentLoaded', () => { Game.init(); });
