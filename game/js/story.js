// ============================================================
// story.js - 剧情系统（完整重构版）
// 7章节 + 7结局（4真结局+3假结局）+ 多分支剧情 + 选择追踪
// 老头单节点选择 + 天台跳楼 + 更多嘲讽 + buff判定结局
// ============================================================

const Story = (function() {

    // ========== 玩家选择追踪 ==========
    let playerChoices = {
        helpedBulliedStudent: null,  // 第二章：是否帮助被欺负的同学
        rooftopJumped: null,         // 第二章：是否从天台跳下（直接触发假结局三）
        helpedOldMan: null,          // 第三章：是否扶起老人
        joinedOldMan: null,          // 第三章：是否加入老头（真结局四/假结局二路线）
        becameBoss: null,            // 第四章（老头线）：是否当上大老板
        cateredToPower: null,        // 第四章：是否迎合权贵
        startedCompany: null,        // 第四章：是否创业
        gaveUp: null,                // 第六章：是否放弃人生（窗台）
        reportedOldMan: null,        // 第六章：是否举报老头
        overcameScheme: null,        // 第六章：是否化解做局
    };

    // ========== 成就定义 ==========
    const achievementDefs = {
        'first_rain':     { name: '初次淋雨', desc: '完成第一章', icon: 'R', info: '你走过了人生的第一场暴雨。\n\n第一章"寒窗风雨"中，少年在倾盆大雨中走过街道，面对同学的嘲笑和老师的怜悯，最终获得了人生中第一把伞——尽管那只是一把有补丁的旧伞。\n\n这是故事的起点，也是你与世界对抗的起点。雨水打湿了课本，但淋不坏知识；嘲笑刺痛了自尊，但磨砺了意志。' },
        'kind_heart':     { name: '扶危济困', desc: '扶起摔倒的老人', icon: 'H', info: '在雨中，你选择了停下脚步。\n\n当老人在雨中摔倒时，旁人视而不见，你却弯下了腰。这个选择看似微不足道，却在你的心中种下了一颗善意的种子。\n\n老人后来成为了你人生中重要的引路人。善意，有时就是最好的投资。' },
        'bully_helper':   { name: '仗义执言', desc: '帮助被欺负的同学', icon: 'B', info: '你曾淋过雨，所以想为别人撑伞。\n\n在学校走廊里，当你看到有同学被霸凌时，你没有选择沉默。你站了出来，就像当年老师为你递出那把旧伞一样。\n\n这个选择让你收获了一个真正的朋友，也让你明白：伞不仅仅是遮雨的工具，更是遮住残酷的善意。' },
        'entrepreneur':   { name: '创业者',   desc: '创办自己的公司', icon: 'E', info: '从一无所有到拥有自己的事业。\n\n你用积累的阅历、能力、学识和毅力，创办了属于自己的公司。这条路充满荆棘，但你走了下去。\n\n创业不是为了证明什么，而是为了不再被雨淋。你终于可以为自己，也为别人撑起一把伞。' },
        'end_failure':    { name: '碌碌无为', desc: '达成真结局·失败人生', icon: '1', info: '【真结局一：碌碌无为】\n\n你走完了人生的全程，却始终没能抓住什么。没有事业，没有爱情，没有伞。\n\n这不是最坏的结局，却是最真实的结局。许多人的一生，就是这样在雨中默默走过的。\n\n但至少，你活到了最后。' },
        'end_rise_fall':  { name: '功亏一篑', desc: '达成真结局·大起大落', icon: '2', info: '【真结局二：功亏一篑】\n\n你曾经拥有过一切——公司、地位、伞。但一场阴谋让你失去了一切。\n\n你在大雨中站在废墟上，看着曾经的一切化为乌有。雨还是那场雨，你还是那个淋雨的少年。\n\n只是这一次，你知道了雨的重量。' },
        'end_cycle':      { name: '伞下轮回', desc: '达成真结局·人生轮回', icon: '3', info: '【真结局三：伞下轮回】\n\n你成功了，你有了伞，你成为了人上人。\n\n但当你撑着伞走过街道，看到一个淋雨的少年时，你犹豫了。你看到了曾经的自己。\n\n你选择了把伞递给他。雨，还在下。轮回，还在继续。' },
        'end_rebirth':    { name: '隐匿新生', desc: '达成真结局·新生', icon: '4', info: '【真结局四：新生】\n\n你揭露了黑暗，付出了代价，但最终获得了新生。\n\n你离开了那个充满雨的城市，去了一个没有人认识你的地方。你不再需要伞，因为那里阳光明媚。\n\n但你知道，总有一天你会回去的。带着阳光，回到那场雨中。' },
        'end_cater':      { name: '伞下之臣', desc: '达成假结局·迎合', icon: '5', info: '【假结局一：伞下之臣】\n\n你选择了迎合权力，放弃了初心。\n\n你有了伞，有了地位，但你的灵魂已经湿透了。那种湿，比淋雨更冷。\n\n你成为了你曾经最讨厌的人，而你自己甚至没有察觉。' },
        'end_corrupt':    { name: '良心债',   desc: '达成假结局·同流合污', icon: '6', info: '【假结局二：同流合污】\n\n你跟着老人走了，学会了他们的规则。\n\n你不再淋雨，但你让别人淋雨。你手中的伞，是别人失去的遮蔽。\n\n良心的债，利息比高利贷还高。总有一天，你会还的。' },
        'end_death':      { name: '坠落者',   desc: '达成假结局·死亡与新生', icon: '7', info: '【假结局三：坠落者】\n\n你站在天台上，暴雨如注。\n\n你选择了坠落。不是因为你害怕雨，而是因为你觉得，也许坠落也是一种飞翔。\n\n但在坠落的瞬间，你看到雨幕中有一个少年正撑着伞走过。那把伞，是你递出去的。' },
        'all_endings':    { name: '万象归一', desc: '解锁全部7个结局', icon: '*', info: '你走过了所有可能的路。\n\n7个结局，7种人生。有的光明，有的黑暗，有的平淡，有的壮烈。\n\n但每一条路都是真实的，每一种选择都有人在走。你理解了它们全部，也就理解了这个世界。\n\n世界大雨滂沱，你的万里山河，不如别人头顶一伞。但你已经看过了所有的雨。' },
    };

    // ========== 章节数据 ==========
    const chapters = [
        // ========== 第一章：寒窗风雨（更多嘲讽） ==========
        {
            id: 0,
            title: '第一章：寒窗风雨',
            subtitle: '求学篇 · 少年的雨季',
            theme: 'school',
            sceneType: 'outdoor',
            rainIntensity: 0.8,
            startX: 100,
            endX: 3200,
            intro: [
                { name: '旁白', portrait: 'narrator', text: '暴雨如注。少年没有伞，却必须去上学。' },
                { name: '旁白', portrait: 'narrator', text: '他看见撑伞的同龄人从容走过，他们谈笑风生，仿佛这场雨与他们无关。' },
                { name: '少年（你）', portrait: 'player', text: '......走吧。淋雨也不是第一次了。' },
                { name: '旁白', portrait: 'narrator', text: '在街上行走，寻找书本和知识。避开雨水，收集阅历。' },
            ],
            encounters: [
                {
                    triggerX: 500,
                    dialogue: [
                        { name: '撑伞同学', portrait: 'lument_npc', text: '哟，又淋雨呢？你家买不起伞吗？哈哈哈！' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '看你这落汤鸡的样子，笑死我了！' },
                        { name: '少年（你）', portrait: 'player', text: '......' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '算了，跟你说了你也不懂。我爸说了，伞是最基本的。' },
                        { name: '旁白', portrait: 'narrator', text: '他的伞是深蓝色的，伞柄是银色的。你记得很清楚，因为你盯着它看了很久。' },
                        { name: '少年（你）', portrait: 'player', text: '（一把伞而已......总有一天我会有的。）' },
                    ],
                    buffReward: { type: 'willpower', amount: 1 },
                },
                {
                    triggerX: 1100,
                    dialogue: [
                        { name: '撑伞同学群', portrait: 'lument_npc', text: '快看！那个没伞的又来了！' },
                        { name: '撑伞同学群', portrait: 'lument_npc', text: '哈哈哈！浑身湿透的样子真好笑！' },
                        { name: '撑伞同学群', portrait: 'lument_npc', text: '喂——你家的伞是被你吃了还是怎么了？' },
                        { name: '少年（你）', portrait: 'player', text: '......（咬紧牙关，继续走）' },
                        { name: '旁白', portrait: 'narrator', text: '嘲笑声在雨中回荡。雨水流进眼睛，你分不清是雨还是别的什么。' },
                        { name: '旁白', portrait: 'narrator', text: '你加快脚步，书包里的课本被淋湿了。今晚得用吹风机一页一页地吹干。' },
                        { name: '少年（你）', portrait: 'player', text: '（吹干了还能用。......知识淋不坏。）' },
                    ],
                    buffReward: { type: 'endurance', amount: 1 },
                },
                {
                    triggerX: 1700,
                    dialogue: [
                        { name: '老师', portrait: 'teacher', text: '你又在淋雨？学习重要，但也要注意身体。' },
                        { name: '老师', portrait: 'teacher', text: '不过话说回来，你的成绩确实不如那些条件好的同学。' },
                        { name: '老师', portrait: 'teacher', text: '也许......环境真的很重要吧。' },
                        { name: '少年（你）', portrait: 'player', text: '我会努力的，老师。' },
                        { name: '老师', portrait: 'teacher', text: '嗯。努力吧。虽然......有时候努力也不够。' },
                        { name: '旁白', portrait: 'narrator', text: '老师犹豫了一下，从抽屉里拿出一把旧伞。' },
                        { name: '老师', portrait: 'teacher', text: '这把伞......我家多余的。你先用着。' },
                        { name: '少年（你）', portrait: 'player', text: '......老师，我......' },
                        { name: '老师', portrait: 'teacher', text: '拿着吧。别让别人看见。咳，你去上课吧。' },
                        { name: '旁白', portrait: 'narrator', text: '你接过那把伞。伞面有补丁，伞骨有些歪，但它是你人生中的第一把伞。' },
                        { name: '少年（你）', portrait: 'player', text: '（......原来被人遮一下雨，是这种感觉。）' },
                    ],
                    buffReward: { type: 'knowledge', amount: 2 },
                },
                {
                    triggerX: 2400,
                    dialogue: [
                        { name: '撑伞同学', portrait: 'lument_npc', text: '哎，你闻到没有？一股穷酸味。' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '就是那个淋雨的。每次经过都有股霉味。' },
                        { name: '旁白', portrait: 'narrator', text: '你没有停下。但你的手攥紧了书包带。' },
                        { name: '少年（你）', portrait: 'player', text: '（......总有一天，我会让你们说不出这种话。）' },
                        { name: '旁白', portrait: 'narrator', text: '你加快了脚步。不是为了躲避，而是为了追上那个想象中的自己。' },
                    ],
                    buffReward: { type: 'willpower', amount: 1 },
                },
                {
                    triggerX: 2900,
                    dialogue: [
                        { name: '淋雨的路人', portrait: 'npc', text: '兄弟，你也没伞啊？这雨什么时候停啊......' },
                        { name: '淋雨的路人', portrait: 'npc', text: '我听说前面有遮雨棚，能歇一会儿。' },
                        { name: '少年（你）', portrait: 'player', text: '谢谢。' },
                        { name: '淋雨的路人', portrait: 'npc', text: '别谢我，大家都是淋雨的人。得互相照应。' },
                        { name: '旁白', portrait: 'narrator', text: '你点点头。雨还在下，但这句话让脚步轻了一些。' },
                        { name: '少年（你）', portrait: 'player', text: '（......淋雨的人帮淋雨的人。这或许就是这个世界的道理。）' },
                    ],
                    buffReward: { type: 'experience', amount: 1 },
                },
            ],
            endDialogue: [
                { name: '旁白', portrait: 'narrator', text: '你走到了街的尽头，学校的大门就在眼前。' },
                { name: '旁白', portrait: 'narrator', text: '少年的求学路，不过是一场漫长的淋雨。' },
                { name: '旁白', portrait: 'narrator', text: '而那些撑伞的人，永远不明白你为什么跑得那么急。' },
            ],
        },

        // ========== 第二章：走廊回响（更多嘲讽 + 天台跳楼） ==========
        {
            id: 1,
            title: '第二章：走廊回响',
            subtitle: '求学篇 · 走廊里的霸凌',
            theme: 'school_corridor',
            sceneType: 'indoor',
            rainIntensity: 0.3,
            startX: 100,
            endX: 2800,
            intro: [
                { name: '旁白', portrait: 'narrator', text: '你走进学校。走廊里回荡着脚步声和笑闹声。' },
                { name: '旁白', portrait: 'narrator', text: '走廊的窗户透进昏暗的光线，外面雨声依旧。' },
                { name: '你', portrait: 'player', text: '至少......在走廊里不用淋雨了。' },
                { name: '旁白', portrait: 'narrator', text: '但你很快发现，学校里也有另一种"雨"。' },
            ],
            encounters: [
                {
                    triggerX: 400,
                    dialogue: [
                        { name: '撑伞同学', portrait: 'lument_npc', text: '看，那个没伞的又来了。' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '你们闻到没？一股穷酸味。衣服都没干透就来上学？' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '哎，你家的伞是被你吃了还是被你爸卖了？' },
                        { name: '撑伞同学群', portrait: 'lument_npc', text: '哈哈哈——' },
                        { name: '旁白', portrait: 'narrator', text: '走廊里的人都在看。没有人替你说话。' },
                        {
                            name: '你', portrait: 'player',
                            text: '......',
                            choices: [
                                { text: '沉默走开，不与他们计较', next: 6, choiceKey: 'ignore_bully' },
                                { text: '反驳："伞能遮雨，遮不住人品"', next: 7, choiceKey: 'refute_bully' },
                            ]
                        },
                        // ignore_bully path (6)
                        { name: '旁白', portrait: 'narrator', text: '你低着头，从他们身边走过。', end: true },
                        // refute_bully path (7-8)
                        { name: '撑伞同学', portrait: 'lument_npc', text: '......你说什么？' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '哼，穷鬼就是嘴硬。走着瞧。', end: true },
                    ],
                    buffReward: { type: 'endurance', amount: 1 },
                },
                {
                    triggerX: 900,
                    groupEncounter: true,  // 群组encounter：霸凌场景，霸凌者围住被欺负的同学
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你看见走廊角落里，一个瘦小的同学被几个人围着。' },
                        { name: '霸凌者', portrait: 'lument_npc', text: '你家里连伞都买不起，还来上什么学？' },
                        { name: '被欺负的同学', portrait: 'npc', text: '......请让我过去......' },
                        { name: '霸凌者', portrait: 'lument_npc', text: '叫你家长来！哦对了，你家长也没伞吧？哈哈哈！' },
                        { name: '旁白', portrait: 'narrator', text: '那个同学浑身发抖，像极了你淋雨时的样子。' },
                        {
                            name: '你', portrait: 'player',
                            text: '......',
                            choices: [
                                { text: '上前制止，帮那个同学解围', next: 6, choiceKey: 'help_student' },
                                { text: '低头快步走过，假装没看见', next: 9, choiceKey: 'ignore_student' },
                            ]
                        },
                        // help_student path (6-8)
                        { name: '你', portrait: 'player', text: '够了。放开他。' },
                        { name: '霸凌者', portrait: 'lument_npc', text: '哟，又一个没伞的来充英雄？' },
                        { name: '旁白', portrait: 'narrator', text: '你挡在那个同学身前。霸凌者骂骂咧咧地走了。', end: true },
                        // ignore_student path (7)
                        { name: '旁白', portrait: 'narrator', text: '你低着头快步走过。身后传来哭声。', end: true },
                    ],
                    buffReward: { type: 'willpower', amount: 1 },
                    onChoice: function(choice) {
                        if (choice.choiceKey === 'help_student') {
                            playerChoices.helpedBulliedStudent = true;
                        } else {
                            playerChoices.helpedBulliedStudent = false;
                        }
                    },
                },
                {
                    triggerX: 1500,
                    dialogue: [
                        { name: '撑伞同学', portrait: 'lument_npc', text: '喂，淋雨的。' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '你知道大家怎么叫你吗？"落汤鸡"。' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '整个年级都知道，有个连伞都没有的穷鬼。' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '你以为成绩好就有用？这世界看的是你爹妈是谁。' },
                        { name: '你', portrait: 'player', text: '......' },
                        { name: '撑伞同学', portrait: 'lument_npc', text: '别挣扎了。你这种人，一辈子都买不起伞。' },
                        { name: '旁白', portrait: 'narrator', text: '这些话像针一样扎进心里。雨声似乎又近了。' },
                    ],
                    buffReward: { type: 'endurance', amount: 1 },
                },
                {
                    triggerX: 1950,
                    repeatable: true,  // 天台入口可重复进入
                    sceneTransition: 'rooftop',  // 对话结束后转换到天台场景
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '走廊尽头有一扇门，上面写着"通往天台"。' },
                        { name: '旁白', portrait: 'narrator', text: '门没有锁。' },
                        { name: '你', portrait: 'player', text: '......上去透透气吧。' },
                        { name: '旁白', portrait: 'narrator', text: '你推开门，沿着楼梯走上了天台。', end: true },
                    ],
                    buffReward: { type: 'mindset', amount: 1 },
                },
                {
                    triggerX: 2500,
                    dialogue: [
                        { name: '班主任', portrait: 'teacher', text: '你的成绩最近有进步，但还不够。' },
                        { name: '班主任', portrait: 'teacher', text: '你要知道，高考不会因为你淋雨就给你加分。' },
                        { name: '班主任', portrait: 'teacher', text: '撑伞的人早就报了补习班，请了一对一辅导。' },
                        { name: '你', portrait: 'player', text: '我知道。所以我会更努力。' },
                        { name: '班主任', portrait: 'teacher', text: '怎么个努力法？' },
                        { name: '你', portrait: 'player', text: '图书馆每天开到十点。我在那里待到关门。' },
                        { name: '你', portrait: 'player', text: '没有补习班，我就把课本每一道题都做三遍。' },
                        { name: '班主任', portrait: 'teacher', text: '......好。知识或许是你唯一的伞。' },
                        { name: '班主任', portrait: 'teacher', text: '但记住，撑伞的人也在努力。你要跑得比他们更快才行。' },
                        { name: '你', portrait: 'player', text: '我知道。我从出生就在跑。' },
                    ],
                    buffReward: { type: 'knowledge', amount: 2 },
                },
            ],
            endDialogue: [
                { name: '旁白', portrait: 'narrator', text: '走廊的尽头是教室的门。' },
                { name: '旁白', portrait: 'narrator', text: '你坐下来，翻开书本。窗外的雨声渐渐远去。' },
                { name: '旁白', portrait: 'narrator', text: '多年后你才明白，学校里的雨，比外面的更冷。' },
            ],
        },

        // ========== 第三章：职场泥泞（老头单节点） ==========
        {
            id: 2,
            title: '第三章：职场泥泞',
            subtitle: '事业篇 · 成年人的沼泽',
            theme: 'career',
            sceneType: 'outdoor',
            rainIntensity: 1.0,
            startX: 100,
            endX: 3400,
            intro: [
                { name: '旁白', portrait: 'narrator', text: '毕业了。找到了工作。雨还在下。' },
                { name: '旁白', portrait: 'narrator', text: '你挤在上班的人潮中，看见豪车从身边驶过，车窗紧闭。' },
                { name: '你', portrait: 'player', text: '至少......我现在有工作了。' },
                { name: '旁白', portrait: 'narrator', text: '在商务区行走，积累经验和能力。雨水更大了。' },
            ],
            encounters: [
                {
                    triggerX: 500,
                    dialogue: [
                        { name: '老板', portrait: 'boss', text: '小王，今天的报告呢？加班做完。' },
                        { name: '你', portrait: 'player', text: '可是已经十点了，我还没吃晚饭......' },
                        { name: '老板', portrait: 'boss', text: '你没伞可以淋雨，没工作可不行。公司不养闲人。' },
                        { name: '老板', portrait: 'boss', text: '看看人家李总的儿子，开着车来上班。你呢？' },
                        { name: '你', portrait: 'player', text: '......我知道了。' },
                        { name: '老板', portrait: 'boss', text: '还有，明天的客户接待，你穿体面点。别让人家以为我们公司雇不起撑伞的人。' },
                        { name: '旁白', portrait: 'narrator', text: '你低头看了看自己湿透的鞋。鞋底已经开胶了，每走一步都会渗水。' },
                        { name: '你', portrait: 'player', text: '（......连一双不漏水的鞋都是奢望。）' },
                    ],
                    buffReward: { type: 'endurance', amount: 1 },
                },
                {
                    triggerX: 1100,
                    dialogue: [
                        { name: '撑伞的同事', portrait: 'lument_npc', text: '哎，听说你又背锅了？那个项目明明是经理的问题。' },
                        { name: '你', portrait: 'player', text: '没办法，谁让我没有背景呢。' },
                        { name: '撑伞的同事', portrait: 'lument_npc', text: '我叔叔是副总，所以这种事轮不到我。' },
                        { name: '撑伞的同事', portrait: 'lument_npc', text: '你也别太难过，习惯就好了。' },
                        { name: '你', portrait: 'player', text: '习惯......' },
                    ],
                    buffReward: { type: 'experience', amount: 1 },
                },
                {
                    // ========== 老头单节点：扶起 → 邀请加入 ==========
                    triggerX: 1900,
                    npcFallen: true, // 老头倒地状态
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你在雨中看见一个老人摔倒在地。' },
                        { name: '旁白', portrait: 'narrator', text: '撑伞的人们从身边走过，没有人停下。' },
                        { name: '老人', portrait: 'npc', text: '......小伙子......能扶我一把吗......' },
                        {
                            name: '你', portrait: 'player',
                            text: '......',
                            choices: [
                                { text: '上前扶起老人', next: 4, choiceKey: 'help_oldman' },
                                { text: '犹豫片刻，还是走过去', next: 13, choiceKey: 'ignore_oldman' },
                            ]
                        },
                        // help_oldman path (4-8)
                        { name: '旁白', portrait: 'narrator', text: '你走上前去，把老人扶了起来。' },
                        { name: '老人', portrait: 'npc', text: '谢谢你，小伙子。这年头，愿意停下的人不多了。' },
                        { name: '老人', portrait: 'npc', text: '我观察你很久了。你有能力，也有良心。' },
                        { name: '老人', portrait: 'npc', text: '实不相瞒，我手下有些产业。你愿意来帮我吗？' },
                        {
                            name: '你', portrait: 'player',
                            text: '......',
                            choices: [
                                { text: '接受老人的邀请', next: 9, choiceKey: 'accept_oldman' },
                                { text: '婉拒，想靠自己', next: 11, choiceKey: 'refuse_oldman' },
                            ]
                        },
                        // accept_oldman path (9)
                        { name: '老人', portrait: 'npc', text: '好。从今天开始，你就跟着我。我不会亏待你的。' },
                        { name: '旁白', portrait: 'narrator', text: '你没有继续在雨中走。你跟着老人，走进了他的世界。', end: true },
                        // refuse_oldman path (10)
                        { name: '老人', portrait: 'npc', text: '也好。年轻人有骨气。祝你顺利。' },
                        { name: '旁白', portrait: 'narrator', text: '老人撑起伞，消失在雨中。你继续向前走。', end: true },
                        // ignore_oldman path (11)
                        { name: '旁白', portrait: 'narrator', text: '你低着头走过去了。身后传来微弱的呻吟声。' },
                        { name: '旁白', portrait: 'narrator', text: '雨越下越大。你没有回头。', end: true },
                    ],
                    buffReward: { type: 'mindset', amount: 1 },
                    nextChapter: function() { return playerChoices.joinedOldMan === true; },
                    onChoice: function(choice) {
                        if (choice.choiceKey === 'help_oldman') {
                            playerChoices.helpedOldMan = true;
                        } else if (choice.choiceKey === 'ignore_oldman') {
                            playerChoices.helpedOldMan = false;
                        } else if (choice.choiceKey === 'accept_oldman') {
                            playerChoices.joinedOldMan = true;
                        } else if (choice.choiceKey === 'refuse_oldman') {
                            playerChoices.joinedOldMan = false;
                        }
                    },
                },
                {
                    triggerX: 2700,
                    dialogue: [
                        { name: '加班的同事', portrait: 'npc', text: '又加班到凌晨？我也是。' },
                        { name: '加班的同事', portrait: 'npc', text: '你看对面那栋楼，灯全亮着，全是我们这种人。' },
                        { name: '加班的同事', portrait: 'npc', text: '而楼上那层......那是高管的健身房，从来不开灯。' },
                        { name: '你', portrait: 'player', text: '他们在健身，我们在拼命。' },
                        { name: '加班的同事', portrait: 'npc', text: '对了，你听说了吗？老陈被辞退了。' },
                        { name: '你', portrait: 'player', text: '老陈？他不是连续三年业绩第一吗？' },
                        { name: '加班的同事', portrait: 'npc', text: '是啊。但李总的外甥要他的位置。' },
                        { name: '加班的同事', portrait: 'npc', text: '老陈收拾东西的时候手在抖。他说他房贷还剩十五年。' },
                        { name: '你', portrait: 'player', text: '......这不公平。' },
                        { name: '加班的同事', portrait: 'npc', text: '公平？这里是职场，不是学校。伞下的人说了算。' },
                        { name: '加班的同事', portrait: 'npc', text: '但至少......我们学到了东西。总有一天用得上。' },
                    ],
                    buffReward: { type: 'ability', amount: 1 },
                },
            ],
            endDialogue: [
                { name: '旁白', portrait: 'narrator', text: '又走到了街的尽头。公司大楼就在前方。' },
                { name: '旁白', portrait: 'narrator', text: '你才明白：有些路，不是走出来的，是被分配的。' },
                { name: '旁白', portrait: 'narrator', text: '伞下的人走的是林荫道，雨中的人走的是泥泞路。' },
            ],
        },

        // ========== 第四章：办公室风云 / 老头公司（动态） ==========
        {
            id: 3,
            title: '第四章：办公室风云',
            subtitle: '事业篇 · 格子间里的权力',
            theme: 'company_office',
            sceneType: 'indoor',
            rainIntensity: 0.3,
            startX: 100,
            endX: 3600,
            // 动态intro：老头线 vs 普通线
            intro: function() {
                if (playerChoices.joinedOldMan === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '你跟着老人来到了他的公司——一栋位于市中心的摩天大楼。' },
                        { name: '旁白', portrait: 'narrator', text: '电梯直达顶层。落地窗外，整座城市笼罩在雨幕之中。' },
                        { name: '老人', portrait: 'npc', text: '从今天起，你就是我的特别助理。先从基层学起。' },
                        { name: '你', portrait: 'player', text: '谢谢您给我这个机会。我会努力的。' },
                        { name: '旁白', portrait: 'narrator', text: '你的人生，从踏入这扇门的那一刻起，彻底改变了。' },
                    ];
                }
                return [
                    { name: '旁白', portrait: 'narrator', text: '你走进公司大门。格子间里灯火通明，键盘声此起彼伏。' },
                    { name: '旁白', portrait: 'narrator', text: '窗外雨幕如帘，办公室里却是另一种风雨。' },
                    { name: '你', portrait: 'player', text: '在这里，没有雨水，但处处都是暗流。' },
                ];
            },
            // 动态encounters：老头线 vs 普通线
            encounters: function() {
                if (playerChoices.joinedOldMan === true) {
                    // ========== 老头公司线：基层磨练→崭露头角→权力上升→接掌金伞 ==========
                    return [
                        // 第1幕：初入公司，从最底层做起
                        {
                            triggerX: 350,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '第一天。你穿着唯一一件没有褶皱的衬衫，站在公司大厅里。' },
                                { name: '旁白', portrait: 'narrator', text: '前台的姑娘看了你一眼，以为你是来面试的。' },
                                { name: '前台', portrait: 'npc', text: '面试在三楼右转。' },
                                { name: '你', portrait: 'player', text: '我是张总介绍来的......' },
                                { name: '前台', portrait: 'npc', text: '哦——您就是那位。抱歉。电梯在左手边，顶层。' },
                                { name: '旁白', portrait: 'narrator', text: '你注意到她的语气从"打发"变成了"恭敬"。仅仅因为一句话。' },
                                { name: '你', portrait: 'player', text: '（......原来伞的影子，比伞本身还大。）' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        },
                        {
                            triggerX: 700,
                            dialogue: [
                                { name: '秘书', portrait: 'npc', text: '张总让你先从基层学起。今天的工作：把文件送到财务部。' },
                                { name: '你', portrait: 'player', text: '送文件？' },
                                { name: '秘书', portrait: 'npc', text: '对。这栋楼38层，你每层都要跑。熟悉每个部门的运作。' },
                                { name: '秘书', portrait: 'npc', text: '记住，在这里，听话比能干重要。至少......现阶段是这样。' },
                                { name: '旁白', portrait: 'narrator', text: '你抱着一摞文件走出电梯。走廊里没有人正眼看你。' },
                                { name: '同事甲', portrait: 'npc', text: '听说来了个空降的"特别助理"？' },
                                { name: '同事乙', portrait: 'npc', text: '不就是张总捡回来的嘛。能有什么本事。' },
                                { name: '你', portrait: 'player', text: '（......忍。我在雨里都忍过来了，这算什么。）' },
                            ],
                            buffReward: { type: 'endurance', amount: 1 },
                        },
                        // 新增：遇到善良的老员工——人情冷暖
                        {
                            triggerX: 850,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '送完最后一层文件，你在茶水间歇脚。腿已经酸得发抖。' },
                                { name: '老周', portrait: 'npc', text: '小伙子，新来的？脸色不太好啊。' },
                                { name: '你', portrait: 'player', text: '......嗯。张总让我从基层学起。今天跑了三十八层。' },
                                { name: '老周', portrait: 'npc', text: '三十八层？哈，老规矩了。每个空降的人都得跑一遍。' },
                                { name: '老周', portrait: 'npc', text: '来，喝杯茶。我这儿有好茶叶，铁观音。' },
                                { name: '你', portrait: 'player', text: '谢谢......您在这里多久了？' },
                                { name: '老周', portrait: 'npc', text: '十五年。进公司的时候，这栋楼才盖到二十层。' },
                                { name: '老周', portrait: 'npc', text: '看着一任又一任的人来了又走。有的升上去了，有的被挤走了。' },
                                { name: '你', portrait: 'player', text: '那您......怎么一直没升？' },
                                { name: '老周', portrait: 'npc', text: '（笑了笑）因为我不会弯腰啊。在这栋楼里，不弯腰的人，只能待在原地。' },
                                { name: '老周', portrait: 'npc', text: '但你不一样。你是张总带进来的。你有选择的机会。' },
                                { name: '老周', portrait: 'npc', text: '记住一句话——别学他们弯腰，但也别像我一样站着不动。要学会......在弯腰和站着之间，找到自己的姿势。' },
                                { name: '你', portrait: 'player', text: '（......弯腰和站着之间？）' },
                                { name: '旁白', portrait: 'narrator', text: '老周给你倒了杯茶。铁观音很苦，但回甘。你觉得他说的话也是。' },
                            ],
                            buffReward: { type: 'mindset', amount: 1 },
                        },
                        {
                            triggerX: 1050,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '第一个月。你的工作是端茶倒水、整理文件、跑腿送材料。' },
                                { name: '旁白', portrait: 'narrator', text: '每天早上七点到，晚上十点走。比在原来公司加班还累。' },
                                { name: '旁白', portrait: 'narrator', text: '但你不抱怨。你利用送文件的机会，观察每个部门的运作方式。' },
                                { name: '你', portrait: 'player', text: '（财务部的流程有漏洞......项目部的审批链条太长......）' },
                                { name: '你', portrait: 'player', text: '（这些我以前在课本上学过，但亲眼看到，感觉完全不同。）' },
                                { name: '旁白', portrait: 'narrator', text: '你把观察到的都记在笔记本上。没有人知道你在做这些。' },
                            ],
                            buffReward: { type: 'knowledge', amount: 1 },
                        },
                        // 新增：办公室政治——耳语与站队
                        {
                            triggerX: 1250,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '午休时间。你在食堂角落吃饭，旁边几个同事在小声议论。' },
                                { name: '同事甲', portrait: 'npc', text: '听说了吗？陈主管和赵总在争城南项目的控制权。' },
                                { name: '同事乙', portrait: 'npc', text: '赵总？他不是退居二线了吗？' },
                                { name: '同事甲', portrait: 'npc', text: '退居二线不代表放手啊。他的根系在这公司扎了二十年。' },
                                { name: '同事丙', portrait: 'npc', text: '那个新来的"特别助理"呢？他站哪边？' },
                                { name: '同事乙', portrait: 'npc', text: '谁知道。但我觉得他迟早得选边站。在这公司里，不站队的人死得最快。' },
                                { name: '旁白', portrait: 'narrator', text: '你假装没听到，低头扒饭。但你心里在盘算。' },
                                { name: '你', portrait: 'player', text: '（陈主管......就是给我下马威那个？他做假账的事我知道。如果将来要用......）' },
                                { name: '你', portrait: 'player', text: '（不，不能想这些。我来这里是为了学东西，不是来搞政治的。）' },
                                { name: '旁白', portrait: 'narrator', text: '但你已经在想了。这就是这栋楼的空气——你呼吸着它，它就慢慢改变了你的血液。' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        },
                        // 第2幕：第一次被刁难
                        {
                            triggerX: 1400,
                            dialogue: [
                                { name: '部门主管', portrait: 'lument_npc', text: '你就是那个"特别助理"？' },
                                { name: '部门主管', portrait: 'lument_npc', text: '我这里有一份季度报表，帮我核对一下数据。明天早上要。' },
                                { name: '你', portrait: 'player', text: '......这份报表有三千多行数据。' },
                                { name: '部门主管', portrait: 'lument_npc', text: '怎么？张总的人连这点事都做不了？' },
                                { name: '旁白', portrait: 'narrator', text: '你听出了他的意思。这不是工作，是下马威。' },
                                { name: '你', portrait: 'player', text: '没问题。明早放在您桌上。' },
                                { name: '旁白', portrait: 'narrator', text: '你通宵核对完了三千行数据。在最后一页，你发现了一处财务异常——有人在做假账。' },
                                { name: '你', portrait: 'player', text: '（......这个主管，自己屁股就不干净，还来给我下马威？）' },
                                { name: '旁白', portrait: 'narrator', text: '你没有声张。你把异常数据单独标注，放在了报表最后一页。' },
                            ],
                            buffReward: { type: 'ability', amount: 1 },
                        },
                        // 第3幕：崭露头角，获得老头认可
                        {
                            triggerX: 1750,
                            dialogue: [
                                { name: '老人', portrait: 'npc', text: '小王，听说你昨天帮陈主管核对了季度报表？' },
                                { name: '你', portrait: 'player', text: '是的，张老。' },
                                { name: '老人', portrait: 'npc', text: '他给你下马威的事我知道。但我更想知道——你核对了三千行数据，有什么发现？' },
                                { name: '你', portrait: 'player', text: '......最后一页，我标注了几处异常。第三季度的采购支出和实际入库对不上，差额大约两百万。' },
                                { name: '老人', portrait: 'npc', text: '......你看到了。' },
                                { name: '老人', portrait: 'npc', text: '那份报表，陈主管做了三年。从来没有人发现过。' },
                                { name: '老人', portrait: 'npc', text: '你不是只会端茶倒水的料。从明天起，你负责项目部的日常事务。' },
                                { name: '你', portrait: 'player', text: '谢谢张老。' },
                                { name: '老人', portrait: 'npc', text: '别谢我。那个陈主管......我会处理的。你以后还会遇到更多这种人。' },
                                { name: '老人', portrait: 'npc', text: '记住，在伞下的世界里，最大的敌人不是雨，是撑伞的人。' },
                                { name: '旁白', portrait: 'narrator', text: '你记住了这句话。但当时的你还不能完全理解它的分量。' },
                            ],
                            buffReward: { type: 'ability', amount: 2 },
                        },
                        // 新增：老头带你看一场谈判——权力的课堂
                        {
                            triggerX: 1950,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '老头叫你跟他去旁听一场谈判。对方是一家建材供应商，合作了八年。' },
                                { name: '老人', portrait: 'npc', text: '坐旁边，别说话。看就行了。' },
                                { name: '供应商老板', portrait: 'lument_npc', text: '张总，这次的原材料涨价，实在是没有办法。市场行情摆在那里。' },
                                { name: '老人', portrait: 'npc', text: '老李，你跟我合作八年了。八年里，我让你赚了多少？' },
                                { name: '供应商老板', portrait: 'lument_npc', text: '这......张总的照顾，我一直记在心里。' },
                                { name: '老人', portrait: 'npc', text: '那就好。你知道城南还有两家建材商想接我的单子吗？' },
                                { name: '供应商老板', portrait: 'lument_npc', text: '......张总，您这是什么意思？' },
                                { name: '老人', portrait: 'npc', text: '没什么意思。我只是告诉你——涨价可以，涨多少，我说了算。不是市场说了算。' },
                                { name: '旁白', portrait: 'narrator', text: '供应商老板的脸色变了。他张了张嘴，最终点了头。' },
                                { name: '供应商老板', portrait: 'lument_npc', text: '......行。听张总的。' },
                                { name: '旁白', portrait: 'narrator', text: '出了门，老头问你：看懂了吗？' },
                                { name: '你', portrait: 'player', text: '......您不是在谈价格。您是在告诉他谁说了算。' },
                                { name: '老人', portrait: 'npc', text: '对了。价格只是表面。真正谈的是——谁离不开谁。' },
                                { name: '老人', portrait: 'npc', text: '记住，谈判桌上最重要的不是你能给出什么，而是对方怕失去什么。' },
                                { name: '你', portrait: 'player', text: '（......他不是在教我谈判。他是在教我怎么拿捏人。）' },
                                { name: '旁白', portrait: 'narrator', text: '你学得很快。快到你自己都没有察觉。' },
                            ],
                            buffReward: { type: 'ability', amount: 1 },
                        },
                        // 第4幕：执掌项目部，初尝权力
                        {
                            triggerX: 2100,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '三个月后。你成了项目部负责人。' },
                                { name: '旁白', portrait: 'narrator', text: '第一次主持部门会议，你紧张得手心冒汗。但没有人看出来。' },
                                { name: '下属甲', portrait: 'lument_npc', text: '王总，这个方案我认为应该调整一下方向......' },
                                { name: '你', portrait: 'player', text: '说说看。' },
                                { name: '下属甲', portrait: 'lument_npc', text: '客户那边更看重成本控制，我们应该把预算压缩15%......' },
                                { name: '你', portrait: 'player', text: '不行。压缩15%意味着偷工减料。我们不做一锤子买卖。' },
                                { name: '你', portrait: 'player', text: '重新做方案。预算不动，从效率上找空间。' },
                                { name: '旁白', portrait: 'narrator', text: '会议结束后，几个下属在走廊里议论。' },
                                { name: '下属乙', portrait: 'lument_npc', text: '这个新来的......有点东西啊。' },
                                { name: '下属甲', portrait: 'lument_npc', text: '以前那几个空降的，只会点头。这个至少敢说"不行"。' },
                                { name: '旁白', portrait: 'narrator', text: '你听到这些话，心里有一丝异样的感觉。这可能是你第一次被人认可——不是因为你是谁的"特别助理"，而是因为你说了"不行"。' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        },
                        // 新增：独自处理危机——成长的代价
                        {
                            triggerX: 2300,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '两个月后。一个重点项目出了问题——施工方偷工减料，被监理查出。' },
                                { name: '下属甲', portrait: 'lument_npc', text: '王总，监理那边已经发函了。如果甲方知道了，整个项目可能要停工。' },
                                { name: '你', portrait: 'player', text: '施工方那边怎么说？' },
                                { name: '下属甲', portrait: 'lument_npc', text: '他们说......可以"处理"。给监理一点好处，把报告压下去。' },
                                { name: '你', portrait: 'player', text: '......"处理"?' },
                                { name: '下属甲', portrait: 'lument_npc', text: '以前陈主管在的时候，都是这么操作的。行业惯例。' },
                                { name: '旁白', portrait: 'narrator', text: '你沉默了。你想起了老周说的话——"别学他们弯腰"。' },
                                { name: '你', portrait: 'player', text: '不处理。让施工方返工。费用他们自己承担。' },
                                { name: '下属甲', portrait: 'lument_npc', text: '可是王总，这样会延误工期，甲方那边......' },
                                { name: '你', portrait: 'player', text: '我去跟甲方谈。偷工减料的事，我如实告知，附带整改方案。' },
                                { name: '下属甲', portrait: 'lument_npc', text: '如实告知？这......' },
                                { name: '你', portrait: 'player', text: '甲方要的是质量，不是面子。隐瞒一旦被发现，我们连本带利都赔不起。' },
                                { name: '旁白', portrait: 'narrator', text: '你去了甲方那里。被骂了半个小时。但你拿出了整改方案和追责清单。' },
                                { name: '甲方代表', portrait: 'lument_npc', text: '......至少你说了实话。比上一个主管强。改吧，费用施工方出。' },
                                { name: '旁白', portrait: 'narrator', text: '危机解除了。老头听说了这件事，只是笑了笑。' },
                                { name: '老人', portrait: 'npc', text: '你做得对。但记着——能说实话，是因为你现在还有说实话的资本。' },
                                { name: '老人', portrait: 'npc', text: '等你欠了银行十个亿的时候，你看还说不说得出来。' },
                                { name: '你', portrait: 'player', text: '（......他说得对吗？我不知道。但我知道今天我做的是对的。）' },
                            ],
                            buffReward: { type: 'willpower', amount: 2 },
                        },
                        // 第5幕：升任副总，开始变化
                        {
                            triggerX: 2500,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '一年后。你已经是公司副总了。' },
                                { name: '旁白', portrait: 'narrator', text: '你有了自己的办公室、专职秘书、公司配的车。' },
                                { name: '旁白', portrait: 'narrator', text: '你学会了这个世界里的生存法则——什么时候该笑，什么时候该沉默。' },
                                { name: '老人', portrait: 'npc', text: '小王，今晚有个饭局，几个局长都会到。你跟我去。' },
                                { name: '你', portrait: 'player', text: '好的，张老。' },
                                { name: '老人', portrait: 'npc', text: '到了那里，多听少说。你现在的身份是我的副手，不是端茶的小伙子了。' },
                                { name: '旁白', portrait: 'narrator', text: '饭局上，你第一次坐在"上座"旁边。觥筹交错间，你看着那些局长、处长们对你毕恭毕敬。' },
                                { name: '你', portrait: 'player', text: '（......一年前，我在雨里跑着送外卖。现在这些人叫我"王总"。）' },
                                { name: '旁白', portrait: 'narrator', text: '你没有喝醉，但你假装醉了。因为老头教过你——"清醒的人最危险，装醉的人最安全。"' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        },
                        // 新增：回到旧地——两个世界的裂缝
                        {
                            triggerX: 2700,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '周末。你让司机停在公司附近的老街区。你想吃一碗以前常吃的面。' },
                                { name: '旁白', portrait: 'narrator', text: '面馆还在。老板还是那个老板。但你穿着定制西装走进来的时候，所有人的目光都变了。' },
                                { name: '面馆老板', portrait: 'npc', text: '这不是......小王？好久没来了啊！' },
                                { name: '你', portrait: 'player', text: '老板，老样子。一碗牛肉面，多放辣。' },
                                { name: '面馆老板', portrait: 'npc', text: '好好好！你现在是张大老板了吧？看你这西装......' },
                                { name: '旁白', portrait: 'narrator', text: '面端上来了。味道没变。但你吃起来，总觉得少了什么。' },
                                { name: '你', portrait: 'player', text: '（......以前吃这碗面的时候，外面下着雨。我浑身湿透，但觉得面是热的，就够了。）' },
                                { name: '你', portrait: 'player', text: '（现在西装是干的，面也是热的。但总觉得......少了什么。）' },
                                { name: '旁白', portrait: 'narrator', text: '门口进来一个浑身湿透的年轻人，点了一碗最便宜的素面。' },
                                { name: '旁白', portrait: 'narrator', text: '你看了他一眼。他低着头，筷子在碗里搅了搅，先喝了一口汤。' },
                                { name: '你', portrait: 'player', text: '老板，那位小哥的面钱算我的。再给他加个蛋。' },
                                { name: '面馆老板', portrait: 'npc', text: '哎，小王出息了，大方了！' },
                                { name: '旁白', portrait: 'narrator', text: '年轻人抬头看了你一眼，点了点头，没有说话。' },
                                { name: '你', portrait: 'player', text: '（......一年前我也是他。有人帮过我。现在我也帮了别人。这算......传承吗？）' },
                                { name: '旁白', portrait: 'narrator', text: '你走出面馆。雨停了。你站在街边，看着自己锃亮的皮鞋，再看看地上的水洼。' },
                                { name: '你', portrait: 'player', text: '（......我已经不走水洼了。我走的是红地毯。）' },
                                { name: '旁白', portrait: 'narrator', text: '这是最后一次你主动走进这条街。之后的你，再也没来过。' },
                            ],
                            buffReward: { type: 'mindset', amount: 1 },
                        },
                        {
                            triggerX: 2900,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '你的变化是潜移默化的。' },
                                { name: '旁白', portrait: 'narrator', text: '你开始用"效率"代替"感受"，用"资源"代替"人"。' },
                                { name: '旁白', portrait: 'narrator', text: '一次裁员会议上，你签字裁掉了二十个人。其中有个人跟了公司八年。' },
                                { name: '被裁员工', portrait: 'npc', text: '王总......我在公司干了八年了。我孩子刚上小学......' },
                                { name: '你', portrait: 'player', text: '......公司有公司的难处。这是商业决策，不是针对个人。' },
                                { name: '被裁员工', portrait: 'npc', text: '可是......' },
                                { name: '你', portrait: 'player', text: '人事会跟你谈赔偿方案。我还有会。' },
                                { name: '旁白', portrait: 'narrator', text: '你转身走了。身后传来压抑的哭声。你没有回头。' },
                                { name: '旁白', portrait: 'narrator', text: '一年前的你，一定会多问一句。但现在的你学会了——在伞下的世界里，心软是最贵的奢侈品。' },
                            ],
                            buffReward: { type: 'mindset', amount: 1 },
                        },
                        // 第6幕：接掌金伞
                        {
                            triggerX: 3300,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '又过了两年。老人正式退居幕后，你成了公司的一把手。' },
                                { name: '旁白', portrait: 'narrator', text: '你站在顶层的落地窗前，俯瞰着楼下在雨中奔跑的人群。' },
                                { name: '老人', portrait: 'npc', text: '小王，你准备好了吗？' },
                                { name: '你', portrait: 'player', text: '张老......' },
                                { name: '老人', portrait: 'npc', text: '这把伞，以后就是你的了。' },
                                { name: '旁白', portrait: 'narrator', text: '老人递给你一把金色的伞。沉甸甸的，带着权力的重量。' },
                                { name: '老人', portrait: 'npc', text: '记住我当年说的话——在伞下的世界里，最大的敌人不是雨，是撑伞的人。' },
                                { name: '老人', portrait: 'npc', text: '现在你就是那个撑伞的人了。别人会盯着你的伞，想夺走它。' },
                                {
                                    name: '你', portrait: 'player',
                                    text: '......',
                                    choices: [
                                        { text: '接过金伞，接受新的身份', next: 5, choiceKey: 'accept_lument' },
                                        { text: '犹豫片刻，还是接了过来', next: 5, choiceKey: 'hesitate_lument' },
                                    ]
                                },
                                { name: '旁白', portrait: 'narrator', text: '你握住了金色的伞柄。金属的冰凉传到掌心。' },
                                { name: '旁白', portrait: 'narrator', text: '从这一刻起，你不再是雨中奔跑的人了。' },
                                { name: '旁白', portrait: 'narrator', text: '窗外，有人在雨中跌倒，没有人停下。就像当年的你。', end: true },
                            ],
                            buffReward: { type: 'mindset', amount: 2 },
                            nextChapter: true,
                            onChoice: function(choice) {
                                playerChoices.becameBoss = true;
                            },
                        },
                    ];
                }
                // ========== 普通公司线 ==========
                return [
                    {
                        triggerX: 500,
                        dialogue: [
                            { name: '部门经理', portrait: 'boss', text: '公司最近在推一个新项目，需要一个负责人。' },
                            { name: '部门经理', portrait: 'boss', text: '你有能力，但......你知道的，李总那边有人选。' },
                            { name: '部门经理', portrait: 'boss', text: '你要是能跟李总那边打好关系，这事就好办了。' },
                            {
                                name: '你', portrait: 'player',
                                text: '......',
                                choices: [
                                    { text: '去迎合李总，换取项目机会', next: 4, choiceKey: 'cater_power' },
                                    { text: '靠自己的实力争取，不迎合任何人', next: 6, choiceKey: 'rely_self' },
                                ]
                            },
                            // cater_power path (4)
                            { name: '部门经理', portrait: 'boss', text: '明智的选择。在这个公司里，会做人比会做事重要。' },
                            { name: '旁白', portrait: 'narrator', text: '你去了李总的饭局。递上了名片，陪了笑脸。', end: true },
                            // rely_self path (5)
                            { name: '部门经理', portrait: 'boss', text: '......随你吧。但别怪我没提醒你。' },
                            { name: '旁白', portrait: 'narrator', text: '你转身离开。你选择了不弯腰。', end: true },
                        ],
                        buffReward: { type: 'ability', amount: 1 },
                        onChoice: function(choice) {
                            if (choice.choiceKey === 'cater_power') {
                                playerChoices.cateredToPower = true;
                            } else {
                                playerChoices.cateredToPower = false;
                            }
                        },
                    },
                    {
                        triggerX: 1200,
                        dialogue: [
                            { name: '撑伞的高管', portrait: 'lument_npc', text: '年轻人，在这个公司里，能力只是入场券。' },
                            { name: '撑伞的高管', portrait: 'lument_npc', text: '真正决定你位置的，是你站在谁的伞下。' },
                            { name: '撑伞的高管', portrait: 'lument_npc', text: '我们这些撑伞的人，互相照应。你们淋雨的......自求多福。' },
                            { name: '你', portrait: 'player', text: '......' },
                        ],
                        buffReward: { type: 'experience', amount: 1 },
                    },
                    {
                        triggerX: 1900,
                        dialogue: [
                            { name: '同事老张', portrait: 'npc', text: '你听说了吗？老陈干了十年，被一个空降的关系户顶了位置。' },
                            { name: '同事老张', portrait: 'npc', text: '老陈没伞，没关系，干得再好也没用。' },
                            { name: '同事老张', portrait: 'npc', text: '我在想要不要自己出去干。你有学识，有能力......' },
                            {
                                name: '同事老张', portrait: 'npc',
                                text: '咱们合伙创业怎么样？',
                                choices: [
                                    { text: '好，我们一起创业', next: 4, choiceKey: 'start_company' },
                                    { text: '不了，我现在还没准备好', next: 6, choiceKey: 'no_company' },
                                ]
                            },
                            // start_company path (4)
                            { name: '同事老张', portrait: 'npc', text: '好！就这么定了。咱们自己撑伞！' },
                            { name: '旁白', portrait: 'narrator', text: '你递交了辞职信。雨还在下，但你的心里有了一团火。', end: true },
                            // no_company path (5)
                            { name: '同事老张', portrait: 'npc', text: '也好，稳妥一点。但机会不等人啊。' },
                            { name: '旁白', portrait: 'narrator', text: '你继续回到工位上。窗外的雨声仿佛更近了。', end: true },
                        ],
                        buffReward: { type: 'resume', amount: 1 },
                        nextChapter: true,
                        onChoice: function(choice) {
                            if (choice.choiceKey === 'start_company') {
                                playerChoices.startedCompany = true;
                            } else {
                                playerChoices.startedCompany = false;
                            }
                        },
                    },
                ];
            },
            endDialogue: function() {
                if (playerChoices.joinedOldMan === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '你站在办公室的落地窗前，看着楼下雨中奔跑的人群。' },
                        { name: '旁白', portrait: 'narrator', text: '手中的金色雨伞格外沉重。' },
                        { name: '你', portrait: 'player', text: '......这就是我想要的吗？' },
                    ];
                }
                return [
                    { name: '旁白', portrait: 'narrator', text: '下班了。你走出公司大楼，雨还在下。' },
                    { name: '旁白', portrait: 'narrator', text: '格子间里的灯光在身后熄灭，只剩下雨声。' },
                    { name: '旁白', portrait: 'narrator', text: '你站在门口，不知道前方等待你的是什么。' },
                ];
            },
        },

        // ========== 第五章：创业征程（动态） ==========
        {
            id: 4,
            title: '第五章：创业征程',
            subtitle: '事业篇 · 自己撑伞的路',
            theme: 'life',
            sceneType: 'outdoor',
            rainIntensity: 0.9,
            startX: 100,
            endX: 3000,
            intro: function() {
                if (playerChoices.joinedOldMan === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '你走出公司大楼。手里握着那把金色的伞。' },
                        { name: '旁白', portrait: 'narrator', text: '雨还在下，但你不再奔跑了。你从容地走在雨中。' },
                        { name: '你', portrait: 'player', text: '原来......撑伞的人看到的世界，是这样的。' },
                    ];
                }
                if (playerChoices.startedCompany === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '辞职后的第一个清晨。你和老张站在租来的小办公室门口。' },
                        { name: '旁白', portrait: 'narrator', text: '十几平米，一张桌子，两把椅子。窗外下着小雨。' },
                        { name: '老张', portrait: 'npc', text: '从今天起，咱们自己当老板！自己给自己撑伞！' },
                        { name: '你', portrait: 'player', text: '......嗯。这条路不好走，但我想试试。' },
                    ];
                }
                return [
                    { name: '旁白', portrait: 'narrator', text: '人到中年。房贷，父母。雨越下越大。' },
                    { name: '旁白', portrait: 'narrator', text: '你走在居住区的街上，看见有人在屋檐下避雨，那是你买不起的房子。' },
                    { name: '你', portrait: 'player', text: '半生已过，山河万里，却无一把伞。也无一人相伴。' },
                ];
            },
            encounters: function() {
                if (playerChoices.joinedOldMan === true) {
                    // ========== 老头线：大老板视角 ==========
                    return [
                        // 场景1：清晨的金伞
                        {
                            triggerX: 350,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '清晨。你从顶层公寓醒来。窗外是整座城市的轮廓，雨幕笼罩着一切。' },
                                { name: '旁白', portrait: 'narrator', text: '金伞立在玄关。你的司机已经在楼下等着了。' },
                                { name: '你', portrait: 'player', text: '......又是新的一天。' },
                                { name: '旁白', portrait: 'narrator', text: '你拿起金伞，走出门。电梯直达地下车库，不用淋一滴雨。' },
                                { name: '你', portrait: 'player', text: '（......我已经多久没淋过雨了？）' },
                                { name: '旁白', portrait: 'narrator', text: '你想不起来。这种"想不起来"本身就是一种答案。' },
                            ],
                            buffReward: { type: 'mindset', amount: 1 },
                        },
                        // 场景2：偶遇淋雨年轻人
                        {
                            triggerX: 800,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '车在红灯前停下。你透过车窗，看见一个淋着雨的年轻人在路边等公交。' },
                                { name: '旁白', portrait: 'narrator', text: '他浑身湿透，书包里露出课本的一角。他的鞋已经泡水了，但他还在看手机——大概在看招聘信息。' },
                                { name: '你', portrait: 'player', text: '（那个人......像极了当年的我。）' },
                                { name: '你', portrait: 'player', text: '（......停一下车。我想......）' },
                                { name: '司机', portrait: 'npc', text: '王总？后面还有会呢。' },
                                { name: '你', portrait: 'player', text: '......算了。走吧。' },
                                { name: '旁白', portrait: 'narrator', text: '绿灯亮了。车窗隔绝了外面的一切。你没有回头。' },
                                { name: '你', portrait: 'player', text: '（......他自己会走出来的。我当年不也是这样吗？）' },
                                { name: '旁白', portrait: 'narrator', text: '你用这句话安慰自己。但安慰的效力越来越短了。' },
                            ],
                            buffReward: null,
                        },
                        // 场景3：公司日常——被簇拥的孤独
                        {
                            triggerX: 1250,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '到了公司。从车库到办公室，一路上有人问好、有人递文件、有人汇报工作。' },
                                { name: '秘书', portrait: 'lument_npc', text: '王总，今天的行程：上午董事会，中午跟银行行长吃饭，下午视察工地，晚上有个饭局。' },
                                { name: '你', portrait: 'player', text: '......行。' },
                                { name: '旁白', portrait: 'narrator', text: '你注意到秘书称呼你"王总"。三年前，你也叫别人"总"。' },
                                { name: '旁白', portrait: 'narrator', text: '你坐进办公椅，转过去面对落地窗。外面是灰蒙蒙的天。你在想什么？你自己也不清楚。' },
                                { name: '你', portrait: 'player', text: '（所有人都对我笑。但没有一个是真心的。包括我自己。）' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        },
                        // 新增：工地视察——伞下与雨中
                        {
                            triggerX: 1450,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '下午。你视察城南工地。安全帽、劳保鞋，你的装备是定制的。' },
                                { name: '旁白', portrait: 'narrator', text: '工人们在雨中作业。没有雨衣，没有安全帽上的遮檐。他们的手粗糙得像砂纸。' },
                                { name: '项目经理', portrait: 'lument_npc', text: '王总，工期紧，工人们已经连续加班两周了。' },
                                { name: '你', portrait: 'player', text: '进度怎么样？' },
                                { name: '项目经理', portrait: 'lument_npc', text: '按计划推进。但有几个工人反映......工资拖欠了两个月。' },
                                { name: '你', portrait: 'player', text: '拖欠？财务那边怎么回事？' },
                                { name: '项目经理', portrait: 'lument_npc', text: '这个......王总，您也知道，城南项目的资金被挪了一部分到其他项目上。' },
                                { name: '你', portrait: 'player', text: '......我知道了。我回去催财务。' },
                                { name: '旁白', portrait: 'narrator', text: '你走过工地。一个年长的工人抬头看了你一眼，又低下头继续干活。' },
                                { name: '老工人', portrait: 'npc', text: '（小声）大老板来了又怎样。工资不发，还不是白干。' },
                                { name: '旁白', portrait: 'narrator', text: '你听到了。你停下脚步。但你没有回头。' },
                                { name: '你', portrait: 'player', text: '（......他们淋着雨，在给我盖楼。我坐在楼里，看着他们淋雨。）' },
                                { name: '你', portrait: 'player', text: '（......但这不是我造成的。资金的事，是老头安排的。我管不了。）' },
                                { name: '旁白', portrait: 'narrator', text: '你又用那句话安慰自己。但你心里清楚，"我管不了"这四个字，正在变得越来越顺口。' },
                            ],
                            buffReward: { type: 'endurance', amount: 1 },
                        },
                        // 场景4：饭局——权力的味道
                        {
                            triggerX: 1700,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '晚上。饭局。包间里坐满了局长、处长、企业家。' },
                                { name: '王局长', portrait: 'lument_npc', text: '王总年轻有为啊！张老先生没看错人。' },
                                { name: '李处长', portrait: 'lument_npc', text: '王总，城南那块地的事......您看方便的时候，咱们单独聊聊？' },
                                { name: '你', portrait: 'player', text: '李处长说笑了。改天我登门拜访。' },
                                { name: '旁白', portrait: 'narrator', text: '你举杯敬酒。动作流畅得像呼吸一样自然。' },
                                { name: '旁白', portrait: 'narrator', text: '你曾经厌恶这些在饭局上推杯换盏的人。现在你坐在主位上，比任何人都熟练。' },
                                { name: '王局长', portrait: 'lument_npc', text: '来来来，敬王总一杯！王总以后多关照！' },
                                { name: '你', portrait: 'player', text: '（......他们敬的不是我。是我手里这把伞。）' },
                                { name: '旁白', portrait: 'narrator', text: '你笑着碰杯。笑容很标准，标准到你自己都分不清真假了。' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        },
                        // 新增：商业对手——伞外的威胁
                        {
                            triggerX: 1900,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '饭局散场后，你在停车场遇到了同行——恒达集团的刘总。' },
                                { name: '刘总', portrait: 'lument_npc', text: '哟，这不是张老的新接班人嘛。年轻就是好。' },
                                { name: '你', portrait: 'player', text: '刘总客气了。' },
                                { name: '刘总', portrait: 'lument_npc', text: '我听说城南那块地，你们拿下了？恭喜恭喜。' },
                                { name: '刘总', portrait: 'lument_npc', text: '不过年轻人，我得提醒你一句——张老的伞确实大，但伞再大，也有收起来的一天。' },
                                { name: '你', portrait: 'player', text: '......刘总有什么想说的？' },
                                { name: '刘总', portrait: 'lument_npc', text: '没什么。就是觉得你跟他以前用过的那些人不一样。你至少有真本事。' },
                                { name: '刘总', portrait: 'lument_npc', text: '但本事大的人，在伞下待久了，容易忘记雨是什么感觉。' },
                                { name: '刘总', portrait: 'lument_npc', text: '等你忘了的时候......风一吹，伞翻了，你连跑都不会了。' },
                                { name: '你', portrait: 'player', text: '刘总是在威胁我？' },
                                { name: '刘总', portrait: 'lument_npc', text: '不。我是在可怜你。我淋了三十年雨，好歹知道怎么跑。你呢？' },
                                { name: '旁白', portrait: 'narrator', text: '刘总上了自己的车。车灯扫过你的脸，刺得你眯了眯眼。' },
                                { name: '你', portrait: 'player', text: '（......他说得对吗？我已经不会跑了？）' },
                                { name: '旁白', portrait: 'narrator', text: '你站在停车场里，雨打在金伞上。你突然觉得，这把伞很沉。' },
                            ],
                            buffReward: { type: 'willpower', amount: 1 },
                        },
                        // 场景5：深夜独处——裂缝
                        {
                            triggerX: 2100,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '饭局结束。凌晨一点。你回到空旷的豪宅。' },
                                { name: '旁白', portrait: 'narrator', text: '客厅有三百平米，但你只开了一盏台灯。' },
                                { name: '你', portrait: 'player', text: '......' },
                                { name: '旁白', portrait: 'narrator', text: '你打开手机。有一条未读消息——来自一个很久没联系的号码。' },
                                { name: '旁白', portrait: 'narrator', text: '"小王，是我，老陈。还记得吗？以前一个公司的。我最近不太好......能借我五万块吗？"' },
                                { name: '你', portrait: 'player', text: '（老陈......就是当年被裁的那个？）' },
                                { name: '旁白', portrait: 'narrator', text: '你看着这条消息。五万块对你来说不算什么。但你犹豫了。' },
                                { name: '你', portrait: 'player', text: '（......如果借了，他会到处说。别人也会来借。撑伞的人不能有软肋。）' },
                                { name: '旁白', portrait: 'narrator', text: '你把消息标记为已读，然后锁了屏幕。' },
                                { name: '你', portrait: 'player', text: '......我变了。' },
                                { name: '旁白', portrait: 'narrator', text: '你知道你变了。但"知道"并不能阻止变化。温水已经没过了胸口。' },
                            ],
                            buffReward: { type: 'willpower', amount: 1 },
                        },
                        // 场景6：路过旧居
                        {
                            triggerX: 2500,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '第二天傍晚。你让司机绕路经过你曾经租住的老旧小区。' },
                                { name: '旁白', portrait: 'narrator', text: '窗户里透出昏暗的灯光。三楼那间——你曾经在那间屋子里吃过无数碗泡面，淋雨回来后用塑料袋套着头吹头发。' },
                                { name: '你', portrait: 'player', text: '......那时候，我连一把伞都没有。' },
                                { name: '旁白', portrait: 'narrator', text: '窗帘后面有人影在动——又一个租客，大概和你当年一样。' },
                                { name: '司机', portrait: 'npc', text: '王总？要停车吗？' },
                                { name: '你', portrait: 'player', text: '不用。走吧。' },
                                { name: '旁白', portrait: 'narrator', text: '你从车窗看着那扇窗渐渐缩小、消失。金伞放在后座，你甚至没有拿起来。' },
                                { name: '你', portrait: 'player', text: '（......那个窗口里的人，大概也在想：总有一天我会买一把伞。）' },
                                { name: '你', portrait: 'player', text: '（他不知道的是......伞里的世界，比雨里更冷。）' },
                            ],
                            buffReward: { type: 'endurance', amount: 1 },
                        },
                        // 新增：一个电话——彻底的孤独
                        {
                            triggerX: 2700,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '回到豪宅。你翻看手机通讯录。五百多个联系人，你滑了三遍，找不到一个能打电话聊天的人。' },
                                { name: '旁白', portrait: 'narrator', text: '你想起老周。那个在茶水间给你倒铁观音的老员工。你拨打了他的号码。' },
                                { name: '旁白', portrait: 'narrator', text: '"您拨打的号码已停机。"' },
                                { name: '你', portrait: 'player', text: '......' },
                                { name: '旁白', portrait: 'narrator', text: '你打电话给秘书。' },
                                { name: '你', portrait: 'player', text: '帮我查一下老周......就是行政部的周师傅，他怎么停机了？' },
                                { name: '秘书', portrait: 'lument_npc', text: '王总，周师傅......三个月前被优化了。是陈主管那批裁员名单上的。' },
                                { name: '你', portrait: 'player', text: '......三个月前？我怎么不知道？' },
                                { name: '秘书', portrait: 'lument_npc', text: '那时候......裁员的文件是您签的字。' },
                                { name: '旁白', portrait: 'narrator', text: '你挂了电话。你想起那杯铁观音，苦但回甘。' },
                                { name: '你', portrait: 'player', text: '（......是我签字裁的。我甚至不记得他的名字出现在名单上。）' },
                                { name: '你', portrait: 'player', text: '（他说"别学他们弯腰"。但我已经在弯了。弯到连名字都看不见了。）' },
                                { name: '旁白', portrait: 'narrator', text: '你打开一瓶酒。三百年的红酒，老头送的。你一个人喝完了整瓶。' },
                                { name: '旁白', portrait: 'narrator', text: '酒很贵。但你喝不出味道。就像你住在三百平米的房子里，却找不到一个可以坐下来的角落。' },
                            ],
                            buffReward: { type: 'mindset', amount: 1 },
                        },
                        // 场景7：老头的一通电话——暗示秘密
                        {
                            triggerX: 2900,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '回到公司。老头打来电话。他已经退居幕后了，很少主动联系。' },
                                { name: '老人', portrait: 'npc', text: '小王，城南那块地的事......你处理得怎么样了？' },
                                { name: '你', portrait: 'player', text: '李处长那边在推。应该没问题。' },
                                { name: '老人', portrait: 'npc', text: '嗯。那块地......有些事情你不用知道太多。按照我教你的做就行。' },
                                { name: '你', portrait: 'player', text: '张老，什么意思？' },
                                { name: '老人', portrait: 'npc', text: '有些账，不需要看得太清楚。你只管签字就行。其他的，我安排好了。' },
                                { name: '旁白', portrait: 'narrator', text: '电话挂了。你盯着"城南项目"的文件夹，心里有个声音在说：打开它。' },
                                { name: '你', portrait: 'player', text: '（......老头到底在瞒什么？）' },
                                { name: '旁白', portrait: 'narrator', text: '你把手放在文件夹上。但最终，你收回了手，关灯离开了办公室。' },
                                { name: '旁白', portrait: 'narrator', text: '这天夜里，你失眠了。窗外的雨声很大，像是在提醒你什么。', end: true },
                            ],
                            buffReward: { type: 'mindset', amount: 1 },
                            nextChapter: true,
                        },
                    ];
                }

                // ========== 创业线：从零开始的奔波 ==========
                if (playerChoices.startedCompany === true) {
                    return [
                        {
                            triggerX: 350,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '公司注册下来了。名字叫"微光科技"。' },
                                { name: '老张', portrait: 'npc', text: '今天咱们去跑客户！我就不信凭咱们的技术，拿不到单子！' },
                                { name: '你', portrait: 'player', text: '嗯。先从周边的小公司开始吧。' },
                                { name: '旁白', portrait: 'narrator', text: '雨不大，但路很长。两个人的影子拉得很长。' },
                            ],
                            buffReward: { type: 'mindset', amount: 1 },
                        },
                        {
                            triggerX: 900,
                            dialogue: [
                                { name: '前台小姐', portrait: 'npc', text: '对不起，我们经理不在。您把名片留下吧。' },
                                { name: '旁白', portrait: 'narrator', text: '这是今天第五个说"经理不在"的前台了。' },
                                { name: '老张', portrait: 'npc', text: '没事，明天再来！创业哪有一帆风顺的！' },
                                { name: '你', portrait: 'player', text: '......老张，你饿不饿？我们去吃碗面吧。' },
                                { name: '旁白', portrait: 'narrator', text: '雨还在下。两碗热腾腾的面，是今天唯一的温暖。' },
                                { name: '老张', portrait: 'npc', text: '我跟你说，我当年摆地摊的时候，比这还惨。城管追了三条街。' },
                                { name: '老张', portrait: 'npc', text: '但你猜怎么着？第二天我还是去摆了。因为不摆就没饭吃。' },
                                { name: '你', portrait: 'player', text: '......是啊。不跑就淋得更湿。' },
                                { name: '旁白', portrait: 'narrator', text: '两个中年人蹲在面摊前，呵出的白气混进雨雾里。' },
                            ],
                            buffReward: { type: 'endurance', amount: 1 },
                        },
                        {
                            triggerX: 1500,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '半个月后。凌晨两点，办公室的灯还亮着。' },
                                { name: '老张', portrait: 'npc', text: '这个方案改了第八版了......客户还是不满意。' },
                                { name: '你', portrait: 'player', text: '再改一版。这是我们第一个客户，不能搞砸了。' },
                                { name: '旁白', portrait: 'narrator', text: '咖啡已经凉了。窗外的雨下了又停，停了又下。' },
                                { name: '你', portrait: 'player', text: '（原来......自己撑伞，比在别人伞下淋雨还要累。）' },
                            ],
                            buffReward: { type: 'knowledge', amount: 1 },
                        },
                        {
                            triggerX: 2100,
                            dialogue: [
                                { name: '老张', portrait: 'npc', text: '签了！王总那个项目签了！' },
                                { name: '你', portrait: 'player', text: '真的？！太好了！' },
                                { name: '老张', portrait: 'npc', text: '这一单够咱们撑三个月了！而且王总说如果做得好，以后还有合作！' },
                                { name: '旁白', portrait: 'narrator', text: '两个人在雨里大笑。雨水打在脸上，分不清是雨还是泪。' },
                                { name: '老张', portrait: 'npc', text: '......我跟你说，改方案那天晚上，我差点想放弃了。' },
                                { name: '老张', portrait: 'npc', text: '但是看你还在敲键盘，我就想，他都没放弃，我放弃什么？' },
                                { name: '你', portrait: 'player', text: '......老张，我们能行的。' },
                                { name: '老张', portrait: 'npc', text: '当然能行！以后咱们就是这条街上最牛的公司！' },
                                { name: '旁白', portrait: 'narrator', text: '雨还在下，但此刻，你们觉得头顶好像有了一把伞。虽然看不见，但能感觉到。' },
                            ],
                            buffReward: { type: 'willpower', amount: 2 },
                        },
                        {
                            triggerX: 2600,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '半年后。公司从两个人变成了十个人。' },
                                { name: '旁白', portrait: 'narrator', text: '你们搬进了更大的办公室。客户越来越多，名气越来越大。' },
                                { name: '老张', portrait: 'npc', text: '照这个势头，再过一年咱们就能在行业里站稳脚跟了！' },
                                { name: '你', portrait: 'player', text: '......但我听说，有几家大公司已经注意到我们了。' },
                                { name: '旁白', portrait: 'narrator', text: '雨云正在远处聚集。更大的考验，还在后面。' },
                            ],
                            buffReward: { type: 'ability', amount: 2 },
                        },
                    ];
                }

                // ========== 普通线 ==========
                return [
                    {
                        triggerX: 400,
                        dialogue: [
                            { name: '房产中介', portrait: 'npc', text: '哥，这房子首付只要两百万。您看看这地段。' },
                            { name: '你', portrait: 'player', text: '两百万......我一年才攒下五万。' },
                            { name: '房产中介', portrait: 'npc', text: '那是您的问题了。您看隔壁那位，全款买的。' },
                            { name: '旁白', portrait: 'narrator', text: '隔壁那位，撑着金色的伞从门洞里走了出来。' },
                        ],
                        buffReward: { type: 'mindset', amount: 1 },
                    },
                    {
                        triggerX: 1000,
                        dialogue: [
                            { name: '老同学', portrait: 'npc', text: '好久不见啊！听说你还单着呢？' },
                            { name: '你', portrait: 'player', text: '嗯。一个人习惯了。' },
                            { name: '老同学', portrait: 'npc', text: '我孩子都上小学了。你也该考虑考虑了，总不能一个人过一辈子。' },
                            { name: '你', portrait: 'player', text: '......我这样的人，谁会愿意跟着我淋雨呢？' },
                            { name: '老同学', portrait: 'npc', text: '唉，也是。现在的人都现实得很。没伞的人，连相亲都没人搭理。' },
                        ],
                        buffReward: { type: 'endurance', amount: 1 },
                    },
                    {
                        triggerX: 1700,
                        dialogue: [
                            { name: '撑伞的成功人士', portrait: 'lument_npc', text: '人生就是选择。我当年选择了创业，所以现在有伞。' },
                            { name: '撑伞的成功人士', portrait: 'lument_npc', text: '你选择了安稳，所以淋雨。怨不得别人。' },
                            { name: '你', portrait: 'player', text: '你创业的本金，是你父亲给的。' },
                            { name: '撑伞的成功人士', portrait: 'lument_npc', text: '......那也是我家的资源。穷，也是一种遗传。' },
                        ],
                        buffReward: { type: 'willpower', amount: 1 },
                    },
                    {
                        triggerX: 2300,
                        dialogue: [
                            { name: '老友', portrait: 'npc', text: '好久不见。你还是......在跑啊。' },
                            { name: '你', portrait: 'player', text: '不跑怎么办？停下来就淋得更湿。' },
                            { name: '老友', portrait: 'npc', text: '我以前也这么想。后来我想通了。' },
                            { name: '老友', portrait: 'npc', text: '雨不会停。伞也不会凭空出现。但跑不跑，由你决定。' },
                        ],
                        buffReward: { type: 'mindset', amount: 2 },
                    },
                ];
            },
            endDialogue: function() {
                if (playerChoices.joinedOldMan === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '夜深了。你一个人坐在空旷的客厅里。' },
                        { name: '旁白', portrait: 'narrator', text: '金伞立在门口，像一尊沉默的雕塑。' },
                        { name: '旁白', portrait: 'narrator', text: '窗外的雨声，和多年前一模一样。只是你已经不在雨中了。' },
                    ];
                }
                if (playerChoices.startedCompany === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '夜幕降临。你站在新办公室的落地窗前。' },
                        { name: '旁白', portrait: 'narrator', text: '城市的灯火在脚下延伸，雨丝在玻璃上划过。' },
                        { name: '你', portrait: 'player', text: '......终于，我们也有了自己的一片天。' },
                        { name: '旁白', portrait: 'narrator', text: '但你知道，真正的暴风雨，还在前方等着你们。' },
                    ];
                }
                return [
                    { name: '旁白', portrait: 'narrator', text: '你走到了家门口。钥匙插进锁孔的声音格外清晰。' },
                    { name: '旁白', portrait: 'narrator', text: '推开门，黑暗的房间在等着你。' },
                    { name: '旁白', portrait: 'narrator', text: '雨声被关在门外，但心里的雨，关不住。' },
                ];
            },
        },

        // ========== 第六章：商海抉择（动态剧情） ==========
        {
            id: 5,
            title: '第六章：商海抉择',
            subtitle: '事业篇 · 伞下的诱惑',
            theme: function() {
                // 创业线和老头线用办公室场景，普通线用居家场景
                if (playerChoices.startedCompany === true || playerChoices.joinedOldMan === true) {
                    return 'company_office';
                }
                return 'home';
            },
            sceneType: 'indoor',
            rainIntensity: function() {
                if (playerChoices.startedCompany === true || playerChoices.joinedOldMan === true) {
                    return 0.5;
                }
                return 0.2;
            },
            startX: 100,
            endX: 2400,
            intro: function() {
                if (playerChoices.joinedOldMan === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '你坐在老头公司的副总办公室里。' },
                        { name: '旁白', portrait: 'narrator', text: '落地窗外是城市的天际线。桌上是签不完的文件。' },
                        { name: '你', portrait: 'player', text: '（这就是撑伞人的生活吗......好像也没那么轻松。）' },
                    ];
                }
                if (playerChoices.startedCompany === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '一年后。微光科技搬进了写字楼的高层。' },
                        { name: '旁白', portrait: 'narrator', text: '员工从十人变成了三十人。客户名单越来越长。' },
                        { name: '老张', portrait: 'npc', text: '咱们公司现在在行业里也算小有名气了！' },
                        { name: '你', portrait: 'player', text: '......但越是往上走，越觉得高处不胜寒。' },
                    ];
                }
                return [
                    { name: '旁白', portrait: 'narrator', text: '你回到家中。一室一厅，窗外雨声不断。' },
                    { name: '旁白', portrait: 'narrator', text: '昏暗的灯光下，房间显得格外空旷。' },
                    { name: '你', portrait: 'player', text: '......又是只有自己一个人的夜晚。' },
                    { name: '旁白', portrait: 'narrator', text: '你坐在床边，回想着这些年走过的路。' },
                ];
            },
            // 动态生成encounters（函数形式，进入章节时调用）
            encounters: function() {
                const list = [];

                // ========== 创业路线：公司做大 → 权贵找上门 → 选择 → 做局 ==========
                if (playerChoices.startedCompany === true && playerChoices.joinedOldMan !== true) {
                    // 创业剧情1：公司蒸蒸日上
                    list.push({
                        triggerX: 300,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '公司的业绩连续三个季度增长。' },
                            { name: '老张', portrait: 'npc', text: '这个季度的利润比去年翻了一倍！' },
                            { name: '老张', portrait: 'npc', text: '咱们再熬两年，就能买自己的办公楼了！' },
                            { name: '你', portrait: 'player', text: '......先别高兴太早。树大招风。' },
                        ],
                        buffReward: { type: 'ability', amount: 1 },
                    });

                    // 创业剧情2：权贵找上门
                    list.push({
                        triggerX: 700,
                        dialogue: [
                            { name: '秘书', portrait: 'npc', text: '张总，有人找您。说是......商务局的王处长。' },
                            { name: '你', portrait: 'player', text: '商务局？我们好像没什么业务往来......' },
                            { name: '王处长', portrait: 'lument_npc', text: '张总年轻有为啊！这么短的时间就把公司做这么大。' },
                            { name: '王处长', portrait: 'lument_npc', text: '不过呢，这做生意嘛，光靠自己是走不远的。得有人照应。' },
                            { name: '王处长', portrait: 'lument_npc', text: '我上头有人，手里有不少资源。咱们......可以合作合作。' },
                        ],
                        buffReward: { type: 'experience', amount: 1 },
                    });

                    // 创业剧情3：选择是否迎合权贵
                    list.push({
                        triggerX: 1100,
                        dialogue: [
                            { name: '老张', portrait: 'npc', text: '王处长的意思很明显了......想让我们站到他的伞下。' },
                            { name: '老张', portrait: 'npc', text: '如果答应他，以后项目、资金都不用愁了。但代价是......' },
                            { name: '你', portrait: 'player', text: '代价是公司的控制权，还有我们的底线。' },
                            {
                                name: '你', portrait: 'player',
                                text: '你说，我们该怎么办？',
                                choices: [
                                    { text: '答应合作，站到权贵的伞下', next: 5, choiceKey: 'cater_yes' },
                                    { text: '婉言拒绝，靠自己的实力走下去', next: 7, choiceKey: 'cater_no' },
                                ]
                            },
                            // cater_yes path (5-6)
                            { name: '你', portrait: 'player', text: '......告诉王处长，我们同意合作。' },
                            { name: '老张', portrait: 'npc', text: '你确定吗？这一步迈出去，就回不了头了。' },
                            { name: '旁白', portrait: 'narrator', text: '你沉默了。窗外的雨，下得更大了。', end: true },
                            // cater_no path (7-8)
                            { name: '你', portrait: 'player', text: '告诉王处长，谢谢他的好意，但我们想自己走。' },
                            { name: '老张', portrait: 'npc', text: '......好。我陪你。大不了，从头再来！' },
                            { name: '旁白', portrait: 'narrator', text: '你知道这个选择意味着什么。暴风雨，要来了。', end: true },
                        ],
                        buffReward: { type: 'mindset', amount: 2 },
                        reResolveOnChoice: true,
                        onChoice: function(choice) {
                            if (choice.choiceKey === 'cater_yes') {
                                playerChoices.cateredToPower = true;
                            } else {
                                playerChoices.cateredToPower = false;
                            }
                        },
                    });

                    // 创业剧情4：如果不迎合 → 做局
                    if (playerChoices.cateredToPower === false) {
                        // 新增：暗流涌动——最初的排挤
                        list.push({
                            triggerX: 1300,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '拒绝王处长后的第一周。表面上什么都没发生。' },
                                { name: '旁白', portrait: 'narrator', text: '但你注意到——行业群里没人@你了。以前每周都有人约你吃饭，现在手机安安静静。' },
                                { name: '老张', portrait: 'npc', text: '奇怪......城南那个项目招标，我们的标书被退回来了。说是"资质不符"。' },
                                { name: '你', portrait: 'player', text: '资质不符？我们做了三年，资质从来没问题。' },
                                { name: '老张', portrait: 'npc', text: '我去问过，对方说"上面的意思"。我问上面是谁，他们不说了。' },
                                { name: '旁白', portrait: 'narrator', text: '你站在窗前。雨还在下。你知道这是开始，不是结束。' },
                                { name: '你', portrait: 'player', text: '......他们要让我们知难而退。' },
                            ],
                            buffReward: { type: 'willpower', amount: 1 },
                        });

                        // 新增：旧友的警告——你不知道水有多深
                        list.push({
                            triggerX: 1450,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '一个行业里的老前辈约你喝茶。你们认识很多年了。' },
                                { name: '老前辈', portrait: 'lument_npc', text: '小张，听说你拒绝了王处长？' },
                                { name: '你', portrait: 'player', text: '消息传得真快。' },
                                { name: '老前辈', portrait: 'lument_npc', text: '这个行业就这么大。你拒绝他，就等于拒绝了整个圈子。' },
                                { name: '你', portrait: 'player', text: '我只是不想弯腰。' },
                                { name: '老前辈', portrait: 'lument_npc', text: '我知道。但你得知道——上一个拒绝他的人，公司三个月就倒了。' },
                                { name: '老前辈', portrait: 'lument_npc', text: '不是正常的商业竞争。是全方位的绞杀——客户、供应商、银行、甚至工商税务。' },
                                { name: '老前辈', portrait: 'lument_npc', text: '他没有动手。他只是给一些人打了几个电话。然后......伞就收了。' },
                                { name: '你', portrait: 'player', text: '......您是劝我回去道歉？' },
                                { name: '老前辈', portrait: 'lument_npc', text: '我劝你想清楚。你一个人撑伞，撑不过暴风雨。' },
                                { name: '老前辈', portrait: 'lument_npc', text: '但如果一定要走......就把证据留好。他做过的那些事，不止你知道。' },
                                { name: '旁白', portrait: 'narrator', text: '老前辈起身走了。茶凉了。你坐了很久。' },
                                { name: '你', portrait: 'player', text: '（......他说"把证据留好"。他知道多少？）' },
                            ],
                            buffReward: { type: 'knowledge', amount: 1 },
                        });

                        list.push({
                            triggerX: 1600,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '拒绝王处长一个月后。暴风雨如期而至。' },
                                { name: '老张', portrait: 'npc', text: '不好了！三家大客户同时终止了合同！' },
                                { name: '老张', portrait: 'npc', text: '供应商那边也说原材料紧张，要涨价30%！' },
                                { name: '老张', portrait: 'npc', text: '还有银行......之前说好的贷款批不下来了！' },
                                { name: '旁白', portrait: 'narrator', text: '这就是权贵的"做局"。你不肯站在他们的伞下，他们就让你淋到死。' },
                                {
                                    name: '你', portrait: 'player',
                                    text: '......',
                                    choices: [
                                        { text: '正面迎战，收集证据，用法律和舆论反击', next: 6, choiceKey: 'fight_back' },
                                        { text: '先稳住局面，想办法撑过去再说', next: 8, choiceKey: 'survive_first' },
                                    ]
                                },
                                // fight_back path (6-7)
                                { name: '旁白', portrait: 'narrator', text: '你找律师，找媒体，找一切能找到的武器。' },
                                { name: '旁白', portrait: 'narrator', text: '你淋了半辈子的雨，这一次，你不会再退缩。', end: true },
                                // survive_first path (8-9)
                                { name: '旁白', portrait: 'narrator', text: '你试图周旋，但对方的网太密了。' },
                                { name: '旁白', portrait: 'narrator', text: '每一条路都被堵死。雨越下越大。', end: true },
                            ],
                            buffReward: { type: 'willpower', amount: 2 },
                            nextChapter: true,
                            onChoice: function(choice) {
                                if (choice.choiceKey === 'fight_back') {
                                    playerChoices.overcameScheme = 'pending';
                                } else {
                                    playerChoices.overcameScheme = false;
                                }
                            },
                        });
                    } else {
                        // 如果迎合了权贵 → 腐化过渡 → 进入终局
                        // 腐化过渡1：初尝甜头
                        list.push({
                            triggerX: 1600,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '站到王处长的伞下后，一切变得顺利起来。' },
                                { name: '旁白', portrait: 'narrator', text: '项目审批一路绿灯，银行贷款三天到账。曾经拒绝你们的前台，现在主动上门拜访。' },
                                { name: '老张', portrait: 'npc', text: '公司市值翻了三倍......但总觉得哪里不对。' },
                                { name: '你', portrait: 'player', text: '有什么不对的？这就是我们想要的，不是吗？' },
                                { name: '老张', portrait: 'npc', text: '王处长上次让你走账的那笔钱......' },
                                { name: '你', portrait: 'player', text: '那叫灵活经营。别想太多，老张。' },
                                { name: '旁白', portrait: 'narrator', text: '你说出"灵活经营"四个字时，自己都没察觉到语气里的冷淡。' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        });

                        // 腐化过渡2：疏远旧友
                        list.push({
                            triggerX: 1850,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '三个月后。你搬进了独立办公室，配了专职秘书和司机。' },
                                { name: '老张', portrait: 'npc', text: '小王，最近约你吃饭总约不上......' },
                                { name: '老张', portrait: 'npc', text: '上次改方案到凌晨的事，还记得吗？那时候咱们一碗面都吃得开心。' },
                                { name: '你', portrait: 'player', text: '老张，人要往前看。格局要大一点，别总拘着过去。' },
                                { name: '老张', portrait: 'npc', text: '......格局？' },
                                { name: '你', portrait: 'player', text: '公司要上市了，你把技术那块抓好就行。社交的事，我来。' },
                                { name: '旁白', portrait: 'narrator', text: '老张沉默了。你挂掉电话，觉得他说的话越来越不入耳了。' },
                                { name: '旁白', portrait: 'narrator', text: '你没有意识到——你已经开始用"格局"这个词，就像当年那些撑伞的人对你说的一样。' },
                            ],
                            buffReward: { type: 'resume', amount: 1 },
                        });

                        // 新增：越过红线——第一次做假账
                        list.push({
                            triggerX: 1950,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '一个月后的深夜。王处长打来电话。' },
                                { name: '王处长', portrait: 'lument_npc', text: '小张，有件事需要你配合。城南项目有一笔款项，需要走你们公司的账。' },
                                { name: '你', portrait: 'player', text: '走账？什么意思？' },
                                { name: '王处长', portrait: 'lument_npc', text: '很简单。你们公司代收一笔"咨询费"，扣完税后转到一个指定账户。' },
                                { name: '你', portrait: 'player', text: '......这笔钱的实际来源是？' },
                                { name: '王处长', portrait: 'lument_npc', text: '你不需要知道来源。你只需要知道——配合了，以后城南所有项目都是你的。不配合......' },
                                { name: '王处长', portrait: 'lument_npc', text: '算了，不配合也行。但上次那笔贷款，银行可能会重新评估。' },
                                { name: '旁白', portrait: 'narrator', text: '你坐在办公桌前。桌上是那份需要签字的文件。' },
                                { name: '你', portrait: 'player', text: '......' },
                                { name: '旁白', portrait: 'narrator', text: '你想起老张的话——"王处长上次让你走账的那笔钱"。老张已经警告过你了。' },
                                { name: '你', portrait: 'player', text: '（签了，就是同谋。不签，公司可能就没了。三十个人的饭碗......）' },
                                { name: '旁白', portrait: 'narrator', text: '你拿起笔。笔尖悬在纸面上方，停了很久。' },
                                { name: '你', portrait: 'player', text: '......就这一次。下不为例。' },
                                { name: '旁白', portrait: 'narrator', text: '你签了。笔划过纸面的声音很轻，但你觉得像是撕开了什么。' },
                                { name: '旁白', portrait: 'narrator', text: '从这一刻起，你不再只是"迎合"。你是同谋。' },
                                { name: '你', portrait: 'player', text: '（......就这一次。）' },
                                { name: '旁白', portrait: 'narrator', text: '每一个越界的人，都对自己说过这四个字。' },
                            ],
                            buffReward: { type: 'experience', amount: 1 },
                        });

                        // 腐化过渡3：高傲成型
                        list.push({
                            triggerX: 2050,
                            dialogue: [
                                { name: '旁白', portrait: 'narrator', text: '半年后。你出席行业峰会，身边簇拥着各路奉承者。' },
                                { name: '下属', portrait: 'lument_npc', text: '张总，外面有个叫老张的，说是您的合伙人，想见您。' },
                                { name: '你', portrait: 'player', text: '......不见。跟他说我在开会。' },
                                { name: '下属', portrait: 'lument_npc', text: '好的。另外，楼下有个淋雨的年轻人在找您投简历，保安要赶他走。' },
                                { name: '你', portrait: 'player', text: '让保安处理。我没时间看什么简历。' },
                                { name: '旁白', portrait: 'narrator', text: '那个年轻人浑身湿透，手里攥着一份简历，像极了多年前的你。' },
                                { name: '旁白', portrait: 'narrator', text: '你从落地窗往下看了一眼，然后拉上了窗帘。' },
                                { name: '你', portrait: 'player', text: '（......想不起来什么感觉了。）' },
                                { name: '旁白', portrait: 'narrator', text: '你已经不会为淋雨的人停下了。金伞教会你的第一件事，就是漠视。', end: true },
                            ],
                            buffReward: { type: 'resume', amount: 1 },
                            nextChapter: true,
                        });
                    }

                    return list;
                }

                // ========== 老头路线：办公室发现秘密 → 举报/不举报 ==========
                if (playerChoices.joinedOldMan === true) {
                    // 老头线剧情1：日常——权力的惯性
                    list.push({
                        triggerX: 300,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '深夜。办公室只剩你一个人。你在处理城南项目的文件。' },
                            { name: '下属', portrait: 'lument_npc', text: '张总，这个季度的财报出来了，利润增长20%。' },
                            { name: '你', portrait: 'player', text: '知道了。告诉财务，把账做干净一点。' },
                            { name: '旁白', portrait: 'narrator', text: '说出这句话的时候，你停了一下。你曾经最讨厌说这种话的人。' },
                            { name: '下属', portrait: 'lument_npc', text: '另外张总，楼下有个老太太来上访，说我们工地占了她家的地......' },
                            { name: '你', portrait: 'player', text: '让法务去处理。这种事别来烦我。' },
                            { name: '下属', portrait: 'lument_npc', text: '好的。还有......老太太说她已经在楼下等了三天了。' },
                            { name: '你', portrait: 'player', text: '......三天？' },
                            { name: '下属', portrait: 'lument_npc', text: '是。保安赶过，她第二天又来了。' },
                            { name: '你', portrait: 'player', text: '让法务赶紧解决。别让她再在楼下待着了。' },
                            { name: '旁白', portrait: 'narrator', text: '你曾经也是那些"在楼下等着"的普通人。现在你坐在落地窗后面，用"法务"两个字把他们的声音挡在了门外。' },
                            { name: '你', portrait: 'player', text: '（......这不是我能管的事。我只管做好自己的事。）' },
                            { name: '旁白', portrait: 'narrator', text: '你又一次用这句话安慰自己。但这句话的效力越来越弱了。' },
                        ],
                        buffReward: { type: 'experience', amount: 1 },
                    });

                    // 老头线剧情2：发现保险柜的秘密
                    list.push({
                        triggerX: 750,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你需要一份旧合同。老头退居幕后前，把重要文件都锁在办公室的保险柜里。' },
                            { name: '旁白', portrait: 'narrator', text: '你拿着老头给的密码，打开了保险柜。' },
                            { name: '旁白', portrait: 'narrator', text: '合同在最上层。但你的目光被下面的东西吸引住了。' },
                            { name: '旁白', portrait: 'narrator', text: '一个牛皮纸信封。里面是......账本、合同副本、转账记录。' },
                            { name: '你', portrait: 'player', text: '这是......' },
                            { name: '旁白', portrait: 'narrator', text: '城南项目的真实合同。和公司存档的那份完全不同。' },
                            { name: '旁白', portrait: 'narrator', text: '存档的那份写着"商业开发"。这份上面写着——"关系费""顾问费""资源协调费"。' },
                            { name: '你', portrait: 'player', text: '关系费......顾问费......这些就是行贿。' },
                            { name: '旁白', portrait: 'narrator', text: '你翻了几页。数字越来越大。有给李处长的，有给王局长的，还有几个你根本不认识的名字。' },
                            { name: '旁白', portrait: 'narrator', text: '时间跨度——整整十年。' },
                            { name: '你', portrait: 'player', text: '（十年......从我还在雨里跑的时候，他就开始了。）' },
                        ],
                        buffReward: { type: 'mindset', amount: 1 },
                    });

                    // 老头线剧情3：深入了解——受害者的面孔
                    list.push({
                        triggerX: 1150,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你没有立刻关上保险柜。你继续翻看那些文件。' },
                            { name: '旁白', portrait: 'narrator', text: '在账本最后一页，你发现了一份上访记录的复印件。' },
                            { name: '旁白', portrait: 'narrator', text: '那个在楼下等了三天的老太太——她的名字在上访名单上。' },
                            { name: '旁白', portrait: 'narrator', text: '城南那块地，是强拆来的。补偿款被层层截留，到她手里的不到应得的十分之一。' },
                            { name: '旁白', portrait: 'narrator', text: '而截留的那些钱，变成了账本上的"关系费"。' },
                            { name: '你', portrait: 'player', text: '......' },
                            { name: '旁白', portrait: 'narrator', text: '你又翻到了一份工伤赔偿协议。一个工人断了三根手指，赔了两万块。协议上写着"双方已达成一致"。' },
                            { name: '旁白', portrait: 'narrator', text: '签字栏上，那个工人的手印歪歪扭扭的——大概是用断指的手按的。' },
                            { name: '你', portrait: 'player', text: '（......两万块。三根手指。两万块。）' },
                            { name: '旁白', portrait: 'narrator', text: '你曾经淋着雨送外卖，一单赚五块钱。你知道两万块意味着什么。你也知道三根手指意味着什么。' },
                            { name: '你', portrait: 'player', text: '（老头......你到底做了多少这样的事？）' },
                        ],
                        buffReward: null,
                    });

                    // 新增：亲访受害者——真实的重量
                    list.push({
                        triggerX: 1350,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你做了一个决定——去找那个老太太。' },
                            { name: '旁白', portrait: 'narrator', text: '城南旧改区。你已经很久没来过这种地方了。' },
                            { name: '旁白', portrait: 'narrator', text: '巷子很窄，墙上刷着"拆"字。你穿着西装走过，像是另一个世界的人。' },
                            { name: '你', portrait: 'player', text: '（......我以前就住在这种巷子里。走的时候发誓再也不回来。现在......是为了查案回来的。）' },
                            { name: '旁白', portrait: 'narrator', text: '你找到了那个门牌号。敲了三下门。' },
                            { name: '老太太', portrait: 'npc', text: '谁啊？' },
                            { name: '旁白', portrait: 'narrator', text: '门开了。一个头发花白的老太太，背已经驼了。她看了你一眼，又看了你的西装。' },
                            { name: '老太太', portrait: 'npc', text: '你......你是那个公司的人？我不走！这房子是我老伴留下的！你们拆了我住哪！' },
                            { name: '你', portrait: 'player', text: '阿姨，我不是来赶您走的。我......我想问您一些事。' },
                            { name: '老太太', portrait: 'npc', text: '问什么？补偿款只给了两万块，说是按面积算的。我那房子八十平！两万块你让我去哪买房子？' },
                            { name: '老太太', portrait: 'npc', text: '我去他们公司找过，等了三天，没人理我。后来来了个人说再闹就拘留我。' },
                            { name: '老太太', portrait: 'npc', text: '我老伴走了，儿子在外地打工。就我一个人......我能去哪呢？' },
                            { name: '你', portrait: 'player', text: '......阿姨，对不起。' },
                            { name: '老太太', portrait: 'npc', text: '你道什么歉？又不是你拆的。你是好人，看着不像那些人。' },
                            { name: '旁白', portrait: 'narrator', text: '你站在她家门口，看着屋里昏暗的灯光和一张破旧的方桌。' },
                            { name: '旁白', portrait: 'narrator', text: '账本上"关系费"的数字，在这间屋子里变成了一个活生生的老人。' },
                            { name: '你', portrait: 'player', text: '（......她的两万块补偿款，变成了一笔"关系费"。给了一个她这辈子都不会认识的人。）' },
                            { name: '你', portrait: 'player', text: '（而我......就坐在那笔钱的另一端。）' },
                            { name: '旁白', portrait: 'narrator', text: '你留下了一些钱，没有说自己的名字。走出巷子时，雨开始下了。你没有撑伞。' },
                        ],
                        buffReward: { type: 'willpower', amount: 2 },
                    });

                    // 老头线剧情4：与老头的对话——试探
                    list.push({
                        triggerX: 1550,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '第二天。你给老头打了个电话。你没有直接说保险柜的事，只是试探。' },
                            { name: '你', portrait: 'player', text: '张老，城南项目的账我看了。有个地方不太明白。' },
                            { name: '老人', portrait: 'npc', text: '什么地方？' },
                            { name: '你', portrait: 'player', text: '有一笔"顾问费"，收款方我不太认识。' },
                            { name: '老人', portrait: 'npc', text: '......那是给中间人的。你不用管这些。' },
                            { name: '你', portrait: 'player', text: '可是金额很大......如果审计查到的话......' },
                            { name: '老人', portrait: 'npc', text: '小王。' },
                            { name: '老人', portrait: 'npc', text: '你是我一手带出来的人。我信任你，才把公司交给你。' },
                            { name: '老人', portrait: 'npc', text: '有些事，你不需要知道为什么。你只需要知道——这些都是行业惯例。每个公司都这么干。' },
                            { name: '老人', portrait: 'npc', text: '你是想当那个"不合群"的人，还是想继续撑着这把伞？' },
                            { name: '你', portrait: 'player', text: '......' },
                            { name: '老人', portrait: 'npc', text: '好好想想吧。别让我失望。' },
                            { name: '旁白', portrait: 'narrator', text: '电话挂了。你坐在办公室里，手里攥着那本账本。' },
                        ],
                        buffReward: { type: 'willpower', amount: 1 },
                    });

                    // 新增：心腹的警告——更深的深渊
                    list.push({
                        triggerX: 1750,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '那天傍晚。你的心腹秘书小林敲门进来，犹豫了很久才开口。' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '王总......有件事我不知道该不该说。' },
                            { name: '你', portrait: 'player', text: '什么事？' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '我之前帮张老先生整理过私人文件。有些东西......我看到了，一直不敢说。' },
                            { name: '你', portrait: 'player', text: '你看到了什么？' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '张老先生......他在您之前，还带过三个人。都是年轻人，都是从基层做起。' },
                            { name: '你', portrait: 'player', text: '三个人？我怎么不知道？' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '第一个，五年前走了。说是辞职。但我看过他的离职记录——是被辞退的。' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '第二个，三年前。出了一场车祸。事故认定是对方全责。但那个司机......是张老先生名下公司的员工。' },
                            { name: '你', portrait: 'player', text: '......' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '第三个，一年半前。他发现了保险柜里的东西，跟张老先生摊了牌。' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '后来他......消失了。不是离职，是消失。公司里没有人再提起他。' },
                            { name: '你', portrait: 'player', text: '消失？什么意思？' },
                            { name: '秘书小林', portrait: 'lument_npc', text: '王总，我说这些......是因为您跟他们不一样。您是好人。我不想看您......' },
                            { name: '你', portrait: 'player', text: '够了。我知道了。你出去吧。' },
                            { name: '旁白', portrait: 'narrator', text: '小林走了。你坐在椅子上，手心全是汗。' },
                            { name: '你', portrait: 'player', text: '（......三个人。在我之前，有三个人坐过我这把椅子。）' },
                            { name: '你', portrait: 'player', text: '（他们的下场......辞职、车祸、消失。）' },
                            { name: '你', portrait: 'player', text: '（老头......你到底是恩人，还是......）' },
                            { name: '旁白', portrait: 'narrator', text: '你不敢往下想。但恐惧像藤蔓一样缠了上来。' },
                        ],
                        buffReward: { type: 'endurance', amount: 2 },
                    });

                    // 老头线剧情5：深夜独白——回忆与挣扎
                    list.push({
                        triggerX: 1950,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '那一晚，你一夜未眠。' },
                            { name: '旁白', portrait: 'narrator', text: '你坐在窗前，看着外面的雨。金伞立在墙角，在月光下泛着冷光。' },
                            { name: '你', portrait: 'player', text: '老头帮过我。没有他，我还在雨里跑。这是事实。' },
                            { name: '你', portrait: 'player', text: '但他做的事......那个老太太等了三天。那个工人断了三根手指。' },
                            { name: '你', portrait: 'player', text: '这些也是事实。' },
                            { name: '旁白', portrait: 'narrator', text: '你想起当年在雨里奔跑的自己。你想起了那句"总有人会为你撑一把伞"。' },
                            { name: '你', portrait: 'player', text: '老头替我撑了伞。但他这把伞下面，压着多少淋雨的人？' },
                            { name: '旁白', portrait: 'narrator', text: '你想起老头说过的话——"在伞下的世界里，最大的敌人不是雨，是撑伞的人。"' },
                            { name: '你', portrait: 'player', text: '他说得对。撑伞的人......就是他自己。' },
                            { name: '旁白', portrait: 'narrator', text: '雨声很大。像是在催促你做决定。' },
                        ],
                        buffReward: { type: 'endurance', amount: 1 },
                    });

                    // 老头线剧情6：抉择
                    list.push({
                        triggerX: 2250,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '天快亮了。你站在保险柜前。账本就在你手里。' },
                            {
                                name: '你', portrait: 'player',
                                text: '我该怎么办？',
                                choices: [
                                    { text: '向有关部门举报老头', next: 5, choiceKey: 'report_oldman' },
                                    { text: '顾及他帮过你的恩情，选择沉默', next: 7, choiceKey: 'protect_oldman' },
                                ]
                            },
                            // report_oldman path (5-6)
                            { name: '旁白', portrait: 'narrator', text: '你拿起电话，拨通了举报热线。' },
                            { name: '你', portrait: 'player', text: '......我要举报。我有证据。' },
                            { name: '旁白', portrait: 'narrator', text: '电话那头沉默了几秒，然后说："请说出您的姓名和举报内容。"' },
                            { name: '旁白', portrait: 'narrator', text: '你报出了自己的名字。你淋过雨，你知道被人做局的滋味。你不能让别人继续被他的"伞"所遮蔽。' },
                            { name: '你', portrait: 'player', text: '对不起，张老。但有些事，总得有人做。', end: true },
                            // protect_oldman path (7-8)
                            { name: '你', portrait: 'player', text: '......算了。他帮过我。我欠他一份恩情。' },
                            { name: '旁白', portrait: 'narrator', text: '你把账本放回了保险柜。关上门，锁好。' },
                            { name: '旁白', portrait: 'narrator', text: '你假装什么都没看到。但你心里清楚——有些东西一旦看到，就再也装不回去了。' },
                            { name: '你', portrait: 'player', text: '（......也许有一天，一切都会好起来的。也许吧。）', end: true },
                        ],
                        buffReward: null,
                        nextChapter: true,
                        onChoice: function(choice) {
                            if (choice.choiceKey === 'report_oldman') {
                                playerChoices.reportedOldMan = true;
                            } else {
                                playerChoices.reportedOldMan = false;
                            }
                        },
                    });

                    return list;
                }

                // ========== 普通路线：居家场景 ==========
                // 普通线剧情1：电视新闻
                list.push({
                    triggerX: 300,
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你打开电视，新闻正在播放财经报道。' },
                        { name: '新闻主播', portrait: 'narrator', text: '......本市某知名企业家因涉嫌多项经济犯罪今日被依法逮捕......' },
                        { name: '你', portrait: 'player', text: '（又是一个大人物落马了......）' },
                        { name: '新闻主播', portrait: 'narrator', text: '......据知情人士透露，此案牵涉甚广，多名高管已被带走调查......' },
                        { name: '旁白', portrait: 'narrator', text: '你关掉电视。房间里又安静了。只有窗外的雨声。' },
                    ],
                    buffReward: { type: 'experience', amount: 1 },
                });

                // 普通线剧情2：旧照片
                list.push({
                    triggerX: 650,
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你走到书架前，拿起一张泛黄的照片。' },
                        { name: '旁白', portrait: 'narrator', text: '照片上是大学毕业时的你，笑容灿烂，眼神里有光。' },
                        { name: '你', portrait: 'player', text: '那时候......我还相信努力就能改变一切。' },
                        { name: '旁白', portrait: 'narrator', text: '照片旁边是一张相亲时的合影，对方表情勉强。后来就没有后来了。' },
                        { name: '你', portrait: 'player', text: '......没钱没伞的人，连被爱的资格都没有。' },
                        { name: '旁白', portrait: 'narrator', text: '你放下照片。书架上没有其他人的痕迹。' },
                    ],
                    buffReward: { type: 'mindset', amount: 1 },
                });

                // 普通线剧情3：同学婚礼请柬
                list.push({
                    triggerX: 1000,
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你收到一封快递，是大学同学的婚礼请柬。' },
                        { name: '旁白', portrait: 'narrator', text: '照片上的新郎你认识，是当年和你一起面试但因为有关系被录用的那个同学。' },
                        { name: '你', portrait: 'player', text: '......又一个走进人生下一阶段的人。' },
                        { name: '旁白', portrait: 'narrator', text: '请柬上写着"诚邀您参加"。你默默把请柬放在了桌上。' },
                        { name: '你', portrait: 'player', text: '连伴手礼都凑不齐......还是不去了吧。' },
                    ],
                    buffReward: { type: 'endurance', amount: 1 },
                });

                // 普通线剧情4：崩溃边缘（窗台）
                list.push({
                    triggerX: 1700,
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '深夜。你一个人坐在窗前，看着窗外的雨。' },
                        { name: '旁白', portrait: 'narrator', text: '那些有伞的人的嘲讽声在耳边回响......' },
                        { name: '旁白', portrait: 'narrator', text: '"穷鬼""落汤鸡""一辈子买不起伞"......' },
                        { name: '旁白', portrait: 'narrator', text: '人到中年，一事无成，无人相伴。你感到前所未有的疲惫。' },
                        { name: '你', portrait: 'player', text: '......到底有什么意义呢？' },
                        {
                            name: '你', portrait: 'player',
                            text: '窗外的雨下个不停。你站在窗台边，往下看去......',
                            choices: [
                                { text: '退后一步。不管多难，还是要走下去。', next: 6, choiceKey: 'keep_going' },
                                { text: '......跳下去吧。', next: 8, choiceKey: 'give_up', ending: 'false_death' },
                            ]
                        },
                        // keep_going path (6-7)
                        { name: '旁白', portrait: 'narrator', text: '你退后了一步。关上了窗户。' },
                        { name: '旁白', portrait: 'narrator', text: '雨还在下。但你决定，再走一程。', end: true },
                        // give_up path (8-9)
                        { name: '旁白', portrait: 'narrator', text: '你闭上了眼睛。' },
                        { name: '旁白', portrait: 'narrator', text: '前倾......然后，风声消失了。一切归于寂静。', end: true },
                    ],
                    buffReward: null,
                    nextChapter: true,
                    onChoice: function(choice) {
                        if (choice.choiceKey === 'give_up') {
                            playerChoices.gaveUp = true;
                        } else {
                            playerChoices.gaveUp = false;
                        }
                    },
                });

                return list;
            },
            endDialogue: function() {
                if (playerChoices.joinedOldMan === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '城市的灯火在夜色中闪烁。' },
                        { name: '旁白', portrait: 'narrator', text: '你做出了选择。无论对错，都要走到底。' },
                        { name: '旁白', portrait: 'narrator', text: '最后一程路，就在前方。' },
                    ];
                }
                if (playerChoices.startedCompany === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '办公室的灯亮了一整夜。' },
                        { name: '旁白', portrait: 'narrator', text: '窗外的雨，和你心中的风暴比起来，不值一提。' },
                        { name: '旁白', portrait: 'narrator', text: '明天，一切都会有个结果。' },
                    ];
                }
                return [
                    { name: '旁白', portrait: 'narrator', text: '清晨的微光透过窗帘。雨势渐小。' },
                    { name: '旁白', portrait: 'narrator', text: '你站起身来，看着镜中苍老的自己。' },
                    { name: '旁白', portrait: 'narrator', text: '半生走过，那些选择已经无法回头。' },
                    { name: '旁白', portrait: 'narrator', text: '但你还有最后一程路要走。' },
                ];
            },
        },

        // ========== 第七章：终局万象 ==========
        {
            id: 6,
            title: '第七章：终局万象',
            subtitle: '世界篇 · 雨的尽头',
            theme: 'finale',
            sceneType: 'outdoor',
            rainIntensity: function() {
                // 迎合权贵和加入老头后雨小了（撑伞了），其他路线雨更大
                if (playerChoices.cateredToPower === true || playerChoices.joinedOldMan === true) return 0.5;
                return 1.5;
            },
            startX: 100,
            endX: 2400,
            intro: function() {
                if (playerChoices.cateredToPower === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '你坐在豪车的后座上，窗外是暴雨中的城市。' },
                        { name: '旁白', portrait: 'narrator', text: '司机撑着伞在前面开路。你下车时，有人递上文件，有人递上茶。' },
                        { name: '你', portrait: 'player', text: '这就是......撑伞人的世界。' },
                        { name: '旁白', portrait: 'narrator', text: '你曾经淋过的雨，现在已经和你无关了。至少你是这么认为的。' },
                    ];
                }
                if (playerChoices.joinedOldMan === true) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '你撑着金伞走在街上。路人纷纷避让。' },
                        { name: '旁白', portrait: 'narrator', text: '这是你的世界——伞下的世界。雨打在伞面上，发出沉闷的声响。' },
                        { name: '你', portrait: 'player', text: '一切都结束了......或者说，一切才刚刚开始。' },
                    ];
                }
                if (playerChoices.startedCompany === true && playerChoices.cateredToPower === false) {
                    return [
                        { name: '旁白', portrait: 'narrator', text: '暴风雨过后，你走在满目疮痍的街道上。' },
                        { name: '旁白', portrait: 'narrator', text: '公司还在不在，已经不重要了。重要的是你还站着。' },
                        { name: '你', portrait: 'player', text: '......最后一程了。' },
                    ];
                }
                return [
                    { name: '旁白', portrait: 'narrator', text: '这是最后一程。城市的心脏，权力的中心。' },
                    { name: '旁白', portrait: 'narrator', text: '所有的街道都通向这里。所有的雨，都汇聚于此。' },
                    { name: '你', portrait: 'player', text: '......半辈子了。雨一直没停过。' },
                    { name: '旁白', portrait: 'narrator', text: '现在，该面对这一切了。' },
                ];
            },
            encounters: function() {
                const list = [];

                // ========== 迎合权贵路线：独白场景 ==========
                if (playerChoices.cateredToPower === true) {
                    list.push({
                        triggerX: 400,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你站在公司顶层的落地窗前。楼下是暴雨中的城市。' },
                            { name: '旁白', portrait: 'narrator', text: '秘书端来咖啡。司机在楼下等候。一切都很完美。' },
                            { name: '你', portrait: 'player', text: '曾经我连一碗面都要犹豫。现在......一瓶酒抵得上普通人一年的工资。' },
                            { name: '旁白', portrait: 'narrator', text: '你想起老张。上个月他给你发消息说身体不太好，想见见你。' },
                            { name: '旁白', portrait: 'narrator', text: '你让秘书回了句"张总最近很忙"。' },
                            { name: '你', portrait: 'player', text: '（......他应该能理解吧。人往高处走。）' },
                        ],
                        buffReward: null,
                    });
                    list.push({
                        triggerX: 1000,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你参加了一个高端酒会。觥筹交错间，你见到了王处长。' },
                            { name: '王处长', portrait: 'lument_npc', text: '小张啊，你学得很快。当初的选择是对的吧？' },
                            { name: '你', portrait: 'player', text: '多谢王处长提携。' },
                            { name: '王处长', portrait: 'lument_npc', text: '不过记住，伞是我给你的。哪天我不高兴了，收回来，你就还是那个淋雨的。' },
                            { name: '你', portrait: 'player', text: '......我明白。' },
                            { name: '旁白', portrait: 'narrator', text: '你笑着碰杯。但笑容下面是什么，你自己也说不清了。' },
                        ],
                        buffReward: null,
                    });
                    // 新增：老张的最后一通电话——断裂的纽带
                    list.push({
                        triggerX: 1350,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '酒会后的深夜。你的手机响了。是老张。' },
                            { name: '老张', portrait: 'npc', text: '小王......我刚从医院出来。' },
                            { name: '你', portrait: 'player', text: '医院？你怎么了？' },
                            { name: '老张', portrait: 'npc', text: '胃出血。医生说是压力太大。' },
                            { name: '老张', portrait: 'npc', text: '小王，公司上市的事......我最近一直在想。我们当初创业，是为了不再淋雨。' },
                            { name: '老张', portrait: 'npc', text: '但现在......你变成了撑伞的人。而我......我感觉自己被挤到伞外面去了。' },
                            { name: '你', portrait: 'player', text: '老张，你在说什么？公司上市对大家都好......' },
                            { name: '老张', portrait: 'npc', text: '是吗？那我为什么越来越看不懂你了？' },
                            { name: '老张', portrait: 'npc', text: '上次走账的事，我查了。那笔钱不是咨询费，是洗钱。' },
                            { name: '老张', portrait: 'npc', text: '小王，你是不是已经回不了头了？' },
                            { name: '你', portrait: 'player', text: '......老张，你不懂。有些事身不由己。' },
                            { name: '老张', portrait: 'npc', text: '身不由己？当初拒绝王处长的时候，你可不是这么说的。' },
                            { name: '老张', portrait: 'npc', text: '那时候你说"就算重来一次，我还是不会弯腰"。' },
                            { name: '老张', portrait: 'npc', text: '现在你弯了。弯得比谁都深。' },
                            { name: '旁白', portrait: 'narrator', text: '电话里沉默了很久。' },
                            { name: '老张', portrait: 'npc', text: '......算了。你保重吧。' },
                            { name: '旁白', portrait: 'narrator', text: '电话挂了。你看着屏幕发呆。然后你把老张的号码设为了"免打扰"。' },
                            { name: '你', portrait: 'player', text: '（......他不懂。他不站在这个位置上，他不懂。）' },
                            { name: '旁白', portrait: 'narrator', text: '你用这句话堵住了最后一丝愧疚。但你知道——你堵住的不是愧疚，是你和过去最后的连接。' },
                        ],
                        buffReward: { type: 'mindset', amount: 1 },
                    });
                    list.push({
                        triggerX: 1700,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '酒会散场。你站在门口，等司机把车开过来。' },
                            { name: '旁白', portrait: 'narrator', text: '一个浑身湿透的年轻人跑过来，递上一份简历。' },
                            { name: '年轻人', portrait: 'npc', text: '先生，我是来应聘的......我等了很久了......' },
                            { name: '保安', portrait: 'lument_npc', text: '去去去！别挡路！' },
                            { name: '你', portrait: 'player', text: '......' },
                            { name: '旁白', portrait: 'narrator', text: '你看着他。他的鞋湿透了，手里攥着一份被雨水打湿的简历。像极了二十年前的你。' },
                            { name: '你', portrait: 'player', text: '......让保安处理吧。' },
                            { name: '旁白', portrait: 'narrator', text: '你上了车。车门关上的那一刻，雨声被隔绝在外。你再也没有回头。' },
                            { name: '旁白', portrait: 'narrator', text: '你已经忘记了淋雨是什么感觉了。', end: true },
                        ],
                        buffReward: null,
                    });
                    return list;
                }

                // ========== 老头路线（举报）：离开前的最后一天 ==========
                if (playerChoices.joinedOldMan === true && playerChoices.reportedOldMan === true) {
                    list.push({
                        triggerX: 400,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '举报之后，老头被带走了。公司上下人心惶惶。' },
                            { name: '下属', portrait: 'lument_npc', text: '张总，外面来了很多记者......' },
                            { name: '你', portrait: 'player', text: '让他们等着。我需要静一静。' },
                            { name: '旁白', portrait: 'narrator', text: '你坐在老头曾经的办公室里。桌上还摆着他的茶杯，茶已经凉了。' },
                            { name: '你', portrait: 'player', text: '他帮过我。如果不是他，我可能还在雨里跑。' },
                            { name: '你', portrait: 'player', text: '但他做的那些事......如果我不举报，还会有更多人被他的"伞"压在下面。' },
                        ],
                        buffReward: null,
                    });
                    list.push({
                        triggerX: 1000,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你收拾了办公室的私人物品。一把旧伞，几本书，一张照片。' },
                            { name: '旁白', portrait: 'narrator', text: '照片是你刚来公司时和老头的合影。他搂着你的肩膀，笑得很开心。' },
                            { name: '你', portrait: 'player', text: '......对不起，张老。但有些事，总得有人做。' },
                            { name: '旁白', portrait: 'narrator', text: '你把照片放进了箱子里。连同金伞一起。' },
                            { name: '你', portrait: 'player', text: '这把伞......我不要了。我想试试自己走。' },
                        ],
                        buffReward: null,
                    });
                    // 新增：探视老头——最后的对话
                    list.push({
                        triggerX: 1350,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '离开前，你做了一件事——去探视老头。' },
                            { name: '旁白', portrait: 'narrator', text: '看守所的会见室很小。一堵玻璃墙隔着你们。' },
                            { name: '老人', portrait: 'npc', text: '......你来了。' },
                            { name: '你', portrait: 'player', text: '张老。' },
                            { name: '老人', portrait: 'npc', text: '我早该想到是你。那本账本......我放在保险柜里，就是给你看的。' },
                            { name: '你', portrait: 'player', text: '什么？' },
                            { name: '老人', portrait: 'npc', text: '你以为我不知道你在看？我知道的。我一直在等。' },
                            { name: '老人', portrait: 'npc', text: '等一个有勇气举报我的人出现。' },
                            { name: '你', portrait: 'player', text: '......您是说，您故意让我发现？' },
                            { name: '老人', portrait: 'npc', text: '我前面带过三个人。第一个弯了腰，成了帮凶，后来被我送走了。' },
                            { name: '老人', portrait: 'npc', text: '第二个想举报，但犹豫了太久，错过了时机。最后他成了替罪羊。' },
                            { name: '老人', portrait: 'npc', text: '第三个......他没有举报，也没有弯腰。他选择了沉默。现在他还在公司，' },
                            { name: '老人', portrait: 'npc', text: '活得像个影子。' },
                            { name: '老人', portrait: 'npc', text: '你不一样。你发现了，挣扎了，然后做了选择。你没有犹豫太久。' },
                            { name: '你', portrait: 'player', text: '张老......您到底是好人还是坏人？' },
                            { name: '老人', portrait: 'npc', text: '（苦笑）你觉得一个做了三十年脏事的人，能是好人吗？' },
                            { name: '老人', portrait: 'npc', text: '我只是......在找一个人。一个能在我走后，替我把伞收了的人。' },
                            { name: '老人', portrait: 'npc', text: '伞撑太久了，下面的人会喘不过气。该收了。' },
                            { name: '你', portrait: 'player', text: '......对不起，张老。' },
                            { name: '老人', portrait: 'npc', text: '别道歉。你做了对的事。' },
                            { name: '老人', portrait: 'npc', text: '去吧。别回头。这把伞......别再撑了。' },
                            { name: '旁白', portrait: 'narrator', text: '会见时间到了。老头站起来，最后看了你一眼。' },
                            { name: '旁白', portrait: 'narrator', text: '他的背影很苍老。你突然想起第一次见到他的那天——雨中，他摔倒在路边，你扶起了他。' },
                            { name: '旁白', portrait: 'narrator', text: '一切从那个雨天开始。现在，又在雨中结束。' },
                        ],
                        buffReward: { type: 'mindset', amount: 3 },
                    });
                    list.push({
                        triggerX: 1700,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你走出公司大楼。没有司机，没有秘书，没有金伞。' },
                            { name: '旁白', portrait: 'narrator', text: '雨落在你身上。冰凉的，久违的。' },
                            { name: '你', portrait: 'player', text: '......原来淋雨是这种感觉。我差点忘了。' },
                            { name: '旁白', portrait: 'narrator', text: '一个年轻人从你身边跑过，浑身湿透。他看了你一眼。' },
                            { name: '年轻人', portrait: 'npc', text: '大叔，你也淋雨啊？前面有遮雨棚，一块儿走吧？' },
                            { name: '你', portrait: 'player', text: '......好。' },
                            { name: '旁白', portrait: 'narrator', text: '你笑了笑，跟上了他的脚步。这一次，你走在雨里，但心里是暖的。' },
                            { name: '旁白', portrait: 'narrator', text: '你要去一个没人认识你的地方，重新开始。', end: true },
                        ],
                        buffReward: null,
                    });
                    return list;
                }

                // ========== 老头路线（不举报）：等待审判 ==========
                if (playerChoices.joinedOldMan === true && playerChoices.reportedOldMan === false) {
                    list.push({
                        triggerX: 400,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你没有举报老头。日子照常过。' },
                            { name: '旁白', portrait: 'narrator', text: '但那本账本像一根刺，扎在你心里。每次看到老头笑着跟你说话，你都觉得不自在。' },
                            { name: '老头', portrait: 'npc', text: '小王，最近你脸色不太好。是不是太累了？' },
                            { name: '你', portrait: 'player', text: '......没事，张老。就是没休息好。' },
                            { name: '旁白', portrait: 'narrator', text: '你对他笑了笑。笑容背后是说不出口的沉重。' },
                        ],
                        buffReward: null,
                    });
                    list.push({
                        triggerX: 1000,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '三个月后。一通电话打破了平静。' },
                            { name: '下属', portrait: 'lument_npc', text: '张总！不好了！老头......张老先生被带走调查了！' },
                            { name: '下属', portrait: 'lument_npc', text: '听说不是我们公司的事，是他另一边的产业出了问题。牵连很广！' },
                            { name: '你', portrait: 'player', text: '......（来了。终究还是来了。）' },
                            { name: '旁白', portrait: 'narrator', text: '你想起保险柜里那本账本。如果当初你举报了，至少还能主动交代。' },
                            { name: '旁白', portrait: 'narrator', text: '现在......你成了包庇者。' },
                        ],
                        buffReward: null,
                    });
                    // 新增：被带走的那一刻——后悔
                    list.push({
                        triggerX: 1350,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '调查组来的那天，你正在办公室处理文件。' },
                            { name: '旁白', portrait: 'narrator', text: '门被推开。两个人走进来，出示了证件。' },
                            { name: '调查员', portrait: 'npc', text: '王某某，请跟我们走一趟。有些事情需要你配合调查。' },
                            { name: '旁白', portrait: 'narrator', text: '你站起来。办公室外面的员工都在看着你。没有人说话。' },
                            { name: '你', portrait: 'player', text: '......我知道了。' },
                            { name: '旁白', portrait: 'narrator', text: '你走过走廊，经过老周曾经待过的茶水间。铁观音的气味好像还在。' },
                            { name: '旁白', portrait: 'narrator', text: '你经过秘书小林的工位。她已经不在了——在你收到调查通知的前一周，她辞职了。' },
                            { name: '你', portrait: 'player', text: '（......小林早就知道了。她提醒过我。她说"您跟他们不一样"。）' },
                            { name: '旁白', portrait: 'narrator', text: '你走出公司大门。雨下得很大。你没有带伞。' },
                            { name: '你', portrait: 'player', text: '......我又淋雨了。' },
                            { name: '旁白', portrait: 'narrator', text: '车门口，你回头看了一眼这栋大楼。三十八层。你曾经一层一层跑上来。' },
                            { name: '你', portrait: 'player', text: '（如果那天我没有扶起老头......如果我举报了他......如果......）' },
                            { name: '旁白', portrait: 'narrator', text: '太多的"如果"。但人生没有如果。' },
                            { name: '旁白', portrait: 'narrator', text: '你上了车。车门关上。雨声被隔绝在外。但这一次，不是金伞的庇护。' },
                            { name: '旁白', portrait: 'narrator', text: '是法律的审判。' },
                        ],
                        buffReward: { type: 'endurance', amount: 1 },
                    });
                    list.push({
                        triggerX: 1700,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '调查组来了。公司被查封。你作为老头的左膀右臂，首当其冲。' },
                            { name: '调查员', portrait: 'npc', text: '你知道张某某的那些事吗？' },
                            { name: '你', portrait: 'player', text: '我......我知道一些。' },
                            { name: '调查员', portrait: 'npc', text: '知道为什么不举报？' },
                            { name: '你', portrait: 'player', text: '......他帮过我。我欠他一份恩情。' },
                            { name: '调查员', portrait: 'npc', text: '恩情大于法律？你也是淋过雨的人，应该知道被人做局的滋味。' },
                            { name: '旁白', portrait: 'narrator', text: '你低下了头。无话可说。' },
                            { name: '旁白', portrait: 'narrator', text: '如果当初你做了不同的选择......但世上没有如果。', end: true },
                        ],
                        buffReward: null,
                    });
                    return list;
                }

                // ========== 创业路线（不迎合，反击）：决战 ==========
                if (playerChoices.startedCompany === true && playerChoices.cateredToPower === false && playerChoices.overcameScheme !== false) {
                    list.push({
                        triggerX: 400,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你四处搜集证据。王处长做局的手段并不高明，只是从来没有人敢查。' },
                            { name: '老张', portrait: 'npc', text: '律师说了，只要证据链完整，我们有胜算。' },
                            { name: '你', portrait: 'player', text: '不光是打官司。我要让所有人知道他们做了什么。' },
                            { name: '旁白', portrait: 'narrator', text: '你联系了媒体，整理了材料，准备在法庭上把一切公之于众。' },
                        ],
                        buffReward: null,
                    });
                    list.push({
                        triggerX: 1000,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '开庭那天，法庭外挤满了人。' },
                            { name: '旁白', portrait: 'narrator', text: '你站在原告席上，面前是王处长和他背后那一群撑伞的人。' },
                            { name: '你', portrait: 'player', text: '我淋了半辈子的雨。今天，我要让撑伞的人也淋一淋。' },
                            { name: '旁白', portrait: 'narrator', text: '证据确凿。舆论沸腾。那些曾经不可一世的人，终于低下了头。' },
                            { name: '老张', portrait: 'npc', text: '赢了......我们赢了！' },
                            { name: '你', portrait: 'player', text: '......赢了。但为什么我心里没有想象中那么高兴？' },
                        ],
                        buffReward: null,
                    });
                    // 新增：新的伞——权力的邀请
                    list.push({
                        triggerX: 1350,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '胜诉后的一个月。你的名字上了财经新闻头条。"草根企业家扳倒贪官"——标题写得很漂亮。' },
                            { name: '旁白', portrait: 'narrator', text: '公司门口每天都有人排队求见。有投资机构，有媒体记者，还有......一些你不认识的人。' },
                            { name: '秘书', portrait: 'npc', text: '张总，省里的赵秘书长想约您吃个饭。说是......欣赏您的魄力。' },
                            { name: '你', portrait: 'player', text: '赵秘书长？我不认识他。' },
                            { name: '秘书', portrait: 'npc', text: '他说......王处长倒了他很高兴。王处长以前一直压着他。现在他想跟您交个朋友。' },
                            { name: '你', portrait: 'player', text: '......' },
                            { name: '老张', portrait: 'npc', text: '小王，这个人不简单。赵秘书长在省里根子很深。他主动来找你，不是交朋友的。' },
                            { name: '你', portrait: 'player', text: '我知道。但......公司刚经历这么大一场仗，需要一个稳定的靠山。' },
                            { name: '老张', portrait: 'npc', text: '你确定？上一个靠山差点把我们整死。' },
                            { name: '你', portrait: 'player', text: '赵秘书长不一样。他是......体制内的改革派。' },
                            { name: '旁白', portrait: 'narrator', text: '你说这句话的时候，语气和一年前王处长来找你时一模一样。' },
                            { name: '旁白', portrait: 'narrator', text: '当时你也觉得王处长"不一样"。' },
                            { name: '你', portrait: 'player', text: '......安排吧。我去见见赵秘书长。' },
                            { name: '旁白', portrait: 'narrator', text: '老张看着你，欲言又止。最终他什么都没说，转身走了。' },
                            { name: '你', portrait: 'player', text: '（......我知道老张在想什么。但这一次不一样。我能控制住。）' },
                            { name: '旁白', portrait: 'narrator', text: '每一个走上这条路的人，都觉得自己能控制住。' },
                        ],
                        buffReward: { type: 'willpower', amount: 1 },
                    });
                    list.push({
                        triggerX: 1700,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '王处长被判了刑。几个跟着他作恶的人也受到了惩罚。' },
                            { name: '旁白', portrait: 'narrator', text: '你的公司保住了。甚至比以前更壮大——因为你成了"对抗权贵"的英雄。' },
                            { name: '旁白', portrait: 'narrator', text: '但渐渐地，你发现身边多了很多"朋友"。有人请你吃饭，有人给你送礼。' },
                            { name: '下属', portrait: 'lument_npc', text: '张总，有个局长想约您打高尔夫......' },
                            { name: '你', portrait: 'player', text: '......好。安排时间吧。' },
                            { name: '旁白', portrait: 'narrator', text: '你低头一看，自己手里不知什么时候多了一把伞。金色的。' },
                            { name: '你', portrait: 'player', text: '（......什么时候开始的？）' },
                            { name: '旁白', portrait: 'narrator', text: '你打败了撑伞的人。但伞还在那里，只是换了一个人撑。', end: true },
                        ],
                        buffReward: null,
                    });
                    return list;
                }

                // ========== 创业路线（不迎合，未反击成功）：破产 ==========
                if (playerChoices.startedCompany === true && playerChoices.cateredToPower === false && playerChoices.overcameScheme === false) {
                    list.push({
                        triggerX: 400,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '你试图稳住局面，但每一条路都被堵死了。' },
                            { name: '老张', portrait: 'npc', text: '银行那边正式通知了，贷款全部停发。' },
                            { name: '老张', portrait: 'npc', text: '供应商要求现款现货。我们没有现金流了。' },
                            { name: '你', portrait: 'player', text: '......还能撑多久？' },
                            { name: '老张', portrait: 'npc', text: '最多两周。' },
                        ],
                        buffReward: null,
                    });
                    list.push({
                        triggerX: 1000,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '最后一周。员工们陆续离职。办公室越来越空。' },
                            { name: '老张', portrait: 'npc', text: '小王......对不起。是我当初拉你创业的。' },
                            { name: '你', portrait: 'player', text: '别这么说，老张。是我自己的选择。' },
                            { name: '老张', portrait: 'npc', text: '我们......是不是应该当初就答应王处长？' },
                            { name: '你', portrait: 'player', text: '不。就算重来一次，我还是不会弯腰。' },
                            { name: '旁白', portrait: 'narrator', text: '老张红了眼眶。两个中年男人坐在空荡荡的办公室里，沉默了很久。' },
                        ],
                        buffReward: null,
                    });
                    // 新增：最后一夜——回望来路
                    list.push({
                        triggerX: 1350,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '破产清算的前一夜。你一个人坐在空荡荡的办公室里。' },
                            { name: '旁白', portrait: 'narrator', text: '桌上的电脑已经搬走了。墙上还贴着当初创业时的第一张合影——你、老张、还有最初的三个员工。' },
                            { name: '你', portrait: 'player', text: '......三年了。' },
                            { name: '旁白', portrait: 'narrator', text: '你想起第一个客户。那碗在面摊上吃的牛肉面。凌晨三点改方案时的咖啡。' },
                            { name: '旁白', portrait: 'narrator', text: '你想起签下第一个大单时，你和老张在雨里大笑。' },
                            { name: '你', portrait: 'player', text: '那时候我们什么都没有。但什么都不怕。' },
                            { name: '旁白', portrait: 'narrator', text: '你拿出手机。有一条老张发的消息：' },
                            { name: '旁白', portrait: 'narrator', text: '"小王，别灰心。大不了从头再来。我认识一个做餐饮的，需要技术支持。咱们......还可以再干一票。"' },
                            { name: '你', portrait: 'player', text: '......（笑了一声）老张这个人。公司都破产了，他还想着"再干一票"。' },
                            { name: '旁白', portrait: 'narrator', text: '你回了三个字："好。再说。"' },
                            { name: '旁白', portrait: 'narrator', text: '然后你站起来，走到窗前。' },
                            { name: '旁白', portrait: 'narrator', text: '楼下的街道上，撑伞的人在雨中走过。有个人没打伞，在雨里跑着。' },
                            { name: '你', portrait: 'player', text: '（......那个人在跑。就像当年的我。）' },
                            { name: '你', portrait: 'player', text: '（跑吧。别停。停下就再也起不来了。）' },
                            { name: '旁白', portrait: 'narrator', text: '你关上窗户。转身看着空荡荡的办公室，最后看了一眼那张合影。' },
                            { name: '你', portrait: 'player', text: '......再见了。微光。' },
                        ],
                        buffReward: { type: 'mindset', amount: 2 },
                    });
                    list.push({
                        triggerX: 1700,
                        dialogue: [
                            { name: '旁白', portrait: 'narrator', text: '公司正式宣布破产。' },
                            { name: '旁白', portrait: 'narrator', text: '你站在空荡荡的办公室里，看着窗外的雨。' },
                            { name: '旁白', portrait: 'narrator', text: '楼下，撑伞的人从容走过。他们甚至不知道这栋楼里发生了什么。' },
                            { name: '你', portrait: 'player', text: '......我什么都没了。' },
                            { name: '老张', portrait: 'npc', text: '不。你还有我这个朋友。还有你自己的脊梁。' },
                            { name: '你', portrait: 'player', text: '......是啊。至少这两样，他们抢不走。' },
                            { name: '旁白', portrait: 'narrator', text: '你关上灯，锁上门。走进雨里。', end: true },
                        ],
                        buffReward: null,
                    });
                    return list;
                }

                // ========== 普通路线：最后的路 ==========
                list.push({
                    triggerX: 400,
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你走在城市最繁华的街道上。' },
                        { name: '旁白', portrait: 'narrator', text: '两边是高耸入云的写字楼，玻璃幕墙映着灰色的天空。' },
                        { name: '旁白', portrait: 'narrator', text: '撑伞的人们从容走过，谈笑风生。没有人看你一眼。' },
                        { name: '你', portrait: 'player', text: '......这条路，我走了半辈子。' },
                        { name: '旁白', portrait: 'narrator', text: '街边橱窗里的电视正在播放企业家专访。' },
                        { name: '旁白', portrait: 'narrator', text: '"成功源于选择，"电视里的企业家说，"我当年选对了路。"' },
                        { name: '你', portrait: 'player', text: '（选对了路......呵。你的路，是生下来就铺好的。）' },
                    ],
                    buffReward: { type: 'endurance', amount: 1 },
                });
                list.push({
                    triggerX: 1000,
                    dialogue: [
                        { name: '撑伞的权贵', portrait: 'lument_npc', text: '你们这些人，总是抱怨命运不公。' },
                        { name: '撑伞的权贵', portrait: 'lument_npc', text: '可你想过没有？我们撑的伞，是谁做的？是你们。' },
                        { name: '撑伞的权贵', portrait: 'lument_npc', text: '你们淋着雨，为我们造伞。然后怪我们撑着伞？' },
                        { name: '你', portrait: 'player', text: '......' },
                        { name: '撑伞的权贵', portrait: 'lument_npc', text: '想要伞？可以。但你得先学会弯腰。' },
                        { name: '你', portrait: 'player', text: '我淋了半辈子的雨，腰一直没有弯过。' },
                        { name: '撑伞的权贵', portrait: 'lument_npc', text: '那就继续淋着吧。' },
                        { name: '旁白', portrait: 'narrator', text: '他撑着伞走远了。雨水打在你脸上，冰凉。' },
                        { name: '你', portrait: 'player', text: '（......你的伞，总有一天会被风吹翻的。）' },
                    ],
                    buffReward: { type: 'willpower', amount: 1 },
                });
                list.push({
                    triggerX: 1500,
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你看见一个少年在雨中奔跑。' },
                        { name: '旁白', portrait: 'narrator', text: '他没有伞，浑身湿透，但跑得很用力。' },
                        { name: '少年', portrait: 'npc', text: '......让一让！我要迟到了！' },
                        { name: '旁白', portrait: 'narrator', text: '你看着他的背影，像是看见了多年前的自己。' },
                        { name: '你', portrait: 'player', text: '......那时候我也以为，只要跑得够快，总能跑到没雨的地方。' },
                        { name: '旁白', portrait: 'narrator', text: '你想叫住他，递给他那把老师给你的旧伞。但伞早就坏了，你没能留住它。' },
                        { name: '旁白', portrait: 'narrator', text: '少年消失在雨幕中。你继续向前走。' },
                    ],
                    buffReward: { type: 'mindset', amount: 1 },
                });
                list.push({
                    triggerX: 2000,
                    dialogue: [
                        { name: '旁白', portrait: 'narrator', text: '你来到街的尽头。前方的路分成了几条。' },
                        { name: '旁白', portrait: 'narrator', text: '你走过的每一步，做过的每一个选择，都把你带到了这里。' },
                        { name: '你', portrait: 'player', text: '......不管结局如何，这条路是我自己走的。' },
                        { name: '旁白', portrait: 'narrator', text: '现在，是时候面对你的结局了。' },
                    ],
                    buffReward: null,
                });
                return list;
            },
            endDialogue: [
                { name: '旁白', portrait: 'narrator', text: '雨声渐渐远去。' },
                { name: '旁白', portrait: 'narrator', text: '你的一生在眼前闪过——少年时的奔跑，青年时的挣扎，中年时的孤独。' },
                { name: '旁白', portrait: 'narrator', text: '那些撑伞的人，那些淋雨的人，那些在雨中倒下的人......' },
                { name: '旁白', portrait: 'narrator', text: '都在这场雨里。' },
            ],
        },
    ];

    // ========== 结局定义 ==========
    // text 支持函数形式，接收 playerChoices 参数，生成路线定制的结局文本
    const endings = {
        // 真结局一：失败人生（普通路线，未创业未加入老头）
        'true_failure': {
            type: 'true',
            title: '真结局·失败人生',
            sceneTheme: 'rain_street',
            getText: function(c) {
                let t = '你没有迎合那些有伞的人。\n\n一生碌碌无为，浑浑噩噩。\n你做过零工，摆过地摊，送过外卖。\n伞下的人从你身边走过，从未回头。\n\n';
                if (c.helpedBulliedStudent === true) {
                    t += '你还记得那个被欺负的同学。后来他转学了，你再也没有见过他。\n你常常想，他现在过得好不好。至少那天，你替他挡了一下。\n\n';
                } else if (c.helpedBulliedStudent === false) {
                    t += '走廊里那个被欺负的同学，你从他身边走过了。\n后来他转学了。你始终没来得及说声对不起。\n\n';
                }
                if (c.helpedOldMan === false) {
                    t += '那个雨天摔倒的老人，你犹豫了一下，还是走过去了。\n你不知道他后来怎么样了。这件事像一根刺，偶尔会在深夜扎你一下。\n\n';
                }
                t += '你没有被打败，但也从未赢过。\n你只是......活着。\n像雨中的一粒尘埃，不被人注意地飘着。\n\n世界大雨滂沱。\n而你的万里山河，\n终究不如别人头顶一伞。\n\n但你从未弯过腰。\n这或许是你唯一的骄傲。';
                return t;
            },
            achievement: 'end_failure',
        },
        // 真结局二：大起大落（创业，不迎合，未能化解做局）
        'true_rise_fall': {
            type: 'true',
            title: '真结局·大起大落',
            sceneTheme: 'ruined_office',
            getText: function(c) {
                let t = '你利用自己的学识开了公司，算是有所作为。\n\n但你没有迎合那些权贵。\n于是他们做局，断你的供应链，挖你的人，停你的贷款。\n你奋力抵抗，但终究寡不敌众。\n\n';
                t += '老张陪到了最后。在空荡荡的办公室里，\n他说："就算重来一次，我还是跟你创业。"\n你说："我也是。就算重来一次，我还是不会弯腰。"\n\n';
                t += '公司破产的那天，又下起了雨。\n你站在空荡荡的办公室里，看着窗外。\n那些撑伞的人路过你的楼下，脚步从容。\n他们甚至不知道这栋楼里发生了什么。\n\n你输了。但你没有跪下。\n伞可以遮雨，但遮不住一个人的脊梁。\n\n你什么都没了，\n但你还有自己，\n还有一个叫老张的朋友。';
                return t;
            },
            achievement: 'end_rise_fall',
        },
        // 真结局三：人生轮回（创业，不迎合，成功反击）
        'true_cycle': {
            type: 'true',
            title: '真结局·人生轮回',
            sceneTheme: 'golden_throne',
            getText: function(c) {
                let t = '你利用学识开了公司，面对权贵的做局，你化解了。\n\n你用法律反击，用舆论施压，用证据将王处长送进了监狱。\n那些曾经不可一世的人，终于也淋到了雨。\n老张在法庭外抱着你哭。你说："我们赢了。"\n\n';
                t += '但渐渐地，你发现身边开始有人给你撑伞。\n有人叫你"老板"，有人叫你"靠山"，有人约你打高尔夫。\n你低头一看，自己手里多了一把伞。金色的。\n你甚至不记得是什么时候接过来的。\n\n';
                t += '你终于明白了——\n雨不会停，伞也不会消失。\n打败了撑伞的人，你就成了下一个撑伞的人。\n\n';
                t += '一个淋雨的年轻人站在你的楼下，手里攥着一份湿透的简历。\n保安在赶他走。你从落地窗往下看了一眼。\n\n然后，你拉上了窗帘。\n\n这就是轮回。\n你曾经淋过的雨，\n终将由另一个人来淋。';
                return t;
            },
            achievement: 'end_cycle',
        },
        // 真结局四：新生（加入老头，举报）
        'true_rebirth': {
            type: 'true',
            title: '真结局·新生',
            sceneTheme: 'small_town',
            getText: function(c) {
                let t = '你扶起的那个老头，原来是一位有实力的大老板。\n你依靠他的背景，事业蒸蒸日上。\n从端茶倒水到公司副总，你只用了三年。\n\n但你发现了他的秘密——那些见不得光的账目和交易。\n你犹豫过，挣扎过。他救过你，你欠他一份恩情。\n你想起他递给你金伞时说的："这把伞，以后就是你的了。"\n\n';
                t += '但最终，你还是选择了举报。\n因为你淋过雨，你知道被人做局的滋味。\n你不能让别人继续被他的"伞"所遮蔽。\n\n';
                t += '老头被捕的那天，你收拾了办公室。\n你把金伞留在了桌上。你没有带走它。\n\n你带着自己赚来的积蓄，去了一个小镇。\n开了一家小店，卖些日用品。\n偶尔有淋雨的年轻人进来避雨，你会给他们倒一杯热茶。\n\n你不再追逐伞，也不再淋雨。\n你选择了不与世俗同流合污。\n这或许不是最好的结局，\n但这是你最心安的结局。';
                return t;
            },
            achievement: 'end_rebirth',
        },
        // 假结局一：迎合（创业，迎合权贵）
        'false_cater': {
            type: 'false',
            title: '假结局·迎合',
            sceneTheme: 'luxury_party',
            getText: function(c) {
                let t = '你利用学识开了公司，算是有所作为。\n\n但最终，你还是迎合了那些权贵。\n起初你安慰自己：这只是暂时的妥协。\n后来你学会了他们的语言，参加了他们的饭局。\n再后来，你开始享受这种被人簇拥的感觉。\n\n';
                t += '你不再回复老张的消息了。\n他给你发消息说身体不好，想见你。\n你让秘书回了句"张总最近很忙"。\n你忘了当年是谁陪你吃泡面改方案到凌晨三点。\n\n';
                t += '王处长在酒会上拍着你的肩膀说：\n"伞是我给你的。哪天我不高兴了，收回来，你就还是那个淋雨的。"\n你笑着碰杯。但笑容下面是什么，你自己也说不清了。\n\n';
                t += '一个浑身湿透的年轻人跑到你面前递简历。\n保安在赶他走。你看着他，像极了二十年前的自己。\n你说："让保安处理吧。"\n\n你上了车。车门关上的那一刻，雨声被隔绝在外。\n你再也没有回头。\n\n你举起酒杯，对自己说：\n"这就是成长。"\n\n但你知道，那不是成长。\n那只是——\n你终于成为了你曾经最恨的人。';
                return t;
            },
            achievement: 'end_cater',
        },
        // 假结局二：同流合污（加入老头，不举报）
        'false_corrupt': {
            type: 'false',
            title: '假结局·同流合污',
            sceneTheme: 'prison_shadow',
            getText: function(c) {
                let t = '你扶起的那个老头，原来是一位有实力的大老板。\n你依靠他的背景，事业蒸蒸日上。\n\n你发现了他的秘密。那些不干净的账目，那些见不得光的交易。\n但你犹豫了。他帮过你，你欠他一份恩情。\n\n"算了，"你想，"他做他的，我做我的。"\n你合上了保险柜，假装什么都没看到。\n\n';
                t += '但事情终究败露了。\n不是你们公司的事——是他另一边的产业出了问题，牵连甚广。\n老头被带走调查。调查组来了，公司被查封。\n\n调查员问你："知道为什么不举报？"\n你说："他帮过我。我欠他一份恩情。"\n调查员说："恩情大于法律？你也是淋过雨的人，应该知道被人做局的滋味。"\n\n';
                t += '你低下了头。无话可说。\n\n你站在废墟般的办公室里，回想当初。\n如果那天你举报了他......\n如果那天你没有接受他的邀请......\n如果那天你从老人身边走过，没有停下来......\n\n但世上没有如果。\n良心债，\n终归要还的。';
                return t;
            },
            achievement: 'end_corrupt',
        },
        // 假结局三：死亡与新生（跳楼或放弃）
        'false_death': {
            type: 'false',
            title: '假结局·死亡与新生',
            sceneTheme: 'rooftop_storm',
            getText: function(c) {
                let t = '那些有伞的人的嘲讽，像雨一样不停地打在你身上。\n\n"穷鬼""落汤鸡""一辈子买不起伞"......\n这些声音在耳边回响了太久太久。\n\n';
                if (c.rooftopJumped === true) {
                    t += '你站在学校天台的边缘。风把你的衣服吹得猎猎作响。\n操场上的撑伞同学像蚂蚁一样小。他们不会注意到你。\n你闭上了眼睛。前倾......然后，风声消失了。\n\n';
                } else {
                    t += '工作不顺，生活窘迫，无人相伴......\n你站在窗台边，往下看去。\n风很大，雨也很大。\n你闭上了眼睛。前倾......然后，风声消失了。\n\n';
                }
                t += '第二天，新闻报道了一则坠楼消息。\n没有人知道他经历了什么。\n撑伞的人从楼下路过，没有停留。\n\n雨还在下。\n永远在下。\n\n......\n但如果你还在跑，请继续跑下去。\n总有人会为你撑一把伞。\n总有人会的。';
                return t;
            },
            achievement: 'end_death',
        },
    };

    // ========== 成就系统 ==========
    let unlockedAchievements = {};

    function loadAchievements() {
        try {
            const saved = localStorage.getItem('lumentWorld_achievements');
            if (saved) {
                unlockedAchievements = JSON.parse(saved);
            }
        } catch (e) {
            unlockedAchievements = {};
        }
    }

    function saveAchievements() {
        try {
            localStorage.setItem('lumentWorld_achievements', JSON.stringify(unlockedAchievements));
        } catch (e) {}
    }

    function unlockAchievement(id) {
        if (!achievementDefs[id]) return false;
        if (unlockedAchievements[id]) return false;
        unlockedAchievements[id] = true;
        saveAchievements();

        // 检查全结局成就
        const endingAchievements = ['end_failure', 'end_rise_fall', 'end_cycle', 'end_rebirth', 'end_cater', 'end_corrupt', 'end_death'];
        if (endingAchievements.every(a => unlockedAchievements[a]) && !unlockedAchievements['all_endings']) {
            unlockedAchievements['all_endings'] = true;
            saveAchievements();
        }
        return true;
    }

    function getAchievements() {
        return { defs: achievementDefs, unlocked: unlockedAchievements };
    }

    function getEndingCount() {
        const endingAchievements = ['end_failure', 'end_rise_fall', 'end_cycle', 'end_rebirth', 'end_cater', 'end_corrupt', 'end_death'];
        return endingAchievements.filter(a => unlockedAchievements[a]).length;
    }

    // ========== 结局判定 ==========
    function determineEnding(playerBuffs) {
        // 假结局三：从天台跳下 或 放弃人生（窗台）
        if (playerChoices.rooftopJumped === true || playerChoices.gaveUp === true) {
            return 'false_death';
        }

        // 老头路线（加入老头）
        if (playerChoices.joinedOldMan === true) {
            if (playerChoices.reportedOldMan === true) {
                return 'true_rebirth';   // 真结局四：新生
            } else {
                return 'false_corrupt';  // 假结局二：同流合污
            }
        }

        // 创业路线
        if (playerChoices.startedCompany === true) {
            if (playerChoices.cateredToPower === true) {
                return 'false_cater';    // 假结局一：迎合
            } else {
                // 判定是否化解做局：需要willpower + mindset总和 >= 5
                const fightPower = (playerBuffs.willpower || 0) + (playerBuffs.mindset || 0);
                if (playerChoices.overcameScheme === 'pending') {
                    playerChoices.overcameScheme = fightPower >= 5;
                }
                if (playerChoices.overcameScheme === true) {
                    return 'true_cycle'; // 真结局三：人生轮回
                } else {
                    return 'true_rise_fall'; // 真结局二：大起大落
                }
            }
        }

        // 默认：真结局一·失败人生
        return 'true_failure';
    }

    // ========== 运行时状态 ==========
    let currentChapterIdx = 0;
    let triggeredEncounters = new Set();
    let currentEncounters = [];
    let finalEnding = null;
    let repeatableEncounterState = {}; // 可重复encounter的触发状态
    let savedTriggeredEncounters = null; // 天台场景切换时保存已触发状态

    // ========== NPC类型判定 ==========
    // 判定encounter是否需要NPC（有非旁白/非玩家角色的对话行）
    function encounterHasNPC(enc) {
        if (enc.sceneTransition) return false;
        if (!enc.dialogue) return false;
        for (const line of enc.dialogue) {
            if (line.portrait && line.portrait !== 'narrator' && line.portrait !== 'player') {
                return true;
            }
        }
        return false;
    }

    // 获取encounter的NPC类型
    // 室外雨天：lument_npc/teacher/boss → 'lument'（带伞）；npc → 'normal'（淋雨）
    // 室内：所有类型 → 'normal'（室内不打伞）
    function getEncounterNPCType(enc) {
        if (!encounterHasNPC(enc)) return null;
        for (const line of enc.dialogue) {
            if (line.portrait && line.portrait !== 'narrator' && line.portrait !== 'player') {
                // 室内场景不打伞
                const chapter = chapters[currentChapterIdx];
                if (chapter.sceneType === 'indoor') return 'normal';
                // 室外雨天：有伞阶层带伞，淋雨路人不带
                if (line.portrait === 'lument_npc' || line.portrait === 'teacher' || line.portrait === 'boss') {
                    return 'lument';
                }
                return 'normal';
            }
        }
        return null;
    }

    // 判定encounter是否为群组encounter（霸凌场景）
    function isGroupEncounter(enc) {
        return enc.groupEncounter === true;
    }

    function isEncounterTriggered(index) {
        return triggeredEncounters.has(index);
    }

    function getCurrentEncounters() {
        return currentEncounters;
    }

    // 通过索引触发encounter（用于NPC碰撞触发）
    function triggerEncounterByIndex(index) {
        if (index < 0 || index >= currentEncounters.length) return null;
        const enc = currentEncounters[index];
        if (enc.repeatable) return enc; // 可重复：总是触发
        if (triggeredEncounters.has(index)) return null;
        triggeredEncounters.add(index);
        return enc;
    }

    function init() {
        currentChapterIdx = 0;
        triggeredEncounters = new Set();
        finalEnding = null;
        repeatableEncounterState = {};
        playerChoices = {
            helpedBulliedStudent: null,
            rooftopJumped: null,
            helpedOldMan: null,
            joinedOldMan: null,
            becameBoss: null,
            cateredToPower: null,
            startedCompany: null,
            gaveUp: null,
            reportedOldMan: null,
            overcameScheme: null,
        };
        loadAchievements();
        resolveEncounters();
    }

    // 解析当前章节的encounters（支持函数形式）
    function resolveEncounters() {
        const chapter = chapters[currentChapterIdx];
        if (typeof chapter.encounters === 'function') {
            currentEncounters = chapter.encounters();
        } else {
            currentEncounters = chapter.encounters || [];
        }
    }

    // ========== 天台场景encounters ==========
    const rooftopEncounters = [
        {
            triggerX: 800,  // 靠近栏杆时触发（栏杆在x=920）
            repeatable: true,
            sceneTransition: 'school_corridor',  // 选择"看看风景"后回到走廊
            dialogue: [
                { name: '旁白', portrait: 'narrator', text: '你走到天台边缘，扶着冰冷的栏杆向下看。' },
                { name: '旁白', portrait: 'narrator', text: '从这里往下看，操场上撑伞的人像蚂蚁一样小。' },
                { name: '旁白', portrait: 'narrator', text: '他们有伞。你没有。也许永远没有。' },
                { name: '旁白', portrait: 'narrator', text: '所有的嘲讽声在耳边回响——"穷鬼""落汤鸡""一辈子买不起伞"......' },
                {
                    name: '你', portrait: 'player',
                    text: '......',
                    choices: [
                        { text: '看看风景就好了，下去吧', next: 5, choiceKey: 'rooftop_view' },
                        { text: '......跳下去', next: 7, choiceKey: 'rooftop_jump', ending: 'false_death' },
                    ]
                },
                // rooftop_view path (index 5-6)
                { name: '你', portrait: 'player', text: '风很大......但还是要回去上课。' },
                { name: '旁白', portrait: 'narrator', text: '你转身离开了天台。雨还在下，但你还要走。', end: true },
                // rooftop_jump path (index 7-8)
                { name: '旁白', portrait: 'narrator', text: '你站在天台边缘。风把你的衣服吹得猎猎作响。' },
                { name: '旁白', portrait: 'narrator', text: '你闭上了眼睛。前倾......然后，风声消失了。', end: true },
            ],
            buffReward: { type: 'mindset', amount: 1 },
            onChoice: function(choice) {
                if (choice.choiceKey === 'rooftop_jump') {
                    playerChoices.rooftopJumped = true;
                }
            },
        },
    ];

    // 切换到天台encounters
    function setRooftopEncounters() {
        savedTriggeredEncounters = new Set(triggeredEncounters); // 保存走廊已触发状态
        currentEncounters = rooftopEncounters;
        triggeredEncounters = new Set();
        repeatableEncounterState = {};
    }

    // 切换回走廊encounters
    function setCorridorEncounters() {
        if (savedTriggeredEncounters) {
            triggeredEncounters = new Set(savedTriggeredEncounters); // 恢复走廊已触发状态
            savedTriggeredEncounters = null;
        }
        resolveEncounters();
        repeatableEncounterState = {};
    }

    function getCurrentChapter() {
        return chapters[currentChapterIdx];
    }

    function getChapterCount() {
        return chapters.length;
    }

    function getEnding(type) {
        finalEnding = type;
        const ending = endings[type];
        if (ending && ending.achievement) {
            unlockAchievement(ending.achievement);
        }
        // 如果text是函数，调用生成路线定制文本
        const result = Object.assign({}, ending);
        if (typeof ending.getText === 'function') {
            result.text = ending.getText(playerChoices);
        }
        return result;
    }

    function nextChapter() {
        currentChapterIdx++;
        triggeredEncounters = new Set();
        repeatableEncounterState = {};
        resolveEncounters();
        return currentChapterIdx < chapters.length;
    }

    function checkEncounter(playerX) {
        if (!currentEncounters || currentEncounters.length === 0) return null;
        for (let i = 0; i < currentEncounters.length; i++) {
            const enc = currentEncounters[i];

            // 跳过有NPC的encounter（由碰撞检测处理）
            if (encounterHasNPC(enc)) continue;

            if (enc.repeatable) {
                // 可重复encounter：玩家从左到右穿过触发点时触发
                if (!repeatableEncounterState[i]) repeatableEncounterState[i] = { lastSide: playerX >= enc.triggerX ? 'right' : 'left' };
                const st = repeatableEncounterState[i];
                const currentSide = playerX >= enc.triggerX ? 'right' : 'left';

                // 从左到右穿过时触发
                if (st.lastSide === 'left' && currentSide === 'right') {
                    st.lastSide = currentSide;
                    return enc;
                }
                st.lastSide = currentSide;
            } else {
                // 普通一次性encounter
                if (!triggeredEncounters.has(i) && playerX >= enc.triggerX) {
                    triggeredEncounters.add(i);
                    return enc;
                }
            }
        }
        return null;
    }

    function isChapterEnd(playerX) {
        const chapter = getCurrentChapter();
        return playerX >= chapter.endX;
    }

    function handleChoice(choice) {
        if (choice.ending) {
            finalEnding = choice.ending;
        }
    }

    function getPlayerChoices() {
        return playerChoices;
    }

    function setChoice(key, value) {
        playerChoices[key] = value;
    }

    function getChapterForSave() {
        return currentChapterIdx;
    }

    function setChapterForSave(idx) {
        currentChapterIdx = idx;
        triggeredEncounters = new Set();
        repeatableEncounterState = {};
        resolveEncounters();
    }

    // ========== 存档数据 ==========
    function getSaveData(player) {
        return {
            chapter: currentChapterIdx,
            playerX: player.x,
            health: player.health,
            buffs: player.buffs,
            hasLument: player.hasLument || false,
            choices: { ...playerChoices },
            // 保存已触发的encounter索引，防止读档后重复触发
            triggeredEncounters: Array.from(triggeredEncounters),
            // 保存可重复encounter的状态
            repeatableState: { ...repeatableEncounterState },
        };
    }

    function loadSaveData(data, player) {
        currentChapterIdx = data.chapter || 0;
        // 恢复已触发的encounter，防止重复触发
        triggeredEncounters = new Set(data.triggeredEncounters || []);
        // 恢复可重复encounter的状态
        if (data.repeatableState) {
            repeatableEncounterState = { ...data.repeatableState };
        }
        if (data.choices) {
            playerChoices = { ...playerChoices, ...data.choices };
        }
        if (data.buffs) {
            player.buffs = data.buffs;
        }
        player.health = data.health || 100;
        player.x = data.playerX || 100;
        player.hasLument = data.hasLument || false;
        resolveEncounters();
    }

    function hasSave() {
        try {
            const save = localStorage.getItem('lumentWorld_save');
            return save !== null;
        } catch (e) {
            return false;
        }
    }

    function clearSave() {
        try {
            localStorage.removeItem('lumentWorld_save');
        } catch (e) {}
    }

    return {
        init,
        chapters,
        endings,
        achievementDefs,
        getCurrentChapter,
        getChapterCount,
        getEnding,
        nextChapter,
        checkEncounter,
        isChapterEnd,
        handleChoice,
        determineEnding,
        getPlayerChoices,
        setChoice,
        getSaveData,
        loadSaveData,
        hasSave,
        clearSave,
        loadAchievements,
        getAchievements,
        unlockAchievement,
        getEndingCount,
        setRooftopEncounters,
        setCorridorEncounters,
        encounterHasNPC,
        getEncounterNPCType,
        isEncounterTriggered,
        getCurrentEncounters,
        triggerEncounterByIndex,
        isGroupEncounter,
        setChapterForSave,
        resolveEncounters,
        get currentChapterIdx() { return currentChapterIdx; },
        get finalEnding() { return finalEnding; },
    };
})();
