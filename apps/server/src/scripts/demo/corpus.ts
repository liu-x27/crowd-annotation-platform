/**
 * Synthetic text for the demo instance, generated from templates. Every sentence is made up
 * here; none comes from a real corpus. Each generator returns the text with the label (or
 * entity spans) it was built from, which the simulated annotators treat as the truth.
 */
import type { Span } from '@crowd/shared';

export type Rand = () => number;

export function seeded(seed: number): Rand {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: Rand, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const int = (r: Rand, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));

function fill(
  template: string,
  r: Rand,
  slots: Record<string, readonly string[] | (() => string)>,
): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const s = slots[key];
    if (!s) return key;
    return typeof s === 'function' ? s() : pick(r, s);
  });
}

// ── Chinese news headlines ──────────────────────────────────────────────────

export const HEADLINE_LABELS = [
  { name: '体育', description: '比赛、运动员、赛事结果与体育产业中以赛事为主的新闻。' },
  { name: '财经', description: '公司业绩、股市、货币政策、房地产与宏观经济。' },
  { name: '科技', description: '新产品、芯片、人工智能、互联网公司的技术动态与科研突破。' },
  { name: '娱乐', description: '电影、剧集、综艺、音乐与明星。' },
  { name: '教育', description: '考试、招生、学校与教育政策。' },
] as const;

const zh = {
  team: ['上海海港', '北京国安', '山东泰山', '成都蓉城', '浙江队', '广州队', '武汉三镇'],
  player: ['武磊', '张琳芃', '王霜', '谷爱凌', '苏炳添', '全红婵', '樊振东', '孙颖莎'],
  company: ['星海科技', '远航集团', '华辰电子', '青禾食品', '北辰汽车', '云帆智能', '恒泰银行'],
  city: ['杭州', '深圳', '成都', '武汉', '南京', '西安', '合肥', '苏州'],
  univ: ['清华大学', '浙江大学', '复旦大学', '南京大学', '武汉大学', '中山大学'],
  movie: ['长河落日', '星际归途', '雾都迷踪', '春风十里', '孤岛来信', '追光者'],
  show: ['乘风而来', '声临其境', '奇妙之旅', '极限挑战者'],
  singer: ['林若溪', '周子航', '许嘉宁', '陈一鸣'],
  product: ['折叠屏手机', '智能手表', '电动汽车', '家用机器人', 'AR眼镜', '笔记本电脑'],
  model: ['天工', '启明', '星河', '九章', '灵犀'],
  event: ['亚洲杯', '全运会', '世锦赛', '奥运资格赛', '马拉松'],
};

const headlineTemplates: Record<string, string[]> = {
  体育: [
    '{team}主场{a}比{b}击败{team}，{player}梅开二度',
    '{event}：{player}以个人最好成绩夺冠',
    '中超第{n}轮：{team}客场爆冷输球',
    '{player}宣布退役，结束{n}年职业生涯',
    '{event}落幕，中国代表团金牌数位列第一',
    '{team}官宣新帅，目标直指亚冠资格',
    '女排{a}比{b}逆转对手，晋级{event}决赛',
    '{city}马拉松今日鸣枪，三万名选手参赛',
  ],
  财经: [
    '{company}三季度营收同比增长{p}%，净利润创新高',
    '央行宣布下调存款准备金率{n}个基点',
    'A股三大指数集体{updown}，成交额突破{n}千亿元',
    '{city}出台楼市新政，首套房首付比例降至{p}%',
    '{company}发布{n}亿元股份回购计划',
    '人民币对美元汇率{updown}，市场关注美联储议息',
    '{company}拟赴港上市，募资规模约{n}亿港元',
    '统计局：前三季度社会消费品零售总额同比增长{p}%',
  ],
  科技: [
    '{company}发布新一代{product}，续航提升{p}%',
    '国产大模型“{model}”开源，参数规模达{n}0亿',
    '{city}建成首个城市级自动驾驶测试区',
    '研究团队研制出新型固态电池，能量密度大幅提升',
    '{company}宣布自研芯片流片成功，采用{n}纳米工艺',
    '{univ}团队在量子通信领域取得突破',
    '{company}{product}系统升级，新增离线语音助手',
    '卫星互联网试验星发射成功，将开展在轨测试',
  ],
  娱乐: [
    '电影《{movie}》上映{n}天票房突破{n}亿元',
    '{singer}新专辑上线首日销量破{n}万张',
    '综艺《{show}》第{n}季定档，嘉宾阵容曝光',
    '剧集《{movie}》收视登顶，主演回应结局争议',
    '第{n}届电影节闭幕，《{movie}》获最佳影片',
    '{singer}{city}演唱会门票开售即告罄',
    '《{movie}》导演谈创作：用十年打磨一个故事',
    '动画电影《{movie}》定档暑期，预告片播放量破亿',
  ],
  教育: [
    '教育部：今年高考报名人数达{n}0万',
    '{city}推进义务教育学区制改革，明年起实施',
    '{univ}新增人工智能、储能科学等{n}个本科专业',
    '中小学课后服务新规下月起实施',
    '{univ}发布{year}年本科招生简章，计划招生{n}00人',
    '{city}将新建{n}所公办幼儿园，新增学位万余个',
    '研究生招生考试报名开始，报考人数预计持平',
    '{univ}与{city}共建研究院，探索产教融合',
  ],
};

