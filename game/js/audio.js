// ============================================================
// audio.js - 音频系统（Lument 移植版）
// 使用 Lument 音频 API 播放程序化生成的音效和背景音乐
// 保留原始的程序化音频生成方式（振荡器 + 增益包络），
// 通过 OfflineAudioContext 预渲染为 AudioBuffer，
// 编码为 WAV 后经引擎 loadAudio/playAudio/stopAudio/setVolume 路由播放
// ============================================================

const AudioSystem = (function() {

    // ========== 引擎 API 引用 ==========
    const UE = (typeof Lument !== 'undefined') ? Lument : null;

    // ========== 音量比例（与原始系统一致）==========
    // 原始系统：masterGain=0.5, bgmGain=0.3, sfxGain=0.5
    // 移植后：引擎 setVolume(id, masterVolume * relativeVolume)
    const BGM_VOLUME = 0.3;
    const SFX_VOLUME = 0.5;

    // ========== 采样率 ==========
    const SAMPLE_RATE = 44100;

    // ========== 状态 ==========
    let initialized = false;
    let masterVolume = 0.5;

    // 音频 ID 映射：引擎 loadAudio 返回的 ID
    const sfxIds = {};       // type -> engine audio ID
    const sfxReady = {};     // type -> boolean（是否已加载到引擎）
    const bgmIds = {};       // theme -> engine audio ID
    const bgmReady = {};    // theme -> boolean
    let currentBgmId = null;

    // ========== 程序化音频数据 ==========

    // SFX 时长（秒）
    const SFX_DURATIONS = {
        blip:    0.05,
        select:  0.10,
        pickup:  0.20,
        damage:  0.15,
        chapter: 0.70,
        ending:  2.05,
    };

    // BGM 旋律（频率序列）
    const BGM_MELODIES = {
        school: [261, 293, 329, 349, 329, 293, 261, 233, 261, 293, 329, 392, 349, 329, 293, 261],
        career: [220, 246, 261, 293, 261, 246, 220, 196, 220, 246, 261, 329, 293, 261, 246, 220],
        life:   [196, 220, 246, 261, 246, 220, 196, 174, 196, 220, 246, 293, 261, 246, 220, 196],
        finale: [174, 196, 220, 233, 220, 196, 174, 155, 174, 196, 220, 261, 233, 220, 196, 174],
        menu:   [261, 329, 392, 329, 261, 329, 392, 440, 392, 329, 261, 329, 392, 329, 261, 233],
    };

    const BGM_NOTE_DURATION = 0.4;

    // ========== WAV 编码 ==========

    // 将 AudioBuffer 编码为 WAV 格式的 Blob URL
    // 引擎的 loadAudio 通过 fetch + decodeAudioData 加载，支持 blob: URL
    function audioBufferToWavUrl(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const bytesPerSample = 2; // 16-bit PCM
        const blockAlign = numChannels * bytesPerSample;
        const dataSize = buffer.length * blockAlign;
        const arrayBuffer = new ArrayBuffer(44 + dataSize);
        const view = new DataView(arrayBuffer);

        // 收集声道数据
        const channels = [];
        for (let i = 0; i < numChannels; i++) {
            channels.push(buffer.getChannelData(i));
        }

        // 写入 WAV 头部
        const writeStr = (offset, str) => {
            for (let i = 0; i < str.length; i++) {
                view.setUint8(offset + i, str.charCodeAt(i));
            }
        };
        writeStr(0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeStr(8, 'WAVE');
        writeStr(12, 'fmt ');
        view.setUint32(16, 16, true);                    // fmt chunk size
        view.setUint16(20, 1, true);                      // PCM format
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * blockAlign, true); // byte rate
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, 16, true);                     // bits per sample
        writeStr(36, 'data');
        view.setUint32(40, dataSize, true);

        // 写入交错的 16-bit PCM 数据
        let offset = 44;
        for (let i = 0; i < buffer.length; i++) {
            for (let ch = 0; ch < numChannels; ch++) {
                const s = Math.max(-1, Math.min(1, channels[ch][i]));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
                offset += 2;
            }
        }

        return URL.createObjectURL(new Blob([arrayBuffer], { type: 'audio/wav' }));
    }

    // ========== 程序化 SFX 渲染 ==========

    // 在 OfflineAudioContext 中构建 SFX 节点图（与原始系统逻辑完全一致）
    function buildSfxNodes(ctx, sfxGain, now, type) {
        switch (type) {
            case 'blip': {
                // 对话框打字音效
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.value = 800 + Math.random() * 200;
                gain.gain.setValueAtTime(0.05, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
                osc.connect(gain);
                gain.connect(sfxGain);
                osc.start(now);
                osc.stop(now + 0.05);
                break;
            }
            case 'select': {
                // 选择确认音效
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'square';
                osc.frequency.setValueAtTime(400, now);
                osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.10);
                osc.connect(gain);
                gain.connect(sfxGain);
                osc.start(now);
                osc.stop(now + 0.10);
                break;
            }
            case 'pickup': {
                // 拾取道具音效
                const osc1 = ctx.createOscillator();
                const osc2 = ctx.createOscillator();
                const gain = ctx.createGain();
                osc1.type = 'square';
                osc2.type = 'square';
                osc1.frequency.setValueAtTime(523, now);
                osc1.frequency.setValueAtTime(659, now + 0.06);
                osc1.frequency.setValueAtTime(784, now + 0.12);
                osc2.frequency.setValueAtTime(261, now);
                osc2.frequency.setValueAtTime(330, now + 0.06);
                osc2.frequency.setValueAtTime(392, now + 0.12);
                gain.gain.setValueAtTime(0.1, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);
                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(sfxGain);
                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 0.20);
                osc2.stop(now + 0.20);
                break;
            }
            case 'damage': {
                // 受伤音效
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(200, now);
                osc.frequency.exponentialRampToValueAtTime(50, now + 0.15);
                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
                osc.connect(gain);
                gain.connect(sfxGain);
                osc.start(now);
                osc.stop(now + 0.15);
                break;
            }
            case 'chapter': {
                // 章节切换音效
                for (let i = 0; i < 3; i++) {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    const freq = [261, 330, 392][i];
                    osc.frequency.value = freq;
                    gain.gain.setValueAtTime(0, now + i * 0.1);
                    gain.gain.linearRampToValueAtTime(0.1, now + i * 0.1 + 0.05);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.1 + 0.5);
                    osc.connect(gain);
                    gain.connect(sfxGain);
                    osc.start(now + i * 0.1);
                    osc.stop(now + i * 0.1 + 0.5);
                }
                break;
            }
            case 'ending': {
                // 结局音效
                const notes = [261, 293, 329, 349, 392, 440, 493, 523];
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.value = freq;
                    gain.gain.setValueAtTime(0, now + i * 0.15);
                    gain.gain.linearRampToValueAtTime(0.08, now + i * 0.15 + 0.05);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.15 + 1.0);
                    osc.connect(gain);
                    gain.connect(sfxGain);
                    osc.start(now + i * 0.15);
                    osc.stop(now + i * 0.15 + 1.0);
                });
                break;
            }
        }
    }

    // 渲染单个 SFX 为 WAV Blob URL
    function renderSfx(type) {
        const duration = SFX_DURATIONS[type];
        if (!duration) return Promise.resolve(null);

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineCtx) return Promise.resolve(null);

        const offlineCtx = new OfflineCtx(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
        const sfxGain = offlineCtx.createGain();
        sfxGain.gain.value = 1.0; // 相对音量由引擎 setVolume 控制
        sfxGain.connect(offlineCtx.destination);

        buildSfxNodes(offlineCtx, sfxGain, 0, type);

        return offlineCtx.startRendering().then(buffer => audioBufferToWavUrl(buffer));
    }

    // ========== 程序化 BGM 渲染 ==========

    // 渲染 BGM 循环为 WAV Blob URL
    // 将完整旋律预渲染为一个循环 buffer，由引擎以 loop=true 播放
    function renderBGM(theme) {
        const melody = BGM_MELODIES[theme] || BGM_MELODIES.menu;
        const totalDuration = melody.length * BGM_NOTE_DURATION;

        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (!OfflineCtx) return Promise.resolve(null);

        const offlineCtx = new OfflineCtx(1, Math.ceil(SAMPLE_RATE * totalDuration), SAMPLE_RATE);
        const bgmGain = offlineCtx.createGain();
        bgmGain.gain.value = 1.0; // 相对音量由引擎 setVolume 控制
        bgmGain.connect(offlineCtx.destination);

        for (let i = 0; i < melody.length; i++) {
            const playTime = i * BGM_NOTE_DURATION;
            const osc = offlineCtx.createOscillator();
            const gain = offlineCtx.createGain();
            osc.type = 'triangle';
            osc.frequency.value = melody[i];

            gain.gain.setValueAtTime(0, playTime);
            gain.gain.linearRampToValueAtTime(0.04, playTime + 0.05);
            gain.gain.linearRampToValueAtTime(0.03, playTime + BGM_NOTE_DURATION * 0.7);
            gain.gain.exponentialRampToValueAtTime(0.001, playTime + BGM_NOTE_DURATION);

            osc.connect(gain);
            gain.connect(bgmGain);
            osc.start(playTime);
            osc.stop(playTime + BGM_NOTE_DURATION);
        }

        return offlineCtx.startRendering().then(buffer => audioBufferToWavUrl(buffer));
    }

    // ========== 引擎加载辅助 ==========

    // 将 WAV URL 加载到引擎并设置初始音量
    function loadIntoEngine(url, isMusic, relativeVolume) {
        if (!UE) return 0;
        const id = UE.loadAudio(url, isMusic);
        UE.setVolume(id, masterVolume * relativeVolume);
        return id;
    }

    // ========== 公共 API ==========

    // 初始化：预渲染所有 SFX 和 BGM，加载到引擎
    function init() {
        if (initialized) return;
        initialized = true;

        if (!UE) {
            console.warn('AudioSystem: Lument 未找到，音频不可用');
            return;
        }

        // 预渲染并加载所有 SFX
        Object.keys(SFX_DURATIONS).forEach(type => {
            renderSfx(type).then(url => {
                if (!url) return;
                const id = loadIntoEngine(url, false, SFX_VOLUME);
                sfxIds[type] = id;
                sfxReady[type] = true;
            }).catch(() => {});
        });

        // 预渲染并加载所有 BGM 主题
        Object.keys(BGM_MELODIES).forEach(theme => {
            renderBGM(theme).then(url => {
                if (!url) return;
                const id = loadIntoEngine(url, true, BGM_VOLUME);
                bgmIds[theme] = id;
                bgmReady[theme] = true;
            }).catch(() => {});
        });
    }

    // 恢复音频上下文（浏览器策略需要用户交互后才能播放音频）
    function resume() {
        // 引擎内部创建了 AudioContext 但未暴露 resume 方法，
        // 此处创建临时上下文以解锁页面音频播放策略
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            if (ctx.state === 'suspended') {
                ctx.resume();
            }
            ctx.close();
        } catch (e) {
            // AudioContext 不可用，忽略
        }
    }

    // 播放音效
    function playSfx(type) {
        if (!UE || !sfxReady[type] || sfxIds[type] == null) return;
        UE.playAudio(sfxIds[type], false);
    }

    // 播放背景音乐
    function playBGM(theme) {
        if (!UE) return;
        stopBGM();
        if (!bgmReady[theme] || bgmIds[theme] == null) return;
        currentBgmId = bgmIds[theme];
        UE.playAudio(currentBgmId, true);
    }

    // 停止背景音乐
    function stopBGM() {
        if (!UE) return;
        if (currentBgmId != null) {
            UE.stopAudio(currentBgmId);
            currentBgmId = null;
        }
    }

    // 设置主音量
    function setVolume(volume) {
        masterVolume = volume;
        if (!UE) return;
        // 更新所有已注册 SFX 的音量
        for (const type in sfxIds) {
            UE.setVolume(sfxIds[type], masterVolume * SFX_VOLUME);
        }
        // 更新所有已注册 BGM 的音量
        for (const theme in bgmIds) {
            UE.setVolume(bgmIds[theme], masterVolume * BGM_VOLUME);
        }
    }

    return {
        init,
        resume,
        playSfx,
        playBGM,
        stopBGM,
        setVolume,
    };
})();
