# 미디어 저장소 배포하기

영상과 사진을 담아두고, 태영만 올릴 수 있게 막아주는 작은 서버입니다.

무료 한도는 저장 10GB, 하루 10만 요청, 내보내는 트래픽 요금 0원입니다.
아이폰 1080p 30초 영상이 50~70MB쯤이니 매일 둘씩 올려도 한참 남습니다.
3주 동안 매일 둘씩 올려도 2GB 안쪽입니다.

## 카드 등록에 대해

**R2는 무료 한도만 쓰더라도 결제 수단(카드 또는 PayPal) 등록을 요구합니다.**
한도를 넘지 않으면 청구되지 않지만, 등록 자체는 건너뛸 수 없습니다.

쓴 만큼은 대시보드의 R2 화면에서 언제든 볼 수 있습니다. 위 표대로면 저장
10GB 중 2GB쯤, 요청은 백만 분의 일 수준이라 넘길 일이 거의 없습니다.

## 가 - 웹 화면으로 하기 (추천, 설치할 것 없음)

이 컴퓨터에는 Node가 깔려 있지 않습니다. 아래 방법은 브라우저만 있으면 됩니다.

1. **계정 만들기** — https://dash.cloudflare.com 에서 가입합니다.

2. **버킷 만들기** — 왼쪽 메뉴에서 R2를 고르고 `Create bucket`.
   이름은 `daejeon-media` 로 합니다.
   R2를 처음 켤 때 결제 수단을 물어봅니다. 위의 "카드 등록에 대해"를 보세요.
   버킷은 그냥 창고 안의 이름 붙은 방 하나입니다. 영상 파일이 여기 쌓입니다.

3. **Worker 만들기** — 왼쪽 메뉴 `Workers & Pages`, `Create`, `Start from Hello World`.
   이름을 `daejeon-media` 로 두고 만든 다음 `Edit code` 를 누릅니다.
   편집기에 있는 내용을 다 지우고 이 폴더의 `worker.js` 를 통째로 붙여넣고
   `Deploy` 를 누릅니다.

4. **버킷을 연결합니다** — 그 Worker의 `Settings`, `Bindings`, `Add binding`,
   `R2 bucket` 을 고릅니다.
   - Variable name 은 반드시 **`BUCKET`**
   - R2 bucket 은 2번에서 만든 `daejeon-media`

5. **올리기 열쇠를 넣습니다** — 같은 `Settings` 에서 `Variables and Secrets`,
   `Add`, 종류를 **Secret** 으로 고릅니다.
   - 이름은 반드시 **`UPLOAD_KEY`**
   - 값은 아무도 못 맞출 긴 문장
   넣고 나서 다시 `Deploy` 를 눌러야 반영됩니다.

6. **주소를 적어둡니다** — `https://daejeon-media.<계정이름>.workers.dev` 형태입니다.

7. **앱에 알려줍니다** — 여기서부터는 Cloudflare 가 아니라 앱 파일을 고치는 일입니다.
   `index-v3.html` 의 **387번째 줄** 에 있는 `MEDIA_BASE` 의 따옴표 안에
   6번에서 나온 주소를 붙여넣습니다. 끝에 슬래시는 붙이지 않습니다.
   비워두면 앱은 저장소 없이 혼자 돌고, 출근·저녁 버튼은 안내만 띄웁니다.

       바꾸기 전   const MEDIA_BASE = "";
       바꾼 뒤     const MEDIA_BASE = "https://daejeon-media.내계정.workers.dev";

8. **잘 됐는지 보기** — 브라우저로 `<주소>/feed` 를 열어 `{}` 가 나오면 성공입니다.

## 나 - 명령줄로 하기 (Node가 있을 때)

    cd worker
    npx wrangler login
    npx wrangler deploy
    npx wrangler secret put UPLOAD_KEY

`wrangler.toml` 이 버킷 연결까지 들고 있어서 위 네 줄이면 끝납니다.

## 다 하고 나서 (선택)

`ALLOW_ORIGIN` 을 깃허브 페이지 주소로 바꾸면 다른 사이트에서 불러가는 걸
막을 수 있습니다. 웹 화면이면 `Settings` 의 일반 변수로 넣고, 명령줄이면
`wrangler.toml` 을 고치고 다시 배포합니다.

## 올린 걸 지우고 싶을 때

앱에서 관리 화면을 열면 항목마다 지우기 버튼이 있습니다.
전부 비우려면 대시보드의 R2에서 버킷 내용을 지우면 됩니다.

## 주소별로 하는 일

| 주소 | 하는 일 | 열쇠 |
|---|---|---|
| `GET /feed` | 올라온 목록 | 필요 없음 |
| `GET /m/<키>` | 영상·사진 (구간 요청 지원) | 필요 없음 |
| `POST /upload?kind=commute&date=2026-10-08` | 올리기 | 필요 |
| `POST /delete?kind=...&date=...` | 지우기 | 필요 |
| `POST /check` | 열쇠가 맞는지 확인 | 필요 |

`kind` 는 `commute`(출근) 또는 `dinner`(저녁)입니다.
영상은 mp4, mov, webm, 사진은 jpg, png, heic, webp 를 받습니다.
한 파일당 100MB까지입니다. 무료 플랜의 요청 본문 상한과 같습니다.
