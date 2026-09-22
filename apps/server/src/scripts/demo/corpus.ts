/**
 * Synthetic text for the demo instance, generated from templates. Every sentence is made up
 * here; none comes from a real corpus, and the athletes and singers are invented. Each
 * generator returns the text with the label (or entity spans) it was built from, which the
 * simulated annotators treat as the truth.
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
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

type Slots = Record<string, readonly string[] | (() => string)>;

/**
 * Fills `{slot}` placeholders. A slot used twice in one template gets two different values
 * ("{team} beat {team}"), and `{Good}` draws from the `good` pool capitalised.
 */
function fill(template: string, r: Rand, slots: Slots): string {
  const used = new Map<string, Set<string>>();
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const direct = slots[key];
    const poolKey = direct ? key : key.toLowerCase();
    const s = direct ?? slots[poolKey];
    if (!s) return key;
    if (typeof s === 'function') return s();
    const taken = used.get(poolKey) ?? new Set<string>();
    const free = s.filter((x) => !taken.has(x));
    const value = pick(r, free.length ? free : s);
    taken.add(value);
    used.set(poolKey, taken);
    return direct ? value : cap(value);
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
  player: ['李明轩', '赵一凡', '周晓彤', '孙浩然', '许文博', '林可欣', '郑宇航', '何思远'],
  company: ['星海科技', '远航集团', '华辰电子', '青禾食品', '北辰汽车', '云帆智能', '恒泰银行'],
  city: ['杭州', '深圳', '成都', '武汉', '南京', '西安', '合肥', '苏州'],
  univ: ['清华大学', '浙江大学', '复旦大学', '南京大学', '武汉大学', '中山大学'],
  movie: ['长河落日', '星际归途', '雾都迷踪', '春风十里', '孤岛来信', '追光者'],
  show: ['乘风而来', '声临其境', '奇妙之旅', '极限挑战者'],
  singer: ['林若溪', '周子航', '许嘉宁', '陈一鸣'],
  product: ['折叠屏手机', '智能手表', '电动汽车', '家用机器人', 'AR眼镜', '笔记本电脑'],
  model: ['天工', '启明', '星河', '九章', '灵犀'],
  /** Multi-sport or championship meets: they have medal tables and individual titles. */
  meet: ['亚运会', '世锦赛', '世界大学生运动会', '亚洲锦标赛'],
  /** Volleyball tournaments that end in a final. */
  vb: ['世锦赛', '亚运会', '亚洲杯', '世界联赛'],
  updown: ['上涨', '下跌', '震荡走高', '小幅回落'],
  fx: ['小幅走强', '震荡走弱', '企稳回升', '小幅回落'],
  year: ['2026', '2027'],
};

