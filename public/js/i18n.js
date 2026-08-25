'use strict';

window.PDS_I18N = {
  en: {
    langLabel: 'EN',
    locale: 'en-IN',
    trainNo: 'Train No',
    trainName: 'Train Name',
    from: 'From',
    to: 'To',
    arrival: 'Arrival',
    departure: 'Departure',
    pf: 'PF',
    status: 'Status',
    lastUpdated: 'Last Updated',
    autoRefresh: 'Auto Refresh Every',
    seconds: 'Seconds',
    stationCode: 'Station Code',
    source: 'Source',
    sourceNtes: 'NTES Live Station',
    page: 'Page',
    pageOf: 'Page {n} of {total}',
    noTrains: 'No upcoming trains at this time',
    loading: 'Loading train information…',
    unable: 'Unable to load train data. Retrying…',
    stopped: 'This display session was stopped by an administrator.',
    reconnect: 'Reconnect',
    sch: 'Sch',
    railwayStation: 'RAILWAY STATION',
    live: 'LIVE',
    paused: 'PAUSED',
    stoppedStatus: 'STOPPED',
    start: 'Start',
    stop: 'Stop',
    startTitle: 'Start live refresh',
    stopTitle: 'Stop live refresh',
    pfOverrideTitle: 'Manual platform override',
    onTime: 'On Time',
    arrived: 'Arrived',
    departed: 'Departed',
    cancelled: 'Cancelled',
    diverted: 'Diverted',
    lateBy: 'Late by {n} mins'
  },
  te: {
    langLabel: 'తె',
    locale: 'te-IN',
    trainNo: 'రైలు సంఖ్య',
    trainName: 'రైలు పేరు',
    from: 'నుండి',
    to: 'వరకు',
    arrival: 'రాక',
    departure: 'నిష్క్రమణ',
    pf: 'ప్లాట్‌ఫామ్',
    status: 'స్థితి',
    lastUpdated: 'చివరిగా నవీకరించినది',
    autoRefresh: 'స్వయం నవీకరణ ప్రతి',
    seconds: 'సెకన్లు',
    stationCode: 'స్టేషన్ కోడ్',
    source: 'మూలం',
    sourceNtes: 'NTES ప్రత్యక్ష స్టేషన్',
    page: 'పేజీ',
    pageOf: 'Page {n} of {total}',
    noTrains: 'ప్రస్తుతం రైళ్లు లేవు',
    loading: 'రైలు సమాచారం లోడ్ అవుతోంది…',
    unable: 'డేటా లోడ్ కాలేదు. మళ్లీ ప్రయత్నిస్తోంది…',
    stopped: 'ఈ ప్రదర్శన సెషన్‌ను నిర్వాహకులు ఆపారు.',
    reconnect: 'మళ్లీ కనెక్ట్',
    sch: 'నిర్ణీత',
    railwayStation: 'రైల్వే స్టేషన్',
    live: 'ప్రత్యక్షం',
    paused: 'నిలిపివేయబడింది',
    stoppedStatus: 'ఆపివేయబడింది',
    start: 'ప్రారంభం',
    stop: 'ఆపు',
    startTitle: 'ప్రత్యక్ష నవీకరణ ప్రారంభించు',
    stopTitle: 'ప్రత్యక్ష నవీకరణ ఆపు',
    pfOverrideTitle: 'మాన్యువల్ ప్లాట్‌ఫామ్ మార్పు',
    onTime: 'సమయానికి',
    arrived: 'వచ్చింది',
    departed: 'వెళ్లింది',
    cancelled: 'రద్దు',
    diverted: 'మార్గం మార్చబడింది',
    lateBy: '{n} నిమి ఆలస్యం'
  },
  hi: {
    langLabel: 'हि',
    locale: 'hi-IN',
    trainNo: 'ट्रेन नं',
    trainName: 'ट्रेन का नाम',
    from: 'से',
    to: 'तक',
    arrival: 'आगमन',
    departure: 'प्रस्थान',
    pf: 'प्लेटफॉर्म',
    status: 'स्थिति',
    lastUpdated: 'अंतिम अद्यतन',
    autoRefresh: 'स्वतः ताज़ा हर',
    seconds: 'सेकंड',
    stationCode: 'स्टेशन कोड',
    source: 'स्रोत',
    sourceNtes: 'NTES लाइव स्टेशन',
    page: 'पृष्ठ',
    pageOf: 'Page {n} of {total}',
    noTrains: 'इस समय कोई ट्रेन नहीं',
    loading: 'ट्रेन जानकारी लोड हो रही है…',
    unable: 'डेटा लोड नहीं हुआ. पुनः प्रयास…',
    stopped: 'यह डिस्प्ले सत्र व्यवस्थापक द्वारा रोक दिया गया।',
    reconnect: 'फिर से जोड़ें',
    sch: 'निर्धारित',
    railwayStation: 'रेलवे स्टेशन',
    live: 'लाइव',
    paused: 'रुका हुआ',
    stoppedStatus: 'रोका गया',
    start: 'शुरू',
    stop: 'रोकें',
    startTitle: 'लाइव रीफ़्रेश शुरू करें',
    stopTitle: 'लाइव रीफ़्रेश रोकें',
    pfOverrideTitle: 'मैन्युअल प्लेटफ़ॉर्म बदलाव',
    onTime: 'समय पर',
    arrived: 'आ गई',
    departed: 'प्रस्थान',
    cancelled: 'रद्द',
    diverted: 'मार्ग परिवर्तित',
    lateBy: '{n} मिनट विलंब'
  }
};

