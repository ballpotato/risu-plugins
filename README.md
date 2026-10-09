# risu-plugins

RisuAI 플러그인 모음입니다. 플러그인마다 폴더가 따로 있고, 각자 버전과 라이선스를 가집니다.

| 플러그인 | 설명 | 설치 파일 |
|---|---|---|
| [🖌️ Wall Painter](wall-painter/) | 채팅 장면에 맞춰 채팅 배경을 자동으로 바꿈 | [wall_painter.js](https://raw.githubusercontent.com/ballpotato/risu-plugins/main/wall-painter/wall_painter.js) |

## 설치

1. 위 표의 설치 파일을 받습니다. (링크를 열고 `Ctrl+S`로 저장)
2. RisuAI 설정 → 플러그인 → 파일 추가로 `.js` 파일을 불러옵니다.

## 업데이트

각 플러그인 파일에는 `//@update-url`이 들어 있습니다. 한 번 설치하면, 새 버전이 올라왔을 때 RisuAI 플러그인 목록에 업데이트 표시가 뜨고 바로 업데이트할 수 있습니다.

## 폴더 구조

```
risu-plugins/
├─ README.md            이 파일
└─ <플러그인-이름>/
   ├─ <플러그인>.js      설치 파일 (버전이 붙지 않은 고정 이름 = 업데이트 주소)
   ├─ README.md          설명
   └─ LICENSE            라이선스
```
