const CACHE = 'daejeon-v34';
const CORE = ['./', './index.html', './manifest.webmanifest',
              './icon-180.png', './icon-192.png', './icon-512.png', './avatar-me.jpg'];

// 글꼴만 바깥에서 받아 캐시한다. 한 번 받으면 바뀌지 않는 파일들이다.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;

  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;

  // 영상·사진 저장소는 다른 도메인에 있다. 여기를 가로채면 안 된다.
  // 아래 "캐시 먼저" 규칙에 걸리면 맨 처음 받은 목록이 그대로 굳어서,
  // 새로 올린 출근·저녁이 영영 보이지 않는다. 영상 자체도 통째로
  // 캐시에 쌓여 저장 공간을 잡아먹는다. 그냥 통과시킨다.
  if (!sameOrigin && !FONT_HOSTS.includes(url.hostname)) return;

  // 페이지 자체: 네트워크 먼저. 온라인이면 새로고침할 때마다 최신이 뜨고,
  // 오프라인이면 캐시에 있는 것으로 넘어간다.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        // 요청한 주소 그대로 넣는다. 예전에는 어떤 페이지를 열든 './index.html'
        // 자리에 덮어써서, 다른 파일을 한 번 열면 오프라인일 때 그게 떴다.
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  // 나머지 (아이콘, 도시 사진, 글꼴): 캐시 먼저, 없으면 받아서 넣어둔다.
  e.respondWith(
    caches.match(e.request, {ignoreSearch: true}).then(hit => {
      if (hit) return hit;
      return fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