const TRAIN_NAME_TOKENS = {
  en: {},
  te: {
    EXPRESS: 'ఎక్స్‌ప్రెస్',
    EXP: 'ఎక్స్‌ప్రెస్',
    SF: 'సూపర్‌ఫాస్ట్',
    SUPERFAST: 'సూపర్‌ఫాస్ట్',
    MEMU: 'మెము',
    DEMU: 'డెము',
    PASSENGER: 'ప్యాసింజర్',
    PASS: 'ప్యాసింజర్',
    SPECIAL: 'స్పెషల్',
    SPL: 'స్పెషల్',
    MAIL: 'మెయిల్',
    LOCAL: 'లోకల్',
    JN: 'జం',
    JUNCTION: 'జంక్షన్'
  },
  hi: {
    EXPRESS: 'एक्सप्रेस',
    EXP: 'एक्सप्रेस',
    SF: 'सुपरफास्ट',
    SUPERFAST: 'सुपरफास्ट',
    MEMU: 'मेमू',
    DEMU: 'डेमू',
    PASSENGER: 'पैसेंजर',
    PASS: 'पैसेंजर',
    SPECIAL: 'स्पेशल',
    SPL: 'स्पेशल',
    MAIL: 'मेल',
    LOCAL: 'लोकल',
    JN: 'जं',
    JUNCTION: 'जंक्शन'
  }
};

