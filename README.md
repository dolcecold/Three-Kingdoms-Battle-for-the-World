# 천하결전 덱 시뮬레이터 — GitHub Pages 프런트 v0.6.1

부대 편성 → 공유 → 전투 → 전보 확인을 한 화면에서 하는 정적 페이지입니다. 빌드나 패키지 설치 없이 이 폴더를 그대로 올리면 됩니다.

## 1. 서버 주소 넣기

`config.js` 한 곳만 고칩니다.

```js
export const API_BASE_URL = 'https://내앱.fastapicloud.dev';
```

주소 끝에 `/api`, `/docs`, `/`를 붙이지 않습니다. GitHub Pages는 HTTPS이므로 백엔드도 HTTPS여야 합니다. 비워 두면 '편성 모드'로 시작하고, 사용자가 화면 오른쪽 위 연결 버튼에서 주소를 넣을 수 있습니다(사용자가 넣은 주소가 우선).

## 2. 백엔드 CORS

백엔드 `CORS_ORIGINS`에 Pages의 origin을 추가합니다. 경로는 빼고 origin만 넣습니다.

- 사용자 페이지·프로젝트 페이지 모두: `https://<계정>.github.io`
- 커스텀 도메인을 쓰면 그 도메인

## 3. 배포

1. 이 폴더 내용을 저장소 루트(또는 `docs/`)에 올립니다. `.nojekyll` 파일을 꼭 포함하세요.
2. 저장소 Settings → Pages → Source를 "Deploy from a branch", 브랜치·폴더를 지정합니다.
3. 몇 분 뒤 `https://<계정>.github.io/<저장소>/`에서 확인합니다.

로컬 확인: 이 폴더에서 `python3 -m http.server 8080` 실행 후 http://localhost:8080. HTML을 더블클릭해 열면 모듈·JSON 읽기가 막힙니다.

## 파일 역할

| 파일 | 역할 | 수정 |
|---|---|---|
| `config.js` | 서버 주소 | 배포 전 수정 |
| `index.html`, `style.css`, `app.js` | 화면 계층 (v0.6.0에서 새로 작성) | |
| `api-client.js` | 공개 API 2개 SDK | `fetch` 호출 1줄 수정 (아래). 새 패키지를 받으면 다시 적용 |
| `army-code.js` | TC1 공유 코드 (data_version 포함) | 변경 없음 |
| `editor.js` | 공개 편성 규칙 검사 | 변경 없음 |
| `recommended-decks.js` | 추천덱 조회 헬퍼 | 변경 없음 |
| `data/editor-s1~3.json` | 서버 연결 전 편성 스냅샷 | 변경 없음 |
| `data/recommended-decks.json` | 추천덱 메타 v1.1.0 | 변경 없음 |
| `data/report-example-s3.json` | 예시 전보 | 변경 없음 |

사용 API는 그대로입니다: `GET /api/v2/editor?season=N`, `POST /api/v2/battles {left_code,right_code}`.

## v0.6.0 변경 사항

**버그 수정 — `api-client.js`**: `this.fetchImpl(...)` 형태로 `fetch`를 호출해, 브라우저에서 `TypeError: Illegal invocation`이 나며 모든 API 요청이 실패했습니다. 기존 화면은 이 오류를 "CORS 확인" 메시지로 보여줘서 원인이 가려져 있었습니다. 래퍼 함수로 감싸 해결했습니다.

**화면**
- 아군·상대 두 부대를 나란히 놓고 가운데에 전투 버튼을 둔 대진판 구성. 모바일은 아군/상대 탭과 하단 고정 전투 바.
- 무장·전법 선택을 검색·분류(병종, 전법 유형) 가능한 선택 창으로 변경. 효과 설명을 고르기 전에 볼 수 있고, 고를 수 없는 항목은 이유를 표시.
- 진형의 전열·후열 배치를 작은 도식으로 표시.
- 상세 설정을 기본/병법/병종/능력치 탭으로 정리. 병법은 품질별로 묶어 표시.
- 각 부대 아래에 편성 규칙 통과 여부를 실시간 표시.
- 전보: 승패 도장, 양측 잔여 병력, **턴별 총 병력 그래프**(전보의 잔여 병력 기록으로 계산), 무장별 피해 막대, 턴별 전보(진영·핵심만 필터), 무장별·전법별 표.
- **대전 링크**: 두 부대를 URL 해시(`#s=2&a=TC1…&b=TC1…`)에 담아 공유. 서버로 전송되지 않습니다.
- 편성 자동 저장(브라우저 localStorage), 양측 바꾸기, 시즌 전환 시 쓸 수 있는 편성은 유지.
- 느린 응답(서버 콜드 스타트) 안내와 전투 요청 취소, 429 응답의 Retry-After 안내.
- 라이트/다크 테마, 키보드 이동, 모션 줄이기 설정 반영.

## v0.6.1 변경 사항

- 데이터 v0.5.1 반영: 무장 진영·등급, `data_version`, 추천덱 메타 v1.1.0.
- 무장 선택 창에 진영·등급 필터를 추가하고, 무장 카드에 진영·등급을 표시합니다.
- 새로 만드는 공유 코드와 전투 요청 코드에 `data_version`을 담습니다. 서버 간 정합용 값이라 화면에는 표시하지 않습니다. 버전 없는 기존 코드도 그대로 불러옵니다.
- 추천덱의 동명 무장(예: 황보숭 A/S등급)은 후보로 보여주고 사용자가 직접 고르게 합니다. 전법이 없는 덱은 빈 슬롯으로 불러옵니다.
- 화면에서 쓰지 않는 파일(`mapping-audit.json`, `recommended-decks.schema.json`, `RECOMMENDED_DECKS.md`)은 배포본에서 뺐습니다.

## 데이터만 갱신할 때

새 패키지를 받으면 `data/` 안의 JSON 5개와 `army-code.js`, `editor.js`, `recommended-decks.js`를 교체합니다. `api-client.js`를 교체했다면 `this.fetchImpl = fetchImpl;` 줄을 `this.fetchImpl = (...args) => fetchImpl(...args);`로 다시 바꿉니다.

## 범위와 한계

기존 v0.5.0의 정책을 그대로 따릅니다. 전투 엔진·암호화 키·비공개 데이터는 프런트에 없습니다. 공유 코드는 키 없는 공개 인코딩입니다. 장비·말은 능력치 합계만 입력하며 특수 효과는 지원하지 않습니다. 추천덱은 과거 자료의 편집용 초안이며 현재 시즌 성능 순위가 아닙니다. 
외부 리소스: 글꼴만 Google Fonts(Hahmlet)와 jsDelivr(Pretendard)에서 받습니다. 차단돼도 시스템 글꼴로 동작합니다.
