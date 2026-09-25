# myholypoly

Windows에서 실행하는 e-POLY 숙제 편집 도우미입니다. Docker와 WSL을 사용하지 않습니다.

## 현재 구현

- `e-POLY.exe`를 원격 디버그 모드로 실행
- e-POLY의 열린 숙제 목록을 읽어 편집 초안으로 가져오기
- 초안을 편집한 뒤 Windows 사용자 데이터 폴더에 등록
- 등록된 일정은 e-POLY에서 다시 가져와도 자동 덮어쓰지 않음

## 다음 구현

- 로그인된 e-POLY의 월간 일정 API로 **오늘 숙제 가져오기** 연결
- 가져온 항목의 순서 변경과 항목 분리
- e-POLY 창 우측 상단을 따라다니는 작은 리모콘 창
- Windows Credential Manager를 이용한 선택적 로그인 채우기

## 개발 실행

`pnpm install` 후 `pnpm dev`를 실행합니다. e-POLY가 이미 일반 모드로 실행 중이면 종료한 뒤 myholypoly에서 다시 열어야 연동됩니다.
