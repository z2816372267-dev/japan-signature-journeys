'use strict';

const JOURNEY_ID_PATTERN = /^[a-z][a-z0-9-]{2,63}$/;

const REGION_DEFINITIONS = Object.freeze([
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

const SEASON_DEFINITIONS = Object.freeze({
  all: {
    id: 'all',
    label: '四季通用',
    defaultVariant: '四季通用',
    colors: ['#f3efe6', '#31443b', '#a99067'],
  },
  spring: {
    id: 'spring',
    label: '春日·樱',
    defaultVariant: '樱花与新绿',
    colors: ['#f7f0ed', '#d9aeb6', '#879779'],
  },
  summer: {
    id: 'summer',
    label: '夏日·青',
    defaultVariant: '青枫与水色',
    colors: ['#eef4f1', '#28545d', '#a9cbc8'],
  },
  autumn: {
    id: 'autumn',
    label: '秋日·枫',
    defaultVariant: '枫狩与金秋',
    colors: ['#f2e7d8', '#994d3e', '#c48a49'],
  },
  winter: {
    id: 'winter',
    label: '冬日·雪',
    defaultVariant: '雪国与温泉',
    colors: ['#f2f6f6', '#29424c', '#bed1d8'],
  },
});

function cleanSingleLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function regionDefinition(value) {
  const input = String(value || '').trim().toLowerCase();
  return REGION_DEFINITIONS.find((item) => item.id === input || item.code === input)
    || REGION_DEFINITIONS.find((item) => item.id === 'kanto');
}

function seasonDefinition(value) {
  return SEASON_DEFINITIONS[String(value || '').trim().toLowerCase()] || SEASON_DEFINITIONS.all;
}

function defaultManagement(data) {
  const region = regionDefinition(data?.regionId);
  const season = seasonDefinition(data?.management?.season);
  const daysCount = Array.isArray(data?.days) ? data.days.length : 1;
  return {
    regionCode: region.code,
    regionName: region.name,
    regionLatin: region.latin,
    season: season.id,
    seasonVariant: season.defaultVariant,
    travelMonths: '全年适用',
    visibility: 'published',
    order: 10,
    nights: Math.max(0, daysCount - 1),
  };
}

function normalizeJourney(data) {
  if (!data || typeof data !== 'object') return data;
  const defaults = defaultManagement(data);
  data.schemaVersion = 2;
  data.management = {
    ...defaults,
    ...(data.management && typeof data.management === 'object' ? data.management : {}),
  };
  const region = regionDefinition(data.regionId || data.management.regionCode);
  data.regionId = region.id;
  data.management.regionCode = region.code;
  data.management.regionName = region.name;
  data.management.regionLatin = region.latin;
  const season = seasonDefinition(data.management.season);
  data.management.season = season.id;
  data.management.seasonVariant = cleanSingleLine(data.management.seasonVariant) || season.defaultVariant;
  data.management.travelMonths = cleanSingleLine(data.management.travelMonths) || '全年适用';
  data.management.visibility = data.management.visibility === 'hidden' ? 'hidden' : 'published';
  data.management.order = Number.isFinite(Number(data.management.order))
    ? Math.max(0, Math.min(9999, Math.round(Number(data.management.order))))
    : 10;
  data.management.nights = Number.isFinite(Number(data.management.nights))
    ? Math.max(0, Math.min(60, Math.round(Number(data.management.nights))))
    : Math.max(0, (Array.isArray(data.days) ? data.days.length : 1) - 1);
  data.booking ||= {};
  data.booking.maxGuests = Number.isFinite(Number(data.booking.maxGuests))
    ? Math.max(1, Math.min(50, Math.round(Number(data.booking.maxGuests))))
    : 8;
  data.seo = {
    title: cleanSingleLine(data.seo?.title || data.card?.title || ''),
    description: cleanSingleLine(data.seo?.description || data.card?.summary || ''),
  };
  data.map ||= {};
  if (!['summary', 'image', 'legacy'].includes(data.map.mode)) {
    data.map.mode = data.map.image ? 'image' : data.map.desktop && data.map.mobile ? 'legacy' : 'summary';
  }
  if (data.map.mode === 'image' && !data.map.image) data.map.mode = 'summary';
  return data;
}

function catalogItemFromJourney(input) {
  const data = normalizeJourney(structuredClone(input));
  const daysCount = Array.isArray(data.days) ? data.days.length : 0;
  return {
    id: data.id,
    productCode: data.productCode,
    regionId: data.regionId,
    regionCode: data.management.regionCode,
    regionName: data.management.regionName,
    regionLatin: data.management.regionLatin,
    season: data.management.season,
    seasonVariant: data.management.seasonVariant,
    travelMonths: data.management.travelMonths,
    visibility: data.management.visibility,
    order: data.management.order,
    daysCount,
    nightsCount: data.management.nights,
    maxGuests: data.booking.maxGuests,
    title: data.card.title,
    summary: data.card.summary,
    meta: [...data.card.meta],
    image: structuredClone(data.hero.image),
    href: `journeys/${data.id}/`,
    updatedAt: new Date().toISOString(),
  };
}

function emptyCatalog() {
  return { schemaVersion: 1, journeys: [] };
}

function normalizeCatalog(input) {
  const catalog = input && typeof input === 'object' ? structuredClone(input) : emptyCatalog();
  catalog.schemaVersion = 1;
  catalog.journeys = Array.isArray(catalog.journeys)
    ? catalog.journeys.filter((item) => item && JOURNEY_ID_PATTERN.test(String(item.id || '')))
    : [];
  catalog.journeys.sort((left, right) => {
    const regionOrder = String(left.regionCode || '').localeCompare(String(right.regionCode || ''));
    if (regionOrder) return regionOrder;
    const itemOrder = Number(left.order || 0) - Number(right.order || 0);
    if (itemOrder) return itemOrder;
    return String(left.title || '').localeCompare(String(right.title || ''), 'zh-CN');
  });
  return catalog;
}

function upsertCatalogJourney(catalogInput, journey) {
  const catalog = normalizeCatalog(catalogInput);
  const item = catalogItemFromJourney(journey);
  const index = catalog.journeys.findIndex((entry) => entry.id === item.id);
  if (index >= 0) {
    const previous = catalog.journeys[index];
    const comparablePrevious = { ...previous, updatedAt: undefined };
    const comparableNext = { ...item, updatedAt: undefined };
    if (JSON.stringify(comparablePrevious) === JSON.stringify(comparableNext)) {
      item.updatedAt = previous.updatedAt || item.updatedAt;
    }
    catalog.journeys[index] = item;
  }
  else catalog.journeys.push(item);
  return normalizeCatalog(catalog);
}

module.exports = {
  JOURNEY_ID_PATTERN,
  REGION_DEFINITIONS,
  SEASON_DEFINITIONS,
  catalogItemFromJourney,
  emptyCatalog,
  normalizeCatalog,
  normalizeJourney,
  regionDefinition,
  seasonDefinition,
  upsertCatalogJourney,
};
