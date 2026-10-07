/* 대전으로 가는 길 - 미디어 저장소
 *
 * 태영만 올릴 수 있고, 광서는 보기만 하는 구조.
 *   POST /upload?kind=commute&date=2026-10-08   x-key 헤더 필요. 올리기
 *   GET  /feed                                   올라온 목록 (공개)
 *   GET  /m/<키>                                 영상·사진 자체 (공개, Range 지원)
 *   POST /delete?date=...&kind=...               x-key 헤더 필요. 지우기
 *
 * 목록은 버킷 안 feed.json 하나에 들어간다. 올리는 사람이 한 명뿐이라
 * 읽고-고쳐-쓰기로 충분하다.
 */

const FEED_KEY = 'feed.json';
const KINDS = ['commute', 'dinner'];

// 확장자는 브라우저가 준 MIME 에서 정한다. 아이폰은 video/quicktime 으로 올라온다.
const EXT = {
  'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/webp': 'webp'
};

const MAX_BYTES = 100 * 1024 * 1024;   // 무료 플랜 요청 본문 상한과 같다

function corsHeaders(env) {
  return {
    'access-control-allow-origin': env.ALLOW_ORIGIN || '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,x-key',
    'access-control-max-age': '86400'
  };
}

function json(body, env, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(env), ...extra }
  });
}

// 길이가 달라도 같은 시간이 걸리도록 비교한다.
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
    diff |= (ea[i] || 0) ^ (eb[i] || 0);
  }
  return diff === 0;
}

function authed(req, env) {
  return !!env.UPLOAD_KEY && sameSecret(req.headers.get('x-key') || '', env.UPLOAD_KEY);
}

async function readFeed(env) {
  const obj = await env.BUCKET.get(FEED_KEY);
  if (!obj) return {};
  try { return await obj.json(); } catch (e) { return {}; }
}

async function writeFeed(env, feed) {
  await env.BUCKET.put(FEED_KEY, JSON.stringify(feed), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
}

const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s);

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(env) });

    /* ---------- 올라온 목록 ---------- */
    if (path === '/feed' && req.method === 'GET') {
      const feed = await readFeed(env);
      // 목록은 자주 바뀌니 짧게만 캐시한다
      return json(feed, env, 200, { 'cache-control': 'public, max-age=30' });
    }

    /* ---------- 영상·사진 내려주기 ---------- */
    if (path.startsWith('/m/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const key = decodeURIComponent(path.slice(3));
      if (!key || key === FEED_KEY) return json({ error: 'not found' }, env, 404);

      const head = await env.BUCKET.head(key);
      if (!head) return json({ error: 'not found' }, env, 404);

      const type = head.httpMetadata?.contentType || 'application/octet-stream';
      const base = {
        ...corsHeaders(env),
        'content-type': type,
        'accept-ranges': 'bytes',
        'etag': head.httpEtag,
        // 올린 뒤에 바뀌지 않는 파일이라 길게 캐시해도 된다
        'cache-control': 'public, max-age=31536000, immutable'
      };

      if (req.method === 'HEAD') {
        return new Response(null, { headers: { ...base, 'content-length': String(head.size) } });
      }

      // 사파리는 Range 를 지원하지 않으면 영상을 아예 재생하지 않는다.
      const range = req.headers.get('range');
      const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
      if (m) {
        const size = head.size;
        let start, end;
        if (m[1] === '') {                       // bytes=-500 : 끝에서 500바이트
          const n = parseInt(m[2], 10);
          if (!n) return json({ error: 'bad range' }, env, 416);
          start = Math.max(0, size - n); end = size - 1;
        } else {
          start = parseInt(m[1], 10);
          end = m[2] === '' ? size - 1 : Math.min(parseInt(m[2], 10), size - 1);
        }
        if (!(start >= 0 && start <= end && end < size)) {
          return new Response(null, {
            status: 416,
            headers: { ...base, 'content-range': `bytes */${size}` }
          });
        }
        const part = await env.BUCKET.get(key, { range: { offset: start, length: end - start + 1 } });
        return new Response(part.body, {
          status: 206,
          headers: { ...base, 'content-range': `bytes ${start}-${end}/${size}`,
                     'content-length': String(end - start + 1) }
        });
      }

      const obj = await env.BUCKET.get(key);
      return new Response(obj.body, { headers: { ...base, 'content-length': String(head.size) } });
    }

    /* ---------- 올리기 (태영만) ---------- */
    if (path === '/upload' && req.method === 'POST') {
      if (!authed(req, env)) return json({ error: '열쇠가 맞지 않습니다' }, env, 401);

      const kind = url.searchParams.get('kind');
      const date = url.searchParams.get('date');
      if (!KINDS.includes(kind)) return json({ error: 'kind 는 commute 또는 dinner' }, env, 400);
      if (!isDate(date)) return json({ error: 'date 는 YYYY-MM-DD' }, env, 400);

      const type = (req.headers.get('content-type') || '').split(';')[0].trim();
      const ext = EXT[type];
      if (!ext) return json({ error: `지원하지 않는 형식: ${type || '없음'}` }, env, 415);

      const declared = Number(req.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) {
        return json({ error: `파일이 너무 큽니다 (${Math.round(declared / 1048576)}MB, 최대 100MB)` }, env, 413);
      }
      if (!req.body) return json({ error: '본문이 비었습니다' }, env, 400);

      const key = `${date}/${kind}.${ext}`;
      const put = await env.BUCKET.put(key, req.body, { httpMetadata: { contentType: type } });

      const feed = await readFeed(env);
      const day = feed[date] || (feed[date] = {});
      // 같은 날 같은 항목을 다시 올리면 이전 파일은 지운다 (확장자가 바뀌었을 수 있다)
      if (day[kind] && day[kind].key !== key) {
        await env.BUCKET.delete(day[kind].key).catch(() => {});
      }
      day[kind] = { key, type, size: put.size ?? (declared || null), at: new Date().toISOString() };
      await writeFeed(env, feed);

      return json({ ok: true, date, kind, key, size: day[kind].size }, env);
    }

    /* ---------- 지우기 (태영만) ---------- */
    if (path === '/delete' && req.method === 'POST') {
      if (!authed(req, env)) return json({ error: '열쇠가 맞지 않습니다' }, env, 401);
      const kind = url.searchParams.get('kind');
      const date = url.searchParams.get('date');
      if (!KINDS.includes(kind) || !isDate(date)) return json({ error: '잘못된 요청' }, env, 400);

      const feed = await readFeed(env);
      const entry = feed[date] && feed[date][kind];
      if (!entry) return json({ error: '그런 항목이 없습니다' }, env, 404);

      await env.BUCKET.delete(entry.key).catch(() => {});
      delete feed[date][kind];
      if (!Object.keys(feed[date]).length) delete feed[date];
      await writeFeed(env, feed);
      return json({ ok: true }, env);
    }

    /* ---------- 열쇠 확인용 ---------- */
    if (path === '/check' && req.method === 'POST') {
      return authed(req, env) ? json({ ok: true }, env) : json({ error: '열쇠가 맞지 않습니다' }, env, 401);
    }

    return json({ error: 'not found' }, env, 404);
  }
};
