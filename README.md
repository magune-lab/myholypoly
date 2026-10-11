# myholypoly

로그인된 e-POLY 캘린더에서 숙제를 불러와 일정과 체크리스트로 관리하는 비공식 Windows 보조 앱입니다.

> [!IMPORTANT]
> 이 프로젝트는 Korea POLY School 또는 e-POLY와 제휴하거나 공식적으로 제작·보증받은 제품이 아닙니다.

## 주요 기능

- 선택한 날짜의 e-POLY 숙제를 사용자 PC에서 불러옵니다.
- 월별 일정과 과목별 진행 상황을 함께 관리합니다.
- 일정과 메모는 외부 서버가 아닌 사용자 PC에 저장됩니다.

## 설치

[GitHub Releases](https://github.com/magune-lab/myholypoly/releases)에서 최신 버전의 아래 두 파일을 받습니다.

- `magune-lab.cer`: 최초 설치에 필요한 공개 인증서
- `myholypoly-windows-x64-버전.appx`: 앱 설치 파일

처음 설치할 때만 인증서를 **로컬 컴퓨터 → 신뢰할 수 있는 사용자(Trusted People)** 저장소에 설치한 뒤 APPX를 실행합니다. 이후 버전은 새 APPX를 기존 앱 위에 설치할 수 있습니다.

## e-POLY 연동

1. **일정 등록 → e-POLY 실행**을 누릅니다.
2. 열린 e-POLY에서 직접 로그인합니다.
3. 앱으로 돌아와 **캘린더 열기 → 일정 불러오기**를 진행합니다.

myholypoly는 e-POLY 로그인 아이디와 비밀번호를 수집하거나 저장하지 않습니다. 연동은 e-POLY의 화면 구성이나 운영 정책이 변경되면 작동하지 않을 수 있습니다.
e-POLY와의 통신은 사용자 PC 내부에서만 이루어지며, 필요한 통신 포트는 앱이 실행될 때 자동으로 선택됩니다.

## 데이터와 개인정보

- 일정, 체크 상태와 메모는 `%APPDATA%\myholypoly`에만 저장됩니다.
- myholypoly는 사용자 데이터를 개발자 서버나 제3자 서비스로 전송하지 않습니다.
- 앱을 제거해도 데이터 폴더가 남을 수 있습니다. 모든 데이터를 삭제하려면 앱을 종료한 뒤 해당 폴더를 직접 삭제하세요.
- 이전 버전에서 더 이상 사용하지 않는 설정은 앱을 실행할 때 자동으로 정리됩니다.

자세한 내용은 [PRIVACY.md](PRIVACY.md)를 확인하세요.

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
- 현재 버전: `0.1.12`
- 라이선스: [MIT](LICENSE)
- 제3자 구성요소: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
- 저장소: [github.com/magune-lab/myholypoly](https://github.com/magune-lab/myholypoly)
