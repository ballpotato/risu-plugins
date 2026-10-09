//@name wall_painter
//@display-name 🖌️ Wall Painter v0.9.24
//@api 3.0
//@version 0.9.24
//@update-url https://raw.githubusercontent.com/ballpotato/risu-plugins/main/wall-painter/wall_painter.js
//@description 채팅 상황에 맞춰 채팅 배경을 자동으로 바꿉니다. 메인모델 태그 주입 + 보조모델 폴백 + 봇 에셋 자동 태깅.

// ─────────────────────────────────────────────────────────────
// Wall Painter — RisuAI 채팅 배경 자동 교체 플러그인
//
// 이 플러그인은 CC BY-NC-SA 4.0 라이선스를 따릅니다.
// (저작자 표시 - 비영리 - 동일조건 변경허락 4.0 국제)
// https://creativecommons.org/licenses/by-nc-sa/4.0/deed.ko
//
// - 저작자 표시: 공유하거나 고쳐 쓸 때 원 저작자와 출처를 밝혀야 합니다.
// - 비영리: 영리 목적으로 쓸 수 없습니다.
// - 동일조건 변경허락: 고쳐서 배포하면 같은 라이선스로 배포해야 합니다.
// ─────────────────────────────────────────────────────────────

(async () => {
  // ─────────────────────────────────────────────────────────────
  // 상수
  // ─────────────────────────────────────────────────────────────
  const VERSION = '0.9.24';             // 머리말 //@version과 맞출 것
  const PREFIX = 'autobg_';                 // 로컬 저장소는 모든 플러그인이 공유하므로 접두사 필수
  const KEY_SETTINGS = PREFIX + 'settings';
  const KEY_META = PREFIX + 'meta';         // 이미지 메타데이터 목록 (이미지 데이터 제외)
  const KEY_IMG = PREFIX + 'img_';          // + id → dataURL (직접 올린 이미지만)
  const KEY_CHAT = PREFIX + 'chat_';
  const KEY_CHECKED = PREFIX + 'checked_';   // 캐릭터별로 스캔에서 이미 확인한 에셋 경로 (배경이 아니라고 판단된 것 포함)
  const KEY_AUX_SCENES = PREFIX + 'auxscenes';   // 보조모델이 판단한 답변별 장면 { chatKey: [기록] }
  const KEY_THUMB = PREFIX + 'thumb_';      // + id → 작은 썸네일 dataURL (다시 열 때 빠르게)        // + chatKey → 감지 상태
  const STYLE_XID = 'x-autobg-style';

  const TIMES = ['day', 'evening', 'night'];
  const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
  const TIME_LABEL = { day: '낮', evening: '저녁', night: '밤' };
  const SEASON_LABEL = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
  const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif', 'bmp'];

  // 메인모델 출력 태그. 응답 안에 여러 개면 마지막 것을 사용 (장면 이동 반영)
  const TAG_RE = /\[BG:\s*([^\]\n]*)\]/gi;

  // RisuAI 채팅 화면 루트(DefaultChatScreen). 테마리스 테마 선택자(클래스 6개)보다
  // 구체성을 높이려고 클래스를 중복 지정함 (클래스 8개).
  const BG_TARGET =
    'html body div.w-full.w-full.h-full.h-full.relative.relative:has(>.default-chat-screen.default-chat-screen)';

  const MAX_IMAGE_DIM = 1920;
  const THUMB_DIM = 360;
  const AUX_TEXT_LIMIT = 8000;
  const AUX_NAMES_PER_CALL = 150;

  const DEFAULT_SETTINGS = {
    enabled: true,
    inject: true,          // 메인모델 프롬프트에 태그 출력 지시 주입
    auxFallback: true,     // 태그가 없으면 보조모델로 판단
    hideThemeFx: true,     // 이 플러그인 배경이 떠 있는 동안 다른 테마의 배경 효과(흐림·어둡게·패턴)를 끔
    lastAux: null,         // 마지막 보조모델 호출 결과 {ok, at, error}
    collapsed: {},         // 설정창에서 접어 둔 구역 {settings, visual, bot, global}
    injectOffChars: [],    // 태그 지시 주입을 끈 캐릭터 chaId 목록 (자체 상태창을 쓰는 봇 등)
    transition: 'fade',    // 배경 전환 효과: none | fade(크로스페이드) | swipe-up(아래에서 위로)
    transitionMs: 700,     // 전환 시간 (ms)
    vignette: 0,           // 비네팅 0~100
    timeTint: false,       // 감지된 시간대에 맞춰 색감 입히기
    timeTintStrength: 60,  // 시간대 색감 강도 0~100
    saturate: 100,         // 채도 0~200 (%)
    brightness: 100,       // 밝기 50~150 (%)
    contrast: 100,         // 대비 50~150 (%)
    grain: 0,              // 필름 그레인 0~100
    followMode: 'latest',
    scrollPick: 'line',    // 실시간 모드 장면 고르는 기준: line(기준선) | area(화면 점유율)  // 배경 따라가기: latest(최신 장면 고정) | scroll(보고 있는 위치의 장면)
    fit: 'cover',          // 이미지 맞춤: cover(꽉 채우고 넘치는 부분 자르기) | contain(그대로, 검은 여백) | blur(그대로 + 여백을 흐린 이미지로)
    dim: 0,                // 배경 어둡게 0~80 (%)
    blur: 0,               // 배경 흐리게 0~20 (px)
    defaultImageId: '',    // 일치하는 배경이 없을 때 (전체 공통)
    disabledChars: [],     // 이 플러그인을 끈 캐릭터 chaId 목록
    scannedChars: [],      // 에셋을 이미 가져온 캐릭터 chaId 목록
    selfBgChars: [],       // 답변에 자체 배경 출력(상태창·이미지)이 있는 봇 chaId 목록 (그 배경을 그대로 따라감)
    bgVarByChar: {},       // 봇이 배경 키를 담는 채팅 변수 이름 { chaId: '$mp_bg' } (처음 찾았을 때 기억)
  };

  // ─────────────────────────────────────────────────────────────
  // 상태
  // ─────────────────────────────────────────────────────────────
  const store = await risuai.getLocalPluginStorage();
  let settings = { ...DEFAULT_SETTINGS, ...((await store.getItem(KEY_SETTINGS)) || {}) };
  if (settings.inject === false) { settings.inject = true; await store.setItem(KEY_SETTINGS, settings); }
  // meta 항목:
  // { id, name, source:'upload'|'asset', path?, ext?, scope:'global'|'char', chaId?, charName?,
  //   location, time, season, tags:[], review? }
  let meta = ((await store.getItem(KEY_META)) || []).map((m) => ({
    source: 'upload', scope: 'global', tags: [], ...m,   // v0.1 데이터 호환
  }));
  // v0.5.5~0.5.6의 "공통 배경 전체 끄기"(globalOffChars)를 이미지별 끄기(offChars)로 옮김
  if (settings.globalOffChars?.length) {
    for (const m of meta) {
      if (m.scope !== 'global') continue;
      m.offChars = [...new Set([...(m.offChars || []), ...settings.globalOffChars])];
    }
    delete settings.globalOffChars;
    await store.setItem(KEY_META, meta);
    await store.setItem(KEY_SETTINGS, settings);
  }
  const imageCache = new Map();   // id → 배경용 dataURL
  const thumbCache = new Map();   // id → 썸네일 dataURL

  let rootDoc = null;
  let styleEl = null;
  let appliedImageId = null;
  let sceneTime = '';      // 지금 채팅방 장면의 시간대 (day/evening/night, 모르면 '')
  let appliedTime = '';
  let currentChat = { charIdx: -1, chaId: '', charName: '', chatKey: '' };
  let lastDetect = null;   // UI 표시용 {source, state, imageId, at}
  let importing = null;    // 진행 중인 가져오기 Promise
  let disposed = false;

  // ─────────────────────────────────────────────────────────────
  // 저장
  // ─────────────────────────────────────────────────────────────
  async function saveSettings() { await store.setItem(KEY_SETTINGS, settings); }
  async function saveMeta() { await store.setItem(KEY_META, meta); }

  function makeChatKey(char, chat, chatIndex) {
    const chaId = char?.chaId || 'unknown';
    const cid = chat?.id || ('idx' + chatIndex);
    return `${chaId}::${cid}`;
  }

  // ─────────────────────────────────────────────────────────────
  // 이미지 변환 (플러그인 iframe 안에서 처리)
  // ─────────────────────────────────────────────────────────────
  // src: Blob/File 또는 dataURL 문자열.
  // 플러그인 iframe은 CSP(connect-src 'none') 때문에 fetch가 막혀 있으므로
  // fetch 없이 <img>로 직접 읽어서 canvas로 줄임 (img-src는 data:/blob: 허용).
  function resizeImage(src, maxDim, quality = 0.85) {
    return new Promise((resolve, reject) => {
      const isBlob = typeof src !== 'string';
      const url = isBlob ? URL.createObjectURL(src) : src;
      const done = () => { if (isBlob) URL.revokeObjectURL(url); };
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        done();
        resolve(canvas.toDataURL('image/webp', quality));
      };
      img.onerror = () => { done(); reject(new Error('이미지를 읽을 수 없음')); };
      img.src = url;
    });
  }
  const blobToResizedDataURL = resizeImage;

  // 봇/모듈 에셋 원본을 읽어옴 (복사 저장하지 않음)
  async function readAssetBlob(m) {
    const bytes = await risuai.readImage(m.path);
    if (!bytes) return null;
    const ext = (m.ext || '').toLowerCase();
    const type = ext === 'jpg' ? 'image/jpeg' : (IMAGE_EXT.includes(ext) ? `image/${ext}` : 'image/png');
    return new Blob([bytes], { type });
  }

  async function getImageData(id) {
    if (!id) return null;
    if (imageCache.has(id)) return imageCache.get(id);
    const m = meta.find((x) => x.id === id);
    if (!m) return null;
    let data = null;
    try {
      if (m.source === 'asset') {
        const blob = await readAssetBlob(m);
        if (blob) data = await blobToResizedDataURL(blob, MAX_IMAGE_DIM);
      } else {
        data = await store.getItem(KEY_IMG + id);
      }
    } catch (e) {
      console.warn('[Wall Painter] 이미지 읽기 실패', m.name, e);
    }
    if (data) imageCache.set(id, data);
    return data;
  }

  // 썸네일은 저장소에 따로 보관하고, 만들 때도 원본 전체를 imageCache에 올리지 않음
  // (봇 에셋이 수백 장이면 원본을 다 올리는 것만으로 메모리와 시간이 크게 듦)
  async function getThumb(id) {
    if (thumbCache.has(id)) return thumbCache.get(id);
    let thumb = await store.getItem(KEY_THUMB + id);
    if (!thumb) {
      const m = meta.find((x) => x.id === id);
      if (!m) return '';
      try {
        const src = m.source === 'asset'
          ? await readAssetBlob(m)
          : (imageCache.get(id) || await store.getItem(KEY_IMG + id));
        if (src) thumb = await resizeImage(src, THUMB_DIM, 0.7);
      } catch (e) {
        console.warn('[Wall Painter] 썸네일 만들기 실패', m.name, e);
      }
      if (thumb) await store.setItem(KEY_THUMB + id, thumb);
    }
    if (thumb) thumbCache.set(id, thumb);
    return thumb || '';
  }

  // 화면에 보이는 카드의 썸네일만 차례로 불러옴 (동시에 4장)
  let thumbObserver = null;
  let thumbQueue = [];
  let thumbActive = 0;
  function pumpThumbs() {
    while (thumbActive < 4 && thumbQueue.length) {
      const el = thumbQueue.shift();
      if (!el.isConnected) continue;
      thumbActive++;
      getThumb(el.dataset.thumb)
        .then((url) => { if (url && el.isConnected) el.style.backgroundImage = `url('${url}')`; })
        .catch(() => {})
        .finally(() => { el.dataset.thumbLoaded = '1'; thumbActive--; pumpThumbs(); });
    }
  }
  function observeThumbs(root = document) {
    if (!thumbObserver) {
      thumbObserver = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          thumbObserver.unobserve(e.target);
          thumbQueue.push(e.target);
        }
        pumpThumbs();
      }, { rootMargin: '300px' });
    }
    root.querySelectorAll('[data-thumb]:not([data-thumb-loaded])').forEach((t) => {
      if (thumbCache.has(t.dataset.thumb)) {
        t.style.backgroundImage = `url('${thumbCache.get(t.dataset.thumb)}')`;
        t.dataset.thumbLoaded = '1';
      } else {
        thumbObserver.observe(t);
      }
    });
  }
  function resetThumbLoading() {
    thumbObserver?.disconnect();
    thumbQueue = [];
  }

  // ─────────────────────────────────────────────────────────────
  // 태그 정규화 / 사용 가능한 이미지 / 어휘
  // ─────────────────────────────────────────────────────────────
  const norm = (v) => String(v ?? '').trim().toLowerCase();
  const normTag = (v) => norm(v).replace(/\s+/g, '_');
  const parseTagList = (v) =>
    [...new Set((Array.isArray(v) ? v : String(v ?? '').split(','))
      .map(normTag).filter((t) => t && t !== 'none' && t !== 'unknown'))];

  // 전체 공통 배경을 이 캐릭터에서 쓰는지 (캐릭터마다 끌 수 있음)

  // 기본 배경은 전체 공통 배경 중 하나라서, 공통 배경을 끈 캐릭터에서는 쓰지 않음
  // 이미지 하나를 이 캐릭터에서 쓰는지 (m.offChars에 캐릭터 chaId가 있으면 꺼진 것)
  const itemOn = (m, chaId = currentChat.chaId) => !(m.offChars || []).includes(chaId);

  // 지금 이 캐릭터에서 실제로 고를 수 있는 이미지인지 (범위 + 공통 배경 스위치 + 개별 스위치)
  const isUsable = (m, chaId = currentChat.chaId) =>
    !!m && itemOn(m, chaId) && (m.scope === 'global' || (m.scope === 'char' && m.chaId === chaId));

  const defaultFor = (chaId = currentChat.chaId) => {
    const m = meta.find((x) => x.id === settings.defaultImageId);
    return isUsable(m, chaId) ? m.id : null;
  };

  // 현재 캐릭터에서 쓸 수 있는 이미지: 전체 공통(켜져 있으면) + 현재 캐릭터 전용
  function availableItems(chaId = currentChat.chaId) {
    return meta.filter((m) => isUsable(m, chaId));
  }

  function vocabulary(chaId = currentChat.chaId) {
    const items = availableItems(chaId);
    const uniq = (arr) => [...new Set(arr.filter(Boolean))].sort();
    return {
      locations: uniq(items.map((m) => normTag(m.location))),
      times: TIMES.filter((t) => items.some((m) => m.time === t)),
      seasons: SEASONS.filter((s) => items.some((m) => m.season === s)),
      tags: uniq(items.flatMap((m) => m.tags || [])),
    };
  }

  // 목록에 없는 장소 이름이면 이름의 단어가 겹치는 등록 장소로 대신함 (보조모델 없이)
  // 예: school_hallway → hallway, riverside_path → riverside.
  // 장소 이름 절반 이상에 들어 있는 흔한 단어(예: 접두어 sh)와 2글자 이하 단어는 비교에서 뺌.
  // 겹치는 비율(공통 단어 ÷ 두 이름의 전체 단어)이 가장 높은 장소, 같으면 이름이 짧은 쪽.
  function similarLocation(loc, locations) {
    const toks = (x) => String(x).toLowerCase().split(/[_\-\s.]+/).filter((t) => t.length >= 3);
    if (!loc || !locations.length) return '';
    const df = new Map();
    for (const l of locations) for (const t of new Set(toks(l))) df.set(t, (df.get(t) || 0) + 1);
    const common = (t) => locations.length >= 4 && df.get(t) / locations.length >= 0.5;
    const want = new Set(toks(loc).filter((t) => !common(t)));
    if (!want.size) return '';
    let best = null;
    for (const l of locations) {
      const have = new Set(toks(l).filter((t) => !common(t)));
      let shared = 0;
      for (const t of want) if (have.has(t)) shared++;
      if (!shared) continue;
      const score = shared / (want.size + have.size - shared);
      if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) < 1e-9 && l.length < best.l.length)) best = { l, score };
    }
    return best ? best.l : '';
  }

  function sanitizeState(raw, chaId = currentChat.chaId) {
    if (!raw) return null;
    const v = vocabulary(chaId);
    let location = normTag(raw.location);
    let approxFrom = '';
    if (location && !v.locations.includes(location)) {
      const near = location === 'unknown' ? '' : similarLocation(location, v.locations);
      approxFrom = near ? location : '';
      location = near;
    }
    const time = TIMES.includes(norm(raw.time)) ? norm(raw.time) : '';
    const season = SEASONS.includes(norm(raw.season)) ? norm(raw.season) : '';
    const tags = parseTagList(raw.tags).filter((t) => v.tags.includes(t));
    if (!location && !time && !season && !tags.length) return null;
    return approxFrom ? { location, time, season, tags, approxFrom } : { location, time, season, tags };
  }

  // "location=forest | time=night | season=autumn | tags=rain, indoor" 형태 파싱
  function parseTagBody(body, chaId) {
    const out = {};
    for (const part of body.split('|')) {
      const m = part.match(/^\s*([a-z]+)\s*[=:]\s*(.*?)\s*$/i);
      if (m) out[norm(m[1])] = m[2];
    }
    return sanitizeState(out, chaId);
  }

  function findTagInText(text, chaId) {
    if (!text) return null;
    let last = null;
    for (const m of String(text).matchAll(TAG_RE)) last = m[1];
    return last === null ? null : parseTagBody(last, chaId);
  }

  // ─────────────────────────────────────────────────────────────
  // 배경 선택
  // ─────────────────────────────────────────────────────────────
  // 장소는 반드시 일치. 시간대/계절: 일치 +2, 미지정 0, 불일치 -3. 자유 태그: 겹칠 때마다 +1.
  // 같은 점수면 이 봇 전용 이미지 우선, 그다음 지금 배경 유지 (깜빡임 방지).
  function pickImage(state, chaId, preferId) {
    if (!state) return defaultFor(chaId);
    let best = null;
    for (const m of availableItems(chaId)) {
      if (!state.location || normTag(m.location) !== state.location) continue;
      let score = 0;
      if (state.time) score += !m.time ? 0 : (m.time === state.time ? 2 : -3);
      if (state.season) score += !m.season ? 0 : (m.season === state.season ? 2 : -3);
      for (const t of state.tags || []) if ((m.tags || []).includes(t)) score += 1;
      if (m.scope === 'char') score += 0.3;
      if (m.id === preferId) score += 0.2;
      if (!best || score > best.score) best = { id: m.id, score };
    }
    return best ? best.id : defaultFor(chaId);
  }

  // ─────────────────────────────────────────────────────────────
  // 배경 적용 (메인 화면에 <style> 주입)
  // ─────────────────────────────────────────────────────────────
  async function ensureStyleEl() {
    if (!rootDoc) return null;
    if (styleEl) return styleEl;
    styleEl = await rootDoc.querySelector(`[x-id="${STYLE_XID}"]`);
    if (!styleEl) {
      styleEl = await rootDoc.createElement('style');
      await styleEl.setAttribute('x-id', STYLE_XID);
      const body = await rootDoc.querySelector('body');
      await body.appendChild(styleEl);
    }
    return styleEl;
  }

  // opts.instant: 설정 변경으로 다시 그릴 때처럼 전환 효과 없이 바로 바꿈
  // 배경 적용. 실제로 화면에 반영됐으면(이미 같은 배경이면 포함) true.
  // 리스가 바쁠 때 원본 읽기가 실패할 수 있어서, 실패하면 잠시 뒤 다시 시도함 (그 사이 다른 배경 요청이 없을 때만)
  let applySeq = 0;
  async function applyImage(imageId, opts = {}) {
    const seq = ++applySeq;
    const el = await ensureStyleEl();
    if (!el) return false;
    if (!settings.enabled || !imageId) {
      const prevData = appliedImageId ? imageCache.get(appliedImageId) : null;
      appliedImageId = null;
      await el.setInnerText('');
      if (prevData && !opts.instant && settings.transition === 'fade') await runTransition('fade', prevData);
      return true;
    }
    if (imageId === appliedImageId && sceneTime === appliedTime) return true;   // 같은 이미지라도 시간대가 바뀌면 색감 때문에 다시 그림
    const data = await getImageData(imageId);
    if (!data) {
      const tries = opts.tries || 0;
      if (tries < 4) {
        setTimeout(() => {
          if (!disposed && seq === applySeq) applyImage(imageId, { ...opts, tries: tries + 1 }).catch(() => {});
        }, 1500 * (tries + 1));
      } else {
        console.warn('[Wall Painter] 배경 이미지를 읽지 못했습니다 (5번 시도)', imageId);
      }
      return false;
    }
    if (seq !== applySeq) return false;   // 읽는 동안 더 새로운 배경 요청이 왔으면 그쪽을 따름
    const prevData = appliedImageId ? imageCache.get(appliedImageId) : null;
    const mode = opts.instant || !prevData ? 'none' : settings.transition;
    appliedImageId = imageId;
    appliedTime = sceneTime;
    if (mode === 'swipe-up') {
      // 새 배경이 아래에서 올라와 덮은 뒤, 밑바탕을 새 배경으로 바꾸고 덮개를 걷음
      await runTransition('swipe-up', data, async () => { await el.setInnerText(buildBackgroundCSS(data)); });
    } else if (mode === 'fade') {
      // 밑바탕은 바로 새 배경으로 바꾸고, 그 위에 이전 배경 덮개를 올려서 서서히 투명하게
      await runTransition('fade', prevData, async () => { await el.setInnerText(buildBackgroundCSS(data)); }, true);
    } else {
      await el.setInnerText(buildBackgroundCSS(data));
    }
    return true;
  }

  // 배경 요소 안에 잠깐 덮개 층을 넣어 전환 효과를 냄. 끝나면 지움.
  // swapFirst=true면 덮개를 붙인 직후 onSwap(밑바탕 교체)을 하고, 아니면 효과가 끝난 뒤에 함
  let activeOverlay = null;
  async function runTransition(mode, data, onSwap, swapFirst = false) {
    const ms = Math.max(150, Math.min(5000, Number(settings.transitionMs) || 700));
    try {
      const host = await rootDoc?.querySelector('div.w-full.h-full.relative:has(>.default-chat-screen)');
      if (!host) { await onSwap?.(); return; }
      // 이전 전환이 아직 진행 중이면 그 덮개를 모두 걷음 (연달아 바뀔 때 덮개가 남지 않게)
      try {
        const olds = await host.querySelectorAll('[x-wp-overlay]');
        const n = await olds.length();
        for (let i = 0; i < n; i++) await (await olds.at(i))?.remove();
      } catch {}
      const fit = settings.fit === 'contain' || settings.fit === 'blur' ? 'contain' : 'cover';
      const a = Math.max(0, Math.min(80, Number(settings.dim) || 0)) / 100;
      const dim = a > 0 ? `linear-gradient(rgba(0,0,0,${a}),rgba(0,0,0,${a})),` : '';
      const blur = Math.max(0, Math.min(20, Number(settings.blur) || 0));
      const url = `url("${data.replace(/["\\\n\r]/g, '')}")`;
      const anim = mode === 'swipe-up'
        ? `animation:wp-swipe-up ${ms}ms cubic-bezier(.22,.8,.2,1) forwards`
        : `animation:wp-fade-out ${ms}ms ease forwards`;
      const box = await rootDoc.createElement('div');
      await box.setAttribute('x-wp-overlay', '1');
      await box.setStyleAttribute('position:absolute;inset:0;z-index:0;pointer-events:none;overflow:hidden;border-radius:inherit');
      const layer = await rootDoc.createElement('div');
      await layer.setStyleAttribute(
        `position:absolute;inset:0;background-color:#000;background-image:${dim}${url};` +
        `background-size:${dim ? '100% 100%,' : ''}${fit};background-position:center;background-repeat:no-repeat;` +
        (blur > 0 ? `filter:blur(${blur}px);transform:scale(1.04);` : '') +
        (mode === 'swipe-up' ? 'translate:0 100%;' : '') + anim);
      await box.appendChild(layer);
      await host.prepend(box);
      activeOverlay = box;
      if (swapFirst) await onSwap?.();
      await new Promise((r) => setTimeout(r, ms + 60));
      if (!swapFirst) await onSwap?.();
      await new Promise((r) => setTimeout(r, 30));   // 밑바탕이 바뀐 뒤 덮개를 걷어야 깜빡이지 않음
      await box.remove();   // 이미 다음 전환이 걷었어도 문제없음
      if (activeOverlay === box) activeOverlay = null;
    } catch (e) {
      console.warn('[Wall Painter] 전환 효과 실패', e);
      try { await onSwap?.(); } catch {}
    }
  }

  // 층 구성 (모두 채팅 내용 아래. isolation으로 이 요소 안에서만 쌓임)
  //  - 요소 자체 배경: [필름 그레인, 비네팅, 시간대 색감, 어둡게] 효과 층 + 이미지 (cover/contain)
  //  - ::before: 흐리게·색 보정용 backdrop-filter 층, 또는 blur 맞춤일 때 여백을 채우는 흐린 이미지
  //  - ::after : blur 맞춤일 때 그 위에 올리는 원본 비율 이미지 (+ 효과 층)
  const TIME_TINT = {
    day:     { color: '255,246,225', alpha: 0.35, blend: 'soft-light' },   // 낮: 살짝 밝고 따뜻하게
    evening: { color: '255,130,50',  alpha: 0.6,  blend: 'soft-light' },   // 저녁: 노을빛 주황
    night:   { color: '35,55,150',   alpha: 0.55, blend: 'multiply' },     // 밤: 푸르고 어둡게
  };
  const clampNum = (v, lo, hi, d) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) ? Number(v) : d));

  function effectLayers() {
    const fx = [];
    const grain = clampNum(settings.grain, 0, 100, 0);
    if (grain > 0) {
      const o = (grain / 100 * 0.9).toFixed(3);
      const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)' opacity='${o}'/></svg>`;
      fx.push({ img: `url("data:image/svg+xml,${encodeURIComponent(svg)}")`, size: '180px 180px', repeat: 'repeat', blend: 'overlay' });
    }
    const vig = clampNum(settings.vignette, 0, 100, 0);
    if (vig > 0) {
      const v = (vig / 100 * 0.85).toFixed(3);
      fx.push({ img: `radial-gradient(ellipse at center,rgba(0,0,0,0) ${Math.round(62 - vig * 0.22)}%,rgba(0,0,0,${v}) 100%)`, size: '100% 100%', repeat: 'no-repeat', blend: 'normal' });
    }
    const tint = settings.timeTint ? TIME_TINT[sceneTime] : null;
    if (tint) {
      const a = (tint.alpha * clampNum(settings.timeTintStrength, 0, 100, 60) / 100).toFixed(3);
      fx.push({ img: `linear-gradient(rgba(${tint.color},${a}),rgba(${tint.color},${a}))`, size: '100% 100%', repeat: 'no-repeat', blend: tint.blend });
    }
    const dim = clampNum(settings.dim, 0, 80, 0) / 100;
    if (dim > 0) fx.push({ img: `linear-gradient(rgba(0,0,0,${dim}),rgba(0,0,0,${dim}))`, size: '100% 100%', repeat: 'no-repeat', blend: 'normal' });
    return fx;
  }

  // 채도·밝기·대비 (모두 100%면 빈 문자열)
  function colorAdjust() {
    const s = clampNum(settings.saturate, 0, 200, 100);
    const b = clampNum(settings.brightness, 50, 150, 100);
    const c = clampNum(settings.contrast, 50, 150, 100);
    return [s !== 100 ? `saturate(${s}%)` : '', b !== 100 ? `brightness(${b}%)` : '', c !== 100 ? `contrast(${c}%)` : ''].filter(Boolean).join(' ');
  }

  // 효과 층 + 이미지를 background 여러 겹으로 씀
  function layeredBackground(url, imageSize) {
    const layers = [...effectLayers(), { img: url, size: imageSize, repeat: 'no-repeat', blend: 'normal' }];
    return `background-image:${layers.map((l) => l.img).join(',')}!important;` +
      `background-size:${layers.map((l) => l.size).join(',')}!important;` +
      `background-repeat:${layers.map((l) => l.repeat).join(',')}!important;` +
      `background-blend-mode:${layers.map((l) => l.blend).join(',')}!important;` +
      `background-position:center!important;`;
  }

  function buildBackgroundCSS(data) {
    const T = BG_TARGET;
    const url = `url("${data.replace(/["\\\n\r]/g, '')}")`;
    const blur = clampNum(settings.blur, 0, 20, 0);
    const adj = colorAdjust();
    const fit = ['cover', 'contain', 'blur'].includes(settings.fit) ? settings.fit : 'cover';
    const layer = `content:''!important;display:block!important;position:absolute!important;inset:0!important;z-index:-1!important;` +
      `pointer-events:none!important;opacity:1!important;transform:none!important;`;
    let css = `${T}{isolation:isolate!important;background-color:#000!important;`;

    if (fit === 'blur') {
      // 요소 배경은 비우고, ::before에 꽉 채운 흐린 이미지, ::after에 원본 비율 이미지
      css += `background-image:none!important}`;
      css += `${T}::before{${layer}background:${url} center/cover no-repeat!important;` +
        `filter:blur(28px) brightness(.75) saturate(1.15) ${adj}!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important;` +
        // 흐림 가장자리가 비어 보이지 않게 1.12배 키우고, 키운 만큼 잘라서 원래 상자 밖으로 번지지 않게 함
        `transform:scale(1.12)!important;clip-path:inset(5.36%)!important}`;
      const f = [blur > 0 ? `blur(${blur}px)` : '', adj].filter(Boolean).join(' ') || 'none';
      css += `${T}::after{${layer}background-color:transparent!important;${layeredBackground(url, 'contain')}` +
        `filter:${f}!important;clip-path:inset(0)!important}`;
    } else {
      css += `${layeredBackground(url, fit)}}`;
      const bf = [blur > 0 ? `blur(${blur}px)` : '', adj].filter(Boolean).join(' ');
      if (bf) {
        // 흐리게·색 보정은 배경 위에 깐 backdrop-filter 층으로 (채팅 글자는 영향 없음)
        css += `${T}::before{${layer}background:transparent!important;filter:none!important;` +
          `backdrop-filter:${bf}!important;-webkit-backdrop-filter:${bf}!important}`;
      } else if (settings.hideThemeFx) {
        css += `${T}::before{background:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;opacity:0!important}`;
      }
      if (settings.hideThemeFx) css += `${T}::after{display:none!important}`;
    }
    // 다른 테마가 채팅 목록 위에 덧씌운 분위기 층 (예: 테마리스의 노이즈·비네트)
    if (settings.hideThemeFx) css += `${T}>.default-chat-screen.default-chat-screen::after{display:none!important}`;
    // 전환 효과용 움직임 (덮개 층이 씀)
    css += '@keyframes wp-fade-out{from{opacity:1}to{opacity:0}}@keyframes wp-swipe-up{from{translate:0 100%}to{translate:0 0}}';
    return css;
  }

  // 지금 열려 있는 채팅방 키를 RisuAI에서 직접 다시 읽음.
  // (채팅방 전환 감지는 1.5초 주기라, 방금 들어온 방이면 currentChat이 아직 이전 방일 수 있음)
  async function freshChatKey() {
    try {
      const idx = await risuai.getCurrentCharacterIndex();
      if (idx == null || idx < 0) return '';
      const char = await risuai.getCharacter();
      if (!char) return '';
      const chatIndex = char.chatPage ?? 0;
      const chatKey = makeChatKey(char, char.chats?.[chatIndex], chatIndex);
      currentChat = { charIdx: idx, chaId: char.chaId, charName: char.name, chatKey };
      return chatKey;
    } catch {
      return currentChat.chatKey;
    }
  }

  // 수동으로 고른 배경(또는 해제)을 이 채팅방에 저장해서, 다른 봇에 갔다 와도 유지되게 함
  async function saveManualChoice(imageId) {
    const chatKey = await freshChatKey();
    if (!chatKey) return;
    const prev = (await store.getItem(KEY_CHAT + chatKey)) || {};
    // cleared는 해제했을 때만 true. 이전에 해제했던 방에서 다시 적용하면 반드시 풀어야 복원됨
    await store.setItem(KEY_CHAT + chatKey, { ...prev, imageId, cleared: !imageId, at: Date.now() });
  }

  // 지금 채팅방의 배경을 끔. 다음 답변에서 새 장면이 감지되면 다시 켜짐.
  async function clearCurrentBackground() {
    await applyImage(null);
    await saveManualChoice(null);
  }

  // 설정(맞춤·어둡게·흐리게 등)을 바꾼 뒤 지금 배경에 바로 다시 적용.
  // 플러그인 업데이트 직후처럼 띄운 배경을 기억하지 못하는 경우엔 지금 채팅방의 저장된 배경을 다시 찾아서 적용.
  async function reapplyCurrent() {
    const id = appliedImageId;
    appliedImageId = null;
    if (id) await applyImage(id, { instant: true });
    else await refreshCurrentChat(true);
    peekBackground();
  }

  // 설정창이 배경을 가리고 있으니, 바꾼 결과가 보이게 잠깐 창을 투명하게 함
  let peekTimer = null;
  function peekBackground() {
    if (!uiOpen || !appliedImageId) return;
    document.documentElement.classList.add('peek');
    clearTimeout(peekTimer);
    peekTimer = setTimeout(() => document.documentElement.classList.remove('peek'), 1400);
  }

  // ─────────────────────────────────────────────────────────────
  // 보조모델 호출
  // ─────────────────────────────────────────────────────────────
  // 플러그인 API로는 RisuAI의 "보조 모델" 설정값을 직접 읽을 수 없어서,
  // 실제 호출 결과를 기록해 두고 설정창에 연결 상태로 보여줌.
  // 오류 응답이 HTML 페이지(예: Cloudflare 524 시간 초과 페이지)로 오면 태그를 걷어내고 짧게 정리
  function tidyAuxError(error) {
    let t = String(error || '');
    const code = t.match(/\b([45]\d\d)\b/)?.[1];
    if (/<!doctype|<html|<head|<body/i.test(t)) {
      const prefix = t.split('<')[0].trim();   // 예: "[Vertex Error 524]"
      t = `${prefix || '서버 오류'} (HTML 오류 페이지)`;
    }
    const hints = { 524: '서버 응답 시간 초과', 504: '게이트웨이 시간 초과', 502: '게이트웨이 오류', 503: '서버 일시 중단', 429: '요청이 너무 많음', 401: '인증 실패(API 키 확인)', 403: '권한 없음' };
    if (code && hints[code] && !t.includes(hints[code])) t += ` — ${hints[code]}`;
    t = t.replace(/\s+/g, ' ').trim();
    return t.length > 140 ? t.slice(0, 140) + '…' : t;
  }

  async function recordAux(ok, error = '') {
    settings.lastAux = { ok, at: Date.now(), error: ok ? '' : tidyAuxError(error) };
    await saveSettings();
  }

  // 보조모델 호출은 한 번에 하나만.
  // 보조모델이 다른 플러그인이 제공하는 모델이면, 응답이 늦거나 오지 않는 호출이 쌓였을 때
  // 그 플러그인을 쓰는 메인 채팅 요청까지 막혀서 답변이 끝없이 대기하는 문제가 있었음.
  // - auxInFlight: RisuAI 쪽 요청이 실제로 끝날 때까지 유지 (시간 초과로 포기해도 요청 자체는 남아 있으므로)
  // - 시간 초과: 이 플러그인은 기다리기를 그만두고 실패로 처리
  const AUX_TIMEOUT_MS = 90000;
  let auxInFlight = null;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function callAux(system, user, { skipIfBusy = false } = {}) {
    if (auxInFlight) {
      if (skipIfBusy) throw new Error('이전 보조모델 요청이 아직 끝나지 않아 건너뜀');
      await auxInFlight;
    }
    const started = Date.now();
    const req = risuai.runLLMModel({
      // 'otherAx'로 부르면 LIBRA 같은 메모리 플러그인이 메인 채팅 요청으로 취급해서(otherAx를 서사 요청으로 분류)
      // 우리 요청에 메모리 처리를 돌리고 응답을 대화로 기록하다가 다음 메인 요청이 끝없이 대기하는 문제가 있었음.
      // 'memory'는 그런 플러그인들이 건너뛰는 종류이고, RisuAI는 보조 모델(분리 시 "메모리" 모델)로 보냄.
      mode: 'memory',
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      // 보조 모델이 다른 플러그인이 제공하는 모델(pluginmodel:::)이면 RisuAI가 기본으로 막음
      // ("Plugin calls are blocked by the caller"). 이 플러그인은 모델 제공자가 아니라서
      // 서로 무한 호출할 위험이 없으므로 허용함.
      allowPlugins: true,
    });
    const settled = req.then(() => {}, () => {});
    auxInFlight = settled;
    settled.then(() => {
      if (auxInFlight === settled) auxInFlight = null;
      const sec = ((Date.now() - started) / 1000).toFixed(1);
      console.log(`[Wall Painter] 보조모델 요청 종료 (${sec}초)`);
    });
    let res;
    try {
      res = await Promise.race([
        req,
        sleep(AUX_TIMEOUT_MS).then(() => { throw new Error(`보조모델 응답 시간 초과 (${AUX_TIMEOUT_MS / 1000}초)`); }),
      ]);
    } catch (e) {
      await recordAux(false, e?.message || e);
      throw e;
    }
    if (!res || res.type !== 'success' || typeof res.result !== 'string' || !res.result.trim()) {
      const why = res?.result ? String(res.result) : '응답 없음';
      await recordAux(false, why);
      throw new Error('보조모델 응답 실패: ' + why);
    }
    await recordAux(true);
    return res.result;
  }

  async function testAux() {
    try {
      await callAux('Reply with exactly: OK', 'ping');
      return true;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 감지
  // ─────────────────────────────────────────────────────────────
  function isCharEnabled(chaId) {
    return settings.enabled && !settings.disabledChars.includes(chaId);
  }

  function buildAuxPrompt(chaId) {
    const v = vocabulary(chaId);
    return fillTemplate(promptTemplate('aux'), {
      locations: v.locations.join(', '), times: TIMES.join(', '), seasons: SEASONS.join(', '), tags: v.tags.join(', '),
    });
  }
  function buildTaggingPrompt(chaId) {
    const v = vocabulary(chaId);
    return fillTemplate(promptTemplate('tagging'), {
      existing_locations: v.locations.length ? `Reuse these existing names when they fit: ${v.locations.join(', ')}. ` : '',
      locations: v.locations.join(', '),
    });
  }

  // ── 프롬프트 설정을 사람이나 AI가 읽고 고칠 수 있는 .md로 내보내고 다시 읽기 ──
  // 편집 칸은 <!-- wall-painter:prompt 키 --> 표시 바로 아래의 코드 블록. 불러올 때 그 블록만 읽음.
  const PROMPT_INFO = {
    inject: {
      title: '메인모델 주입 프롬프트',
      when: '메인 채팅 요청마다 맨 마지막에 system 메시지로 붙습니다. (보조모델·번역 요청에는 붙지 않습니다)',
      must: [
        '`{format}`을 그대로 두거나, 답변에 `[BG: location=… | time=… | season=… | tags=…]` 한 줄을 쓰라는 지시가 있어야 합니다. 플러그인은 이 줄만 읽습니다.',
        '`{field_rules}` 또는 `{locations}`가 있어야 메인모델이 등록된 장소 중에서 고릅니다.',
        '이 줄은 화면에서 자동으로 숨겨지니, 캐릭터가 언급하지 않게 하는 지시를 남겨 두는 게 좋습니다.',
      ],
    },
    aux: {
      title: '보조모델 장면 판단 프롬프트',
      when: '메인 답변에 `[BG: …]` 태그가 없을 때 보조모델에게 보내는 system 지시입니다. user 메시지로는 이전 상태와 답변(최대 8000자, 넘으면 끝부분)이 전달됩니다.',
      must: [
        '응답이 JSON 배열 `[{"from":"…","location":"…","time":"…","season":"…","tags":["…"]}]` 형식이어야 합니다. 장면마다 하나씩, 나온 순서대로입니다. 마지막 장면이 현재 배경이 됩니다.',
        '`from`은 그 장면이 시작되는 원문 글귀를 그대로 베낀 것이어야 합니다. 실시간 모드에서 이 글귀 위치에 장면 표시를 넣습니다. (예전 형식인 객체 하나도 읽지만, 그러면 장면 하나로만 처리됩니다)',
        '`{locations}`가 있어야 등록된 장소 중에서 고릅니다. 목록에 없는 값은 무시됩니다.',
      ],
    },
    tagging: {
      title: '에셋 자동 태깅 프롬프트',
      when: '"봇 에셋 가져오기"에서 보조모델에게 보내는 system 지시입니다. user 메시지로는 봇 이름과 `번호: 에셋 이름` 목록(최대 150개씩)이 전달됩니다.',
      must: [
        '응답이 JSON 배열 `[{"i":번호,"location":"…","time":"…","season":"…","tags":["…"]}]` 형식이어야 합니다. 배경이 아닌 에셋은 빼고 답하게 해야 합니다.',
        'location은 영어 snake_case가 좋습니다. 메인모델 주입 때 그대로 장소 이름으로 쓰입니다.',
      ],
    },
  };

  function buildPromptMarkdown(chaId) {
    const v = vocabulary(chaId);
    const sample = (arr) => (arr.length ? arr.slice(0, 12).join(', ') + (arr.length > 12 ? `, … (총 ${arr.length}개)` : '') : '(없음)');
    const fence = (t) => '```text\n' + t + '\n```';
    const filled = { inject: buildInjection(chaId) || '(등록된 장소가 없어서 지금은 주입하지 않습니다)', aux: buildAuxPrompt(chaId), tagging: buildTaggingPrompt(chaId) };
    const out = [];
    out.push(`# Wall Painter 프롬프트 설정`);
    out.push('');
    out.push(`> RisuAI 플러그인 **Wall Painter v${VERSION}**의 프롬프트 설정 파일입니다. (${new Date().toLocaleString('ko-KR')} 내보냄)`);
    out.push('>');
    out.push('> - 각 프롬프트의 **편집 칸** 코드 블록 안만 고친 뒤, 설정창 프롬프트 구역의 **".md 불러오기"**로 다시 넣으면 적용됩니다.');
    out.push('> - 편집 칸을 비우거나 기본값과 똑같이 두면 기본값을 씁니다.');
    out.push('> - `<!-- wall-painter:prompt … -->` 표시 줄은 지우지 마십시오. 불러올 때 이 표시로 칸을 찾습니다.');
    out.push('');
    out.push('## 플러그인이 하는 일');
    out.push('');
    out.push('1. 메인모델에게 답변 맨 앞에 `[BG: location=… | time=… | season=… | tags=…]` 한 줄을 쓰게 합니다. (메인모델 주입 프롬프트)');
    out.push('2. 답변이 오면 이 줄을 읽어서 맞는 배경 이미지를 채팅 배경으로 적용합니다. 줄은 화면에서 숨깁니다.');
    out.push('3. 줄이 없으면 보조모델에게 장면을 물어봅니다. (보조모델 장면 판단 프롬프트)');
    out.push('4. 봇 에셋을 가져올 때는 보조모델이 에셋 이름을 보고 배경만 골라 태그를 붙입니다. (에셋 자동 태깅 프롬프트)');
    out.push('');
    out.push('### `[BG: …]` 줄을 읽는 규칙');
    out.push('');
    out.push('- 형식: `[BG: key=value | key=value | …]` — 항목은 `|`로 나누고, 키는 `location`, `time`, `season`, `tags`.');
    out.push('- 답변 안에 여러 줄이 있으면 **마지막 줄**을 씁니다. (중간에 장소가 바뀌는 경우)');
    out.push('- `time`은 `day | evening | night`, `season`은 `spring | summer | autumn | winter` 중 하나.');
    out.push('- `tags`는 쉼표로 여러 개. 값은 소문자로 바꾸고 띄어쓰기는 `_`로 바꿔서 비교합니다.');
    out.push('- 등록된 목록에 없는 장소·태그는 무시합니다. 장소는 반드시 맞아야 배경이 바뀌고, 시간대·계절·태그는 맞을수록 우선입니다.');
    out.push('');
    out.push('## 자리표시자');
    out.push('');
    out.push('보낼 때 실제 값으로 바뀝니다. 아래 "지금 값"은 이 파일을 내보낸 캐릭터 기준 예시입니다. 모르는 `{이름}`은 바꾸지 않고 그대로 보냅니다.');
    out.push('');
    out.push('| 자리표시자 | 쓰는 곳 | 내용 | 지금 값 |');
    out.push('|---|---|---|---|');
    const fieldsNow = (buildInjection(chaId) || '').split('\n').find((l) => l.startsWith('[BG:')) || '(장소 없음)';
    out.push(`| \`{format}\` | 메인모델 | 답변에 쓸 \`[BG: …]\` 줄 형식. 등록된 값이 없는 항목은 빠집니다 | \`${fieldsNow.replace(/\|/g, '\\|')}\` |`);
    out.push('| `{field_rules}` | 메인모델 | 항목별 선택지 안내 여러 줄 (장소 목록 포함) | (아래 "실제로 보내는 문구" 참고) |');
    out.push(`| \`{locations}\` | 전부 | 쓸 수 있는 장소 이름, 쉼표로 구분 | ${sample(v.locations)} |`);
    out.push(`| \`{times}\` | 메인모델·보조모델 | 시간대 (메인모델은 등록된 것만) | ${v.times.join(', ') || '(없음)'} |`);
    out.push(`| \`{seasons}\` | 메인모델·보조모델 | 계절 (메인모델은 등록된 것만) | ${v.seasons.join(', ') || '(없음)'} |`);
    out.push(`| \`{tags}\` | 메인모델·보조모델 | 자유 태그 | ${sample(v.tags)} |`);
    out.push('| `{existing_locations}` | 에셋 태깅 | 이미 있는 장소가 있으면 "Reuse these existing names…" 문장, 없으면 빈칸 | |');
    out.push('');
    for (const key of ['inject', 'aux', 'tagging']) {
      const info = PROMPT_INFO[key];
      const custom = (settings.prompts?.[key] || '').trim();
      out.push(`## ${info.title}`);
      out.push('');
      out.push(`- **언제:** ${info.when}`);
      out.push(`- **지금 상태:** ${custom ? '직접 수정함' : '기본값 사용 중'}`);
      out.push(`- **쓸 수 있는 자리표시자:** ${PROMPT_VARS[key].map((n) => '`{' + n + '}`').join(' ')}`);
      out.push('- **지켜야 할 것:**');
      for (const m of info.must) out.push(`  - ${m}`);
      out.push('');
      out.push('### 편집 칸');
      out.push('');
      out.push(`<!-- wall-painter:prompt ${key} -->`);
      out.push(fence(custom || DEFAULT_PROMPTS[key]));
      out.push('');
      out.push('<details><summary>기본값 (참고용, 여기를 고쳐도 반영되지 않습니다)</summary>');
      out.push('');
      out.push(fence(DEFAULT_PROMPTS[key]));
      out.push('');
      out.push('</details>');
      out.push('');
      out.push('<details><summary>지금 실제로 보내는 문구 (참고용)</summary>');
      out.push('');
      out.push(fence(filled[key]));
      out.push('');
      out.push('</details>');
      out.push('');
    }
    out.push('## AI에게 고쳐 달라고 할 때');
    out.push('');
    out.push('아래 문장과 함께 이 파일을 넘기면 됩니다.');
    out.push('');
    out.push('> 이 파일은 RisuAI 플러그인의 프롬프트 설정이야. 각 "편집 칸"의 코드 블록 안 내용만 고쳐서 파일 전체를 돌려줘. ');
    out.push('> `<!-- wall-painter:prompt … -->` 표시 줄과 `{이름}` 자리표시자는 지우지 말고, "지켜야 할 것"에 적힌 출력 형식(`[BG: …]` 줄, JSON 형식)은 유지해 줘.');
    out.push('');
    return out.join('\n');
  }

  // 편집 칸만 읽음. 기본값과 같거나 비어 있으면 '' (기본값 사용)
  function parsePromptMarkdown(md) {
    const found = {};
    const re = /<!--\s*wall-painter:prompt\s+(inject|aux|tagging)\s*-->\s*\n\s*(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\s*\2/g;
    for (const m of String(md).replace(/\r\n/g, '\n').matchAll(re)) {
      const text = m[3].trim();
      found[m[1]] = text === DEFAULT_PROMPTS[m[1]].trim() ? '' : text;
    }
    return found;
  }

  async function askAuxScene(text, prevState, chaId) {
    const v = vocabulary(chaId);
    if (!v.locations.length) return null;
    const sys = buildAuxPrompt(chaId);
    const prev = prevState ? JSON.stringify(prevState) : 'none';
    try {
      const out = await callAux(sys, `Previous: ${prev}\n\nText:\n${String(text).slice(-AUX_TEXT_LIMIT)}`, { skipIfBusy: true });
      return parseAuxScenes(out, prevState, chaId);
    } catch (e) {
      console.warn('[Wall Painter] 보조모델 장면 판단 실패', e);
      return null;
    }
  }

  // 응답: 장면 배열 [{from, location, …}] 또는 예전 형식의 객체 하나 → [{ from, state }]
  function parseAuxScenes(out, prevState, chaId) {
    const t = String(out);
    const ia = t.indexOf('[');
    const io = t.indexOf('{');
    let list = null;
    if (ia >= 0 && (io < 0 || ia < io)) list = JSON.parse(t.slice(ia, t.lastIndexOf(']') + 1));
    else if (io >= 0) list = [JSON.parse(t.slice(io, t.lastIndexOf('}') + 1))];
    if (!Array.isArray(list)) return null;
    const scenes = [];
    let carry = prevState?.location || '';
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue;
      const state = sanitizeState(raw, chaId);
      if (!state) continue;
      if (!state.location && carry) state.location = carry;   // 장소를 못 정한 장면은 앞 장면의 장소
      carry = state.location || carry;
      scenes.push({ from: String(raw.from || '').trim().slice(0, 160), state });
    }
    return scenes.length ? scenes : null;
  }

  // ── 보조모델 장면 기록: 원문은 건드리지 않고, 화면에 그릴 때만 글귀 위치에 표시를 넣음 ──
  // 기록은 답변 앞부분(공백·기호 제거 60자)으로 찾음. 다른 정규식이 앞부분을 바꿨으면 글귀로 찾음.
  let auxScenes = (await store.getItem(KEY_AUX_SCENES)) || {};
  let auxHeadIndex = new Map();
  let pendingAux = null;   // 방금 판단했지만 아직 화면에 표시가 그려지지 않은 기록 { id, body, chatKey }
  const stateToBody = (st) =>
    `location=${st.location || ''} | time=${st.time || ''} | season=${st.season || ''} | tags=${(st.tags || []).join(', ')}`;
  function msgHead(text) {
    return String(text).replace(/\[BG:[^\]\n]*\]/gi, '').replace(/<[^>]*>/g, '')
      .replace(/[*_#>`~\[\]()"'“”‘’]/g, '').replace(/\s+/g, '').slice(0, 60);
  }
  function hashStr(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }
  function rebuildAuxIndex() {
    auxHeadIndex = new Map();
    for (const list of Object.values(auxScenes)) for (const r of list) auxHeadIndex.set(r.head, r);
  }
  rebuildAuxIndex();
  async function saveAuxScenes(chatKey, text, scenes) {
    return putSceneRecord(chatKey, text, scenes.map((sc) => ({ from: sc.from, body: stateToBody(sc.state) })));
  }
  // 채팅 변수로 정한 배경: 답변 맨 앞에 그 이미지 표시 하나 (실시간 모드에서 예전 답변으로 올라가도 그때 배경)
  async function saveVarScene(chatKey, text, imageId) {
    return putSceneRecord(chatKey, text, [{ from: '', body: 'img=' + imageId }]);
  }
  async function putSceneRecord(chatKey, text, scenes) {
    const head = msgHead(text);
    if (!head) return null;
    const rec = { id: hashStr(head), head, at: Date.now(), scenes };
    const list = (auxScenes[chatKey] || []).filter((r) => r.head !== head);
    list.push(rec);
    auxScenes[chatKey] = list.slice(-300);   // 채팅방마다 최근 300개만
    rebuildAuxIndex();
    await store.setItem(KEY_AUX_SCENES, auxScenes);
    return rec;
  }
  function findAuxRecord(content) {
    const byHead = auxHeadIndex.get(msgHead(content));
    if (byHead) return byHead;
    // 지금 채팅방 기록 중에서 글귀가 전부 들어 있는 것 (짧은 글귀 하나로는 판단하지 않음)
    const flat = content.replace(/\s+/g, '');
    const list = auxScenes[currentChat.chatKey] || [];
    for (let k = list.length - 1; k >= 0; k--) {
      const anchors = list[k].scenes.map((sc) => sc.from.replace(/\s+/g, '')).filter((a) => a.length >= 4);
      if (anchors.join('').length >= 12 && anchors.every((a) => flat.includes(a))) return list[k];
    }
    return null;
  }
  const escRe = (c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 글귀 위치 찾기: 공백 차이는 무시, 못 찾으면 앞부분만 (60% → 6글자)으로 다시
  function anchorIndex(content, from, start) {
    const chars = [...String(from).replace(/\s+/g, '')];
    if (!chars.length) return -1;
    const lens = [...new Set([chars.length, Math.ceil(chars.length * 0.6), Math.min(6, chars.length)])].filter((n) => n >= Math.min(6, chars.length));
    for (const n of lens) {
      const re = new RegExp(chars.slice(0, n).map(escRe).join('\\s*'), 'g');
      re.lastIndex = start;
      const m = re.exec(content);
      if (m) return m.index;
    }
    return -1;
  }
  function insertAuxMarkers(content, rec) {
    const marks = [];
    let pos = 0;
    rec.scenes.forEach((sc, i) => {
      let at = sc.from ? anchorIndex(content, sc.from, pos) : -1;
      if (at < 0) at = i === 0 ? 0 : pos;   // 못 찾으면 첫 장면은 맨 앞, 나머지는 앞 장면 자리(뒤 장면이 우선)
      marks.push({ at, body: sc.body });
      pos = at;
    });
    let out = content;
    for (let k = marks.length - 1; k >= 0; k--) out = out.slice(0, marks[k].at) + bgMarker(marks[k].body, rec.id) + out.slice(marks[k].at);
    return out;
  }

  // ─────────────────────────────────────────────────────────────
  // 봇 자체 배경 출력 읽기
  // ─────────────────────────────────────────────────────────────
  // 원작자의 상태창(예: "Background: sh_bg_cafe_summer_day.webp")이나 {{asset::이름}} 같은 이미지 출력에서
  // 에셋 이름을 찾아, RisuAI가 {{asset::}}에서 이미지를 고르는 규칙 그대로 해석함.
  //  1) 이름(소문자)이 봇 에셋 + 적용된 모듈 에셋 이름과 정확히 같으면 그 에셋
  //  2) 아니면 확장자와 _ - . 공백 등을 떼고, 봇 에셋(모듈 제외) 중 편집 거리가 가장 가까운 것
  //     (RisuAI 설정 assetMaxDifference 이하일 때만, 기본 4)
  // 그 에셋이 라이브러리에 배경으로 등록돼 있을 때만 배경으로 씀 (캐릭터 스프라이트 등은 무시).
  // 원문과 봇 출력은 바꾸지 않고 읽기만 함.
  let assetIndex = { chaId: '', exact: new Map(), fuzzy: [], maxDiff: 4, legacy: false, cache: new Map() };
  const ASSET_EXTS = ['webp', 'png', 'jpg', 'jpeg', 'gif', 'mp4', 'webm', 'avi', 'm4p', 'm4v', 'mp3', 'wav', 'ogg'];
  function trimAssetName(str) {   // RisuAI parser.ts의 trimmer와 같은 규칙
    for (const e of ASSET_EXTS) if (str.endsWith('.' + e)) str = str.substring(0, str.length - e.length - 1);
    return str.trim().replace(/[_ -.]/g, '');
  }
  function editDistance(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }
  async function buildAssetIndex(char) {
    const exact = new Map();
    const fuzzy = [];
    for (const a of char.additionalAssets || []) {
      const k = String(a[0] || '').toLowerCase();
      if (!k) continue;
      if (!exact.has(k)) exact.set(k, a[1]);
      fuzzy.push([trimAssetName(k), a[1]]);
    }
    try {
      for (const mod of await getActiveModules(char)) {
        for (const a of mod.assets || []) {
          const k = String(a[0] || '').toLowerCase();
          if (k && !exact.has(k)) exact.set(k, a[1]);
        }
      }
    } catch {}
    let maxDiff = 4;
    let legacy = false;
    try {
      const db = await risuai.getDatabase(['assetMaxDifference', 'legacyMediaFindings']);
      if (Number.isFinite(db?.assetMaxDifference)) maxDiff = db.assetMaxDifference;
      legacy = !!db?.legacyMediaFindings;
    } catch {}
    assetIndex = { chaId: char.chaId, exact, fuzzy, maxDiff, legacy, cache: new Map() };
  }
  function resolveAssetPath(name, fuzzyOk) {
    const k = String(name).toLowerCase().trim();
    const ck = (fuzzyOk ? '~' : '=') + k;
    if (assetIndex.cache.has(ck)) return assetIndex.cache.get(ck);
    let path = assetIndex.exact.get(k) || null;
    if (!path && fuzzyOk && !assetIndex.legacy) {
      const t = trimAssetName(k);
      let best = null;
      let bestD = Infinity;
      for (const [tk, pth] of assetIndex.fuzzy) {
        if (Math.abs(tk.length - t.length) >= bestD) continue;
        const d = editDistance(t, tk);
        if (d < bestD) { bestD = d; best = pth; }
      }
      if (bestD <= assetIndex.maxDiff) path = best;
    }
    assetIndex.cache.set(ck, path);
    return path;
  }
  // 에셋 경로 → 이 캐릭터에서 쓸 수 있는 라이브러리 배경 (캐릭터 전용 우선)
  function bgItemForPath(path, chaId) {
    if (!path) return null;
    const hits = meta.filter((m) => m.source === 'asset' && m.path === path && isUsable(m, chaId));
    return hits.find((m) => m.scope === 'char') || hits[0] || null;
  }
  const BOT_CBS_RE = /\{\{(?:raw|path|img|image|bg|asset)::(.+?)\}\}/gs;
  const BOT_TOKEN_RE = /[\p{L}\p{N}][\p{L}\p{N}_\-.]{3,}/gu;
  const IMG_NAME_RE = /\.(?:webp|png|jpe?g|gif|avif)$/i;
  // 답변 원문에서 봇 배경 출력 찾기 → [{ at, imageId, name, missing }] (나온 순서)
  //  - {{asset::이름}} 같은 이미지 문법과, 파일명 모양(…​.webp 등) 글자는 RisuAI 규칙(가까운 이름 포함)으로 해석
  //  - 확장자 없는 글자는 _가 든 식별자 모양이고 에셋 이름과 정확히 같을 때만
  //  - 배경이 아닌 에셋(스프라이트 등)은 무시. 파일명 모양인데 어떤 에셋도 못 찾으면 missing으로 남김
  function findBotBgRefs(text, chaId) {
    const out = [];
    if (typeof text !== 'string' || !text || assetIndex.chaId !== chaId) return out;
    const cbsRanges = [];
    for (const m of text.matchAll(BOT_CBS_RE)) {
      const arg = m[1];
      cbsRanges.push([m.index, m.index + m[0].length]);
      if (arg.includes('{{')) continue;   // {{asset::{{getvar::bg}}}}처럼 변수로 고르는 건 원문에서 알 수 없음
      const path = resolveAssetPath(arg, true);
      const item = bgItemForPath(path, chaId);
      if (item) out.push({ at: m.index, imageId: item.id, name: arg });
      else if (!path) out.push({ at: m.index, imageId: null, name: arg, missing: true });
    }
    const inCbs = (i) => cbsRanges.some(([a, b]) => i >= a && i < b);
    for (const m of text.matchAll(BOT_TOKEN_RE)) {
      if (inCbs(m.index)) continue;
      const tok = m[0].replace(/[.\-]+$/, '');
      const fileLike = IMG_NAME_RE.test(tok);
      // 확장자 없는 글자는 _가 든 식별자 모양일 때만 (본문의 '교실' 같은 낱말이 에셋 이름과 같아도 무시)
      if (!fileLike && !(tok.includes('_') && assetIndex.exact.has(tok.toLowerCase()))) continue;
      const path = resolveAssetPath(tok, fileLike);
      const item = bgItemForPath(path, chaId);
      if (item) out.push({ at: m.index, imageId: item.id, name: tok });
      else if (!path && fileLike) out.push({ at: m.index, imageId: null, name: tok, missing: true });
    }
    return out.sort((a, b) => a.at - b.at);
  }
  // 화면 표시용 후보 찾기: 캐릭터 에셋 정보 없이도 동작 (해석은 나중에 resolveRefBody)
  let libNameCache = { key: '', set: new Set() };
  function libraryAssetNames() {
    const key = meta.length + ':' + (meta[meta.length - 1]?.id || '');
    if (libNameCache.key !== key) {
      const set = new Set();
      for (const m of meta) {
        if (m.source !== 'asset' || !m.name) continue;
        const n = String(m.name).toLowerCase();
        set.add(n);
        set.add(n.replace(/\.[a-z0-9]+$/, ''));
      }
      libNameCache = { key, set };
    }
    return libNameCache.set;
  }
  function findBotRefCandidates(text) {
    const out = [];
    if (typeof text !== 'string' || !text) return out;
    const names = libraryAssetNames();
    const cbsRanges = [];
    for (const m of text.matchAll(BOT_CBS_RE)) {
      cbsRanges.push([m.index, m.index + m[0].length]);
      if (!m[1].includes('{{')) out.push({ at: m.index, name: m[1].trim(), fuzzy: true });
    }
    const inCbs = (i) => cbsRanges.some(([a, b]) => i >= a && i < b);
    for (const m of text.matchAll(BOT_TOKEN_RE)) {
      if (inCbs(m.index)) continue;
      const tok = m[0].replace(/[.\-]+$/, '');
      const fileLike = IMG_NAME_RE.test(tok);
      if (fileLike || (tok.includes('_') && names.has(tok.toLowerCase()))) out.push({ at: m.index, name: tok, fuzzy: fileLike });
    }
    return out.sort((a, b) => a.at - b.at);
  }
  // 스크롤 확인 때: 'ref=' 표시를 지금 캐릭터 기준으로 해석 → 'img=<id>' (배경이 아니거나 못 찾으면 null)
  function resolveRefBody(body) {
    const m = /^ref=([~=])([\s\S]*)$/.exec(body);
    if (!m) return body;
    if (assetIndex.chaId !== currentChat.chaId) return null;
    const item = bgItemForPath(resolveAssetPath(m[2], m[1] === '~'), currentChat.chaId);
    return item ? 'img=' + item.id : null;
  }

  // ── 채팅 변수에 배경 키를 담는 봇 (Lua 트리거가 정하고 상태창이 {{getvar::…}}로 보여 주는 방식) ──
  // 채팅 변수(chat.scriptstate) 중 값이 라이브러리 배경 에셋 이름과 정확히 같은 것을 찾음.
  // 이름에 bg·background·배경이 든 변수를 우선하고, 한 번 찾은 변수 이름은 캐릭터별로 기억함.
  function findVarBg(chat, chaId) {
    const ss = chat?.scriptstate;
    if (!ss || typeof ss !== 'object' || assetIndex.chaId !== chaId) return null;
    const cands = [];
    for (const [key, v] of Object.entries(ss)) {
      if (typeof v !== 'string' || !v || v.length > 160 || /\s/.test(v)) continue;
      const path = resolveAssetPath(v, IMG_NAME_RE.test(v));   // 파일명 모양일 때만 비슷한 이름까지
      const item = bgItemForPath(path, chaId);
      if (item) cands.push({ key, value: v, imageId: item.id, bgName: /bg|background|배경/i.test(key) });
    }
    if (!cands.length) return null;
    const pref = settings.bgVarByChar?.[chaId];
    return cands.find((c) => c.key === pref) || cands.find((c) => c.bgName) || cands[0];
  }
  async function rememberBgVar(chaId, key) {
    if (!chaId || !key || settings.bgVarByChar?.[chaId] === key) return;
    settings.bgVarByChar = { ...(settings.bgVarByChar || {}), [chaId]: key };
    await saveSettings();
  }

  const stateOfItem = (m) => ({ location: normTag(m.location), time: m.time || '', season: m.season || '', tags: [...(m.tags || [])] });

  // 채팅 화면 위쪽에 몇 초간 뜨는 작은 알림 (클릭을 막지 않음)
  async function showMainToast(text, ms = 5000) {
    if (!rootDoc) return;
    try {
      const body = await rootDoc.querySelector('body');
      if (!body) return;
      const base = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483000;pointer-events:none;' +
        'max-width:min(92vw,520px);padding:10px 16px;border-radius:12px;background:rgba(28,30,38,.94);color:#f2f2f7;' +
        'border:1px solid rgba(230,211,163,.35);box-shadow:0 8px 24px rgba(0,0,0,.45);font:500 13px/1.5 Pretendard,system-ui,sans-serif;' +
        'transition:opacity .35s ease;';
      const box = await rootDoc.createElement('div');
      await box.setAttribute('x-wp-toast', '1');
      await box.setStyleAttribute(base + 'opacity:0');
      await box.setInnerText(text);
      await body.appendChild(box);
      setTimeout(() => { box.setStyleAttribute(base + 'opacity:1').catch(() => {}); }, 30);
      setTimeout(() => { box.setStyleAttribute(base + 'opacity:0').catch(() => {}); }, ms);
      setTimeout(() => { box.remove().catch(() => {}); }, ms + 450);
    } catch (e) {
      console.warn('[Wall Painter] 알림 표시 실패', e);
    }
  }

  // 자체 배경 출력이 있는 봇으로 표시하고, 처음 한 번은 태그 주입을 꺼서 출력 형식이 겹치지 않게 함
  async function markSelfBg(chaId, charName = '') {
    if (!chaId || settings.selfBgChars.includes(chaId)) return;
    settings.selfBgChars = [...settings.selfBgChars, chaId];
    const turnedOff = !settings.injectOffChars.includes(chaId);
    if (turnedOff) settings.injectOffChars = [...settings.injectOffChars, chaId];
    await saveSettings();
    console.log('[Wall Painter] 자체 배경 출력이 있는 봇으로 감지 — 이 캐릭터의 태그 주입을 껐습니다', chaId);
    showMainToast(`🖌️ Wall Painter: ${charName ? `'${charName}'의 ` : ''}자체 배경 출력을 감지했습니다. ` +
      (turnedOff ? '출력 형식이 겹치지 않도록 이 봇의 태그 주입을 껐습니다.' : '이 봇의 배경 출력을 그대로 따라갑니다.'));
  }
  // 채팅방을 열 때: 첫 메시지와 최근 답변에서 자체 배경 출력을 찾음 → 마지막으로 나온 배경 id
  async function scanHistoryForBotBg(char, chat) {
    const texts = [char.firstMessage, ...(char.alternateGreetings || [])];
    const msgs = (chat?.message || []).filter((x) => x.role === 'char').slice(-20);
    let found = false;
    let latest = null;
    for (const t of texts) if (findBotBgRefs(t, char.chaId).some((r) => r.imageId)) found = true;
    for (const x of msgs) {
      const refs = findBotBgRefs(x.data, char.chaId).filter((r) => r.imageId);
      if (refs.length) { found = true; latest = refs[refs.length - 1].imageId; }
    }
    if (found) await markSelfBg(char.chaId, char.name);
    return latest;
  }

  async function detectAndApply({ char, chat, chatIndex, messageIndex }) {
    if (disposed || !char || !chat) return;
    if (!isCharEnabled(char.chaId)) return;
    const msg = chat.message?.[messageIndex];
    if (!msg || msg.role !== 'char') return;

    const chaId = char.chaId;
    const chatKey = makeChatKey(char, chat, chatIndex);
    const prev = (await store.getItem(KEY_CHAT + chatKey)) || null;

    // 1순위: 봇 자체 배경 출력 (원작자 상태창·이미지). 있으면 그 이미지를 그대로 씀
    if (assetIndex.chaId !== chaId) await buildAssetIndex(char);
    const botRefs = findBotBgRefs(msg.data, chaId);
    const hit = [...botRefs].reverse().find((r) => r.imageId);
    // 자체 출력 봇 판단은 "스캔해서 배경으로 등록된 에셋을 실제로 찾았을 때"만.
    // 못 찾은 파일명만 있으면 이미 자체 출력 봇으로 알려진 경우에만 '찾지 못함'으로 처리
    if (hit || (botRefs.length && settings.selfBgChars.includes(chaId))) {
      if (hit) await markSelfBg(chaId, char.name);
      if (!hit) {
        // 봇이 쓴 이름을 RisuAI도 못 찾음: AI 답변이나 원작자 지시문 쪽 문제라서 이전 배경 유지
        lastDetect = { source: 'bot-missing', missing: botRefs[botRefs.length - 1].name, state: prev?.state || null, imageId: prev?.imageId || null, at: Date.now() };
        return;
      }
      const item = meta.find((m) => m.id === hit.imageId);
      const botState = stateOfItem(item);
      await store.setItem(KEY_CHAT + chatKey, { state: botState, imageId: hit.imageId, at: Date.now() });
      lastDetect = { source: 'bot', state: botState, imageId: hit.imageId, at: Date.now() };
      if (chatKey === currentChat.chatKey) {
        sceneTime = botState.time || sceneTime;
        await applyImage(hit.imageId);
      }
      return;
    }

    // 2순위: 봇이 채팅 변수에 담아 둔 배경 키 (Lua 트리거가 답변 뒤에 갱신한 값)
    const vb = findVarBg(chat, chaId);
    if (vb) {
      await markSelfBg(chaId, char.name);
      await rememberBgVar(chaId, vb.key);
      const item = meta.find((m) => m.id === vb.imageId);
      const vState = stateOfItem(item);
      await store.setItem(KEY_CHAT + chatKey, { state: vState, imageId: vb.imageId, at: Date.now() });
      lastDetect = { source: 'var', varKey: vb.key, state: vState, imageId: vb.imageId, at: Date.now() };
      const rec = await saveVarScene(chatKey, msg.data, vb.imageId);
      if (rec) pendingAux = { id: rec.id, body: 'img=' + vb.imageId, chatKey };
      if (chatKey === currentChat.chatKey) {
        sceneTime = vState.time || sceneTime;
        await applyImage(vb.imageId);
      }
      return;
    }

    let state = findTagInText(msg.data, chaId);
    let source = 'tag';
    // 자체 배경 출력 봇이 이번 답변에는 배경을 안 썼으면(장소 그대로) 보조모델로 추측하지 않고 유지
    if (!state && settings.auxFallback && !settings.selfBgChars.includes(chaId)) {
      // RisuAI가 답변 마무리(자동 계속, TTS 등)를 끝낼 시간을 줌
      await sleep(1500);
      if (disposed) return;
      const scenes = await askAuxScene(msg.data, prev?.state, chaId);
      source = 'aux';
      if (scenes) {
        state = { ...scenes[scenes.length - 1].state };   // 마지막 장면이 지금 배경
        const rec = await saveAuxScenes(chatKey, msg.data, scenes);
        if (rec) pendingAux = { id: rec.id, body: rec.scenes[rec.scenes.length - 1].body, chatKey };
      }
    }
    if (!state) {
      lastDetect = { source: 'none', state: prev?.state || null, imageId: prev?.imageId || null, at: Date.now() };
      return; // 판단 실패: 이전 배경 유지
    }
    // 장소를 못 정했으면 이전 장소 유지
    if (!state.location && prev?.state?.location) state.location = prev.state.location;

    // 장소가 맞는 배경도, 기본 배경도 없으면 배경을 끄지 않고 이전 배경을 유지
    const picked = pickImage(state, chaId, prev?.imageId);
    const imageId = picked || prev?.imageId || null;
    await store.setItem(KEY_CHAT + chatKey, { state, imageId, at: Date.now() });
    lastDetect = { source, state, imageId, nomatch: !picked, at: Date.now() };

    // 응답이 끝나기 전에 다른 채팅으로 이동했으면 화면에는 적용하지 않음
    if (chatKey === currentChat.chatKey) {
      sceneTime = state.time || sceneTime;
      await applyImage(imageId);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 봇/모듈 에셋 가져오기 + 이름 기반 자동 태깅
  // ─────────────────────────────────────────────────────────────
  // 이 봇에 적용된 모듈: 전역 활성 모듈 + 캐릭터 모듈 + 현재 채팅 모듈
  async function getActiveModules(char) {
    const db = await risuai.getDatabase(['modules', 'enabledModules']);   // 'db' 권한 요청
    const chat = char.chats?.[char.chatPage ?? 0];
    const ids = new Set([...(db?.enabledModules || []), ...(char.modules || []), ...(chat?.modules || [])]);
    return (db?.modules || []).filter((mod) => ids.has(mod.id));
  }

  async function collectBotAssets(char) {
    const list = [];
    const seen = new Set();
    const push = (name, path, ext, from) => {
      if (!name || !path || seen.has(path)) return;
      const e = (ext || String(path).split('.').pop() || '').toLowerCase();
      if (e && !IMAGE_EXT.includes(e)) return;   // 영상/오디오 제외
      seen.add(path);
      list.push({ name, path, ext: e, from });
    };
    for (const a of char.additionalAssets || []) push(a[0], a[1], a[2], '캐릭터');

    try {
      for (const mod of await getActiveModules(char)) {
        for (const a of mod.assets || []) push(a[0], a[1], a[2], `모듈: ${mod.name}`);
      }
    } catch (e) {
      console.warn('[Wall Painter] 모듈 에셋 읽기 실패', e);
    }
    return list;
  }

  async function autoTagByName(assets, char) {
    const sys = buildTaggingPrompt(char.chaId);
    const results = [];
    for (let start = 0; start < assets.length; start += AUX_NAMES_PER_CALL) {
      const chunk = assets.slice(start, start + AUX_NAMES_PER_CALL);
      const names = chunk.map((a, k) => `${start + k}: ${a.name}`).join('\n');
      const out = await callAux(sys, `Bot: ${char.name}\nAsset names:\n${names}`);
      const json = out.match(/\[[\s\S]*\]/);
      if (!json) throw new Error('보조모델이 JSON 배열을 주지 않음');
      for (const r of JSON.parse(json[0])) {
        const a = assets[Number(r.i)];
        if (!a) continue;
        results.push({
          asset: a,
          location: normTag(r.location),
          time: TIMES.includes(norm(r.time)) ? norm(r.time) : '',
          season: SEASONS.includes(norm(r.season)) ? norm(r.season) : '',
          tags: parseTagList(r.tags),
        });
      }
    }
    return results.filter((r) => r.location);
  }

  // 보조모델이 실패하면 이름에 bg/background/배경이 들어간 에셋만 파일명 규칙으로 태깅
  function fallbackTagByName(assets) {
    return assets
      .filter((a) => /(^|[_\-\s.])(bg|background|backgrounds|배경)([_\-\s.]|$)/i.test(a.name))
      .map((a) => ({ asset: a, ...guessTagsFromName(a.name, true) }))
      .filter((r) => r.location);
  }

  async function importBotAssets(char, { openReview = true } = {}) {
    if (importing) return importing;
    importing = (async () => {
      const assets = await collectBotAssets(char);
      // 이미 라이브러리에 있는 에셋(범위 상관없이: 프리셋으로 전체 공통에 넣은 것 포함)과
      // 예전 스캔에서 이미 확인한 에셋(배경이 아니라고 판단된 스프라이트 등)은 다시 보내지 않음
      const checked = new Set((await store.getItem(KEY_CHECKED + char.chaId)) || []);
      const existing = new Set(meta.filter((m) => m.source === 'asset').map((m) => m.path));
      const fresh = assets.filter((a) => !existing.has(a.path) && !checked.has(a.path));

      let tagged = [];
      let note = '';
      let auxOk = true;
      let processed = [];   // 이번에 확인을 끝낸 에셋 (다음 스캔에서 제외)
      if (fresh.length) {
        // 1) 이름에 bg/background/배경이 든 에셋은 보조모델 없이 파일명 규칙으로 바로 태깅
        const ruleHits = fallbackTagByName(fresh);
        const ruleSet = new Set(ruleHits.map((r) => r.asset.path));
        const rest = fresh.filter((a) => !ruleSet.has(a.path));
        tagged = ruleHits;
        processed = ruleHits.map((r) => r.asset);
        // 2) 나머지는 보조모델로 확인할지 물어봄 (호출 횟수 안내)
        if (rest.length) {
          const calls = Math.ceil(rest.length / AUX_NAMES_PER_CALL);
          const choice = await showDialog({
            title: '나머지 에셋도 보조모델로 확인할까요?',
            body: `<p>새 에셋 <b>${fresh.length}개</b> 중 이름에 bg·배경이 들어간 <b>${ruleHits.length}개</b>는 파일명 규칙으로 바로 가져옵니다.</p>
              <p>나머지 <b>${rest.length}개</b>의 이름을 보조모델에 보내 배경인지 판단할 수 있습니다. <b>보조모델 약 ${calls}번 호출</b></p>
              <p class="hint">확인한 에셋은 기억해서 다음 스캔에서는 다시 보내지 않습니다.</p>`,
            buttons: [
              { label: ruleHits.length ? `규칙으로 찾은 ${ruleHits.length}개만` : '취소', value: 'rule' },
              { label: `보조모델로 확인 (${calls}번)`, value: 'aux', cls: 'sel' },
            ],
          });
          if (choice === 'aux') {
            try {
              tagged = [...ruleHits, ...(await autoTagByName(rest, char))];
              processed = fresh;
            } catch (e) {
              console.warn('[Wall Painter] 자동 태깅 실패, 파일명 규칙 결과만 사용', e);
              auxOk = false;
              note = '보조모델 확인에 실패해서 이름에 bg·배경이 들어간 에셋만 파일명 규칙으로 가져왔습니다. 보조모델 문제를 해결한 뒤 다시 스캔하면 나머지 에셋도 확인합니다.';
            }
          } else if (!ruleHits.length) {
            return null;   // 취소
          } else {
            note = `나머지 ${rest.length}개 에셋은 확인하지 않았습니다. 다시 스캔하면 다시 물어봅니다.`;
          }
        }
        if (processed.length) {
          for (const a of processed) checked.add(a.path);
          await store.setItem(KEY_CHECKED + char.chaId, [...checked]);
        }
      }
      for (const r of tagged) {
        meta.push({
          id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
          name: r.asset.name, source: 'asset', path: r.asset.path, ext: r.asset.ext, from: r.asset.from,
          scope: 'char', chaId: char.chaId, charName: char.name,
          location: r.location, time: r.time, season: r.season, tags: r.tags,
          review: true,
        });
      }
      // 보조모델이 실패했으면 "가져옴"으로 표시하지 않아서 새 봇 안내가 계속 뜨게 함
      if (auxOk && !settings.scannedChars.includes(char.chaId)) settings.scannedChars.push(char.chaId);
      await saveMeta(); await saveSettings();

      const summary = { total: assets.length, checked: fresh.length, added: tagged.length, note };
      // 스캔으로 배경이 새로 생겼으면 지금 채팅방을 다시 확인 (이미 지난 답변의 상태창 배경을 바로 반영)
      if (tagged.length && char.chaId === currentChat.chaId) {
        lastScrollSig = '';
        await refreshCurrentChat(true);
        scheduleScrollScan(300);
      }
      if (openReview && tagged.length) await openUI({ mode: 'modal', focus: 'review', importSummary: summary });
      return summary;
    })();
    try { return await importing; } finally { importing = null; }
  }

  // ─────────────────────────────────────────────────────────────
  // 프리셋 저장 / 불러오기
  //  - JSON(참조만): 이미지 없이 이름·장소·시간대·계절·태그와 봇 에셋 경로만. 직접 올린 이미지는
  //    이미지 지문(hash)만 담겨서, 같은 이미지가 이미 있는 기기에서만 태그가 덮어써짐.
  //  - ZIP(이미지 포함): preset.json + images/ 폴더. 봇 없이도 그대로 쓸 수 있음.
  //  - 캐릭터별 ON/OFF·기본 배경 같은 기기 설정은 담지 않음.
  // ─────────────────────────────────────────────────────────────
  const PRESET_FORMAT = 'wall-painter-preset';

  // 이미지 지문: 저장된 dataURL 문자열의 FNV-1a 해시 + 길이
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return `${str.length.toString(36)}-${(h >>> 0).toString(36)}`;
  }
  async function uploadHash(m) {
    if (m.hash) return m.hash;
    const data = await store.getItem(KEY_IMG + m.id);
    if (!data) return '';
    m.hash = hashString(data);
    return m.hash;
  }

  const bytesToDataURL = (bytes, mime) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(new Blob([bytes], { type: mime }));
  });
  function dataURLToBytes(dataURL) {
    const [head, b64] = dataURL.split(',');
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return { bytes: out, mime: head.match(/data:([^;]+)/)?.[1] || 'image/webp' };
  }
  const mimeOfExt = (ext) => {
    ext = (ext || '').toLowerCase();
    return ext === 'jpg' ? 'image/jpeg' : IMAGE_EXT.includes(ext) ? `image/${ext}` : 'image/png';
  };

  // ── ZIP (압축 없이 묶기 / 읽을 때는 압축된 ZIP도 지원) ──
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(bytes) {
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const size = f.data.length;
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true);          // 파일 이름 UTF-8
      local.setUint16(8, 0, true);               // 압축 없음
      local.setUint32(14, crc, true);
      local.setUint32(18, size, true);
      local.setUint32(22, size, true);
      local.setUint16(26, name.length, true);
      parts.push(local.buffer, name, f.data);
      const cen = new DataView(new ArrayBuffer(46));
      cen.setUint32(0, 0x02014b50, true);
      cen.setUint16(4, 20, true);
      cen.setUint16(6, 20, true);
      cen.setUint16(8, 0x0800, true);
      cen.setUint32(16, crc, true);
      cen.setUint32(20, size, true);
      cen.setUint32(24, size, true);
      cen.setUint16(28, name.length, true);
      cen.setUint32(42, offset, true);
      central.push(cen.buffer, name);
      offset += 30 + name.length + size;
    }
    const cenSize = central.reduce((n, p) => n + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cenSize, true);
    end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }
  async function readZip(buf) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('ZIP 파일이 아닙니다');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const dec = new TextDecoder();
    const files = new Map();
    for (let n = 0; n < count; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = dec.decode(new Uint8Array(buf, p + 46, nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith('/')) continue;
      const lNameLen = dv.getUint16(localOff + 26, true);
      const lExtraLen = dv.getUint16(localOff + 28, true);
      const start = localOff + 30 + lNameLen + lExtraLen;
      const raw = new Uint8Array(buf, start, csize);
      files.set(name, async () => {
        if (method === 0) return raw;
        if (method === 8) {
          const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Uint8Array(await new Response(stream).arrayBuffer());
        }
        throw new Error(`지원하지 않는 압축 방식(${method})`);
      });
    }
    return files;
  }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  const safeFileName = (s) => String(s || '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'preset';

  function presetItems(scope, char) {
    return meta.filter((m) => (scope === 'char' ? m.scope === 'char' && m.chaId === char?.chaId : m.scope === 'global'));
  }

  async function exportPreset(scope, char, withImages, onProgress) {
    const items = presetItems(scope, char);
    const files = [];
    const out = [];
    let i = 0;
    for (const m of items) {
      i++;
      onProgress?.(i, items.length);
      const it = {
        name: m.name, source: m.source, location: m.location || '', time: m.time || '', season: m.season || '',
        tags: m.tags || [],
      };
      if (m.source === 'asset') Object.assign(it, { path: m.path, ext: m.ext, from: m.from });
      if (m.source === 'upload') it.hash = await uploadHash(m);
      if (withImages) {
        try {
          let bytes, ext;
          if (m.source === 'asset') {
            bytes = await risuai.readImage(m.path);
            ext = (m.ext || 'png').toLowerCase();
          } else {
            const data = await store.getItem(KEY_IMG + m.id);
            if (data) ({ bytes } = dataURLToBytes(data));
            ext = 'webp';
          }
          if (bytes) {
            it.file = `images/${String(i).padStart(4, '0')}.${ext}`;
            files.push({ name: it.file, data: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes) });
          }
        } catch (e) {
          console.warn('[Wall Painter] 프리셋 이미지 읽기 실패', m.name, e);
        }
      }
      out.push(it);
    }
    const preset = {
      format: PRESET_FORMAT, version: 1, scope, exportedAt: new Date().toISOString(),
      plugin: `Wall Painter ${VERSION}`, character: scope === 'char' ? char?.name || '' : '',
      withImages, items: out,
    };
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `wallpainter_${scope === 'char' ? safeFileName(char?.name) : 'global'}_${stamp}`;
    if (!withImages) {
      downloadBlob(new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' }), `${base}.json`);
    } else {
      const json = new TextEncoder().encode(JSON.stringify(preset, null, 2));
      downloadBlob(makeZip([{ name: 'preset.json', data: json }, ...files]), `${base}.zip`);
    }
    return { count: out.length, images: files.length };
  }

  // 파일을 읽어서 무엇이 추가·덮어쓰기·건너뛰기 될지 계획만 세움 (아직 바꾸지 않음)
  async function planPresetImport(file, scope, char) {
    let preset;
    let zipFiles = null;
    if (/\.zip$/i.test(file.name) || file.type.includes('zip')) {
      zipFiles = await readZip(await file.arrayBuffer());
      const pj = zipFiles.get('preset.json') || [...zipFiles.entries()].find(([n]) => n.endsWith('preset.json'))?.[1];
      if (!pj) throw new Error('ZIP 안에 preset.json이 없습니다');
      preset = JSON.parse(new TextDecoder().decode(await pj()));
    } else {
      preset = JSON.parse(await file.text());
    }
    if (preset?.format !== PRESET_FORMAT || !Array.isArray(preset.items)) throw new Error('Wall Painter 프리셋 파일이 아닙니다');

    const targetItems = presetItems(scope, char);
    const botPaths = scope === 'char' && char ? new Set((await collectBotAssets(char)).map((a) => a.path)) : new Set();
    // 같은 이미지가 여러 장 있을 수 있어서 지문마다 후보 목록을 두고 한 장씩 짝지음
    const hashOf = new Map();
    for (const m of targetItems) {
      if (m.source !== 'upload') continue;
      const h = await uploadHash(m);
      if (!hashOf.has(h)) hashOf.set(h, []);
      hashOf.get(h).push(m);
    }
    const takeByHash = (h, name) => {
      const pool = hashOf.get(h);
      if (!pool?.length) return null;
      const k = Math.max(0, pool.findIndex((m) => m.name === name));   // 이름까지 같으면 우선
      return pool.splice(k, 1)[0];
    };
    const usedAssets = new Set();

    const plan = { preset, add: [], overwrite: [], skip: [] };
    for (const it of preset.items) {
      const tags = { name: String(it.name || ''), location: normTag(it.location), time: TIMES.includes(it.time) ? it.time : '',
        season: SEASONS.includes(it.season) ? it.season : '', tags: parseTagList(it.tags) };
      // 1) 같은 봇 에셋 경로가 이미 있으면 덮어쓰기
      if (it.source === 'asset' && it.path) {
        const same = targetItems.find((m) => m.source === 'asset' && m.path === it.path && !usedAssets.has(m));
        if (same) { usedAssets.add(same); plan.overwrite.push({ target: same, tags }); continue; }
        if (botPaths.has(it.path)) {
          plan.add.push({ kind: 'asset', it, tags });
          continue;
        }
      }
      // 2) 직접 올린 이미지는 지문이 같으면 덮어쓰기
      const byHash = it.hash ? takeByHash(it.hash, it.name) : null;
      if (byHash) { plan.overwrite.push({ target: byHash, tags }); continue; }
      // 3) ZIP에 이미지가 있으면 새 이미지로 추가
      const getter = it.file && zipFiles?.get(it.file);
      if (getter) { plan.add.push({ kind: 'image', it, tags, getter }); continue; }
      plan.skip.push({ it, why: it.source === 'asset' ? '이 봇에 없는 에셋(참조만 저장된 프리셋)' : '이미지가 없음(참조만 저장된 프리셋)' });
    }
    return plan;
  }

  async function applyPresetImport(plan, scope, char, onProgress) {
    const scopeInfo = scope === 'char' && char ? { scope: 'char', chaId: char.chaId, charName: char.name } : { scope: 'global' };
    for (const { target, tags } of plan.overwrite) {
      Object.assign(target, { location: tags.location, time: tags.time, season: tags.season, tags: tags.tags });
      if (target.source === 'upload' && tags.name) target.name = tags.name;
    }
    let i = 0;
    for (const a of plan.add) {
      onProgress?.(++i, plan.add.length);
      const base = { ...scopeInfo, location: a.tags.location, time: a.tags.time, season: a.tags.season, tags: a.tags.tags, review: true };
      if (a.kind === 'asset') {
        meta.push({ id: 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: a.tags.name || a.it.path,
          source: 'asset', path: a.it.path, ext: a.it.ext, from: a.it.from || '프리셋', ...base });
        continue;
      }
      try {
        const bytes = await a.getter();
        const ext = (a.it.file.split('.').pop() || '').toLowerCase();
        let data = await bytesToDataURL(bytes, mimeOfExt(ext));
        // 이 플러그인이 저장하는 형식(webp, 1920px 이하)이 아니면 맞춰서 줄임
        if (ext !== 'webp') data = await resizeImage(data, MAX_IMAGE_DIM);
        const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        await store.setItem(KEY_IMG + id, data);
        meta.push({ id, name: a.tags.name || 'preset', source: 'upload', hash: hashString(data), ...base });
      } catch (e) {
        console.warn('[Wall Painter] 프리셋 이미지 가져오기 실패', a.it.name, e);
      }
    }
    await saveMeta();
  }

  // ── 설정창 안의 대화상자 ──
  function showDialog({ title, body, buttons }) {
    return new Promise((resolve) => {
      document.querySelector('.dlg-back')?.remove();
      const back = document.createElement('div');
      back.className = 'dlg-back';
      back.innerHTML = `<div class="dlg" role="dialog"><h3>${title}</h3><div class="dlg-body">${body}</div>
        <div class="dlg-btns">${buttons.map((b, i) => `<button class="chip ${b.cls || 'gray'}" data-i="${i}">${b.label}</button>`).join('')}</div></div>`;
      const close = (v) => { back.remove(); resolve(v); };
      back.addEventListener('click', (e) => {
        if (e.target === back) return close(null);
        const b = e.target.closest('[data-i]');
        if (b) close(buttons[Number(b.dataset.i)].value);
      });
      back._close = () => close(null);
      document.body.appendChild(back);
    });
  }
  function setDialogBody(html) {
    const el = document.querySelector('.dlg-back .dlg-body');
    if (el) el.innerHTML = html;
  }

  // ─────────────────────────────────────────────────────────────
  // 채팅방 전환 감지 → 저장된 배경 복원
  // ─────────────────────────────────────────────────────────────
  async function refreshCurrentChat(force = false) {
    if (disposed) return;
    let idx;
    try { idx = await risuai.getCurrentCharacterIndex(); } catch { return; }
    if (idx == null || idx < 0) {
      if (currentChat.charIdx !== -1) {
        currentChat = { charIdx: -1, chaId: '', charName: '', chatKey: '' };
        await applyImage(null);
      }
      return;
    }
    const char = await risuai.getCharacter();
    if (!char) return;
    const chatIndex = char.chatPage ?? 0;
    const chat = char.chats?.[chatIndex];
    const chatKey = makeChatKey(char, chat, chatIndex);
    if (!force && chatKey === currentChat.chatKey) return;
    currentChat = { charIdx: idx, chaId: char.chaId, charName: char.name, chatKey };

    if (!isCharEnabled(char.chaId)) { await applyImage(null); return; }
    await buildAssetIndex(char);
    let historyBotBg = await scanHistoryForBotBg(char, chat);
    const varBg = findVarBg(chat, char.chaId);
    if (varBg) {
      await markSelfBg(char.chaId, char.name);
      await rememberBgVar(char.chaId, varBg.key);
      historyBotBg = varBg.imageId;   // 채팅 변수는 지금 장면 그 자체
    }


    const saved = await store.getItem(KEY_CHAT + chatKey);
    sceneTime = saved?.state?.time || '';
    lastScrollSig = '';
    if (pendingAux && pendingAux.chatKey !== chatKey) pendingAux = null;
    scheduleScrollScan(1200);
    if (saved?.cleared) { await applyImage(null); return; }
    // 자체 출력 봇: 최근 답변의 상태창 배경이 기준 (리롤·수정·삭제로 저장값이 오래됐을 수 있음)
    if (historyBotBg && settings.selfBgChars.includes(char.chaId)) {
      const item = meta.find((m) => m.id === historyBotBg);
      if (saved?.imageId !== historyBotBg) await store.setItem(KEY_CHAT + chatKey, { state: stateOfItem(item), imageId: historyBotBg, at: Date.now() });
      sceneTime = item.time || sceneTime;
      await applyImage(historyBotBg);
      return;
    }
    if (saved?.imageId) {
      const m = meta.find((x) => x.id === saved.imageId);
      if (isUsable(m, char.chaId)) { await applyImage(saved.imageId); return; }
      // 그 사이 이미지가 꺼졌거나 지워졌으면 저장된 장면 상태로 다시 고름
      const imageId = saved.state ? pickImage(saved.state, char.chaId, null) : defaultFor(char.chaId);
      await store.setItem(KEY_CHAT + chatKey, { ...saved, imageId, at: Date.now() });
      await applyImage(imageId);
      return;
    }

    // 저장된 상태가 없으면: 최근 답변의 봇 자체 배경 출력 → 마지막 캐릭터 메시지의 태그 (보조모델은 호출 안 함)
    if (historyBotBg) {
      const item = meta.find((m) => m.id === historyBotBg);
      await store.setItem(KEY_CHAT + chatKey, { state: stateOfItem(item), imageId: historyBotBg, at: Date.now() });
      sceneTime = item.time || sceneTime;
      await applyImage(historyBotBg);
      return;
    }
    const msgs = chat?.message || [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== 'char') continue;
      const state = findTagInText(msgs[i].data, char.chaId);
      if (state) {
        const imageId = pickImage(state, char.chaId, null);
        await store.setItem(KEY_CHAT + chatKey, { state, imageId, at: Date.now() });
        await applyImage(imageId);
        return;
      }
      break;
    }
    await applyImage(defaultFor(char.chaId));
  }

  // ─────────────────────────────────────────────────────────────
  // 프롬프트 주입 / 표시에서 태그 숨기기
  // ─────────────────────────────────────────────────────────────
  // 설정창에서 고칠 수 있는 프롬프트. 비워 두면 아래 기본값을 씀.
  // {이름} 자리표시자는 보낼 때 실제 값으로 채움 (모르는 이름은 그대로 둠)
  const DEFAULT_PROMPTS = {
    inject:
      '[Scene background tag]\n' +
      'At the very beginning of your reply, before any narrative, output exactly one line:\n' +
      '{format}\n' +
      '{field_rules}\n' +
      'Describe where the characters physically are. Places that are only mentioned, remembered or planned do not count. ' +
      'If the location changes during the reply, output another [BG: ...] line right before the change. ' +
      'Repeat the previous values when nothing changed. Characters must never notice or mention this line.',
    aux:
      'You track the physical setting of a roleplay reply, in order.\n' +
      'Reply with a JSON array only, no prose. One object per scene, in the order they appear:\n' +
      '[{"from":"...","location":"...","time":"...","season":"...","tags":["..."]}]\n' +
      'from: copy 4-10 consecutive words EXACTLY as written in the text where that scene starts (no paraphrase, no ellipsis). ' +
      'The first scene starts with the first words of the text.\n' +
      'location: one of [{locations}], or "unknown" if none fits.\n' +
      'time: one of [{times}] or "unknown". season: one of [{seasons}] or "unknown".\n' +
      'tags: zero or more of [{tags}] that describe the scene.\n' +
      'Start a new scene only when the characters physically move to another place or the time clearly changes. ' +
      'Ignore places that are only mentioned, remembered or planned. ' +
      'If the text gives no new information, return one scene that repeats the previous values.',
    tagging:
      'You sort the image assets of a roleplay bot by their FILE NAMES only.\n' +
      'For each name decide whether it is a BACKGROUND / scenery image (a place), ' +
      'not a character sprite, portrait, expression, item, icon or UI element.\n' +
      'Reply with a JSON array only, no prose. One object per background, skip the rest:\n' +
      '[{"i":<index>,"location":"<snake_case place>","time":"day|evening|night|","season":"spring|summer|autumn|winter|","tags":["..."]}]\n' +
      'location: a short English snake_case place name (e.g. cafe, forest, school_classroom). {existing_locations}' +
      'time / season: only when the name clearly says so, otherwise "". ' +
      'tags: a few short English words for other clear features in the name (e.g. rain, festival, indoor). ' +
      'If no background exists, reply [].',
  };
  const PROMPT_VARS = {
    inject: ['format', 'field_rules', 'locations', 'times', 'seasons', 'tags'],
    aux: ['locations', 'times', 'seasons', 'tags'],
    tagging: ['existing_locations', 'locations'],
  };
  const promptTemplate = (key) => (settings.prompts?.[key] || '').trim() || DEFAULT_PROMPTS[key];
  const fillTemplate = (tpl, vars) => tpl.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));

  function buildInjection(chaId) {
    const v = vocabulary(chaId);
    if (!v.locations.length) return null;
    const fields = ['location=<location>'];
    const lines = [`location: choose one of: ${v.locations.join(', ')}. If none fits exactly, choose the closest broader one.`];
    if (v.times.length) {
      fields.push('time=<time>');
      lines.push(`time: ${TIMES.join(' | ')}.`);
    }
    if (v.seasons.length) {
      fields.push('season=<season>');
      lines.push(`season: ${SEASONS.join(' | ')}.`);
    }
    if (v.tags.length) {
      fields.push('tags=<tag, tag>');
      lines.push(`tags: zero or more of: ${v.tags.join(', ')}. Only tags that are true for the current scene.`);
    }
    return fillTemplate(promptTemplate('inject'), {
      format: `[BG: ${fields.join(' | ')}]`,
      field_rules: lines.join('\n'),
      locations: v.locations.join(', '),
      times: v.times.join(', '),
      seasons: v.seasons.join(', '),
      tags: v.tags.join(', '),
    });
  }

  // 보내는 요청(사본)에서만 [BG: …] 줄을 지움. 저장된 원문은 그대로.
  // 주입을 끈 캐릭터에서 예전 답변의 태그를 모델이 보고 계속 따라 쓰는 것(맥락 오염)을 막음.
  // 원작자 상태창 같은 다른 줄은 건드리지 않음.
  const TAG_LINE_RE = /\[BG:[^\]\n]*\]\s*/gi;
  function stripTagsFromRequest(messages) {
    if (!Array.isArray(messages)) return messages;
    let changed = 0;
    const strip = (t) => {
      if (typeof t !== 'string' || !t.includes('[BG:')) return t;
      changed++;
      return t.replace(TAG_LINE_RE, '');
    };
    const out = messages.map((m) => {
      if (!m || typeof m !== 'object') return m;
      if (typeof m.content === 'string') return { ...m, content: strip(m.content) };
      if (Array.isArray(m.content)) {   // 이미지가 섞인 메시지: 글 부분만
        return { ...m, content: m.content.map((part) => (part && typeof part.text === 'string' ? { ...part, text: strip(part.text) } : part)) };
      }
      return m;
    });
    if (changed) console.log(`[Wall Painter] 보내는 요청에서 [BG:] 태그를 지움 (메시지 ${changed}개, 원문은 그대로)`);
    return out;
  }

  const injectReplacer = async (messages, type) => {
    try {
      if (type !== 'model' || !settings.enabled) return messages;
      // 이 캐릭터에서 플러그인을 껐거나 주입을 껐으면: 주입하지 않고, 예전 태그도 요청에서 지움
      if (!isCharEnabled(currentChat.chaId) || settings.injectOffChars?.includes(currentChat.chaId)) {
        return stripTagsFromRequest(messages);
      }
      const text = buildInjection(currentChat.chaId);
      if (!text) return messages;
      return [...messages, { role: 'system', content: text }];
    } catch {
      return messages;
    }
  };

  // 화면에서 [BG: …] 줄을 숨김. 스크롤 모드에서는 그 자리에 보이지 않는 표시(span)를 남겨서
  // (display:none이면 위치를 잴 수 없어서, 크기 0인 보이지 않는 요소로 둠)
  // 지금 보고 있는 위치의 장면을 찾을 수 있게 함 (내용은 URI 인코딩해서 마크다운이 건드리지 않게)
  // 보조모델 기록으로 만든 표시에는 기록 id를 붙임 (방금 판단한 답변의 표시가 그려졌는지 확인용)
  function bgMarker(body, recId = '') {
    return `<span data-wp-bg="1"${recId ? ` data-wp-rec="${recId}"` : ''} style="display:inline-block;width:0;height:0;overflow:hidden;vertical-align:top;visibility:hidden;pointer-events:none">${encodeURIComponent(body.trim())}</span>`;
  }
  const hideTagHandler = (content) => {
    if (typeof content !== 'string') return content;
    if (settings.followMode === 'scroll') {
      // 봇 자체 배경 출력: 그 줄의 앞 줄 끝(첫 줄이면 그 줄 끝)에 표시. 봇 정규식이 읽는 줄 안은 건드리지 않음.
      // 채팅방을 연 직후에는 리스가 이 플러그인보다 먼저 메시지를 그려서 캐릭터 에셋 정보가 아직 없을 수 있음
      // → 여기서는 '에셋 이름 후보'만 표시해 두고, 실제 배경으로 해석하는 건 스크롤 확인 때(준비된 뒤) 함
      const refs = findBotRefCandidates(content);
      let out = content;
      if (refs.length) {
        const spots = [];
        for (const r of refs) {
          const lineStart = content.lastIndexOf('\n', r.at - 1);
          let at = lineStart;   // 앞 줄의 줄바꿈 바로 앞 (빈 줄은 건너뛰어 내용 있는 줄 끝에 붙임: 빈 문단이 생기지 않게)
          while (at > 0 && /[\r\n]/.test(content[at - 1])) at--;
          if (at === 0 && lineStart >= 0) at = -1;
          if (lineStart < 0 || at < 0) { const end = content.indexOf('\n', r.at); at = end < 0 ? content.length : end; }
          spots.push({ at, body: `ref=${r.fuzzy ? '~' : '='}${r.name}` });
        }
        for (let k = spots.length - 1; k >= 0; k--) out = out.slice(0, spots[k].at) + bgMarker(spots[k].body) + out.slice(spots[k].at);
      }
      if (out.includes('[BG:')) {
        // 자체 배경 출력 봇: 예전에 주입 때문에 쓰인 태그는 따르지 않음 (봇이 정한 배경이 기준)
        if (settings.selfBgChars.includes(currentChat.chaId)) {
          out = out.replace(/\[BG:[^\]\n]*\]\s*/gi, '');
        } else {
          return out.replace(/\[BG:([^\]\n]*)\]\s*/gi, (m, body) => bgMarker(body));
        }
      }
      if (refs.length) return out;
      // 태그가 없는 답변: 보조모델·채팅 변수 기록이 있으면 그 위치에 표시를 넣음 (원문은 그대로)
      const rec = auxHeadIndex.size ? findAuxRecord(out) : null;
      return rec ? insertAuxMarkers(out, rec) : out;
    }
    if (!content.includes('[BG:')) return content;
    return content.replace(/\[BG:[^\]\n]*\]\s*/gi, '');
  };

  // ── 스크롤 따라가기: 채팅 화면의 기준선(위에서 35%, 맨 아래 근처에선 최대 65%)보다 위에 있는 가장 가까운 표시의 장면으로 ──
  const REF_RATIO_TOP = 0.35;
  const REF_RATIO_BOTTOM = 0.65;
  let scrollScanTimer = null;
  let scrollScanBusy = false;
  let lastScrollSig = '';
  function scheduleScrollScan(delay = 180) {
    if (settings.followMode !== 'scroll') return;
    clearTimeout(scrollScanTimer);
    scrollScanTimer = setTimeout(() => { scanScrollScene().catch(() => {}); }, delay);
  }
  async function scanScrollScene() {
    if (disposed || !rootDoc || settings.followMode !== 'scroll' || !settings.enabled) return;
    if (!isCharEnabled(currentChat.chaId)) return;
    if (scrollScanBusy) { scheduleScrollScan(250); return; }
    scrollScanBusy = true;
    try {
      const screen = await rootDoc.querySelector('.default-chat-screen');
      if (!screen) return;
      const box = await screen.getBoundingClientRect();
      // 화면에 보이는 채팅 영역(위끝~입력창 위끝)과 채팅 끝까지 남은 거리 (= 메시지 목록 아래끝 - 입력창 위끝)
      let floor = box.bottom;
      let listBottom = null;
      try {
        const list = await rootDoc.querySelector('.default-chat-screen > .flex-col-reverse');
        const input = await rootDoc.querySelector('.default-chat-screen > .sticky');
        if (input) floor = (await input.getBoundingClientRect()).top;
        if (list) listBottom = (await list.getBoundingClientRect()).bottom;
      } catch {}
      const remaining = listBottom === null ? Infinity : Math.max(0, listBottom - floor);

      // 표시 위치 모으기 (위→아래. 같은 위치면 DOM에서 뒤에 있는 표시가 뒤로 → 뒤 표시가 우선)
      const marks = await rootDoc.querySelectorAll('.default-chat-screen [data-wp-bg]');
      const n = await marks.length();
      const items = [];
      for (let i = 0; i < n; i++) {
        const el = await marks.at(i);
        const r = await el.getBoundingClientRect();
        const body = resolveRefBody(decodeURIComponent((await el.textContent()) || ''));
        if (body) items.push({ el, top: r.top, i, body });   // 배경으로 해석되지 않는 후보 표시는 건너뜀
      }
      items.sort((a, b) => a.top - b.top || a.i - b.i);

      let body = null;
      let pickIsLast = false;   // 맨 아래 장면을 고른 경우 (방금 판단한 보조모델 결과 처리용)
      let decided = false;
      if (settings.scrollPick === 'area' && items.length) {
        // 화면 점유율: 표시 하나가 다음 표시 직전까지(마지막은 채팅 끝까지)를 한 장면으로 보고,
        // 보이는 영역과 겹치는 길이가 가장 긴 장면. 같은 배경이 이어지면 길이를 합침.
        // 흔들림 방지: 지금 장면이 1등의 80% 이상 보이면 그대로 유지
        const vTop = box.top;
        const vBot = floor;
        const sum = new Map();
        let lastBody = null;
        for (let k = 0; k < items.length; k++) {
          const start = items[k].top;
          const end = k + 1 < items.length ? items[k + 1].top : (listBottom ?? Infinity);
          const ov = Math.min(end, vBot) - Math.max(start, vTop);
          if (ov <= 0) continue;
          const b = items[k].body;
          sum.set(b, (sum.get(b) || 0) + ov);
          if (k === items.length - 1) lastBody = b;
        }
        if (sum.size) {
          let best = null;
          for (const [b, ov] of sum) if (!best || ov > best.ov) best = { b, ov };
          const cur = sum.get(lastScrollSig) || 0;
          if (lastScrollSig && cur >= best.ov * 0.8) return;   // 지금 장면 유지
          body = best.b;
          pickIsLast = body === lastBody;
          decided = true;
        }
        // 보이는 영역이 전부 첫 표시보다 위(장면 시작 전)면 아래 기준선 방식으로
      }
      let pick = null;
      if (!decided) {
        // 기준선: 평소 위에서 35%. 채팅 끝까지 남은 거리가 화면 한 장 이하로 줄면 65%까지 서서히 내려감
        // (맨 아래 답변의 아래쪽 상태창도 화면 가운데쯤 지나면 잡히게)
        const near = Number.isFinite(remaining) ? Math.min(1, Math.max(0, 1 - remaining / Math.max(1, box.height))) : 0;
        const refY = box.top + box.height * (REF_RATIO_TOP + (REF_RATIO_BOTTOM - REF_RATIO_TOP) * near);
        let above = null;
        let below = null;
        for (const it of items) {
          if (it.top <= refY) above = it;          // 정렬돼 있으므로 마지막으로 만난 것이 가장 가까움
          else if (!below) below = it;
        }
        pick = above || below;
        pickIsLast = !!pick && pick === above && !below;
      }
      // 방금 보조모델이 판단한 답변은 다시 그려지기 전까지 표시가 없음.
      // 그동안 맨 아래 장면(또는 표시 없음)을 보고 있으면 그 답변의 마지막 장면을 씀
      if (pendingAux && pendingAux.chatKey === currentChat.chatKey) {
        if (await rootDoc.querySelector(`.default-chat-screen [data-wp-rec="${pendingAux.id}"]`)) pendingAux = null;
        else if ((!decided && !pick) || pickIsLast) body = pendingAux.body;
      }
      if (body === null) {
        if (!pick) return;
        body = pick.body;
      }
      if (body === lastScrollSig) return;
      const direct = body.match(/^img=(\S+)$/);
      if (direct) {
        const item = meta.find((m) => m.id === direct[1]);
        if (!isUsable(item)) return;
        sceneTime = item.time || sceneTime;
        // 성공했을 때만 기록. 실패하면 다음 스크롤(또는 applyImage의 재시도)에서 다시 시도
        if (await applyImage(item.id)) lastScrollSig = body;
        return;
      }
      const state = parseTagBody(body, currentChat.chaId);
      if (!state) return;
      sceneTime = state.time || sceneTime;
      const imageId = pickImage(state, currentChat.chaId, appliedImageId);
      if (!imageId) { lastScrollSig = body; return; }   // 맞는 배경이 없음: 다시 볼 필요 없음
      if (await applyImage(imageId)) lastScrollSig = body;
    } finally {
      scrollScanBusy = false;
    }
  }

  const outputListener = (arg) => {
    // 리스너를 기다리게 하면 채팅 흐름이 멈추므로 백그라운드로 실행
    detectAndApply(arg).catch((e) => console.warn('[Wall Painter] 감지 오류', e));
    lastScrollSig = '';
    scheduleScrollScan(900);
  };

  // ─────────────────────────────────────────────────────────────
  // 파일명에서 태그 추측 (직접 올린 이미지 / 보조모델 실패 시)
  // ─────────────────────────────────────────────────────────────
  function guessTagsFromName(name, stripBgWords = false) {
    const base = name.replace(/\.[a-z0-9]+$/i, '').toLowerCase();
    let parts = base.split(/[_\-\s.]+/).filter(Boolean);
    if (stripBgWords) parts = parts.filter((p) => !['bg', 'background', 'backgrounds', '배경'].includes(p));
    const time = TIMES.find((t) => parts.includes(t)) || '';
    const season = SEASONS.find((s) => parts.includes(s)) || '';
    const location = parts.filter((p) => !TIMES.includes(p) && !SEASONS.includes(p)).join('_');
    return { location, time, season, tags: [] };
  }

  // ─────────────────────────────────────────────────────────────
  // 설정 UI (플러그인 iframe을 전체화면으로 띄움)
  // ─────────────────────────────────────────────────────────────
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const UI_CSS = `
    *{box-sizing:border-box}
    body{margin:0;background:#14161c;color:#e6e6ea;font:15px/1.55 "Pretendard Variable",Pretendard,-apple-system,BlinkMacSystemFont,system-ui,"Apple SD Gothic Neo","Segoe UI",sans-serif;-webkit-font-smoothing:antialiased;letter-spacing:-.01em}
    button,input,select{font-family:inherit}
    .wrap{max-width:960px;margin:0 auto;padding:16px}
    header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px}
    h1{font-size:20px;margin:0}
    h2{font-size:16px;margin:24px 0 10px;color:#b9c3d6;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    button{background:#2a2f3a;color:#e6e6ea;border:1px solid #3a4150;border-radius:8px;padding:6px 12px;cursor:pointer;font:inherit}
    button:hover{background:#343a48}
    button:disabled{opacity:.5;cursor:default}
    button.primary{background:#3d6fd9;border-color:#3d6fd9}
    button.danger{background:#5a2a2a;border-color:#7a3a3a}
    .card{background:#1c1f27;border:1px solid #2c313d;border-radius:12px;padding:12px}
    .notice{background:#1d2a44;border-color:#34507f}
    .warn{background:#3a2a12;border-color:#7a5a1e;color:#ffe2a8;line-height:1.6}
    .status-row,.newbot{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .status-row .chip,.newbot .chip{flex:none;font-size:13px}
    /* 설명이 두 줄이라 버튼도 두 줄 높이로 */
    .newbot #import-now{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;min-height:46px;padding:6px 18px;line-height:1.25;font-weight:700;color:#04230f}
    .newbot #import-now:hover{color:#000}
    .newbot #import-now small{font-size:11px;font-weight:600;color:#0a3d1c}
    .status-row .chip[data-tip]:hover::after{left:auto;right:0;transform:none}
    .row.col{flex-direction:column;align-items:stretch;gap:8px}

    /* 보조모델에 보내고 받는 중 표시: 도는 원 */
    .spin{display:inline-block;width:1em;height:1em;margin-right:.5em;vertical-align:-.15em;border-radius:50%;
      border:2px solid currentColor;border-right-color:transparent;opacity:.9;animation:wp-spin .8s linear infinite}
    .notice.busy{display:flex;align-items:center}
    .notice.busy .spin{flex:none;width:18px;height:18px;margin-right:10px;border-width:2.5px;color:#7cbcff}
    button:disabled:has(.spin){opacity:1;cursor:progress}
    @keyframes wp-spin{to{transform:rotate(360deg)}}
    @media (prefers-reduced-motion:reduce){.spin{animation-duration:2.4s}}
    .warn .hint{display:block;margin-top:4px;color:#d9b97a}
    .warn{position:relative;padding-right:44px}
    .warn-x{position:absolute;top:10px;right:10px;width:26px;height:26px;border-radius:50%;padding:0;border:1.5px solid rgba(255,226,168,.4);
      background:rgba(0,0,0,.2);color:#ffe2a8;font-size:12px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
    .warn-x:hover{background:rgba(255,226,168,.18);border-color:#ffe2a8}
    .row{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:9px 0}
    .row > button,.row > input{flex:none;white-space:nowrap}
    .row.sub{padding-left:14px}
    .row.sub > span:first-child{font-weight:500}
    .row > span:first-child{min-width:0;overflow-wrap:anywhere}
    .row > span:first-child{font-weight:600}
    .row .hint{display:block;margin-top:2px;font-weight:400}
    .row code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:#11131a;border:1px solid #2c313d;border-radius:6px;padding:1px 6px;color:#c9f7d5}
    .master{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:14px 16px}
    .master-box{padding:0}
    .master-box .master + .master{border-top:1px solid #262a34}
    .master.sub{padding:12px 16px 12px 28px}
    .master.sub > span{display:grid;gap:2px;min-width:0}
    .master.sub b{font-size:15px}
    .master.dim{opacity:.5}
    .power.small{min-width:56px;height:28px;font-size:13px}
    .power:disabled{opacity:.45;cursor:default;box-shadow:none}
    h1 .ver{font-size:12px;font-weight:500;color:#6f7686;margin-left:6px;letter-spacing:.02em}

    /* 플러그인 사용 ON/OFF (둥근 네모 토글 버튼) */
    .power{min-width:66px;height:32px;padding:0 14px;border-radius:10px;border:1.5px solid;font-size:14px;font-weight:800;
      letter-spacing:.08em;cursor:pointer;transition:background .15s,border-color .15s,box-shadow .15s}
    .power.on{background:#30d158;border-color:#30d158;color:#04230f;box-shadow:0 2px 10px rgba(48,209,88,.35)}
    .power.off{background:#ff453a;border-color:#ff453a;color:#fff;box-shadow:0 2px 10px rgba(255,69,58,.3)}
    .power:hover{filter:brightness(1.08)}

    /* 접었다 펼 수 있는 구역 */
    .sec-h{margin:24px 0 10px}
    .sub-sec{margin-left:14px}
    .sub-sec > .sec-h{margin:16px 0 8px;font-size:15px;color:#c7cbd6}
    .sec{position:relative;border-radius:16px;transition:background .15s,outline-color .15s}
    .sec.drop{outline:2px dashed #30d158;outline-offset:6px;background:rgba(48,209,88,.07)}
    .sec.drop::after{content:attr(data-drop-label);position:absolute;left:50%;top:56px;transform:translateX(-50%);z-index:20;
      background:#30d158;color:#04230f;font-weight:800;font-size:14px;padding:8px 16px;border-radius:999px;
      box-shadow:0 6px 18px rgba(0,0,0,.4);pointer-events:none;white-space:nowrap}
    .sec.drop *{pointer-events:none}
    .inline-toggle{display:inline-flex;align-items:center;gap:8px;margin-left:auto;font-size:13px;font-weight:600;color:#c7cbd6;cursor:pointer}
    .inline-toggle input[type=checkbox]{width:38px;height:22px;border-radius:11px}
    .inline-toggle input[type=checkbox]::after{width:18px;height:18px}
    .inline-toggle input[type=checkbox]:checked::after{transform:translateX(16px)}
    .inline-toggle[data-tip]:hover::after{left:auto;right:0;transform:none}
    .bulk-onoff{margin-left:auto;height:28px;padding:0 12px;border-radius:9px;border:1.5px solid;font-size:12px;font-weight:800;
      letter-spacing:.04em;cursor:pointer}
    .bulk-onoff.on{background:#30d158;border-color:#30d158;color:#04230f}
    .bulk-onoff.off{background:#ff453a;border-color:#ff453a;color:#fff}
    .bulk-onoff.mixed{background:rgba(255,204,0,.15);border-color:#ffcc00;color:#ffe27a}
    .bulk-onoff:hover{filter:brightness(1.08)}

    /* 목록 스크롤 상자 (오른쪽 아래 모서리를 끌어 위아래 크기 조절) */
    .list-box{min-height:260px;overflow:auto;padding:8px 8px 8px 4px;margin:0 -8px 0 -4px;
      border-radius:14px;background:rgba(0,0,0,.12);box-shadow:inset 0 0 0 1px #262a34;overscroll-behavior:contain}
    /* 목록 아래 경계선 전체가 높이 조절 손잡이 */
    .list-resize{height:14px;margin:0 -8px 0 -4px;cursor:ns-resize;display:flex;align-items:center;justify-content:center;touch-action:none}
    .list-resize span{width:100%;height:3px;border-radius:99px;background:#2c313d;transition:background .15s,height .15s}
    .list-resize:hover span,.list-resize.dragging span{height:4px;background:#30d158}
    .item.hidden{display:none}
    .search-empty{display:none;text-align:center;padding:30px 0}
    .list-box.no-result .search-empty{display:block}
    .list-box.no-result .add-card{display:none}

    /* 검색: 돋보기를 누르면 입력칸이 펼쳐짐 */
    .search{display:inline-flex;align-items:center;gap:6px;height:30px;border-radius:999px;border:1.5px solid #3a4150;background:#11131a;
      padding:0 4px 0 2px;transition:border-color .2s}
    .search.active{border-color:#30d158}
    .search-btn{width:26px;height:26px;border-radius:50%;padding:0;border:0;background:transparent;color:#c7cbd6;display:inline-flex;
      align-items:center;justify-content:center;cursor:pointer}
    .search-btn:hover{background:rgba(255,255,255,.08)}
    .search-btn svg{width:15px;height:15px}
    .search .search-input{width:0;min-width:0;padding:0!important;border:0!important;background:transparent!important;outline:0;color:#e6e6ea;
      font:inherit;font-size:13px;transition:width .25s ease}
    .search.active .search-input{width:200px;padding:0 4px!important}
    .search-input::placeholder{color:rgba(230,230,234,.38)}
    .search-count{font-size:12px;min-width:0;padding-right:6px}
    .search-count:empty{display:none}

    /* 프롬프트 편집 */
    .prompt-file{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:4px}
    .prompt-file .chip{font-size:12.5px}
    .prompt-box{display:grid;gap:8px;padding:12px 0}
    .prompt-box + .prompt-box{border-top:1px solid #262a34}
    .prompt-head{display:flex;align-items:center;gap:10px}
    .prompt-head b{font-size:15px}
    .prompt-state{margin-left:auto;padding:1px 9px;border-radius:99px;border:1px solid #3a4150}
    .prompt-state.custom{color:#ffd27a;border-color:#7a5a1e;background:rgba(217,165,33,.12)}
    .prompt-ta{width:100%;min-height:150px;resize:vertical;background:#11131a;color:#e6e6ea;border:1px solid #333a48;border-radius:10px;
      padding:10px 12px;font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
    .prompt-ta:focus{outline:0;border-color:#30d158;box-shadow:0 0 0 2px rgba(48,209,88,.2)}
    .prompt-ta::placeholder{color:rgba(230,230,234,.3)}
    .prompt-btns{display:flex;gap:6px;flex-wrap:wrap}
    .prompt-btns .chip{font-size:12.5px}
    .prompt-preview{white-space:pre-wrap;word-break:break-word;font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
      background:#11131a;border:1px solid #2c313d;border-radius:10px;padding:10px 12px;max-height:55vh;overflow:auto;margin:0}
    .dlg:has(.prompt-preview){width:min(720px,100%)}

    /* 전환 효과 버튼 미리보기: 버튼 안에 다른 색 층을 두고 효과대로 움직임 */
    [data-chips="transition"] .chip{position:relative;overflow:hidden;isolation:isolate}
    [data-chips="transition"] .chip::before{content:"";position:absolute;inset:0;z-index:-1;border-radius:inherit;
      background:linear-gradient(135deg,rgba(255,111,174,.85),rgba(94,92,230,.85));opacity:0;pointer-events:none}
    [data-chips="transition"] .chip:hover{color:#fff}
    [data-chips="transition"] .chip[data-v="none"]:hover::before{animation:wp-chip-cut 1.6s steps(1) infinite}
    [data-chips="transition"] .chip[data-v="fade"]:hover::before{animation:wp-chip-fade 1.6s ease-in-out infinite}
    [data-chips="transition"] .chip[data-v="swipe-up"]:hover::before{opacity:1;animation:wp-chip-swipe 1.6s cubic-bezier(.22,.8,.2,1) infinite}
    @keyframes wp-chip-cut{0%{opacity:0}50%{opacity:1}}
    @keyframes wp-chip-fade{0%,10%{opacity:0}45%,60%{opacity:1}95%,100%{opacity:0}}
    @keyframes wp-chip-swipe{0%{transform:translateY(100%)}45%,70%{transform:translateY(0)}100%{transform:translateY(-100%)}}
    @media (prefers-reduced-motion:reduce){[data-chips="transition"] .chip:hover::before{animation:none;opacity:.6}}
    .row.dim-row{opacity:.45}
    /* 슬라이더 숫자 입력칸 (값 표시는 이 칸이 대신함) */
    #dim-val,#blur-val,#trans-val,[data-fx-val]{display:none!important}
    .row > input[type=range]{margin-left:auto}
    .num-box{position:relative;display:inline-flex;align-items:center;flex:none;width:66px;height:28px;border-radius:9px;
      background:#11131a;border:1px solid #333a48;transition:border-color .15s,box-shadow .15s}
    .num-box:hover{border-color:#4a5263}
    .num-box:focus-within{border-color:#30d158;box-shadow:0 0 0 2px rgba(48,209,88,.18)}
    .num-box.disabled{opacity:.45;pointer-events:none}
    .num-box .num{width:100%!important;height:100%;min-width:0;padding:0 20px 0 6px!important;border:0!important;background:transparent!important;
      border-radius:9px!important;outline:0;text-align:right;color:#e6e6ea;font:inherit;font-size:13px;font-variant-numeric:tabular-nums}
    .num-steps{position:absolute;right:3px;top:3px;bottom:3px;width:15px;display:flex;flex-direction:column;gap:1px;
      opacity:.35;transition:opacity .15s}
    .num-box:hover .num-steps,.num-box:focus-within .num-steps{opacity:1}
    .num-steps button{flex:1;display:flex;align-items:center;justify-content:center;padding:0;border:0;border-radius:4px;
      background:rgba(255,255,255,.06);color:#c7cbd6;cursor:pointer;min-height:0}
    .num-steps button:hover{background:rgba(48,209,88,.25);color:#fff}
    .num-steps button.pressing{background:#30d158;color:#04230f}
    .num-steps svg{width:8px;height:5px;display:block}
    .num-unit{flex:none;width:20px;font-size:12px;color:#8b93a5;margin-left:-8px}
    .row-head{display:flex;align-items:center;justify-content:space-between;gap:16px}
    .row-head > span:first-child{font-weight:600}
    .adj-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 14px}
    .adj{display:flex;align-items:center;gap:6px;min-width:0;font-size:13px;color:#c7cbd6}
    .adj > span:first-child{flex:none}
    .adj input[type=range]{flex:1;min-width:40px;width:auto}
    .adj .num-box{width:58px}
    .adj .num-unit{display:none}
    @media (max-width:640px){.adj-grid{grid-template-columns:1fr}}

    /* 대화상자 */
    .dlg-back{position:fixed;inset:0;z-index:200;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:16px;
      animation:wp-fade .15s ease}
    .dlg{width:min(480px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#1c1f27;border:1px solid #2c313d;border-radius:18px;
      padding:18px 20px;box-shadow:0 24px 64px rgba(0,0,0,.6)}
    .dlg h3{margin:0 0 10px;font-size:17px}
    .dlg-body{line-height:1.6;font-size:14px}
    .dlg-body p{margin:0 0 8px}
    .dlg-body ul{margin:0 0 10px;padding-left:20px}
    .dlg-body li{margin:4px 0}
    .dlg-body .spin{color:#30d158}
    .dlg-warn{background:#3a2a12;border:1px solid #7a5a1e;color:#ffe2a8;border-radius:12px;padding:10px 12px;margin-top:6px}
    .dlg-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:14px;flex-wrap:wrap}
    .dlg-btns:empty{display:none}
    .dlg-btns .chip{padding:5px 14px}

    /* 이미지 추가 빈 카드 */
    .add-card{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:220px;padding:20px;
      background:transparent;border:2px solid rgba(255,255,255,.55);border-radius:16px;color:#e6e6ea;cursor:pointer;text-align:center;
      transition:border-color .15s,background .15s,box-shadow .2s}
    .add-card:hover{border-color:#fff;background:rgba(255,255,255,.05);box-shadow:0 0 0 1px rgba(255,255,255,.25),0 0 18px rgba(255,255,255,.12)}
    .add-card b{font-size:15px}
    .add-card-plus{width:44px;height:44px;border-radius:50%;border:2px solid currentColor;display:inline-flex;align-items:center;justify-content:center}
    .add-card-plus svg{width:18px;height:18px}
    .add-card-hint{font-size:12px;color:#8b93a5;line-height:1.5;max-width:200px}
    h2 .bulk-onoff[data-tip]:hover::after{left:auto;right:0;transform:none}
    .sec-t{display:inline-flex;align-items:center;gap:8px;background:none;border:0;padding:0;margin:0;color:inherit;font:inherit;cursor:pointer}
    .sec-t:hover{color:#e6e6ea;background:none}
    .chev2{width:8px;height:8px;border:solid currentColor;border-width:0 2px 2px 0;transform:rotate(45deg) translate(-2px,-2px);transition:transform .2s;flex:none}
    .sec.closed .chev2{transform:rotate(-45deg)}
    .sec .sec-fold{grid-template-rows:1fr}
    .sec.closed .sec-fold{grid-template-rows:0fr}
    .sec:not(.closed):not(.anim) > .sec-fold > .fold-in{overflow:visible}
    .master b{font-size:16px}
    .row + .row{border-top:1px solid #262a34}
    .hint{color:#8b93a5;font-size:13px;font-weight:400}
    input[type=text],select{background:#11131a;color:#e6e6ea;border:1px solid #333a48;border-radius:6px;padding:5px 8px;font:inherit;min-width:0;width:100%}
    input[type=range]{width:160px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;align-items:start}
    .item{background:#1c1f27;border:1px solid #2c313d;border-radius:16px;display:flex;flex-direction:column}
    .item.applied{border-color:var(--accent)}
    .item.review{border-color:#c79a2e}

    /* 이미지별 ON/OFF (미리보기 오른쪽 위) */
    /* [data-tip]{position:relative}보다 우선하도록 .thumb를 붙임 */
    .thumb .item-onoff{position:absolute;top:8px;right:8px;z-index:3;min-width:42px;height:22px;padding:0 8px;border-radius:7px;border:1.5px solid;
      font-size:11px;font-weight:800;letter-spacing:.06em;cursor:pointer;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}
    .item-onoff.on{background:rgba(48,209,88,.9);border-color:#30d158;color:#04230f}
    .item-onoff.off{background:rgba(255,69,58,.9);border-color:#ff453a;color:#fff}
    .item-onoff:disabled{opacity:.55;cursor:not-allowed}
    .item-onoff[data-tip]:hover::after{left:auto;right:0;transform:none;top:calc(100% + 8px);bottom:auto}
    /* 꺼진 이미지는 미리보기만 흑백·어둡게 (필터를 미리보기 자체에 걸면 위의 OFF 버튼까지 회색이 돼서 덮개 층으로 처리) */
    .item.off .thumb::after{content:'';position:absolute;inset:0;z-index:1;border-radius:inherit;background:rgba(0,0,0,.45);backdrop-filter:grayscale(.9);-webkit-backdrop-filter:grayscale(.9);pointer-events:none}
    .item .chev{z-index:2}
    .item.off .summary,.item.off .src{opacity:.5}
    .thumb{position:relative;aspect-ratio:16/10;background:#000 center/cover no-repeat;border-radius:15px 15px 0 0}
    .badge{position:absolute;top:8px;left:8px;background:rgba(0,0,0,.6);color:#ffd27a;font-size:11px;padding:2px 8px;border-radius:99px}

    /* 접기/펼치기: 미리보기를 누르면 설정이 접히고, 접힌 카드는 한 줄 요약만 보임 */
    .thumb{cursor:pointer;transition:filter .2s}
    /* 미리보기에 마우스를 올리면 카드 외곽선이 빛남 */
    .item{transition:border-color .2s,box-shadow .25s}
    .item:has(.thumb:hover){border-color:rgba(var(--accent-rgb),.9);
      box-shadow:0 0 0 1px rgba(var(--accent-rgb),.55),0 0 18px rgba(var(--accent-rgb),.45),0 0 42px rgba(var(--accent-rgb),.18)}
    .item .thumb:hover{filter:brightness(1.08)}
    .chev{position:absolute;right:8px;bottom:8px;width:24px;height:24px;border-radius:50%;background:rgba(0,0,0,.55);
      backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
    .chev::before{content:"";position:absolute;left:50%;top:50%;width:7px;height:7px;border:solid #fff;border-width:0 2px 2px 0;
      transform:translate(-50%,-70%) rotate(45deg);transition:transform .2s}
    .item.open .chev::before{transform:translate(-50%,-30%) rotate(-135deg)}
    /* grid-template-rows 0fr↔1fr 전환으로 높이를 부드럽게 접고 펼침 */
    .fold{display:grid;grid-template-rows:0fr;transition:grid-template-rows .32s cubic-bezier(.3,.7,.2,1)}
    .fold-in{min-height:0;overflow:hidden}
    .item:not(.open) .sum-fold,.item.open .body-fold{grid-template-rows:1fr}
    .sum-fold .fold-in{transition:opacity .2s}
    .item.open .sum-fold .fold-in{opacity:0}
    /* 다 펼쳐진 뒤에는 말풍선이 잘리지 않게 잘라내기 해제 */
    .item.open.settled .body-fold .fold-in{overflow:visible}
    @media (prefers-reduced-motion:reduce){.fold,.sum-fold .fold-in{transition:none}}
    .summary{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:10px 12px}
    .summary .loc{font-weight:600;margin-right:2px}
    .summary .chip{font-size:12px;padding:1px 9px}
    .src{font-size:11px;color:#7c8497;padding:8px 12px 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .fields{padding:10px 12px;display:grid;gap:12px}
    .group{display:grid;gap:6px}
    .cap{font-size:12px;color:#8b93a5;letter-spacing:.02em}
    .fields input[type=text]{border-radius:10px;padding:6px 10px}
    .empty{color:#8b93a5;text-align:center;padding:24px}

    /* ── 알약 버튼 (Apple 스타일) ── */
    :root{--accent:#30d158;--accent-rgb:48,209,88}
    .chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
    .chip{border:1.5px solid rgba(var(--accent-rgb),.7);background:rgba(var(--accent-rgb),.16);color:color-mix(in srgb,var(--accent) 45%,#fff);
      border-radius:999px;padding:3px 12px;font-size:14px;line-height:1.5;cursor:pointer;transition:background .15s,color .15s,border-color .15s}
    .chip:hover{background:rgba(var(--accent-rgb),.28)}
    .chip.sel{background:var(--accent);border-color:var(--accent);color:var(--on,#fff);font-weight:600}
    .chip:disabled,.chip.ro{cursor:default}
    .chip.ro:hover{background:rgba(var(--accent-rgb),.16)}
    .chip.sel:disabled{opacity:1}
    .chip.gray{--accent:#8e8e93;--accent-rgb:142,142,147}
    .chip.red{--accent:#ff453a;--accent-rgb:255,69,58}
    .chip.blue{--accent:#0a84ff;--accent-rgb:10,132,255}
    .chip.gold{--accent:#ffcc00;--accent-rgb:255,204,0;--on:#1c1c1e}

    /* 태그: 채워진 알약 + 오른쪽 위 작은 삭제 버튼 */
    .tag{position:relative;display:inline-flex;align-items:center;gap:1px;background:#30d158;border:1.5px solid #30d158;
      color:#04230f;font-weight:650;letter-spacing:.01em;border-radius:999px;padding:3px 12px 3px 10px;font-size:13px;line-height:1.5;
      box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 2px 8px rgba(48,209,88,.22);cursor:text;
      transition:background .15s,color .15s,box-shadow .15s}
    .tag::before{content:"#";opacity:.5;font-weight:700}
    .tag:hover{background:#3ddc66;border-color:#3ddc66}
    /* 수정 중: 텍스트 박스처럼 어두운 배경 + 초록 테두리와 링 */
    .tag.editing{background:#0d1610;border-color:#30d158;color:#f2fff5;box-shadow:0 0 0 2px rgba(48,209,88,.25)}
    .tag.editing::before{color:#30d158;opacity:1}
    .tag .x{position:absolute;top:-6px;right:-6px;width:17px;height:17px;border-radius:50%;padding:0;border:2px solid #1c1f27;
      background:#636366;color:#fff;font-size:10px;line-height:13px;text-align:center;cursor:pointer}
    .tag .x:hover{background:#ff453a}
    /* 카드 설정 칸의 입력창 스타일(.fields input, 좌우 여백 10px)이 덮어쓰지 않도록 더 구체적으로 지정.
       여백이 남아 있으면 글자 폭에 맞춘 너비에서 여백만큼 글자 칸이 좁아져 앞글자가 잘림 */
    .tag input,.item .tag input[type=text]{background:transparent;border:0;outline:0;color:inherit;caret-color:#30d158;font:inherit;font-weight:600;
      padding:0;margin:0;height:1.5em;line-height:1.5em;border-radius:0;width:3em;min-width:0;max-width:16em;box-shadow:none}
    .tag input::placeholder{color:rgba(242,255,245,.4)}
    .tag input::-webkit-calendar-picker-indicator{display:none!important}
    .tag.editing:hover{background:#0d1610;border-color:#30d158}
    .add{width:28px;height:28px;border-radius:50%;padding:0;border:2px solid #e6e6ea;background:transparent;color:#e6e6ea;
      display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
    .add svg{width:14px;height:14px;display:block}
    .add:hover{background:rgba(255,255,255,.08)}

    .actions{display:flex;gap:6px;padding:0 12px 12px;align-items:center}
    .actions .chip{flex:1;text-align:center;font-size:12px;padding:4px 8px;white-space:nowrap}

    /* 오른쪽 아래 작은 휴지통 버튼 */
    .trash{flex:none;margin-left:auto;width:30px;height:30px;border-radius:50%;padding:0;border:1.5px solid rgba(255,69,58,.55);
      background:rgba(255,69,58,.12);font-size:14px;line-height:1;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
    .trash:hover{background:rgba(255,69,58,.3);border-color:#ff453a}

    /* 마우스오버 설명 말풍선 */
    [data-tip]{position:relative}
    [data-tip]:hover::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);
      width:max-content;max-width:220px;white-space:normal;text-align:left;background:rgba(44,44,46,.97);color:#f2f2f7;
      font-size:12px;font-weight:400;line-height:1.45;padding:7px 10px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.45);
      pointer-events:none;z-index:50}
    .trash[data-tip]:hover::after{left:auto;right:0;transform:none}
    .actions [data-act=apply]:hover::after{left:0;transform:none}

    /* 설정 토글 스위치 */
    input[type=checkbox]{appearance:none;-webkit-appearance:none;width:44px;height:26px;border-radius:13px;background:#3a3a3c;
      position:relative;cursor:pointer;flex:none;transition:background .2s;margin:0}
    input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;background:#fff;
      box-shadow:0 1px 3px rgba(0,0,0,.4);transition:transform .2s}
    input[type=checkbox]:checked{background:var(--accent)}
    input[type=checkbox]:checked::after{transform:translateX(18px)}
    input[type=checkbox]:disabled{opacity:.4;cursor:default}

    .vocab{display:grid;gap:14px}
    .vrow{display:grid;gap:8px}
    .vrow-t{display:inline-flex;align-items:center;gap:8px;justify-self:start;background:none;border:0;padding:0;color:#c7cbd6;
      font:inherit;font-size:14px;font-weight:600;cursor:pointer}
    .vrow-t:hover{color:#fff;background:none}
    .vrow-t .hint{font-weight:400}
    .vrow.closed .chev2{transform:rotate(-45deg)}
    .vrow.closed .chips{display:none}

    /* 스크롤바: 얇고 둥근 반투명 막대, 마우스를 올리면 초록 */
    /* 크롬 계열은 scrollbar-color를 주면 아래 ::-webkit-scrollbar 스타일이 무시돼서 파이어폭스에만 적용 */
    @supports not selector(::-webkit-scrollbar){*{scrollbar-width:auto;scrollbar-color:rgba(255,255,255,.22) transparent}}
    ::-webkit-scrollbar{width:18px;height:18px}
    ::-webkit-scrollbar-track{background:transparent}
    ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.2);border-radius:99px;border:5px solid transparent;background-clip:padding-box}
    ::-webkit-scrollbar-thumb:hover{background:rgba(48,209,88,.75);border-width:4px;background-clip:padding-box}
    ::-webkit-scrollbar-thumb:active{background:#30d158;background-clip:padding-box}
    ::-webkit-scrollbar-corner{background:transparent}
    html.modal .wrap::-webkit-scrollbar-track{margin:14px 0}

    /* 설정을 바꾸면 잠깐 창을 투명하게 해서 뒤의 배경 변화를 보여줌 */
    html,body,.wrap,.backdrop{transition:background-color .25s,opacity .25s}
    html.peek,html.peek body{background:transparent!important}
    html.peek .wrap{opacity:.12}
    html.peek .backdrop{opacity:0}

    /* 덮어쓰는 창 (플로팅 버튼) */
    html.modal,html.modal body{background:transparent;height:100%;overflow:hidden}
    html.modal .backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);animation:wp-fade .2s ease}
    html.modal .wrap{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:min(960px,calc(100vw - 24px));
      max-height:calc(100vh - 48px);overflow:auto;overscroll-behavior:contain;background:#14161c;border:1px solid #2c313d;
      border-radius:20px;box-shadow:0 24px 64px rgba(0,0,0,.55);padding:16px 18px 20px;animation:wp-pop .22s cubic-bezier(.2,.8,.2,1)}
    html.modal header{position:sticky;top:-16px;z-index:5;background:#14161c;margin:-16px -18px 12px;padding:14px 18px 10px;
      border-bottom:1px solid #262a34}
    @keyframes wp-fade{from{opacity:0}}
    @keyframes wp-pop{from{opacity:0;transform:translate(-50%,-48%) scale(.97)}}
    @media (prefers-reduced-motion:reduce){html.modal .backdrop,html.modal .wrap{animation:none}}
    .vocab .cap{font-size:14px;font-weight:600;color:#c7cbd6;letter-spacing:0}
  `;

  // 시간대·계절·범위 알약 색. on: 선택됐을 때 글자색 (밝은 색은 어두운 글자)
  const CHIP_COLORS = {
    any:     { hex: '#8e8e93' },                 // 아무때나
    day:     { hex: '#ffcc00', on: '#1c1c1e' },  // 낮: 햇빛 노랑
    evening: { hex: '#ff7a3d' },                 // 저녁: 노을 주황
    night:   { hex: '#5e5ce6' },                 // 밤: 남색
    spring:  { hex: '#ff6fae' },                 // 봄: 벚꽃 분홍
    summer:  { hex: '#30d158' },                 // 여름: 초록
    autumn:  { hex: '#ff9f0a' },                 // 가을: 단풍 주황
    winter:  { hex: '#64d2ff', on: '#0b2530' },  // 겨울: 얼음 하늘색
    global:  { hex: '#0a84ff' },                 // 전체 공통
    char:    { hex: '#bf5af2' },                 // 현재 캐릭터 전용
  };
  const CHIP_COLOR_CSS = Object.entries(CHIP_COLORS).map(([k, { hex, on }]) => {
    const n = parseInt(hex.slice(1), 16);
    return `.chip[data-c="${k}"]{--accent:${hex};--accent-rgb:${n >> 16},${(n >> 8) & 255},${n & 255}` +
      (on ? `;--on:${on}` : '') + '}';
  }).join('');

  let uiState = { focus: '', importSummary: null, busy: '' };
  const expanded = new Set();   // 펼쳐진 카드 id (새로 추가한 이미지는 펼친 상태로 시작)

  // mode: 'full' = 플러그인 설정 메뉴에서 연 전체 화면 창
  //       'modal' = 플로팅 버튼으로 연, 채팅 화면 위에 덮어쓰는 창
  // RisuAI는 플러그인 창을 전체 화면 크기로만 띄울 수 있어서, 'modal'은 배경을 반투명하게 두고
  // 가운데에 패널만 그리는 방식으로 만듦.
  let uiOpen = false;
  let uiMode = 'full';

  async function openUI(opts = {}) {
    uiMode = opts.mode || 'full';
    uiState = { focus: opts.focus || '', importSummary: opts.importSummary || null, busy: opts.busy || '' };
    document.head.innerHTML = `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">` +
      `<style>${UI_CSS}${CHIP_COLOR_CSS}</style>`;
    document.documentElement.classList.toggle('modal', uiMode === 'modal');
    await renderUI();
    if (!uiOpen) {
      uiOpen = true;
      await risuai.showContainer('fullscreen');
    }
    if (uiState.focus === 'review') document.getElementById('sec-review')?.scrollIntoView();
  }

  async function closeUI() {
    uiOpen = false;
    document.body.innerHTML = '';
    await risuai.hideContainer();
  }

  // 화면 스크롤 위치 (덮어쓰는 창은 패널 안쪽이 스크롤됨)
  const scroller = () => (uiMode === 'modal' ? document.querySelector('.wrap') : document.scrollingElement);

  const dragHasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  document.addEventListener('dragover', (e) => { if (dragHasFiles(e)) e.preventDefault(); });
  document.addEventListener('drop', (e) => { if (dragHasFiles(e)) e.preventDefault(); });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !uiOpen) return;
    const dlg = document.querySelector('.dlg-back');
    if (dlg) { dlg._close?.(); return; }
    if (document.activeElement?.closest?.('.tag.editing')) return;   // 태그 수정 취소가 우선
    if (document.activeElement?.classList?.contains('search-input')) return;   // 검색 지우기가 우선
    closeUI();
  });

  // 플로팅 버튼: 덮어쓰는 창으로 열고, 아직 에셋을 가져오지 않은 봇이면 바로 파악 시작
  async function onFloatingButton() {
    if (uiOpen) { await closeUI(); return; }
    await openUI({ mode: 'modal' });
  }

  // 한 줄 선택 버튼 묶음. options: [[값, 라벨]]. 값마다 색이 다름 (CHIP_COLORS)
  function chipGroup(field, options, value, { disabled = false } = {}) {
    return `<div class="chips" data-chips="${field}">` +
      options.map(([v, label]) =>
        `<button class="chip${v === value ? ' sel' : ''}" data-c="${esc(v || 'any')}" data-v="${esc(v)}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`
      ).join('') + `</div>`;
  }

  function tagChips(tags) {
    return `<div class="chips" data-tags>` +
      (tags || []).map((t) =>
        `<span class="tag" data-tag="${esc(t)}" title="눌러서 수정"><span class="tag-text">${esc(t)}</span><button class="x" title="태그 삭제">✕</button></span>`
      ).join('') +
      `<button class="add" title="태그 추가"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 1.5v11M1.5 7h11"/></svg></button></div>`;
  }

  // opts.body: 접혀 있어도 설정 본문까지 만듦 (펼치기 직전)
  function renderItem(m, char, opts = {}) {
    const cachedThumb = thumbCache.get(m.id);
    const scope = m.source === 'asset'
      ? chipGroup('scope', [['char', '캐릭터 전용']], 'char', { disabled: true })
      : chipGroup('scope', [['global', '전체 공통'], ...(char ? [['char', '캐릭터 전용']] : [])], m.scope);
    const open = opts.open ?? (expanded.has(m.id) || m.review);
    const withBody = open || opts.body;
    const searchText = [m.location, m.name, ...(m.tags || []), m.from, m.path]
      .filter(Boolean).join(' ').toLowerCase();
    const on = char ? itemOn(m, char.chaId) : true;
    const onoff = char
      ? `<button class="item-onoff ${on ? 'on' : 'off'}" data-item-toggle
           data-tip="${on ? '이 캐릭터에서 이 배경을 씁니다. 누르면 이 캐릭터에서만 끕니다.' : '이 캐릭터에서 이 배경을 쓰지 않습니다. 누르면 켭니다.'}">${on ? 'ON' : 'OFF'}</button>`
      : '';
    return `
      <div class="item${open ? ' open settled' : ''}${m.id === appliedImageId ? ' applied' : ''}${m.review ? ' review' : ''}${on ? '' : ' off'}" data-id="${m.id}" data-search="${esc(searchText)}">
        <div class="thumb" data-toggle data-thumb="${m.id}" title="눌러서 설정 펼치기/접기"${cachedThumb ? ` data-thumb-loaded="1" style="background-image:url('${esc(cachedThumb)}')"` : ''}>${m.review ? '<span class="badge">검토 필요</span>' : ''}${onoff}<span class="chev"></span></div>
        <div class="fold sum-fold"><div class="fold-in"><div class="summary">${renderSummary(m)}</div></div></div>
        <div class="fold body-fold"><div class="fold-in">${withBody ? `
        <div class="src" title="${esc(m.name)}">${m.source === 'asset' ? `📦 ${esc(m.from || '봇 에셋')} · ${esc(m.name)}` : '🖼️ 직접 추가'}</div>
        <div class="fields">
          ${m.source === 'upload' ? `<div class="group"><span class="cap">이름</span><input type="text" data-f="name" value="${esc(m.name)}"></div>` : ''}
          <div class="group"><span class="cap">장소</span><input type="text" data-f="location" list="locs" value="${esc(m.location)}" placeholder="forest, cafe…"></div>
          <div class="group"><span class="cap">시간대</span>${chipGroup('time', [['', '아무때나'], ...TIMES.map((t) => [t, TIME_LABEL[t]])], m.time || '')}</div>
          <div class="group"><span class="cap">계절</span>${chipGroup('season', [['', '아무때나'], ...SEASONS.map((s) => [s, SEASON_LABEL[s]])], m.season || '')}</div>
          <div class="group"><span class="cap">태그</span>${tagChips(m.tags)}</div>
          <div class="group"><span class="cap">범위</span>${scope}</div>
        </div>
        <div class="actions">
          ${m.review ? '<button class="chip sel" data-act="ok">확인</button>' : ''}
          <button class="chip blue" data-act="apply" data-tip="이 이미지를 지금 채팅 배경으로 바로 띄웁니다. 다음 답변에서 장소가 바뀌면 자동 감지가 다시 바꿉니다.">지금 적용</button>
          ${m.scope === 'global' ? `<button class="chip gold${settings.defaultImageId === m.id ? ' sel' : ''}" data-act="default" data-tip="${settings.defaultImageId === m.id ? '기본 배경 지정을 해제합니다.' : '어울리는 배경을 못 찾았을 때 대신 띄울 배경으로 지정합니다.'}">${settings.defaultImageId === m.id ? '★ 기본' : '기본으로'}</button>` : ''}
          <button class="trash" data-act="delete" data-tip="${m.source === 'asset' ? '목록에서 제외 (봇 에셋 원본은 그대로)' : '삭제'}" aria-label="${m.source === 'asset' ? '제외' : '삭제'}">🗑️</button>
        </div>` : ''}
        </div></div>
      </div>`;
  }

  // 접힌 카드에 보이는 한 줄 요약 (읽기 전용 알약)
  function renderSummary(m) {
    const parts = [`<span class="loc">${esc(m.location || '장소 없음')}</span>`];
    if (m.time) parts.push(`<span class="chip ro" data-c="${m.time}">${TIME_LABEL[m.time]}</span>`);
    if (m.season) parts.push(`<span class="chip ro" data-c="${m.season}">${SEASON_LABEL[m.season]}</span>`);
    if (m.tags?.length) parts.push(`<span class="hint">#${m.tags.map(esc).join(' #')}</span>`);
    return parts.join('');
  }

  // 아래쪽 "주입되는 태그 목록" (읽기 전용 알약)
  function renderVocab(v) {
    // 값이 없는 항목은 줄째로 숨김 (장소만 예외: 비어 있으면 주입이 안 된다는 안내 표시)
    // 항목마다 제목을 눌러 접고 펼침 (접은 상태는 settings.collapsed['vocab_<key>']에 저장)
    const row = (key, cap, list) => !list.length ? '' :
      `<div class="vrow${settings.collapsed?.['vocab_' + key] ? ' closed' : ''}" data-vrow="${key}">
        <button class="vrow-t" title="접기/펼치기"><span class="chev2"></span>${cap} <span class="hint">${list.length}개</span></button>
        <div class="chips">` +
      list.map((x) => {
        const [label, c] = Array.isArray(x) ? x : [x, ''];
        return `<span class="chip ro"${c ? ` data-c="${c}"` : ''}>${esc(label)}</span>`;
      }).join('') +
      `</div></div>`;
    if (!v.locations.length) return '<span class="hint">등록된 장소가 없어서 지금은 주입하지 않습니다.</span>';
    return row('loc', '장소', v.locations) +
      row('time', '시간대', v.times.map((t) => [TIME_LABEL[t], t])) +
      row('season', '계절', v.seasons.map((s) => [SEASON_LABEL[s], s])) +
      row('tags', '태그', v.tags);
  }

  function refreshVocab(chaId) {
    const el = document.getElementById('vocab');
    if (el) el.innerHTML = renderVocab(vocabulary(chaId));
  }

  // 검토 필요 목록 기준: 이 캐릭터 전용 + 전체 공통
  const isReviewItem = (m, chaId) => !!m.review && (m.scope === 'global' || (m.scope === 'char' && m.chaId === chaId));

  async function renderUI() {
    let char = null;
    try { if ((await risuai.getCurrentCharacterIndex()) >= 0) char = await risuai.getCharacter(); } catch {}
    const chaId = char?.chaId || '';
    const charOn = char ? !settings.disabledChars.includes(chaId) : false;
    let activeMods = [];
    if (char) { try { activeMods = await getActiveModules(char); } catch {} }

    const la = settings.lastAux;
    const when = (t) => new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    const auxStatusText = !la
      ? '아직 호출한 적이 없습니다. "연결 확인"으로 보조모델이 응답하는지 확인해 보십시오.'
      : la.ok
        ? `✅ 정상 (${when(la.at)} 마지막 응답)`
        : `⚠️ 실패 (${when(la.at)}) — ${esc(la.error || '알 수 없는 오류')}`;
    const auxNeeded = true;   // 장면 판단 폴백과 봇 에셋 가져오기 둘 다 보조모델을 씀
    // 닫은 경고는 다시 안 띄우고, 그 뒤에 새로 실패하면 다시 띄움
    const auxWarning = auxNeeded && la && !la.ok && la.at > (settings.auxWarnDismissedAt || 0)
      ? `<div class="card warn" style="margin-top:12px"><button class="warn-x" id="aux-warn-x" title="경고 닫기" aria-label="경고 닫기">✕</button>⚠️ <b>보조모델 호출에 실패했습니다.</b> 태그가 빠진 답변의 장면 판단과 봇 에셋 가져오기가 동작하지 않습니다.
          RisuAI 설정의 <b>보조 모델</b>이 지정돼 있는지, API 키가 있는지 확인하십시오. ("보조 모델 분리"를 켰다면 "메모리" 항목)
          <span class="hint">사유: ${esc(la.error || '알 수 없는 오류')}</span></div>`
      : '';
    const v = vocabulary(chaId);

    const isReviewHere = (m) => isReviewItem(m, chaId);
    const reviewItems = meta.filter(isReviewHere);
    const reviewCharCount = reviewItems.filter((m) => m.scope === 'char').length;
    const botItems = meta.filter((m) => !m.review && m.scope === 'char' && m.chaId === chaId);
    const globalItems = meta.filter((m) => !m.review && m.scope === 'global');

    const statusText = lastDetect
      ? `${{ tag: '메인모델 태그', aux: '보조모델 판단', bot: '봇 자체 배경 출력', var: `봇 채팅 변수 ${esc(lastDetect.varKey || '')}`, 'bot-missing': `봇이 쓴 배경 '${esc(lastDetect.missing || '')}'을 에셋에서 찾지 못함 (이전 배경 유지)`, none: '판단 실패 (이전 배경 유지)' }[lastDetect.source]} · ` +
        (lastDetect.state
          ? `장소 ${esc(lastDetect.state.location || '?')}${lastDetect.state.approxFrom ? ` (${esc(lastDetect.state.approxFrom)}와 비슷한 장소)` : ''} / ${TIME_LABEL[lastDetect.state.time] || '-'} / ${SEASON_LABEL[lastDetect.state.season] || '-'}` +
            (lastDetect.state.tags?.length ? ` / ${esc(lastDetect.state.tags.join(', '))}` : '')
          : '상태 없음') +
        ` · 배경: ${esc(meta.find((m) => m.id === lastDetect.imageId)?.name || '없음')}` +
        (lastDetect.nomatch ? ' (장소가 맞는 배경이 없어 이전 배경 유지)' : '')
      : '아직 감지 기록이 없습니다.';

    const sum = uiState.importSummary;
    const importNotice = sum
      ? `<div class="card notice" style="margin-bottom:12px">${
          !sum.checked ? `에셋 ${sum.total}개를 확인했는데 새로 확인할 에셋이 없었습니다.`
          : sum.added ? `에셋 ${sum.total}개 중 새 에셋 ${sum.checked}개를 확인해서 배경 ${sum.added}개를 가져왔습니다. 아래 <b>검토 필요</b> 항목의 장소·태그를 다듬고 <b>확인</b>을 누르십시오. 배경이 아닌 건 <b>제외</b>하면 됩니다.`
          : `에셋 ${sum.total}개 중 새 에셋 ${sum.checked}개를 확인했는데, 배경으로 보이는 에셋은 없었습니다.`
        }${sum.note ? `<span class="hint">${esc(sum.note)}</span>` : ''}</div>`
      : '';

    const section = async (list) => list.length
      ? `<div class="grid">${(await Promise.all(list.map((m) => renderItem(m, char)))).join('')}</div>`
      : '';

    // 목록 맨 뒤의 "이미지 추가" 빈 카드. 누르면 파일 선택, 이 구역에 끌어다 놓아도 추가됨
    const addCard = (scope) => `
      <button class="add-card" data-add-scope="${scope}">
        <span class="add-card-plus"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 1.5v11M1.5 7h11"/></svg></span>
        <b>이미지 추가</b>
        <span class="add-card-hint">이미지를 이 영역(${scope === 'char' ? '캐릭터 전용' : '전체 공통'})에 끌어다 놓아도 추가됩니다</span>
      </button>`;
    // 사용자가 끌어서 바꾼 높이를 기억함 (위아래로만 조절)
    const sectionWithAdd = async (list, scope, { add = true, itemOpts = {} } = {}) => {
      const h = settings.listHeight?.[scope];
      // 저장한 높이가 없으면: 카드가 많을 때만 640px로 시작, 적으면 내용 높이 그대로
      const style = h ? `height:${h}px` : list.length > 6 ? 'height:640px' : '';
      return `<div class="list-box" data-list="${scope}"${style ? ` style="${style}"` : ''}>
        <div class="grid">${list.map((m) => renderItem(m, char, itemOpts)).join('')}${add ? addCard(scope) : ''}</div>
        <div class="search-empty hint">검색 결과가 없습니다.</div></div>
        <div class="list-resize" data-resize-for="${scope}" title="위아래로 끌어서 목록 높이 조절"><span></span></div>`;
    };
    const searchBox = (scope) => `
      <span class="search${uiState.search?.[scope] ? ' active' : ''}" data-search-scope="${scope}">
        <button class="search-btn" title="검색" aria-label="검색"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5 14 14"/></svg></button>
        <input type="text" class="search-input" placeholder="장소·파일 이름·태그로 검색" value="${esc(uiState.search?.[scope] || '')}">
        <span class="search-count hint"></span>
      </span>`;

    const scrollY = scroller()?.scrollTop || 0;   // 다시 그려도 보던 위치 유지
    const listScroll = {};
    document.querySelectorAll('.list-box').forEach((b) => { listScroll[b.dataset.list] = b.scrollTop; });
    resetThumbLoading();
    // 접었다 펼 수 있는 구역. key는 settings.collapsed에 저장됨
    // 구역 안의 하위 묶음 (접기·펼치기는 같은 방식, 상태는 settings.collapsed[key])
    const subsec = (key, title, body, defaultClosed = false) => `
      <div class="sec sub-sec${(settings.collapsed?.[key] ?? defaultClosed) ? ' closed' : ''}" data-sec="${key}">
        <h3 class="sec-h"><button class="sec-t" data-toggle-sec title="접기/펼치기"><span class="chev2"></span>${title}</button></h3>
        <div class="fold sec-fold"><div class="fold-in">${body}</div></div>
      </div>`;
    const sec = (key, title, extra, body, defaultClosed = false) => `
      <div class="sec${(settings.collapsed?.[key] ?? defaultClosed) ? ' closed' : ''}" data-sec="${key}">
        <h2 class="sec-h"><button class="sec-t" data-toggle-sec title="접기/펼치기"><span class="chev2"></span>${title}</button>${extra || ''}</h2>
        <div class="fold sec-fold"><div class="fold-in">${body}</div></div>
      </div>`;

    document.body.innerHTML = `
      ${uiMode === 'modal' ? '<div class="backdrop" id="backdrop"></div>' : ''}
      <div class="wrap">
        <header>
          <h1>🖌️ Wall Painter <span class="ver">v${VERSION}</span></h1>
          <button class="chip gray" id="close">닫기</button>
        </header>

        <div class="card master-box">
          <div class="master"><b>플러그인 사용 <span class="hint">모든 캐릭터</span></b>
            <button class="power ${settings.enabled ? 'on' : 'off'}" id="s-enabled" aria-pressed="${settings.enabled}">${settings.enabled ? 'ON' : 'OFF'}</button></div>
          <div class="master sub${settings.enabled ? '' : ' dim'}"><span><b>이 캐릭터에서 사용</b>
              <span class="hint">${char
                ? `봇 : ${esc(char.name)} · 사용된 모듈 : ${activeMods.length ? activeMods.map((x) => esc(x.name)).join(', ') : '없음'}`
                : '캐릭터를 선택하면 캐릭터마다 켜고 끌 수 있습니다'}</span></span>
            <button class="power small ${char && charOn ? 'on' : 'off'}" id="s-char"${char ? '' : ' disabled'} aria-pressed="${!!(char && charOn)}">${char && charOn ? 'ON' : 'OFF'}</button></div>
        </div>

        ${uiState.busy === 'import' ? '<div class="card notice busy" style="margin-top:12px"><span class="spin" aria-hidden="true"></span>이 봇과 적용된 모듈의 에셋 목록을 보조모델에 보내고 응답을 기다리고 있습니다…</div>' : (importNotice ? `<div style="margin-top:12px">${importNotice}</div>` : '')}
        <div class="card status-row" style="margin-top:12px"><span>${statusText}</span>
          <button class="chip red" id="clear-bg"${appliedImageId ? '' : ' disabled'} data-tip="지금 채팅방에 띄운 배경을 끕니다. 다음 답변에서 장면이 감지되면 다시 바뀝니다.">배경 해제</button></div>
        ${char && char.type !== 'group' && !settings.scannedChars.includes(char.chaId) && !uiState.busy && !uiState.importSummary
          ? `<div class="card notice newbot" style="margin-top:12px"><span>아직 배경 이미지 에셋을 스캔하지 않았습니다. 현재 캐릭터의 에셋과 캐릭터에 적용된 모듈 에셋의 파일명을 스캔하여 적절한 이미지를 선별합니다.</span>
              <button class="chip sel" id="import-now">에셋 스캔하기<small>(보조모델 호출)</small></button></div>`
          : ''}
        ${auxWarning}

        ${sec('settings', '설정', '', `
        <div class="card">
          <div class="row"><span>단일 배경 모드<span class="hint">답변 하나당 배경 하나. 채팅방의 마지막 답변 장면을 유지합니다. 가볍고 안정적입니다.</span></span>
            <input type="checkbox" data-follow="latest"${(settings.followMode || 'latest') === 'latest' ? ' checked' : ''}></div>
          <div class="row"><span>실시간 모드<span class="hint">스크롤 위치에 따라 배경이 바뀝니다. 한 답변 안에서 장소가 바뀌면 그 지점에서 전환됩니다. 스크롤마다 위치를 계산하므로 무겁습니다. 태그가 있는 답변만 대상이며, 전환 후 이미 표시된 메시지는 채팅방을 다시 열어야 적용됩니다.</span></span>
            <input type="checkbox" data-follow="scroll"${settings.followMode === 'scroll' ? ' checked' : ''}></div>
          <div class="row sub${settings.followMode === 'scroll' ? '' : ' dim-row'}" data-pick-row><span>└ 기준선<span class="hint">화면 위에서 35% 지점의 선을 지난 장면을 씁니다. 채팅 맨 아래에 가까워지면 선이 65%까지 내려갑니다. 장면이 바뀌는 지점이 분명합니다.</span></span>
            <input type="checkbox" data-pick="line"${(settings.scrollPick || 'line') === 'line' ? ' checked' : ''}${settings.followMode === 'scroll' ? '' : ' disabled'}></div>
          <div class="row sub${settings.followMode === 'scroll' ? '' : ' dim-row'}" data-pick-row><span>└ 화면 점유율<span class="hint">지금 화면에서 가장 많이 보이는 장면을 씁니다. 두 장면이 비슷하게 보이면 지금 배경을 유지해서 경계에서 깜빡이지 않습니다.</span></span>
            <input type="checkbox" data-pick="area"${settings.scrollPick === 'area' ? ' checked' : ''}${settings.followMode === 'scroll' ? '' : ' disabled'}></div>
          <div class="row"><span>메인모델에 배경 태그 지시 주입 <span class="hint">${char ? `이 캐릭터(${esc(char.name)})만` : '캐릭터 선택 안 됨'}</span>${char && settings.selfBgChars.includes(char.chaId) ? '<span class="hint" style="color:#e6d3a3">이 봇은 답변에 자체 배경 출력(상태창·이미지)이 있어 그 배경을 그대로 따라갑니다. 출력 형식이 겹치지 않도록 감지할 때 주입을 껐습니다.</span>' : ''}<span class="hint">메인모델이 답변 맨 앞에 <code>[BG: location=forest | time=night | season=autumn | tags=rain]</code> 형식의 태그를 쓰게 합니다. 장소·시간대·계절·태그는 아래 "주입되는 태그 목록"에 있는 값 중에서만 고르고, 등록된 값이 없는 항목은 빠집니다. 이 태그는 화면에서 자동으로 숨겨집니다.<br>자체 상태창이나 배경 태그를 이미 쓰는 봇이면 꺼서 형식이 겹치지 않게 하십시오. 끄면 이 캐릭터는 보조모델 판단으로만 배경을 정합니다.</span></span>
            <input type="checkbox" id="s-inject-char"${char && !settings.injectOffChars?.includes(char.chaId) ? ' checked' : ''}${char ? '' : ' disabled'}></div>
          <div class="row"><span>태그가 없으면 보조모델로 판단<span class="hint">메인 출력에서 태그가 발견되지 않으면 보조모델을 호출해 장면을 판단하고, 그 결과로 배경 태그를 정합니다.</span></span>
            <input type="checkbox" id="s-aux"${settings.auxFallback ? ' checked' : ''}></div>
          <div class="row"><span>보조모델 연결 상태<span class="hint">${auxStatusText}</span></span>
            <button class="chip gray" id="aux-test"${uiState.busy ? ' disabled' : ''}>${uiState.busy === 'auxtest' ? '<span class="spin" aria-hidden="true"></span>확인 중' : '연결 확인'}</button></div>
        </div>
        ${subsec('prompts', '프롬프트', `        <div class="card">
          <p class="hint" style="margin:0 0 6px">비워 두면 기본값으로 나갑니다. <code>{이름}</code> 자리표시자는 보낼 때 실제 값으로 채워집니다. 흐린 글씨가 지금 기본값입니다.</p>
          <div class="prompt-file">
            <button class="chip blue" id="prompt-md-save" data-tip="세 프롬프트와 작동 규칙, 자리표시자 설명을 .md 파일로 내려받습니다. 다른 사람이나 AI에게 넘겨서 고치기 좋습니다.">.md로 내려받기</button>
            <button class="chip gray" id="prompt-md-load" data-tip="고친 .md 파일의 편집 칸 내용을 읽어서 프롬프트에 넣습니다.">.md 불러오기</button>
            <input type="file" id="prompt-md-file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden>
          </div>
          ${[
            ['inject', '메인모델 주입 프롬프트', '메인 채팅 요청 맨 끝에 붙습니다. <code>{format}</code>은 <code>[BG: location=… | time=… | …]</code> 형식 줄, <code>{field_rules}</code>는 항목별 선택지 안내로 채워집니다. 플러그인은 이 <b>[BG: …] 형식</b>으로 답변을 읽으니 형식은 바꾸지 마십시오.'],
            ['aux', '보조모델 장면 판단 프롬프트', '태그가 빠진 답변을 보조모델이 판단할 때 쓰는 지시입니다. 응답은 장면 목록 JSON 배열 <code>[{"from","location","time","season","tags"}]</code> 형식이어야 합니다. <code>from</code>은 장면이 시작되는 원문 글귀입니다.'],
            ['tagging', '에셋 자동 태깅 프롬프트', '봇 에셋 가져오기에서 보조모델이 에셋 이름을 분류할 때 쓰는 지시입니다. 응답은 JSON 배열 <code>[{"i","location","time","season","tags"}]</code> 형식이어야 합니다.'],
          ].map(([key, title, desc]) => `
          <div class="prompt-box" data-prompt="${key}">
            <div class="prompt-head"><b>${title}</b><span class="prompt-state hint" data-prompt-state></span></div>
            <div class="hint">${desc}<br>쓸 수 있는 자리표시자: ${PROMPT_VARS[key].map((n) => `<code>{${n}}</code>`).join(' ')}</div>
            <textarea class="prompt-ta" rows="8" spellcheck="false" placeholder="${esc(DEFAULT_PROMPTS[key])}">${esc(settings.prompts?.[key] || '')}</textarea>
            <div class="dlg-warn prompt-warn" hidden></div>
            <div class="prompt-btns">
              <button class="chip gray" data-prompt-fill>기본값 넣고 고치기</button>
              <button class="chip gray" data-prompt-clear>비우기 (기본값 사용)</button>
              <button class="chip blue" data-prompt-preview>실제 보내는 문구 보기</button>
            </div>
          </div>`).join('')}
        </div>`, true)}`)}

        ${sec('visual', '비주얼 설정', '', `
        <div class="card">
          <div class="row"><span>다른 배경 설정 덮어쓰기<span class="hint">다른 플러그인, 커스텀 CSS 등의 백그라운드 설정을 덮어씌웁니다.</span></span>
            <input type="checkbox" id="s-themefx"${settings.hideThemeFx ? ' checked' : ''}></div>
        </div>
        ${subsec('imgfx', '이미지 효과', `
        <div class="card">
          <div class="row col"><span>이미지가 화면 비율과 다를 때<span class="hint">채팅 화면과 배경 이미지의 가로세로 비율이 다를 때 처리 방식입니다.</span></span>
            ${chipGroup('fit', [['cover', '꽉 채우기 (넘치는 부분 자름)'], ['contain', '그대로 (검은 여백)'], ['blur', '그대로 + 여백 흐리게']], settings.fit || 'cover')}</div>
          <div class="row"><span>배경 어둡게 <span class="hint" id="dim-val">${settings.dim}%</span></span>
            <input type="range" id="s-dim" min="0" max="80" step="1" value="${settings.dim}"></div>
          <div class="row"><span>배경 흐리게 <span class="hint" id="blur-val">${settings.blur}px</span></span>
            <input type="range" id="s-blur" min="0" max="20" step="1" value="${settings.blur}"></div>
          <div class="row"><span>비네팅 <span class="hint" data-fx-val="vignette">${settings.vignette}%</span><span class="hint">가장자리를 어둡게 해서 가운데에 시선이 모입니다.</span></span>
            <input type="range" data-fx="vignette" data-unit="%" min="0" max="100" step="1" value="${settings.vignette}"></div>
          <div class="row"><span>필름 그레인 <span class="hint" data-fx-val="grain">${settings.grain}%</span><span class="hint">미세한 노이즈로 영화 같은 질감을 줍니다.</span></span>
            <input type="range" data-fx="grain" data-unit="%" min="0" max="100" step="1" value="${settings.grain}"></div>
          <div class="row"><span>시간대 색감<span class="hint">감지된 시간대에 맞춰 색을 입힙니다. 낮은 살짝 밝고 따뜻하게, 저녁은 노을빛, 밤은 푸르고 어둡게. 지금 장면: <b>${{ day: '낮', evening: '저녁', night: '밤' }[sceneTime] || '모름'}</b></span></span>
            <input type="checkbox" id="s-tint"${settings.timeTint ? ' checked' : ''}></div>
          <div class="row sub${settings.timeTint ? '' : ' dim-row'}"><span>└ 색감 강도 <span class="hint" data-fx-val="timeTintStrength">${settings.timeTintStrength}%</span></span>
            <input type="range" data-fx="timeTintStrength" data-unit="%" min="10" max="100" step="1" value="${settings.timeTintStrength}"${settings.timeTint ? '' : ' disabled'}></div>
          <div class="row col"><div class="row-head"><span>색 보정<span class="hint">배경이 너무 화려해서 글자가 안 읽히면 채도를 낮춰 보십시오. (단위 %)</span></span>
            <button class="chip gray" id="fx-color-reset"${settings.saturate === 100 && settings.brightness === 100 && settings.contrast === 100 ? ' disabled' : ''}>초기화</button></div>
            <div class="adj-grid">
              <label class="adj"><span>채도</span><input type="range" data-fx="saturate" data-unit="%" min="0" max="200" step="1" value="${settings.saturate}"></label>
              <label class="adj"><span>밝기</span><input type="range" data-fx="brightness" data-unit="%" min="50" max="150" step="1" value="${settings.brightness}"></label>
              <label class="adj"><span>대비</span><input type="range" data-fx="contrast" data-unit="%" min="50" max="150" step="1" value="${settings.contrast}"></label>
            </div></div>
        </div>`)}
        ${subsec('transfx', '배경 전환 효과', `
        <div class="card">
          <div class="row col"><span>전환 효과<span class="hint">배경이 바뀔 때의 효과입니다. 설정을 바꿔서 다시 그릴 때는 효과 없이 바로 바뀝니다.</span></span>
            ${chipGroup('transition', [['none', '없음'], ['fade', '크로스페이드'], ['swipe-up', '아래에서 위로 스와이프']], settings.transition || 'fade')}
            <span class="hint">버튼에 마우스를 올리면 버튼이 그 효과로 움직입니다.</span></div>
          <div class="row"><span>전환 시간 <span class="hint" id="trans-val">${(settings.transitionMs / 1000).toFixed(1)}초</span></span>
            <input type="range" id="s-trans-ms" min="200" max="5000" step="100" data-num-scale="1000" data-num-step="0.1" data-num-unit="초" value="${settings.transitionMs}"></div>
          <div class="row"><span>전환 효과 미리보기<span class="hint">지금 배경을 다른 배경으로 잠깐 바꿨다가 되돌립니다.</span></span>
            <button class="chip gray" id="trans-test"${appliedImageId ? '' : ' disabled'}>미리보기</button></div>
        </div>`)}`)}

        <datalist id="locs">${v.locations.map((l) => `<option value="${esc(l)}">`).join('')}</datalist>
        <datalist id="tagsl">${v.tags.map((t) => `<option value="${esc(t)}">`).join('')}</datalist>

        ${reviewItems.length ? `
          <h2 id="sec-review">검토 필요 <span class="hint">${reviewItems.length}개${reviewCharCount && reviewCharCount < reviewItems.length
              ? ` (캐릭터 전용 ${reviewCharCount} · 전체 공통 ${reviewItems.length - reviewCharCount})`
              : reviewCharCount ? ' · 캐릭터 전용' : ' · 전체 공통'}</span>
            ${searchBox('review')}
            <button class="chip sel" id="ok-all">모두 확인</button></h2>
          ${await sectionWithAdd(reviewItems, 'review', { add: false, itemOpts: reviewItems.length > 12 ? { open: false } : {} })}` : ''}

        ${sec('bot', `현재 캐릭터 전용 배경 <span class="hint">${char ? esc(char.name) : '-'} · ${botItems.length}개</span>`,
          `${char ? searchBox('char') : ''}<button class="chip sel" id="add-char"${char ? '' : ' disabled'}>이미지 추가</button>
           <button class="chip gray" data-preset-save="char"${char ? '' : ' disabled'} data-tip="이 캐릭터 전용 배경을 프리셋 파일로 저장합니다.">저장</button>
           <button class="chip gray" data-preset-load="char"${char ? '' : ' disabled'} data-tip="프리셋 파일(JSON/ZIP)을 이 캐릭터 전용 배경으로 불러옵니다.">불러오기</button>
           <button class="chip red" data-clear-all="char"${char && meta.some((m) => m.scope === 'char' && m.chaId === char.chaId) ? '' : ' disabled'} data-tip="이 캐릭터 전용 배경을 모두 지웁니다. 확인 창이 한 번 뜹니다.">전체 삭제</button>
           <button class="chip gray" id="import"${char && !uiState.busy ? '' : ' disabled'}>${uiState.busy === 'import' ? '<span class="spin" aria-hidden="true"></span>보조모델 응답 기다리는 중' : '봇 에셋 다시 가져오기 (보조모델 호출)'}</button>`,
          `<div class="hint" style="margin-bottom:8px">이 캐릭터에서만 쓰이는 배경입니다. 직접 추가한 이미지와 봇·모듈 에셋에서 가져온 배경이 여기 모입니다. 탐색기에서 이미지를 이 구역으로 끌어다 놓아도 추가됩니다.</div>
          ${char ? await sectionWithAdd(botItems, 'char') : '<div class="card empty">캐릭터를 선택하면 전용 배경을 추가할 수 있습니다.</div>'}`)}

        ${sec('global', `전체 공통 배경 <span class="hint">${globalItems.length}개${char && globalItems.length ? ` · 이 캐릭터에서 ${globalItems.filter((m) => itemOn(m, char.chaId)).length}개 사용` : ''}</span>`,
          `${searchBox('global')}<button class="chip sel" id="add">이미지 추가</button>
           <button class="chip gray" data-preset-save="global" data-tip="전체 공통 배경을 프리셋 파일로 저장합니다.">저장</button>
           <button class="chip gray" data-preset-load="global" data-tip="프리셋 파일(JSON/ZIP)을 전체 공통 배경으로 불러옵니다.">불러오기</button>
           <button class="chip red" data-clear-all="global"${meta.some((m) => m.scope === 'global') ? '' : ' disabled'} data-tip="전체 공통 배경을 모두 지웁니다. 확인 창이 한 번 뜹니다.">전체 삭제</button>
           ${char && globalItems.length ? (() => {
             const onCount = globalItems.filter((m) => itemOn(m, char.chaId)).length;
             const state = onCount === globalItems.length ? 'on' : onCount === 0 ? 'off' : 'mixed';
             return `<button class="bulk-onoff ${state}" id="s-global"
               data-tip="이 캐릭터에서 전체 공통 배경 이미지들의 ON/OFF를 한 번에 바꿉니다. ${state === 'on' ? '누르면 전부 끕니다.' : '누르면 전부 켭니다.'}">${state === 'on' ? '전체 ON' : state === 'off' ? '전체 OFF' : `일부 ON ${onCount}/${globalItems.length}`}</button>`;
           })() : ''}`,
          `<div class="hint" style="margin-bottom:8px">캐릭터와 상관없이 쓰이는 배경입니다. 탐색기에서 이미지를 이 구역으로 끌어다 놓아도 추가됩니다. 파일명에서 장소·시간대·계절을 추측합니다 (예: forest_autumn_night.webp). 1920px 이하 webp로 줄여서 이 기기에 저장합니다.</div>
          ${await sectionWithAdd(globalItems, 'global')}`)}
        <input type="file" id="file" accept="image/*" multiple hidden>
        <input type="file" id="preset-file" accept=".json,.zip,application/json,application/zip" hidden>

        ${sec('vocab', '지금 이 봇에서 주입되는 태그 목록', '', `<div class="card vocab" id="vocab">${renderVocab(v)}</div>`)}
      </div>`;

    bindUI(char);
    const sc = scroller(); if (sc) sc.scrollTop = scrollY;
    document.querySelectorAll('.list-box').forEach((b) => { b.scrollTop = listScroll[b.dataset.list] || 0; });
    observeThumbs();
  }

  function bindUI(char) {
    const $ = (s) => document.querySelector(s);
    $('#close').onclick = closeUI;
    $('#backdrop')?.addEventListener('click', closeUI);

    $('#s-enabled').onclick = async () => {
      settings.enabled = !settings.enabled; await saveSettings();
      if (!settings.enabled) await applyImage(null); else await refreshCurrentChat(true);
      await renderUI();
    };

    $('#vocab')?.addEventListener('click', async (e) => {
      const t = e.target.closest('.vrow-t');
      if (!t) return;
      const rowEl = t.closest('.vrow');
      const closed = rowEl.classList.toggle('closed');
      settings.collapsed = { ...(settings.collapsed || {}), ['vocab_' + rowEl.dataset.vrow]: closed };
      await saveSettings();
    });

    // 구역 접기/펼치기 (펼치는 애니메이션 동안만 안쪽을 잘라냄)
    document.querySelectorAll('[data-toggle-sec]').forEach((btn) => {
      btn.onclick = async () => {
        const box = btn.closest('.sec');
        const key = box.dataset.sec;
        box.classList.add('anim');
        const closed = box.classList.toggle('closed');
        settings.collapsed = { ...(settings.collapsed || {}), [key]: closed };
        clearTimeout(box._animTimer);
        box._animTimer = setTimeout(() => box.classList.remove('anim'), 380);
        await saveSettings();
      };
    });
    $('#s-char').onclick = async () => {
      if (!char) return;
      const set = new Set(settings.disabledChars);
      set.has(char.chaId) ? set.delete(char.chaId) : set.add(char.chaId);
      settings.disabledChars = [...set]; await saveSettings();
      await refreshCurrentChat(true);
      await renderUI();
    };
    $('#s-inject-char')?.addEventListener('change', async (e) => {
      if (!char) return;
      const set = new Set(settings.injectOffChars || []);
      e.target.checked ? set.delete(char.chaId) : set.add(char.chaId);
      settings.injectOffChars = [...set];
      await saveSettings();
    });
    document.querySelectorAll('[data-chips="transition"] .chip').forEach((btn) => {
      btn.onclick = async () => {
        if (btn.classList.contains('sel')) return;
        document.querySelectorAll('[data-chips="transition"] .chip').forEach((b) => b.classList.toggle('sel', b === btn));
        settings.transition = btn.dataset.v;
        await saveSettings();
      };
    });
    $('#s-trans-ms').oninput = (e) => { $('#trans-val').textContent = (Number(e.target.value) / 1000).toFixed(1) + '초'; };
    $('#s-trans-ms').onchange = async (e) => { settings.transitionMs = Number(e.target.value); await saveSettings(); };
    // 미리보기: 설정창을 잠깐 투명하게 하고, 다른 배경으로 바꿨다가 원래대로 되돌림
    $('#trans-test')?.addEventListener('click', async () => {
      const cur = appliedImageId;
      const other = availableItems().find((m) => m.id !== cur) || meta.find((m) => m.id !== cur);
      if (!cur || !other) return;
      const ms = Number(settings.transitionMs) || 700;
      document.documentElement.classList.add('peek');
      await applyImage(other.id);
      await new Promise((r) => setTimeout(r, 900));
      await applyImage(cur);
      setTimeout(() => document.documentElement.classList.remove('peek'), 400);
      void ms;
    });
    $('#s-aux').onchange = async (e) => { settings.auxFallback = e.target.checked; await saveSettings(); };
    // 배경 모드: 한쪽을 켜면 다른 쪽은 꺼짐 (켜진 쪽을 끄면 다른 쪽이 켜짐)
    document.querySelectorAll('input[data-follow]').forEach((box) => {
      box.onchange = async () => {
        const mode = box.checked ? box.dataset.follow : (box.dataset.follow === 'scroll' ? 'latest' : 'scroll');
        document.querySelectorAll('input[data-follow]').forEach((b) => { b.checked = b.dataset.follow === mode; });
        if (settings.followMode === mode) return;
        settings.followMode = mode;
        await saveSettings();
        lastScrollSig = '';
        // 장면 기준 토글은 실시간 모드에서만 켤 수 있음
        document.querySelectorAll('[data-pick-row]').forEach((r) => r.classList.toggle('dim-row', mode !== 'scroll'));
        document.querySelectorAll('input[data-pick]').forEach((b) => { b.disabled = mode !== 'scroll'; });
        if (mode === 'scroll') scheduleScrollScan(50);
        else await refreshCurrentChat(true);   // 최신 장면으로 되돌림
      };
    });
    // 실시간 모드 장면 기준: 한쪽을 켜면 다른 쪽은 꺼짐
    document.querySelectorAll('input[data-pick]').forEach((box) => {
      box.onchange = async () => {
        const pick = box.checked ? box.dataset.pick : (box.dataset.pick === 'area' ? 'line' : 'area');
        document.querySelectorAll('input[data-pick]').forEach((b) => { b.checked = b.dataset.pick === pick; });
        if (settings.scrollPick === pick) return;
        settings.scrollPick = pick;
        await saveSettings();
        lastScrollSig = '';
        scheduleScrollScan(50);
      };
    });
    $('#s-themefx').onchange = async (e) => { settings.hideThemeFx = e.target.checked; await saveSettings(); await reapplyCurrent(); };
    $('#aux-test').onclick = async () => {
      uiState.busy = 'auxtest'; await renderUI();
      await testAux();
      uiState.busy = ''; await renderUI();
    };
    document.querySelectorAll('[data-chips="fit"] .chip').forEach((btn) => {
      btn.onclick = async () => {
        if (btn.classList.contains('sel')) return;
        document.querySelectorAll('[data-chips="fit"] .chip').forEach((b) => b.classList.toggle('sel', b === btn));
        settings.fit = btn.dataset.v;
        await saveSettings();
        await reapplyCurrent();
      };
    });
    $('#clear-bg')?.addEventListener('click', async () => { await clearCurrentBackground(); await renderUI(); });
    $('#aux-warn-x')?.addEventListener('click', async () => {
      settings.auxWarnDismissedAt = settings.lastAux?.at || Date.now();
      await saveSettings(); await renderUI();
    });
    $('#import-now')?.addEventListener('click', () => $('#import').click());
    $('#s-dim').oninput = (e) => { $('#dim-val').textContent = e.target.value + '%'; };
    $('#s-dim').onchange = async (e) => { settings.dim = Number(e.target.value); await saveSettings(); await reapplyCurrent(); };
    $('#s-blur').oninput = (e) => { $('#blur-val').textContent = e.target.value + 'px'; };
    $('#s-blur').onchange = async (e) => { settings.blur = Number(e.target.value); await saveSettings(); await reapplyCurrent(); };
    // 이미지 효과 슬라이더: 끄는 동안 숫자만 바꾸고, 놓으면 저장하고 다시 그림
    document.querySelectorAll('input[data-fx]').forEach((inp) => {
      const key = inp.dataset.fx;
      const label = document.querySelector(`[data-fx-val="${key}"]`);
      inp.oninput = () => { if (label) label.textContent = inp.value + (inp.dataset.unit || ''); };
      inp.onchange = async () => {
        settings[key] = Number(inp.value);
        await saveSettings();
        await reapplyCurrent();
        const r = $('#fx-color-reset');
        if (r) r.disabled = settings.saturate === 100 && settings.brightness === 100 && settings.contrast === 100;
      };
    });
    $('#s-tint').onchange = async (e) => {
      settings.timeTint = e.target.checked;
      await saveSettings(); await reapplyCurrent();
      const sl = document.querySelector('input[data-fx="timeTintStrength"]');
      if (sl) { sl.disabled = !settings.timeTint; sl.closest('.row')?.classList.toggle('dim-row', !settings.timeTint); }
    };
    $('#fx-color-reset').onclick = async () => {
      Object.assign(settings, { saturate: 100, brightness: 100, contrast: 100 });
      await saveSettings(); await reapplyCurrent(); await renderUI();
    };

    $('#ok-all')?.addEventListener('click', async () => {
      for (const m of meta) if (isReviewItem(m, char?.chaId || '')) delete m.review;   // 화면의 검토 필요 목록과 같은 기준
      uiState.importSummary = null;
      await saveMeta(); await renderUI();
    });

    $('#import').onclick = async () => {
      if (!char) return;
      uiState.busy = 'import'; await renderUI();
      try {
        const sum = await importBotAssets(char, { openReview: false });
        uiState.importSummary = sum || null;   // 취소하면 null
      } catch (e) {
        uiState.importSummary = { total: 0, checked: 0, added: 0, note: '가져오기 실패: ' + (e?.message || e) };
      }
      uiState.busy = ''; await renderUI();
      document.getElementById('sec-review')?.scrollIntoView();
    };

    // 가능하면 File System Access API의 id로 마지막 폴더를 기억시킴.
    // 브라우저나 RisuAI 환경에서 막혀 있으면 일반 파일 선택창으로 대체.
    // 어느 구역의 "이미지 추가"를 눌렀는지에 따라 범위가 정해짐
    let addScope = 'global';
    const pickFiles = async (scope) => {
      addScope = scope;
      if (typeof window.showOpenFilePicker === 'function') {
        try {
          const handles = await window.showOpenFilePicker({
            id: 'autobg-images',
            multiple: true,
            types: [{ description: '이미지', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'] } }],
          });
          await addFiles(await Promise.all(handles.map((h) => h.getFile())));
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;   // 사용자가 취소
        }
      }
      $('#file').value = '';
      $('#file').click();
    };
    $('#add').onclick = () => pickFiles('global');
    // 구역 전체 삭제 (검토 필요로 표시된 항목 포함). 봇 에셋은 목록에서만 빠지고 원본은 그대로
    document.querySelectorAll('[data-clear-all]').forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        const scope = btn.dataset.clearAll;
        if (scope === 'char' && !char) return;
        const targets = meta.filter((m) => (scope === 'char' ? m.scope === 'char' && m.chaId === char.chaId : m.scope === 'global'));
        if (!targets.length) return;
        const assets = targets.filter((m) => m.source === 'asset').length;
        const uploads = targets.length - assets;
        const reviews = targets.filter((m) => m.review).length;
        const label = scope === 'char' ? `'${esc(char.name)}' 전용 배경` : '전체 공통 배경';
        const ok = await showDialog({
          title: `${label}을 모두 지우시겠습니까?`,
          body: `<p>배경 <b>${targets.length}개</b>를 지웁니다. (봇 에셋 ${assets}개 · 직접 추가 ${uploads}개${reviews ? ` · 그중 검토 필요 ${reviews}개` : ''})</p>
            <div class="dlg-warn">⚠️ 직접 추가한 이미지는 이 기기에서 완전히 지워지고 <b>되돌릴 수 없습니다.</b> 필요하면 먼저 "저장"으로 프리셋 백업을 하십시오.
            봇 에셋은 목록에서만 빠지고 봇의 원본 에셋은 그대로입니다.</div>
            ${scope === 'char' ? '<p class="hint">지운 뒤에는 "에셋 스캔하기"로 봇 에셋을 다시 가져올 수 있습니다.</p>' : ''}
            ${scope === 'global' && settings.defaultImageId && targets.some((m) => m.id === settings.defaultImageId) ? '<p class="hint">기본 배경 지정도 함께 해제됩니다.</p>' : ''}`,
          buttons: [{ label: '취소', value: false }, { label: `${targets.length}개 모두 삭제`, value: true, cls: 'red' }],
        });
        if (!ok) return;
        const ids = new Set(targets.map((m) => m.id));
        meta = meta.filter((m) => !ids.has(m.id));
        for (const m of targets) {
          if (m.source === 'upload') await store.removeItem(KEY_IMG + m.id);
          await store.removeItem(KEY_THUMB + m.id);
          imageCache.delete(m.id); thumbCache.delete(m.id);
        }
        if (ids.has(settings.defaultImageId)) settings.defaultImageId = '';
        // 캐릭터 전용을 비우면 다시 스캔할 수 있게 (새 봇 안내가 다시 뜸)
        if (scope === 'char') settings.scannedChars = settings.scannedChars.filter((x) => x !== char.chaId);
        await saveMeta(); await saveSettings();
        if (appliedImageId && ids.has(appliedImageId)) await applyImage(defaultFor());
        await renderUI();
      };
    });

    // ── 모든 슬라이더 옆에 숫자 입력칸 (양방향 동기화) ──
    // data-num-scale: 슬라이더 값 ÷ scale 로 보여줌 (예: ms → 초), data-num-step: 입력칸 단위
    // 브라우저 기본 위아래 버튼은 숨기고, 칸 안에 작은 화살표 두 개를 직접 둠.
    // 화살표를 누르고 있으면 계속 바뀌고, 칸 위에서 마우스 휠, 키보드 ↑↓로도 조절됨.
    const CHEV_UP = '<svg viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 5 5 1l4 4"/></svg>';
    const CHEV_DOWN = '<svg viewBox="0 0 10 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 1l4 4 4-4"/></svg>';
    document.querySelectorAll('.wrap input[type=range]').forEach((range) => {
      if (range.nextElementSibling?.classList.contains('num-box')) return;
      const scale = Number(range.dataset.numScale) || 1;
      const sliderStep = Number(range.step || 1);
      const box = document.createElement('span');
      box.className = 'num-box';
      box.innerHTML = `<input type="text" inputmode="decimal" class="num"><span class="num-steps">` +
        `<button type="button" tabindex="-1" data-d="1" aria-label="올리기">${CHEV_UP}</button>` +
        `<button type="button" tabindex="-1" data-d="-1" aria-label="내리기">${CHEV_DOWN}</button></span>`;
      const num = box.querySelector('.num');
      const show = () => { num.value = String(+(Number(range.value) / scale).toFixed(3)); };
      show();
      const unit = document.createElement('span');
      unit.className = 'num-unit';
      unit.textContent = range.dataset.numUnit ?? range.dataset.unit ?? (range.id === 's-blur' ? 'px' : range.id === 's-dim' ? '%' : '');
      range.after(box, unit);
      range.addEventListener('input', show);

      const clampRaw = (v) => Math.max(Number(range.min), Math.min(Number(range.max), v));
      const fire = (commit) => {
        range.dispatchEvent(new Event('input'));
        if (commit) range.dispatchEvent(new Event('change'));
      };
      const commitTyped = () => {
        const v = Number(String(num.value).replace(/[^\d.\-]/g, ''));
        if (!Number.isFinite(v) || num.value.trim() === '') { show(); return; }
        range.value = String(clampRaw(Math.round(v * scale)));
        show();
        fire(true);
      };
      // 한 칸 이동 (저장은 손을 뗀 뒤에 한 번만)
      const nudge = (dir) => {
        const next = clampRaw(Number(range.value) + dir * sliderStep);
        if (next === Number(range.value)) return false;
        range.value = String(next);
        show();
        fire(false);
        return true;
      };
      let saveTimer = null;
      const saveSoon = (ms = 350) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => fire(true), ms); };

      num.addEventListener('change', commitTyped);
      num.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); commitTyped(); num.blur(); }
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); if (nudge(e.key === 'ArrowUp' ? 1 : -1)) saveSoon(); }
      });
      num.addEventListener('wheel', (e) => {
        if (range.disabled || document.activeElement !== num && !box.matches(':hover')) return;
        e.preventDefault();
        if (nudge(e.deltaY < 0 ? 1 : -1)) saveSoon();
      }, { passive: false });

      box.querySelectorAll('.num-steps button').forEach((btn) => {
        const dir = Number(btn.dataset.d);
        let hold = null;
        let repeat = null;
        const stop = () => {
          clearTimeout(hold); clearInterval(repeat); hold = repeat = null;
          btn.classList.remove('pressing');
        };
        btn.addEventListener('pointerdown', (e) => {
          if (range.disabled) return;
          e.preventDefault();
          btn.setPointerCapture(e.pointerId);
          btn.classList.add('pressing');
          nudge(dir);
          hold = setTimeout(() => { repeat = setInterval(() => { if (!nudge(dir)) stop(); }, 70); }, 380);
        });
        btn.addEventListener('pointerup', () => { stop(); saveSoon(150); });
        btn.addEventListener('pointercancel', () => { stop(); saveSoon(150); });
      });

      // 슬라이더가 잠기면(예: 시간대 색감 끔) 입력칸도 같이 잠금
      const syncDisabled = () => {
        num.disabled = range.disabled;
        box.classList.toggle('disabled', range.disabled);
      };
      syncDisabled();
      new MutationObserver(syncDisabled).observe(range, { attributes: true, attributeFilter: ['disabled'] });
    });

    // ── 프롬프트 .md 내려받기 / 불러오기 ──
    $('#prompt-md-save')?.addEventListener('click', () => {
      const md = buildPromptMarkdown(char?.chaId || currentChat.chaId);
      downloadBlob(new Blob([md], { type: 'text/markdown;charset=utf-8' }), `wallpainter_prompts_${new Date().toISOString().slice(0, 10)}.md`);
    });
    $('#prompt-md-load')?.addEventListener('click', () => { const i = $('#prompt-md-file'); i.value = ''; i.click(); });
    $('#prompt-md-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const found = parsePromptMarkdown(await file.text());
      const keys = Object.keys(found);
      if (!keys.length) {
        await showDialog({ title: '편집 칸을 찾지 못했습니다', body: '<code>&lt;!-- wall-painter:prompt … --&gt;</code> 표시 줄 바로 아래 코드 블록을 찾지 못했습니다. 이 플러그인에서 내려받은 .md 파일인지 확인하십시오.', buttons: [{ label: '확인', value: null }] });
        return;
      }
      const lines = keys.map((k) => {
        const cur = (settings.prompts?.[k] || '').trim();
        const next = found[k];
        const what = next === cur ? '변경 없음' : next ? (cur ? '수정된 내용으로 바뀜' : '기본값 → 직접 수정') : '기본값으로 되돌림';
        return `<li>${PROMPT_INFO[k].title}: <b>${what}</b></li>`;
      }).join('');
      const changed = keys.some((k) => found[k] !== (settings.prompts?.[k] || '').trim());
      const ok = await showDialog({
        title: '프롬프트 불러오기',
        body: `<p class="hint">${esc(file.name)}</p><ul>${lines}</ul>${changed ? '<div class="dlg-warn">⚠️ 지금 프롬프트 칸의 내용은 파일 내용으로 <b>덮어씌워집니다.</b></div>' : ''}`,
        buttons: [{ label: '취소', value: false }, { label: changed ? '덮어쓰고 적용' : '확인', value: changed, cls: changed ? 'red' : 'sel' }],
      });
      if (!ok) return;
      settings.prompts = { ...(settings.prompts || {}), ...found };
      await saveSettings();
      await renderUI();
    });

    // ── 프롬프트 편집 ──
    document.querySelectorAll('.prompt-box').forEach((box) => {
      const key = box.dataset.prompt;
      const ta = box.querySelector('.prompt-ta');
      const stateEl = box.querySelector('[data-prompt-state]');
      const warnEl = box.querySelector('.prompt-warn');
      const refresh = () => {
        const custom = ta.value.trim();
        stateEl.textContent = custom ? '직접 수정함' : '기본값 사용 중';
        stateEl.classList.toggle('custom', !!custom);
        const warns = [];
        if (custom && key === 'inject') {
          if (!custom.includes('{format}') && !custom.includes('[BG:')) warns.push('<code>{format}</code>이나 <code>[BG: …]</code> 형식 안내가 없어서, 메인모델이 태그를 쓰지 않아 배경 감지가 안 될 수 있습니다.');
          if (!custom.includes('{field_rules}') && !custom.includes('{locations}')) warns.push('<code>{field_rules}</code>나 <code>{locations}</code>가 없어서, 메인모델이 등록된 장소 목록을 모릅니다.');
        }
        if (custom && key === 'aux' && !custom.includes('{locations}')) warns.push('<code>{locations}</code>가 없어서, 보조모델이 등록된 장소 중에서 고르지 못합니다.');
        warnEl.hidden = !warns.length;
        warnEl.innerHTML = warns.map((w) => `⚠️ ${w}`).join('<br>');
      };
      let t = null;
      const save = () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          settings.prompts = { ...(settings.prompts || {}), [key]: ta.value.trim() };
          await saveSettings();
        }, 400);
      };
      ta.addEventListener('input', () => { refresh(); save(); });
      box.querySelector('[data-prompt-fill]').onclick = () => {
        if (ta.value.trim() && !confirm('지금 입력한 내용을 기본값으로 바꾸시겠습니까?')) return;
        ta.value = DEFAULT_PROMPTS[key]; refresh(); save(); ta.focus();
      };
      box.querySelector('[data-prompt-clear]').onclick = () => { ta.value = ''; refresh(); save(); };
      box.querySelector('[data-prompt-preview]').onclick = async () => {
        settings.prompts = { ...(settings.prompts || {}), [key]: ta.value.trim() };
        const chaId = char?.chaId || currentChat.chaId;
        const text = key === 'inject' ? buildInjection(chaId) : key === 'aux' ? buildAuxPrompt(chaId) : buildTaggingPrompt(chaId);
        await showDialog({
          title: '실제로 보내는 문구',
          body: text ? `<pre class="prompt-preview">${esc(text)}</pre>` : '등록된 장소가 없어서 지금은 주입하지 않습니다.',
          buttons: [{ label: '닫기', value: null, cls: 'sel' }],
        });
      };
      refresh();
    });

    // ── 프리셋 저장 ──
    const scopeLabel = (scope) => (scope === 'char' ? `현재 캐릭터 전용 배경 (${esc(char?.name || '')})` : '전체 공통 배경');
    document.querySelectorAll('[data-preset-save]').forEach((btn) => {
      btn.onclick = async () => {
        const scope = btn.dataset.presetSave;
        if (scope === 'char' && !char) return;
        const items = presetItems(scope, char);
        if (!items.length) {
          await showDialog({ title: '저장할 배경이 없습니다', body: `${scopeLabel(scope)}에 등록된 배경이 없습니다.`, buttons: [{ label: '확인', value: null }] });
          return;
        }
        const assets = items.filter((m) => m.source === 'asset').length;
        const uploads = items.length - assets;
        const choice = await showDialog({
          title: `${scopeLabel(scope)} 저장`,
          body: `<p>배경 <b>${items.length}개</b>를 프리셋 파일로 저장합니다. (봇 에셋 ${assets}개 · 직접 추가 ${uploads}개)</p>
            <ul>
              <li><b>참조만 (JSON)</b> — 이미지 없이 이름·장소·시간대·계절·태그만 담습니다. 파일이 작습니다.
                봇 에셋은 같은 봇에서, 직접 추가한 이미지는 같은 이미지가 이미 있을 때만 쓸 수 있습니다.</li>
              <li><b>이미지 포함 (ZIP)</b> — 이미지 파일까지 담아서 봇이 없어도 그대로 쓸 수 있습니다. 이미지 수만큼 파일이 큽니다.</li>
            </ul>
            <p class="hint">캐릭터별 ON/OFF와 기본 배경 같은 이 기기 설정은 담지 않습니다.</p>`,
          buttons: [{ label: '취소', value: null }, { label: '참조만 (JSON)', value: 'json', cls: 'blue' }, { label: '이미지 포함 (ZIP)', value: 'zip', cls: 'sel' }],
        });
        if (!choice) return;
        showDialog({ title: '저장하는 중…', body: '<span class="spin"></span>준비하고 있습니다', buttons: [] });
        try {
          const r = await exportPreset(scope, char, choice === 'zip', (i, n) =>
            setDialogBody(`<span class="spin"></span>${choice === 'zip' ? '이미지 담는 중' : '정리하는 중'} ${i} / ${n}`));
          await showDialog({ title: '저장했습니다', body: `배경 ${r.count}개${choice === 'zip' ? `, 이미지 ${r.images}장` : ''}을 파일로 내려받았습니다.`, buttons: [{ label: '확인', value: null, cls: 'sel' }] });
        } catch (e) {
          await showDialog({ title: '저장하지 못했습니다', body: esc(e?.message || e), buttons: [{ label: '확인', value: null }] });
        }
      };
    });

    // ── 프리셋 불러오기 ──
    let presetScope = 'global';
    document.querySelectorAll('[data-preset-load]').forEach((btn) => {
      btn.onclick = () => {
        const scope = btn.dataset.presetLoad;
        if (scope === 'char' && !char) return;
        presetScope = scope;
        const input = $('#preset-file');
        input.value = '';
        input.click();
      };
    });
    $('#preset-file').onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const scope = presetScope;
      showDialog({ title: '프리셋 읽는 중…', body: '<span class="spin"></span>파일을 확인하고 있습니다', buttons: [] });
      let plan;
      try {
        plan = await planPresetImport(file, scope, char);
      } catch (err) {
        await showDialog({ title: '불러오지 못했습니다', body: esc(err?.message || err), buttons: [{ label: '확인', value: null }] });
        return;
      }
      const skipWhy = {};
      for (const s of plan.skip) skipWhy[s.why] = (skipWhy[s.why] || 0) + 1;
      const ok = await showDialog({
        title: `${scopeLabel(scope)}로 불러오기`,
        body: `<p class="hint">${esc(file.name)} · 배경 ${plan.preset.items.length}개${plan.preset.character ? ` · 원래 캐릭터: ${esc(plan.preset.character)}` : ''}</p>
          <ul>
            <li>새로 추가 <b>${plan.add.length}개</b> <span class="hint">(검토 필요로 표시됩니다)</span></li>
            ${plan.overwrite.length ? `<li>덮어쓰기 <b>${plan.overwrite.length}개</b></li>` : ''}
            ${Object.entries(skipWhy).map(([w, n]) => `<li>건너뜀 <b>${n}개</b> <span class="hint">— ${esc(w)}</span></li>`).join('')}
          </ul>
          ${plan.overwrite.length ? `<div class="dlg-warn">⚠️ 이미 있는 배경과 같은 이미지 <b>${plan.overwrite.length}개</b>는 장소·시간대·계절·태그가 <b>프리셋 내용으로 덮어씌워집니다.</b> 지금 설정은 되돌릴 수 없으니, 필요하면 먼저 "저장"으로 백업하십시오.</div>` : ''}`,
        buttons: [{ label: '취소', value: false }, { label: plan.overwrite.length ? '덮어쓰고 가져오기' : '가져오기', value: true, cls: plan.overwrite.length ? 'red' : 'sel' }],
      });
      if (!ok || (!plan.add.length && !plan.overwrite.length)) return;
      showDialog({ title: '가져오는 중…', body: '<span class="spin"></span>준비하고 있습니다', buttons: [] });
      await applyPresetImport(plan, scope, char, (i, n) => setDialogBody(`<span class="spin"></span>이미지 저장 중 ${i} / ${n}`));
      document.querySelector('.dlg-back')?._close?.();
      if (scope === 'char') uiState.importSummary = null;
      await renderUI();
      await showDialog({ title: '불러왔습니다', body: `새로 추가 ${plan.add.length}개, 덮어쓰기 ${plan.overwrite.length}개${plan.skip.length ? `, 건너뜀 ${plan.skip.length}개` : ''}.`, buttons: [{ label: '확인', value: null, cls: 'sel' }] });
      await refreshCurrentChat(true);
    };
    document.querySelectorAll('[data-add-scope]').forEach((card) => {
      card.onclick = () => {
        const scope = card.dataset.addScope;
        if (scope === 'char' && !char) return;
        pickFiles(scope);
      };
    });
    $('#add-char')?.addEventListener('click', () => { if (char) pickFiles('char'); });
    $('#file').onchange = (e) => addFiles([...e.target.files]);

    // 공통 배경 제목줄(사용 개수, 전체 토글 버튼)만 다시 씀. 이미지 하나를 켜고 끌 때 화면 전체를 다시 그리지 않으려고.
    function updateGlobalHeader() {
      if (!char) return;
      const globals = meta.filter((m) => m.scope === 'global');
      const onCount = globals.filter((m) => itemOn(m, char.chaId)).length;
      const hint = document.querySelector('[data-sec="global"] .sec-t .hint');
      if (hint) hint.textContent = `${globals.length}개 · 이 캐릭터에서 ${onCount}개 사용`;
      const btn = $('#s-global');
      if (!btn) return;
      const state = onCount === globals.length ? 'on' : onCount === 0 ? 'off' : 'mixed';
      btn.className = `bulk-onoff ${state}`;
      btn.textContent = state === 'on' ? '전체 ON' : state === 'off' ? '전체 OFF' : `일부 ON ${onCount}/${globals.length}`;
      btn.dataset.tip = `이 캐릭터에서 전체 공통 배경 이미지들의 ON/OFF를 한 번에 바꿉니다. ${state === 'on' ? '누르면 전부 끕니다.' : '누르면 전부 켭니다.'}`;
    }

    $('#s-global')?.addEventListener('click', async () => {
      if (!char) return;
      const globals = meta.filter((m) => m.scope === 'global');
      const turnOn = !globals.every((m) => itemOn(m, char.chaId));
      for (const m of globals) {
        const set = new Set(m.offChars || []);
        turnOn ? set.delete(char.chaId) : set.add(char.chaId);
        m.offChars = [...set];
      }
      await saveMeta();
      // 지금 떠 있던 공통 배경을 껐으면 다시 고름
      const cur = meta.find((m) => m.id === appliedImageId);
      if (!turnOn && cur?.scope === 'global') await refreshCurrentChat(true);
      await renderUI();
    });

    // 탐색기에서 끌어다 놓기. 파일 선택창이 마지막 폴더를 기억하지 못하는 환경(플러그인 iframe)을 위한 대안.
    document.querySelectorAll('[data-sec="bot"],[data-sec="global"]').forEach((box) => {
      const scope = box.dataset.sec === 'bot' ? 'char' : 'global';
      if (scope === 'char' && !char) return;
      box.dataset.dropLabel = scope === 'char' ? '놓으면 현재 캐릭터 전용 배경에 추가' : '놓으면 전체 공통 배경에 추가';
      let depth = 0;
      box.addEventListener('dragenter', (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault(); depth++; box.classList.add('drop');
      });
      box.addEventListener('dragover', (e) => {
        if (!dragHasFiles(e)) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
      });
      box.addEventListener('dragleave', () => {
        if (--depth <= 0) { depth = 0; box.classList.remove('drop'); }
      });
      box.addEventListener('drop', async (e) => {
        e.preventDefault(); e.stopPropagation();
        depth = 0; box.classList.remove('drop');
        const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(f.name));
        if (!files.length) return;
        addScope = scope;
        await addFiles(files);
      });
    });

    async function addFiles(files) {
      for (const file of files) {
        try {
          const data = await blobToResizedDataURL(file, MAX_IMAGE_DIM);
          const id = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
          await store.setItem(KEY_IMG + id, data);
          imageCache.set(id, data);
          const scopeInfo = addScope === 'char' && char
            ? { scope: 'char', chaId: char.chaId, charName: char.name }
            : { scope: 'global' };
          meta.push({ id, name: file.name.replace(/\.[a-z0-9]+$/i, ''), source: 'upload', hash: hashString(data), ...scopeInfo, ...guessTagsFromName(file.name) });
          expanded.add(id);
        } catch (err) {
          console.warn('[Wall Painter] 업로드 실패', file.name, err);
        }
      }
      await saveMeta();
      await renderUI();
    }

    // 검색: 돋보기를 누르면 입력칸이 펼쳐지고, 장소·파일 이름·태그에 모든 검색어가 들어간 카드만 보임
    const applySearch = (scope) => {
      const q = (uiState.search?.[scope] || '').toLowerCase().split(/\s+/).filter(Boolean);
      const box = document.querySelector(`.list-box[data-list="${scope}"]`);
      if (!box) return;
      let shown = 0;
      box.querySelectorAll('.item').forEach((it) => {
        const hit = !q.length || q.every((w) => it.dataset.search.includes(w));
        it.classList.toggle('hidden', !hit);
        if (hit) shown++;
      });
      box.classList.toggle('no-result', q.length > 0 && shown === 0);
      const cnt = document.querySelector(`[data-search-scope="${scope}"] .search-count`);
      if (cnt) cnt.textContent = q.length ? `${shown}개` : '';
      observeThumbs(box);
    };
    document.querySelectorAll('[data-search-scope]').forEach((wrapEl) => {
      const scope = wrapEl.dataset.searchScope;
      const input = wrapEl.querySelector('.search-input');
      wrapEl.querySelector('.search-btn').onclick = () => {
        if (wrapEl.classList.contains('active') && !input.value) { wrapEl.classList.remove('active'); return; }
        wrapEl.classList.add('active');
        input.focus();
      };
      input.oninput = () => {
        uiState.search = { ...(uiState.search || {}), [scope]: input.value };
        applySearch(scope);
      };
      input.onkeydown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          input.value = ''; input.oninput(); wrapEl.classList.remove('active'); input.blur();
        }
      };
      input.onblur = () => { if (!input.value) wrapEl.classList.remove('active'); };
      applySearch(scope);
    });

    // 목록 상자 높이: 상자 아래 경계선 막대를 위아래로 끌어서 조절하고 저장
    document.querySelectorAll('.list-resize').forEach((bar) => {
      const scope = bar.dataset.resizeFor;
      const box = document.querySelector(`.list-box[data-list="${scope}"]`);
      if (!box) return;
      bar.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        bar.setPointerCapture(e.pointerId);
        const startY = e.clientY;
        const startH = box.getBoundingClientRect().height;
        bar.classList.add('dragging');
        const move = (ev) => { box.style.height = Math.max(260, Math.round(startH + ev.clientY - startY)) + 'px'; };
        const up = async () => {
          bar.removeEventListener('pointermove', move);
          bar.removeEventListener('pointerup', up);
          bar.removeEventListener('pointercancel', up);
          bar.classList.remove('dragging');
          settings.listHeight = { ...(settings.listHeight || {}), [scope]: Math.round(box.getBoundingClientRect().height) };
          await saveSettings();
        };
        bar.addEventListener('pointermove', move);
        bar.addEventListener('pointerup', up);
        bar.addEventListener('pointercancel', up);
      });
    });

    const bindItem = (el) => {
      const id = el.dataset.id;
      const m = meta.find((x) => x.id === id);
      const chaId = char?.chaId || '';

      // 미리보기 이미지를 누르면 설정 펼치기/접기
      const bodyFold = el.querySelector('.body-fold');
      const hasBody = !!el.querySelector('.body-fold .fields');
      bodyFold.addEventListener('transitionend', (e) => {
        if (e.target === bodyFold && el.classList.contains('open')) el.classList.add('settled');
      });
      el.querySelector('[data-item-toggle]')?.addEventListener('click', async (e) => {
        e.stopPropagation();   // 미리보기 펼치기/접기와 겹치지 않게
        const b = e.currentTarget;   // await 뒤에는 e.currentTarget이 비므로 미리 잡아 둠
        if (!char || b.disabled) return;
        const set = new Set(m.offChars || []);
        const nowOn = set.has(char.chaId);   // 꺼져 있었으면 켬
        nowOn ? set.delete(char.chaId) : set.add(char.chaId);
        m.offChars = [...set];
        await saveMeta();
        el.classList.toggle('off', !nowOn);
        b.classList.toggle('on', nowOn); b.classList.toggle('off', !nowOn);
        b.textContent = nowOn ? 'ON' : 'OFF';
        b.dataset.tip = nowOn ? '이 캐릭터에서 이 배경을 씁니다. 누르면 이 캐릭터에서만 끕니다.' : '이 캐릭터에서 이 배경을 쓰지 않습니다. 누르면 켭니다.';
        refreshVocab(chaId);
        if (m.scope === 'global') updateGlobalHeader();
        if (!nowOn && appliedImageId === id) await refreshCurrentChat(true);   // 지금 떠 있던 배경을 껐으면 다시 고름
      });

      el.querySelector('[data-toggle]').onclick = () => {
        const open = !el.classList.contains('open');
        if (open && !hasBody) {
          // 접힌 카드는 설정 본문 없이 그려 두므로, 처음 펼칠 때 만들어 끼운 뒤 바로 펼침
          const tmp = document.createElement('div');
          tmp.innerHTML = renderItem(m, char, { body: true, open: false });
          const fresh = tmp.firstElementChild;
          el.replaceWith(fresh);
          bindItem(fresh);
          observeThumbs(fresh.parentElement || document);
          fresh.getBoundingClientRect();   // 접힌 상태를 한 번 계산시켜야 펼침 애니메이션이 일어남
          fresh.querySelector('[data-toggle]').click();
          return;
        }
        el.classList.remove('settled');
        if (!open) el.querySelector('.summary').innerHTML = renderSummary(m);
        el.classList.toggle('open', open);
        open ? expanded.add(id) : expanded.delete(id);
        // 화면이 가려져 있으면 transitionend가 안 올 수 있어서 시간으로도 보장
        clearTimeout(el._settleTimer);
        if (open) el._settleTimer = setTimeout(() => { if (el.classList.contains('open')) el.classList.add('settled'); }, 400);
      };

      // 텍스트 입력: 이름, 장소
      el.querySelectorAll('input[data-f]').forEach((input) => {
        input.onchange = async () => {
          const f = input.dataset.f;
          if (f === 'location') { m.location = normTag(input.value); input.value = m.location; }
          else m[f] = input.value.trim();
          await saveMeta();
          if (f === 'location') refreshVocab(chaId);
        };
      });

      // 알약 버튼: 시간대, 계절, 범위
      el.querySelectorAll('[data-chips]').forEach((group) => {
        const f = group.dataset.chips;
        group.querySelectorAll('.chip').forEach((btn) => {
          btn.onclick = async () => {
            if (btn.disabled || btn.classList.contains('sel')) return;
            group.querySelectorAll('.chip').forEach((b) => b.classList.toggle('sel', b === btn));
            const val = btn.dataset.v;
            if (f === 'scope') {
              m.scope = val;
              if (m.scope === 'char' && char) { m.chaId = char.chaId; m.charName = char.name; }
              if (m.scope === 'char' && settings.defaultImageId === id) { settings.defaultImageId = ''; await saveSettings(); }
              await saveMeta();
              await renderUI();   // 다른 구역으로 옮겨가야 하므로 전체 다시 그림
              return;
            }
            m[f] = val;
            await saveMeta();
            refreshVocab(chaId);
          };
        });
      });

      // 태그: 글자를 누르면 그 자리에서 수정, ⊕로 새 태그, ✕로 삭제.
      // 수정/추가 중에는 Enter 또는 바깥 클릭으로 저장하고, Esc로 취소.
      const tagBox = el.querySelector('[data-tags]');
      const redrawTagsIn = (box) => {
        box.outerHTML = tagChips(m.tags);
        bindTags(el.querySelector('[data-tags]'));
        refreshVocab(chaId);
      };
      const startEdit = (box, span, oldTag) => {
        span.classList.add('editing');
        span.innerHTML = `<input type="text" list="tagsl" placeholder="태그" value="${esc(oldTag || '')}"><button class="x" title="${oldTag ? '수정 취소' : '취소'}">✕</button>`;
        const input = span.querySelector('input');
        // 글자 수(ch)나 글자 폭 계산은 글꼴·자동완성 영역 때문에 어긋나서 잘림 →
        // 폭을 0으로 줄였다가 브라우저가 잰 실제 내용 폭(scrollWidth)으로 맞춤
        const fit = () => {
          input.style.width = '0px';
          input.style.width = (input.scrollWidth + 2) + 'px';
        };
        fit();
        input.oninput = fit;
        let done = false;
        const commit = async (save) => {
          if (done) return; done = true;
          const t = normTag(input.value);
          let tags = [...(m.tags || [])];
          if (save) {
            const valid = t && t !== 'none' && t !== 'unknown';
            if (oldTag) {
              // 수정: 비우면 삭제, 이미 있는 태그로 바꾸면 하나로 합침
              tags = valid
                ? [...new Set(tags.map((v) => (v === oldTag ? t : v)))]
                : tags.filter((v) => v !== oldTag);
            } else if (valid && !tags.includes(t)) {
              tags.push(t);
            }
            if (JSON.stringify(tags) !== JSON.stringify(m.tags || [])) {
              m.tags = tags;
              await saveMeta();
            }
          }
          redrawTagsIn(box);
        };
        input.onkeydown = (e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(true); }
          else if (e.key === 'Escape') { e.preventDefault(); commit(false); }
        };
        input.onblur = () => commit(true);
        span.querySelector('.x').onmousedown = (e) => { e.preventDefault(); commit(false); };
        input.focus();
        input.select();
      };
      const bindTags = (box) => {
        box.querySelectorAll('.tag').forEach((span) => {
          const t = span.dataset.tag;
          span.querySelector('.x').onclick = async (e) => {
            e.stopPropagation();
            m.tags = (m.tags || []).filter((v) => v !== t);
            await saveMeta();
            redrawTagsIn(box);
          };
          span.onclick = () => { if (!span.classList.contains('editing')) startEdit(box, span, t); };
        });
        box.querySelector('.add').onclick = () => {
          const editing = box.querySelector('.tag.editing input');
          if (editing) { editing.focus(); return; }
          const span = document.createElement('span');
          span.className = 'tag';
          box.insertBefore(span, box.querySelector('.add'));
          startEdit(box, span, null);
        };
      };
      if (tagBox) bindTags(tagBox);
      el.querySelector('[data-act="ok"]')?.addEventListener('click', async () => {
        delete m.review; await saveMeta(); await renderUI();
      });
      const applyBtn = el.querySelector('[data-act="apply"]');
      if (applyBtn) applyBtn.onclick = async () => {
        await applyImage(id);
        await saveManualChoice(id);
        await renderUI();
      };
      el.querySelector('[data-act="default"]')?.addEventListener('click', async () => {
        settings.defaultImageId = settings.defaultImageId === id ? '' : id;
        await saveSettings(); await renderUI();
      });
      const delBtn = el.querySelector('[data-act="delete"]');
      if (delBtn) delBtn.onclick = async () => {
        const what = m.source === 'asset' ? '목록에서 제외하시겠습니까? (봇 에셋 원본은 그대로입니다)' : '삭제하시겠습니까?';
        if (!confirm(`'${m.name}' 배경을 ${what}`)) return;
        meta = meta.filter((x) => x.id !== id);
        if (m.source === 'upload') await store.removeItem(KEY_IMG + id);
        await store.removeItem(KEY_THUMB + id);
        imageCache.delete(id); thumbCache.delete(id);
        if (settings.defaultImageId === id) settings.defaultImageId = '';
        await saveMeta(); await saveSettings();
        if (appliedImageId === id) await applyImage(defaultFor());
        await renderUI();
      };
    };
    document.querySelectorAll('.item').forEach(bindItem);
  }

  // ─────────────────────────────────────────────────────────────
  // 시작
  // ─────────────────────────────────────────────────────────────
  rootDoc = await risuai.getRootDocument();   // 'mainDom' 권한 요청
  if (!rootDoc) {
    console.warn('[Wall Painter] 메인 화면 접근 권한이 없어 배경을 바꿀 수 없습니다.');
  }

  await risuai.registerSetting(`Wall Painter v${VERSION}`, () => openUI({ mode: 'full' }), '🖌️', 'html', 'autobg-settings');
  await risuai.registerButton(
    { name: 'Wall Painter', icon: '🖌️', iconType: 'html', location: 'action', id: 'wall-painter-fab' },
    () => { onFloatingButton().catch((e) => console.warn('[Wall Painter] 플로팅 버튼 오류', e)); }
  );
  await risuai.addRisuReplacer('beforeRequest', injectReplacer);   // 'replacer' 권한 요청
  await risuai.addRisuChatListener('output', outputListener);
  await risuai.addRisuScriptHandler('display', hideTagHandler);
  try {
    await rootDoc?.addEventListener('scroll', () => scheduleScrollScan(), true);
  } catch (e) {
    console.warn('[Wall Painter] 스크롤 감지를 연결하지 못했습니다', e);
  }

  await refreshCurrentChat(true);

  // 채팅방 전환 감지. 캐릭터 번호는 가볍게 자주 확인하고,
  // 같은 캐릭터 안에서 채팅방을 바꾼 경우는 조금 더 긴 주기로 확인함.
  let tick = 0;
  let lastCharIdx = currentChat.charIdx;
  const timer = setInterval(async () => {
    if (disposed) return;
    tick++;
    try {
      const idx = await risuai.getCurrentCharacterIndex();
      if (idx !== lastCharIdx || tick % 4 === 0) {
        lastCharIdx = idx;
        await refreshCurrentChat(false);
      }
    } catch {}
  }, 1500);

  await risuai.onUnload(async () => {
    disposed = true;
    clearInterval(timer);
    try { await risuai.removeRisuReplacer('beforeRequest', injectReplacer); } catch {}
    try { await risuai.removeRisuScriptHandler('display', hideTagHandler); } catch {}
    try { if (styleEl) await styleEl.remove(); } catch {}
  });
})();