const headlineTemplates: Record<string, string[]> = {
  体育: [
    '{team}主场{score}击败{team}，{player}梅开二度',
    '{meet}：{player}以个人最好成绩夺冠',
    '中超第{round}轮：{team}客场爆冷输球',
    '{player}宣布退役，结束{career}年职业生涯',
    '{meet}落幕，中国代表团金牌数位列第一',
    '{team}官宣新帅，目标直指亚冠资格',
    '女排{sets}逆转对手，晋级{vb}决赛',
    '{city}马拉松今日鸣枪，三万名选手参赛',
  ],
  财经: [
    '{company}三季度营收同比增长{p}%，净利润创新高',
    '央行宣布下调存款准备金率{bp}个基点',
    'A股三大指数集体{updown}，成交额突破{turnover}万亿元',
    '{city}出台楼市新政，首套房首付比例降至{down}%',
    '{company}发布{yi}亿元股份回购计划',
    '人民币对美元汇率{fx}，市场关注美联储议息',
    '{company}拟赴港上市，募资规模约{yi}亿港元',
    '统计局：前三季度社会消费品零售总额同比增长{growth}%',
  ],
  科技: [
    '{company}发布新一代{product}，续航提升{p}%',
    '国产大模型“{model}”开源，参数规模达{params}亿',
    '{city}建成首个城市级自动驾驶测试区',
    '研究团队研制出新型固态电池，能量密度大幅提升',
    '{company}宣布自研芯片流片成功，采用{node}纳米工艺',
    '{univ}团队在量子通信领域取得突破',
    '{company}{product}系统升级，新增离线语音助手',
    '卫星互联网试验星发射成功，将开展在轨测试',
  ],
  娱乐: [
    '电影《{movie}》上映{days}天票房突破{box}亿元',
    '{singer}新专辑上线首日销量破{wan}万张',
    '综艺《{show}》第{season}季定档，嘉宾阵容曝光',
    '剧集《{movie}》收视登顶，主演回应结局争议',
    '第{edition}届{city}电影节闭幕，《{movie}》获最佳影片',
    '{singer}{city}演唱会门票开售即告罄',
    '《{movie}》导演谈创作：用十年打磨一个故事',
    '动画电影《{movie}》定档暑期，预告片播放量破亿',
  ],
  教育: [
    '今年高考报名人数再创新高，各地考点准备就绪',
    '{city}推进义务教育学区制改革，明年起实施',
    '{univ}新增人工智能、储能科学等{few}个本科专业',
    '中小学课后服务新规下月起实施',
    '{univ}发布{year}年本科招生简章，计划招生{enrol}人',
    '{city}将新建{kindergartens}所公办幼儿园，新增学位万余个',
    '研究生招生考试报名开始，报考人数预计持平',
    '{univ}与{city}共建研究院，探索产教融合',
  ],
};

/** Headlines that honestly belong to two categories; the first is the "truth" used here. */
const ambiguousHeadlines: [string, string][] = [
  ['{company}斥资{tenmillion}千万元冠名{city}马拉松，开启体育营销', '财经'],
  ['{univ}成立人工智能学院，首批招收{cohort}名本科生', '教育'],
  ['{company}发布{product}，股价当日大涨{jump}%', '科技'],
  ['{player}代言{company}新品，首发当日售罄', '娱乐'],
  ['电竞入选亚运会正式项目，{team}组建电竞分部', '体育'],
  ['{company}推出面向中小学生的编程课程平台', '教育'],
];

export function headlines(
  n: number,
  r: Rand,
): { text: string; label: string; ambiguous: boolean }[] {
  const labels = Object.keys(headlineTemplates);
  const slots: Slots = {
    ...zh,
    // the winner's score first, and at least two goals for 梅开二度
    score: () => {
      const won = int(r, 2, 4);
      return `${won}比${int(r, 0, won - 1)}`;
    },
    sets: ['3比2', '3比1'],
    round: () => String(int(r, 2, 28)),
    career: () => String(int(r, 8, 18)),
    p: () => String(int(r, 5, 48)),
    bp: ['25', '50'],
    turnover: ['1', '1.2', '1.5', '2'],
    down: ['15', '20', '25'],
    yi: () => String(int(r, 3, 30)),
    growth: () => (int(r, 20, 85) / 10).toFixed(1),
    params: ['70', '140', '320', '720'],
    node: ['3', '5', '7', '12', '14', '28'],
    days: () => String(int(r, 5, 30)),
    box: () => String(int(r, 2, 20)),
    wan: () => String(int(r, 5, 80)),
    season: () => String(int(r, 2, 6)),
    edition: () => String(int(r, 8, 30)),
    few: () => String(int(r, 3, 8)),
    enrol: () => String(int(r, 30, 72) * 100),
    kindergartens: () => String(int(r, 30, 80)),
    tenmillion: () => String(int(r, 2, 9)),
    cohort: () => String(int(r, 6, 24) * 10),
    jump: () => String(int(r, 5, 10)),
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

// Phrases that fit every product in the list, so no water bottle gets a battery.
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
    'the build feels solid',
    'it works exactly as described',
    'shipping was fast',
    'the colour matches the photos',
    'it feels well made',
    'it is lighter than it looks',
  ],
  bad: [
    'it fell apart after a week',
    'it arrived damaged',
    'customer service never replied',
    'it smells of plastic',
    'the finish started peeling',
    'a part was missing from the box',
  ],
  meh: [
    'it does what it says',
    'the box was slightly dented',
    'it is smaller than I expected',
    'the manual is only in English',
    'it arrived on the promised date',
  ],
};

