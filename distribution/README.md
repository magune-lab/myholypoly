# myholypoly 자체 서명 설치

`magune-lab.cer`는 myholypoly 설치 패키지의 서명을 확인하기 위한 공개 인증서입니다. 비밀키는 포함하지 않습니다.

처음 사용하는 Windows PC에서 한 번만 다음 순서로 설치합니다.

1. `magune-lab.cer`를 두 번 클릭하고 **인증서 설치**를 선택합니다.
2. 저장 위치로 **로컬 컴퓨터**를 선택합니다. 관리자 확인이 표시될 수 있습니다.
3. **모든 인증서를 다음 저장소에 저장**을 선택합니다.
4. 인증서 저장소를 **신뢰할 수 있는 사용자(Trusted People)** 로 지정합니다.
5. 설치를 완료한 뒤 함께 배포된 `myholypoly-windows-x64-버전.appx`를 실행합니다.

또는 저장소를 내려받은 경우 **관리자 권한 PowerShell**에서 다음 명령을 한 번 실행할 수 있습니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-signing-certificate.ps1
```

이후 동일한 `magune-lab` 인증서로 서명된 업데이트는 인증서를 다시 설치할 필요가 없습니다.

인증서 설치는 무료이며 Windows가 이 배포자를 신뢰하도록 해당 PC에만 등록합니다. `magune-lab-code-signing.pfx` 개인키와 암호는 저장소나 릴리스에 포함하지 않습니다.
