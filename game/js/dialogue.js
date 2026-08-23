// ============================================================
// dialogue.js - RPG对话框系统
// 经典RPG风格对话框，含人物头像和打字机效果
// ============================================================

const DialogueSystem = (function() {

    let currentDialogue = null;
    let textIndex = 0;
    let charIndex = 0;
    let typeTimer = 0;
    let typeSpeed = 30; // 每字符毫秒
    let isTyping = false;
    let waitingForInput = false;
    let choices = null;
    let selectedChoice = 0;
    let onComplete = null;
    let onChoice = null;
    let onResetInput = null;

    const dialogueBox = document.getElementById('dialogue-box');
    const portraitCanvas = document.getElementById('portrait-canvas');
    const dialogueName = document.getElementById('dialogue-name');
    const dialogueText = document.getElementById('dialogue-text');
    const dialogueChoices = document.getElementById('dialogue-choices');
    const dialoguePrompt = document.getElementById('dialogue-prompt');

    // ========== 直接触摸交互 ==========
    // 对话框被ui-overlay(z-index:100)包含，高于摇杆画布(z-index:65)
    // 因此对话框区域的触摸不会到达摇杆，需要对话框自行处理触摸
    function setupTouchInteraction() {
        // 对话框点击：推进对话（无选项时）
        const handleTap = (e) => {
            // 如果点击的是选项元素，由选项自己的处理器处理
            if (e.target && e.target.classList && e.target.classList.contains('dialogue-choice')) {
                return;
            }
            if (!currentDialogue) return;

            if (isTyping) {
                // 快进打字效果
                const line = currentDialogue[textIndex];
                dialogueText.textContent = line.text;
                charIndex = line.text.length;
                isTyping = false;
                waitingForInput = true;
                if (line.choices) {
                    choices = line.choices;
                    selectedChoice = 0;
                    renderChoices();
                } else {
                    dialoguePrompt.classList.remove('hidden');
                }
                AudioSystem.playSfx('blip');
            } else if (waitingForInput && !choices) {
                // 普通对话 - 点击继续
                AudioSystem.playSfx('select');
                const line = currentDialogue[textIndex];
                if (line && line.end) {
                    end();
                    return;
                }
                textIndex++;
                showDialogueLine();
            }
        };

        dialogueBox.addEventListener('click', handleTap);
        dialogueBox.addEventListener('touchend', (e) => {
            // 避免触屏后click重复触发
            e.preventDefault();
            handleTap(e);
        }, { passive: false });
    }

    // 初始化触摸交互
    setupTouchInteraction();

    // 开始对话
    function start(dialogueData, callback, onChoiceCallback) {
        currentDialogue = dialogueData;
        textIndex = 0;
        charIndex = 0;
        typeTimer = 0;
        isTyping = true;
        waitingForInput = false;
        choices = null;
        onComplete = callback || null;
        onChoice = onChoiceCallback || null;

        dialogueBox.classList.remove('hidden');
        showDialogueLine();
    }

    // 显示当前对话行
    function showDialogueLine() {
        if (!currentDialogue || textIndex >= currentDialogue.length) {
            end();
            return;
        }

        const line = currentDialogue[textIndex];
        charIndex = 0;
        typeTimer = 0;
        isTyping = true;
        waitingForInput = false;
        choices = null;

        // 设置名字
        dialogueName.textContent = line.name || '';
        dialogueText.textContent = '';
        dialogueChoices.innerHTML = '';
        dialoguePrompt.classList.add('hidden');

        // 绘制头像
        const portraitCtx = portraitCanvas.getContext('2d');
        portraitCtx.imageSmoothingEnabled = false;
        portraitCtx.clearRect(0, 0, 96, 96);
        if (line.portrait) {
            const sprite = PixelArt.createPortrait(line.portrait);
            // createPortrait 返回的是引擎纹理 ID（number），不能直接传给 drawImage
            // 必须使用 drawTextureToCanvas 从纹理注册表取出源画布再绘制
            PixelArt.drawTextureToCanvas(sprite, portraitCtx, 0, 0, 96, 96);
        } else {
            // 默认系统头像
            const sprite = PixelArt.createPortrait('narrator');
            PixelArt.drawTextureToCanvas(sprite, portraitCtx, 0, 0, 96, 96);
        }
    }

    // 更新（打字机效果）
    function update(dt, input) {
        if (!currentDialogue) return;

        if (isTyping) {
            // 快进打字
            if (input.justPressed.action) {
                const line = currentDialogue[textIndex];
                dialogueText.textContent = line.text;
                charIndex = line.text.length;
                isTyping = false;
                waitingForInput = true;
                if (line.choices) {
                    choices = line.choices;
                    selectedChoice = 0;
                    renderChoices();
                } else {
                    dialoguePrompt.classList.remove('hidden');
                }
                return;
            }

            typeTimer += dt;
            if (typeTimer >= typeSpeed) {
                typeTimer = 0;
                const line = currentDialogue[textIndex];
                if (charIndex < line.text.length) {
                    dialogueText.textContent = line.text.substring(0, charIndex + 1);
                    charIndex++;

                    // 播放打字音效
                    if (charIndex % 2 === 0) {
                        AudioSystem.playSfx('blip');
                    }
                } else {
                    // 打字完成
                    isTyping = false;
                    waitingForInput = true;

                    // 如果有选项
                    if (line.choices) {
                        choices = line.choices;
                        selectedChoice = 0;
                        renderChoices();
                    } else {
                        dialoguePrompt.classList.remove('hidden');
                    }
                }
            }
        } else if (waitingForInput) {
            // 处理输入
            if (choices) {
                // 选项导航
                if (input.justPressed.up) {
                    selectedChoice = (selectedChoice - 1 + choices.length) % choices.length;
                    renderChoices();
                    AudioSystem.playSfx('blip');
                }
                if (input.justPressed.down) {
                    selectedChoice = (selectedChoice + 1) % choices.length;
                    renderChoices();
                    AudioSystem.playSfx('blip');
                }
                if (input.justPressed.action) {
                    // 选择当前选项
                    const choice = choices[selectedChoice];
                    AudioSystem.playSfx('select');
                    if (choice.next !== undefined) {
                        textIndex = choice.next;
                    } else {
                        textIndex++;
                    }
                    if (onChoice) onChoice(choice);
                    showDialogueLine();
                }
            } else {
                // 普通对话 - 按确认继续
                if (input.justPressed.action || input.justPressed.up || input.justPressed.down) {
                    AudioSystem.playSfx('select');
                    const line = currentDialogue[textIndex];
                    // 支持end标记：立即结束对话
                    if (line && line.end) {
                        end();
                        return;
                    }
                    textIndex++;
                    showDialogueLine();
                }
            }
        }
    }

    // 渲染选项（两步确认：第一次选中高亮，第二次确认触发）
    function renderChoices() {
        dialogueChoices.innerHTML = '';
        choices.forEach((choice, i) => {
            const div = document.createElement('div');
            div.className = 'dialogue-choice' + (i === selectedChoice ? ' selected' : '');
            div.textContent = (i === selectedChoice ? '▶ ' : '  ') + choice.text;

            // 两步确认：第一次点击选中，第二次点击确认
            const handleChoiceTap = (e) => {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                if (!currentDialogue || !choices) return;

                if (selectedChoice === i) {
                    // 已选中 → 确认触发
                    AudioSystem.playSfx('select');
                    const chosen = choices[selectedChoice];
                    if (chosen.next !== undefined) {
                        textIndex = chosen.next;
                    } else {
                        textIndex++;
                    }
                    if (onChoice) onChoice(chosen);
                    showDialogueLine();
                } else {
                    // 未选中 → 先选中高亮
                    selectedChoice = i;
                    AudioSystem.playSfx('blip');
                    // 更新所有选项的选中状态
                    const choiceEls = dialogueChoices.querySelectorAll('.dialogue-choice');
                    choiceEls.forEach((el, idx) => {
                        if (idx === i) {
                            el.classList.add('selected');
                            el.textContent = '▶ ' + choice.text;
                        } else {
                            el.classList.remove('selected');
                            el.textContent = '  ' + choices[idx].text;
                        }
                    });
                }
            };
            div.addEventListener('click', handleChoiceTap);
            div.addEventListener('touchend', handleChoiceTap, { passive: false });

            dialogueChoices.appendChild(div);
        });
        dialoguePrompt.classList.add('hidden');
    }

    // 结束对话
    function end() {
        currentDialogue = null;
        dialogueBox.classList.add('hidden');
        // 通知外部重置输入状态，防止摇杆/按钮卡死
        if (onResetInput) onResetInput();
        if (onComplete) {
            const cb = onComplete;
            onComplete = null;
            cb();
        }
    }

    // 是否正在对话中
    function isActive() {
        return currentDialogue !== null;
    }

    return {
        start,
        update,
        isActive,
        set onResetInput(fn) { onResetInput = fn; },
    };
})();