const reviewTemplates: Record<string, string[]> = {
  positive: [
    'Really happy with this {product}: {good}.',
    'Five stars. {Good}, and {good}.',
    'Bought a second {product} for my sister because {good}.',
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
    'It is {a_product}. {Meh}.',
    'Average {product}; {meh}.',
    'Fine for the price, {meh}.',
    'No complaints, no praise: {meh}.',
    'Received the {product}. {Meh}.',
  ],
};

const mixedReviews: [string, string][] = [
  ['Nice design, but {bad}.', 'neutral'],
  ['{Good}, although {bad}. Keeping it anyway.', 'positive'],
  ['Looks nice. Honestly {bad}.', 'negative'],
];

export function reviews(n: number, r: Rand): { text: string; label: string; ambiguous: boolean }[] {
  const slots: Slots = {
    ...en,
    a_product: () => {
      const p = pick(r, en.product);
      return `${/^[aeiou]/.test(p) ? 'an' : 'a'} ${p}`;
    },
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

// Finer pools than the labels, so a sentence never graduates from a company or starts
// "from" a time range.
const pools = {
  person: ['张伟', '李娜', '王芳', '刘洋', '陈静', '杨帆', '赵磊', '黄敏', '周杰', '吴婷'],
  school: ['清华大学', '浙江大学', '复旦大学', '南京大学', '武汉大学', '中国科学院大学'],
  company: ['星海科技', '远航集团', '华辰电子', '恒泰银行', '云帆智能', '青禾食品'],
  place: ['北京', '上海', '杭州', '深圳', '成都', '武汉', '西安', '南京', '新加坡'],
  date: ['2019年', '2021年6月', '2023年3月', '2020年', '今年初', '2017年9月'],
  period: ['2018年至2022年', '2019年至今', '2020年至2023年', '2016年至2019年'],
} as const;

type Pool = keyof typeof pools;
const POOL_LABEL: Record<Pool, (typeof NER_LABELS)[number]['name']> = {
  person: 'PER',
  school: 'ORG',
  company: 'ORG',
  place: 'LOC',
  date: 'TIME',
  period: 'TIME',
};

type Part = string | { pool: Pool };
const nerTemplates: Part[][] = [
  [
    { pool: 'person' },
    '，',
    { pool: 'date' },
    '毕业于',
    { pool: 'school' },
    '，现居',
    { pool: 'place' },
    '。',
  ],
  [
    { pool: 'date' },
    '起在',
    { pool: 'company' },
    '担任算法工程师，负责',
    { pool: 'place' },
    '研发中心的推荐系统。',
  ],
  [{ pool: 'person' }, '曾在', { pool: 'place' }, '的', { pool: 'company' }, '实习六个月。'],
  ['求职意向：', { pool: 'place' }, '，数据分析方向。联系人：', { pool: 'person' }, '。'],
  [{ pool: 'date' }, '，', { pool: 'person' }, '加入', { pool: 'company' }, '，参与跨境支付项目。'],
  ['本科就读于', { pool: 'school' }, '，', { pool: 'date' }, '获国家奖学金。'],
  [
    { pool: 'person' },
    '熟悉Python与SQL，',
    { pool: 'period' },
    '在',
    { pool: 'place' },
    '完成两段全职工作。',
  ],
  ['工作经历：', { pool: 'company' }, '（', { pool: 'place' }, '），', { pool: 'period' }, '。'],
];

export function resumes(n: number, r: Rand): { text: string; spans: Span[] }[] {
  const out: { text: string; spans: Span[] }[] = [];
  const seen = new Set<string>();
  while (out.length < n) {
    let text = '';
    let cp = 0;
    const spans: Span[] = [];
    for (const part of pick(r, nerTemplates)) {
      const s = typeof part === 'string' ? part : pick(r, pools[part.pool]);
      const len = Array.from(s).length;
      if (typeof part !== 'string') {
        spans.push({ start: cp, end: cp + len, label: POOL_LABEL[part.pool] });
      }
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
