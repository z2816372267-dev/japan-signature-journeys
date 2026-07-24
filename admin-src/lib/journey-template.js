export const JOURNEY_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

export const REGIONS = Object.freeze([
  { id: 'bando', code: '01', name: '阪东连线', latin: 'BANDO', places: '大阪 · 京都 · 东京' },
  { id: 'kanto', code: '02', name: '关东地区', latin: 'KANTO', places: '东京 · 伊豆 · 镰仓' },
  { id: 'kansai', code: '03', name: '关西地区', latin: 'KANSAI', places: '大阪 · 京都 · 奈良' },
  { id: 'chubu', code: '04', name: '中部地区', latin: 'CHUBU', places: '名古屋 · 金泽 · 高山' },
  { id: 'tohoku', code: '05', name: '东北地区', latin: 'TOHOKU', places: '仙台 · 青森 · 山形' },
  { id: 'chugoku', code: '06', name: '中国地区', latin: 'CHUGOKU', places: '鸟取 · 冈山 · 广岛' },
  { id: 'shikoku', code: '07', name: '四国地区', latin: 'SHIKOKU', places: '香川 · 爱媛 · 德岛' },
  { id: 'kyushu', code: '08', name: '九州地区', latin: 'KYUSHU', places: '福冈 · 熊本 · 鹿儿岛' },
  { id: 'hokkaido', code: '09', name: '北海道地区', latin: 'HOKKAIDO', places: '札幌 · 函馆 · 知床' },
]);

export const SEASONS = Object.freeze([
  {
    id: 'all',
    label: '四季通用',
    motif: '留白、和纸与飞鸟金',
    variant: '四季通用',
    palette: ['#f3efe6', '#31443b', '#a99067'],
  },
  {
    id: 'spring',
    label: '春日·樱',
    motif: '樱瓣、柔粉与新绿',
    variant: '樱花与新绿',
    palette: ['#f7f0ed', '#d9aeb6', '#879779'],
  },
  {
    id: 'summer',
    label: '夏日·青',
    motif: '青枫、水色与通透留白',
    variant: '青枫与水色',
    palette: ['#eef4f1', '#28545d', '#a9cbc8'],
  },
  {
    id: 'autumn',
    label: '秋日·枫',
    motif: '枫叶、赭红与暖金',
    variant: '枫狩与金秋',
    palette: ['#f2e7d8', '#994d3e', '#c48a49'],
  },
  {
    id: 'winter',
    label: '冬日·雪',
    motif: '雪点、雾蓝与温泉暖色',
    variant: '雪国与温泉',
    palette: ['#f2f6f6', '#29424c', '#bed1d8'],
  },
]);

export function cloneValue(value) {
  return window.structuredClone ? window.structuredClone(value) : JSON.parse(JSON.stringify(value));
}

export function regionById(value) {
  return REGIONS.find((region) => region.id === value || region.code === value) || REGIONS[1];
}

export function seasonById(value) {
  return SEASONS.find((season) => season.id === value) || SEASONS[0];
}

export function createBlankDay(index) {
  return {
    number: String(index + 1).padStart(2, '0'),
    title: '',
    route: '',
    stops: [''],
    story: '',
    image: null,
    distance: { value: '', note: '' },
    duration: { value: '', note: '' },
    activity: { value: '', note: '' },
    comfort: { value: '', note: '' },
    meals: { breakfast: '', lunch: '', dinner: '' },
    hotel: '',
    footnote: '',
  };
}

export function reindexDays(data) {
  data.days ||= [];
  data.days.forEach((day, index) => {
    day.number = String(index + 1).padStart(2, '0');
  });
  data.management ||= {};
  data.management.nights = Math.max(0, data.days.length - 1);
  data.map ||= {};
  data.map.days = data.days.map((day) => ({
    number: day.number,
    title: day.title,
    route: day.route,
  }));
  const duration = data.management.nights > 0
    ? `${data.days.length}日${data.management.nights}晚`
    : `${data.days.length}日`;
  if (Array.isArray(data.card?.meta) && data.card.meta.length) data.card.meta[0] = duration;
  if (Array.isArray(data.hero?.breadcrumb) && data.hero.breadcrumb.length) {
    data.hero.breadcrumb[data.hero.breadcrumb.length - 1] = duration;
  }
  if (Array.isArray(data.hero?.tags)) {
    const durationIndex = data.hero.tags.findIndex((item) => /^\d+日/.test(item));
    if (durationIndex >= 0) data.hero.tags[durationIndex] = duration;
  }
  const durationFact = data.overview?.facts?.find((fact) => fact.label === 'DURATION');
  if (durationFact) durationFact.value = duration;
  return data;
}