/** Headlines that honestly belong to two categories; the first is the "truth" used here. */
const ambiguousHeadlines: [string, string][] = [
  ['{company}斥资{n}亿元冠名{event}，开启体育营销', '财经'],
  ['{univ}成立人工智能学院，首批招收{n}0名本科生', '教育'],
  ['{company}发布{product}，股价当日大涨{p}%', '科技'],
  ['{player}代言{company}新品，首发当日售罄', '娱乐'],
  ['电竞入选{event}正式项目，{team}组建电竞分部', '体育'],
  ['{company}推出面向中小学生的编程课程平台', '教育'],
];

export function headlines(
  n: number,
  r: Rand,
): { text: string; label: string; ambiguous: boolean }[] {
  const labels = Object.keys(headlineTemplates);
  const slots = {
    ...zh,
    a: () => String(int(r, 1, 4)),
    b: () => String(int(r, 0, 3)),
    n: () => String(int(r, 2, 28)),
    p: () => String(int(r, 5, 48)),
    year: ['2026', '2027'],
    updown: ['上涨', '下跌', '震荡走高', '小幅回落'],
  };
  const out: { text: string; label: string; ambiguous: boolean }[] = [];
  const seen = new Set<string>();
  while (out.length < n) {
    if (r() < 0.08) {
      const [tpl, label] = pick(r, ambiguousHeadlines);
      const text = fill(tpl, r, slots);
      if (!seen.has(text)) out.push({ text, label, ambiguous: true });
      seen.add(text);
      continue;
    }
    const label = labels[out.length % labels.length]!;
    const text = fill(pick(r, headlineTemplates[label]!), r, slots);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, label, ambiguous: false });
  }
  return out;
}

// ── English product reviews ─────────────────────────────────────────────────

export const REVIEW_LABELS = [
  { name: 'positive', description: 'The reviewer is satisfied overall.' },
  {
    name: 'negative',
    description: 'The reviewer is dissatisfied overall, or returned the product.',
  },
  { name: 'neutral', description: 'Mixed or purely factual; no clear overall judgement.' },
] as const;

const en = {
  product: [
    'blender',
    'kettle',
    'backpack',
    'desk lamp',
    'headphones',
    'phone case',
    'air fryer',
    'keyboard',
    'water bottle',
  ],
  good: [
    'setup took two minutes',
    'the build feels solid',
    'battery lasts for days',
    'it is quieter than my old one',
    'shipping was fast',
    'the colour matches the photos',
  ],
  bad: [
    'it stopped charging after a week',
    'the lid cracked on day three',
    'customer service never replied',
    'it smells of plastic',
    'the buttons stick',
    'one strap tore off',
  ],
  meh: [
    'it does what it says',
    'the box was slightly dented',
    'it is smaller than I expected',
    'the manual is only in English',
    'arrived on the promised date',
  ],
};

const reviewTemplates: Record<string, string[]> = {
  positive: [
    'Really happy with this {product}: {good}.',
    'Five stars. {Good}, and {good}.',
    'Bought a second {product} for my sister, {good}.',
    'Exceeded expectations — {good}.',
    'Would buy again. {Good}.',
  ],
  negative: [
    'Returned it. {Bad}.',
    'Disappointed with this {product}: {bad}.',
    'Do not recommend, {bad}.',
    'One star. {Bad}, and {bad}.',
    'Sadly {bad}. Waste of money.',
  ],
  neutral: [
    'It is a {product}. {Meh}.',
    'Average {product}; {meh}.',
    'Fine for the price, {meh}.',
    'No complaints, no praise: {meh}.',
    'Received the {product}. {Meh}.',
  ],
};

