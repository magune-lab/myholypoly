# myholypoly

e-POLY 숙제를 불러와 일정과 체크리스트로 관리하는 Windows 앱입니다.

## 이 앱에서 중요한 것

- 로그인된 e-POLY 캘린더에서 숙제를 가져옵니다.
- Gemini를 연결하면 단순히 문장을 고치는 대신, 원문의 계층과 내용을 분석해 일정 구조로 정리합니다.
- AI 정리 결과는 가져온 원본과 비교하거나 과목별로 원복할 수 있습니다.
- 학원·선생님마다 다른 입력 방식은 **AI 설정 → 내 추가 규칙**에서 직접 보완할 수 있습니다.
- 일정, 메모, AI 설정은 PC에 저장되며 앱을 업데이트해도 유지됩니다.

## 설치

[GitHub Releases](https://github.com/magune-lab/myholypoly/releases)에서 최신 버전의 아래 두 파일을 받습니다.

- `magune-lab.cer`: 설치 인증서
- `myholypoly-windows-x64-버전.appx`: 앱 설치파일

처음 설치할 때만 다음 순서를 따릅니다.

1. `magune-lab.cer`를 열고 **로컬 컴퓨터 → 신뢰할 수 있는 사용자(Trusted People)** 저장소에 설치합니다.
2. APPX 파일을 열어 앱을 설치합니다.

이후 버전은 새 APPX를 기존 앱 위에 설치하면 됩니다.

## e-POLY 연동

1. **일정 등록 → e-POLY 실행**을 누릅니다.
2. 열린 e-POLY에서 로그인합니다.
3. 앱으로 돌아와 **캘린더 열기 → 일정 불러오기**를 진행합니다.

로그인했는데 화면을 찾지 못한다면 e-POLY를 앱의 **e-POLY 실행** 버튼으로 다시 여세요. e-POLY가 설치되지 않았다면 [PC 설치 가이드](https://www.youtube.com/watch?v=g7CY3u4QoWU)를 참고하세요.

## AI 자동 구성

AI 기능은 선택 사항이며, 없어도 일정 가져오기와 관리는 사용할 수 있습니다.

1. 일정 등록 화면에서 **AI 설정**을 엽니다.
2. [Google AI Studio](https://aistudio.google.com/app/apikey)에서 발급한 Gemini API 키를 저장합니다.
3. 필요한 경우 **내 추가 규칙**에 지점별 정리 방식을 입력합니다.

API 키는 Windows 암호화 저장소를 이용해 이 PC에 보관됩니다. AI가 연결된 경우 숙제 원문과 사용자 추가 규칙은 일정 구성을 위해 Google Gemini API로 전송됩니다.

## 데이터 위치

사용자 데이터는 `%APPDATA%\myholypoly`에 저장됩니다. 앱을 제거하면서 데이터를 삭제하거나 이 폴더를 직접 지우면 일정, 메모, AI 설정이 사라질 수 있습니다.

## 개발

```powershell
pnpm install
pnpm start
```

Windows APPX 생성:

```powershell
pnpm run package:msix
```

- 지원 운영체제: Windows
- 현재 버전: `0.1.8`
- 저장소: [github.com/magune-lab/myholypoly](https://github.com/magune-lab/myholypoly)