export function normalizeJourney(input) {
  const data = cloneValue(input);
  const region = regionById(data.regionId || data.management?.regionCode);
  const season = seasonById(data.management?.season);
  data.schemaVersion = 2;
  data.regionId = region.id;
  data.management = {
    regionCode: region.code,
    regionName: region.name,
    regionLatin: region.latin,
    season: season.id,
    seasonVariant: season.variant,
    travelMonths: '全年适用',
    visibility: 'published',
    order: 10,
    nights: Math.max(0, (data.days?.length || 1) - 1),
    ...(data.management || {}),
  };
  data.management.regionCode = region.code;
  data.management.regionName = region.name;
  data.management.regionLatin = region.latin;
  data.management.season = season.id;
  data.management.seasonVariant ||= season.variant;
  data.booking ||= {};
  data.booking.maxGuests = Math.max(1, Math.min(50, Number(data.booking.maxGuests) || 8));
  data.seo = {
    title: data.seo?.title || data.card?.title?.replaceAll('\n', ' ') || '',
    description: data.seo?.description || data.card?.summary || '',
  };
  data.map ||= {};
  data.map.mode ||= data.map.desktop && data.map.mobile ? 'legacy' : 'summary';
  return reindexDays(data);
}

export function createJourneyFromTemplate(source, options) {
  const data = normalizeJourney(source);
  const region = regionById(options.regionId);
  const season = seasonById(options.season);
  const daysCount = Math.max(1, Math.min(30, Number(options.daysCount) || data.days.length || 1));
  data.id = options.id;
  data.productCode = options.productCode;
  data.regionId = region.id;
  data.management = {
    ...data.management,
    regionCode: region.code,
    regionName: region.name,
    regionLatin: region.latin,
    season: season.id,
    seasonVariant: season.variant,
    travelMonths: options.travelMonths || (season.id === 'all' ? '全年适用' : ''),
    visibility: 'hidden',
    order: 100,
    nights: Math.max(0, daysCount - 1),
  };
  data.card.title = options.title;
  data.hero.title = options.title;
  data.booking.title = options.title;
  data.seo.title = options.title.replaceAll('\n', ' ');
  data.seo.description = data.card.summary;
  data.hero.kicker = `ASUKA SIGNATURE JOURNEY · ${region.latin}`;
  data.card.kicker = data.hero.kicker;
  data.hero.breadcrumb = ['日本心旅行', region.name, `${daysCount}日${Math.max(0, daysCount - 1)}晚`];
  if (Array.isArray(data.hero.tags) && data.hero.tags.length) data.hero.tags[0] = region.name;
  data.booking.productGroup = `日本心旅行·${region.name}`;
  data.map.mode = 'summary';
  delete data.map.image;
  delete data.map.desktop;
  delete data.map.mobile;
  data.map.title = `${daysCount}日动线，一目了然`;
  data.map.alt = `${options.title.replaceAll('\n', '')}逐日路线摘要`;
  data.map.copy = '按照每日停靠顺序梳理完整动线；发布前请结合实际用车、住宿位置与季节交通复核。';
  data.map.caption = '最终路线可能因酒店位置、实时交通、天气与当地运营条件调整。';

  if (daysCount < data.days.length) data.days = data.days.slice(0, daysCount);
  while (data.days.length < daysCount) data.days.push(createBlankDay(data.days.length));
  if (options.mode === 'structure') {
    data.card.summary = '';
    data.hero.copy = '';
    data.hero.status = '后台制作中 · 尚未发布';
    if (data.hero.image) data.hero.image._templatePlaceholder = true;
    data.overview.title = '';
    data.overview.copy = '';
    data.overview.route = '';
    data.overview.facts?.forEach((fact) => {
      if (fact.label !== 'DURATION') fact.value = '';
    });
    data.days = Array.from({ length: daysCount }, (_, index) => createBlankDay(index));
    data.highlights.title = '';
    data.highlights.copy = '';
    data.highlights.items?.forEach((item) => {
      item.eyebrow = '';
      item.title = '';
      if (item.image) item.image._templatePlaceholder = true;
    });
    data.stays.title = '';
    data.stays.copy = '';
    data.stays.groups?.forEach((group) => {
      group.eyebrow = '';
      group.title = '';
      group.hotels = [''];
      group.copy = '';
    });
    data.notes.title = '行程说明';
    data.notes.copy = '';
    data.booking.currentStatus = '后台制作中';
    data.booking.departure = '待公布';
    data.booking.price = '待公布';
    data.seo.description = '';
  }
  return reindexDays(data);
}

export function duplicateDay(data, index) {
  if (data.days.length >= 30) return false;
  data.days.splice(index + 1, 0, cloneValue(data.days[index]));
  reindexDays(data);
  return true;
}

export function addBlankDay(data, index = data.days.length) {
  if (data.days.length >= 30) return false;
  data.days.splice(index, 0, createBlankDay(index));
  reindexDays(data);
  return true;
}

export function moveDay(data, from, to) {
  if (to < 0 || to >= data.days.length || from === to) return false;
  const [day] = data.days.splice(from, 1);
  data.days.splice(to, 0, day);
  reindexDays(data);
  return true;
}

export function removeDay(data, index) {
  if (data.days.length <= 1) return false;
  data.days.splice(index, 1);
  reindexDays(data);
  return true;
}