const NAMED_TRAINS = {
  'SATAVAHANA SF': { te: 'శాతవాహన సూపర్‌ఫాస్ట్', hi: 'सातवाहन सुपरफास्ट' },
  'SATAVAHANA EXPRESS': { te: 'శాతవాహన ఎక్స్‌ప్రెస్', hi: 'सातवाहन एक्सप्रेस' },
  'BHAGYANAGAR EXP': { te: 'భాగ్యనగర్ ఎక్స్‌ప్రెస్', hi: 'भाग्यनगर एक्सप्रेस' },
  'BHAGYANAGAR EXPRESS': { te: 'భాగ్యనగర్ ఎక్స్‌ప్రెస్', hi: 'भाग्यनगर एक्सप्रेस' },
  'FALAKNUMA EXP': { te: 'ఫలక్నుమా ఎక్స్‌ప్రెస్', hi: 'फलकनुमा एक्सप्रेस' },
  'FALAKNUMA EXPRESS': { te: 'ఫలక్నుమా ఎక్స్‌ప్రెస్', hi: 'फलकनुमा एक्सप्रेस' },
  'SABARI EXPRESS': { te: 'శబరి ఎక్స్‌ప్రెస్', hi: 'सबरी एक्सप्रेस' },
  'SABARI EXP': { te: 'శబరి ఎక్స్‌ప్రెస్', hi: 'सबरी एक्सप्रेस' },
  'EAST COAST EXPRESS': { te: 'ఈస్ట్ కోస్ట్ ఎక్స్‌ప్రెస్', hi: 'ईस्ट कोस्ट एक्सप्रेस' },
  'EAST COAST EXP': { te: 'ఈస్ట్ కోస్ట్ ఎక్స్‌ప్రెస్', hi: 'ईस्ट कोस्ट एक्सप्रेस' },
  'CHENNAI SF EXP': { te: 'చెన్నై సూపర్‌ఫాస్ట్ ఎక్స్‌ప్రెస్', hi: 'चेन्नई सुपरफास्ट एक्सप्रेस' },
  'CHENNAI EXPRESS': { te: 'చెన్నై ఎక్స్‌ప్రెస్', hi: 'चेन्नई एक्सप्रेस' },
  'CHARMINAR EXP': { te: 'చార్మినార్ ఎక్స్‌ప్రెస్', hi: 'चारमीनार एक्सप्रेस' },
  'CHARMINAR EXPRESS': { te: 'చార్మినార్ ఎక్స్‌ప్రెస్', hi: 'चारमीनार एक्सप्रेस' },
  'GOUTAMI EXP': { te: 'గౌతమి ఎక్స్‌ప్రెస్', hi: 'गौतमी एक्सप्रेस' },
  'GOUTAMI EXPRESS': { te: 'గౌతమి ఎక్స్‌ప్రెస్', hi: 'गौतमी एक्सप्रेस' },
  'GODAVARI EXP': { te: 'గోదావరి ఎక్స్‌ప్రెస్', hi: 'गोदावरी एक्सप्रेस' },
  'GODAVARI EXPRESS': { te: 'గోదావరి ఎక్స్‌ప్రెస్', hi: 'गोदावरी एक्सप्रेस' },
  'VSKP SF EXP': { te: 'విశాఖపట్నం సూపర్‌ఫాస్ట్ ఎక్స్‌ప్రెస్', hi: 'विशाखापत्तनम सुपरफास्ट एक्सप्रेस' }
};

function normalizeStationKey(name) {
  return String(name || '')
    .toUpperCase()
    .replace(/[.]/g, '')
    .replace(/\bJUNCTION\b/g, 'JN')
    .replace(/\s+/g, ' ')
    .trim();
}

window.PDS_translateStatus = function translateStatus(status, lang) {
  const dict = window.PDS_I18N[lang] || window.PDS_I18N.en;
  const s = String(status || '');
  if (/^on time$/i.test(s)) return dict.onTime;
  if (/^arrived$/i.test(s)) return dict.arrived;
  if (/^departed$/i.test(s)) return dict.departed;
  if (/cancel/i.test(s)) return dict.cancelled;
  if (/divert/i.test(s)) return dict.diverted;
  const late = s.match(/late by\s+(\d+)\s*mins?/i);
  if (late) return dict.lateBy.replace('{n}', late[1]);
  return s;
};

window.PDS_localizeStationName = function localizeStationName(name, lang, stationsByNameMap) {
  if (!name) return '—';
  if (!lang || lang === 'en') return name;
  const map = stationsByNameMap || {};
  const key = normalizeStationKey(name);
  const candidates = [
    key,
    key.replace(/\s+JN$/, ''),
    key.replace(/\s+CITY$/, ''),
    key.replace(/\s+RD$/, ' ROAD'),
    key.replace(/\s+ROAD$/, ' RD'),
    `${key.replace(/\s+JN$/, '')} JN`
  ];
  let row = null;
  for (const c of candidates) {
    if (map[c]) {
      row = map[c];
      break;
    }
  }
  if (!row) {
    const hit = Object.keys(map).find((k) => k.startsWith(key) || key.startsWith(k));
    if (hit) row = map[hit];
  }
  if (row && row[lang]) return row[lang];
  return name;
};

window.PDS_localizeTrainName = function localizeTrainName(name, lang) {
  if (!name) return '—';
  if (!lang || lang === 'en') return name;
  const upper = String(name).toUpperCase().replace(/\s+/g, ' ').trim();
  const named = NAMED_TRAINS[upper];
  if (named && named[lang]) return named[lang];

  const tokens = TRAIN_NAME_TOKENS[lang] || {};
  return String(name)
    .split(/(\s+|[-/])/)
    .map((part) => {
      const key = part.toUpperCase();
      return tokens[key] || part;
    })
    .join('');
};