const mixedReviews: [string, string][] = [
  ['Great sound, but {bad}.', 'neutral'],
  ['{Good}, although {bad}. Keeping it anyway.', 'positive'],
  ['Looks nice. Honestly {bad}.', 'negative'],
];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function reviews(n: number, r: Rand): { text: string; label: string; ambiguous: boolean }[] {
  const slots = {
    product: en.product,
    good: en.good,
    bad: en.bad,
    meh: en.meh,
    Good: () => cap(pick(r, en.good)),
    Bad: () => cap(pick(r, en.bad)),
    Meh: () => cap(pick(r, en.meh)),
  };
  const labels = Object.keys(reviewTemplates);
  const out: { text: string; label: string; ambiguous: boolean }[] = [];
  const seen = new Set<string>();
  while (out.length < n) {
    const ambiguous = r() < 0.1;
    const [tpl, label] = ambiguous
      ? pick(r, mixedReviews)
      : (() => {
          const l = labels[out.length % labels.length]!;
          return [pick(r, reviewTemplates[l]!), l] as const;
        })();
    const text = fill(tpl, r, slots);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, label, ambiguous });
  }
  return out;
}

// ── Chinese résumé NER ──────────────────────────────────────────────────────

export const NER_LABELS = [
  { name: 'PER', description: '人名。' },
  { name: 'ORG', description: '机构：公司、学校、政府部门、研究院。' },
  { name: 'LOC', description: '地点：城市、省份、国家、区域。' },
  { name: 'TIME', description: '时间：年份、年月、时间段。' },
] as const;

const entities = {
  PER: ['张伟', '李娜', '王芳', '刘洋', '陈静', '杨帆', '赵磊', '黄敏', '周杰', '吴婷'],
  ORG: [
    '清华大学',
    '浙江大学',
    '复旦大学',
    '星海科技',
    '远航集团',
    '华辰电子',
    '中国科学院',
    '恒泰银行',
    '云帆智能',
  ],
  LOC: ['北京', '上海', '杭州', '深圳', '成都', '武汉', '西安', '南京', '新加坡'],
  TIME: ['2019年', '2021年6月', '2018年至2022年', '2023年3月', '2020年', '今年初', '2017年9月'],
};

type Part = string | { type: keyof typeof entities };
const nerTemplates: Part[][] = [
  [
    { type: 'PER' },
    '，',
    { type: 'TIME' },
    '毕业于',
    { type: 'ORG' },
    '，现居',
    { type: 'LOC' },
    '。',
  ],
  [
    { type: 'TIME' },
    '起在',
    { type: 'ORG' },
    '担任算法工程师，负责',
    { type: 'LOC' },
    '研发中心的推荐系统。',
  ],
  [{ type: 'PER' }, '曾在', { type: 'LOC' }, '的', { type: 'ORG' }, '实习六个月。'],
  ['求职意向：', { type: 'LOC' }, '，数据分析方向。联系人：', { type: 'PER' }, '。'],
  [{ type: 'TIME' }, '，', { type: 'PER' }, '加入', { type: 'ORG' }, '，参与跨境支付项目。'],
  ['本科就读于', { type: 'ORG' }, '，', { type: 'TIME' }, '获国家奖学金。'],
  [
    { type: 'PER' },
    '熟悉Python与SQL，',
    { type: 'TIME' },
    '在',
    { type: 'LOC' },
    '完成两段全职工作。',
  ],
  ['工作经历：', { type: 'ORG' }, '（', { type: 'LOC' }, '），', { type: 'TIME' }, '。'],
];

export function resumes(n: number, r: Rand): { text: string; spans: Span[] }[] {
  const out: { text: string; spans: Span[] }[] = [];
  const seen = new Set<string>();
  while (out.length < n) {
    let text = '';
    let cp = 0;
    const spans: Span[] = [];
    for (const part of pick(r, nerTemplates)) {
      const s = typeof part === 'string' ? part : pick(r, entities[part.type]);
      const len = Array.from(s).length;
      if (typeof part !== 'string') spans.push({ start: cp, end: cp + len, label: part.type });
      text += s;
      cp += len;
    }
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, spans });
  }
  return out;
}

export const HEADLINE_GUIDELINES = `## 新闻标题分类

每条标题只选**一个**最主要的类别。

- 看标题的**主题**，不看出现的名词：“某公司冠名马拉松”讲的是商业合作，归 **财经**。
- 发布新产品、新芯片归 **科技**；产品发布带动股价，以标题的重点为准。
- 明星代言、综艺、影视归 **娱乐**；运动员参加综艺也归娱乐。
- 实在拿不准时选最接近的一类，并打上 *标记*（F 键）留给审核员。`;

export const REVIEW_GUIDELINES = `## Review sentiment

Label the reviewer's **overall** judgement of the product.

- Returned the item → **negative**, whatever else they say.
- Praise and a complaint with no verdict → **neutral**.
- Delivery-only comments ("arrived on time") → **neutral**.`;

export const NER_GUIDELINES = `## 简历实体标注

- **PER** 只标人名，不含“先生/女士”等称谓。
- **ORG** 标完整机构名，“浙江大学”不要只标“浙江”。
- **LOC** 标地名；机构名里的地名不单独标。
- **TIME** 标完整时间表达，“2018年至2022年”整体标一个 TIME。`;
