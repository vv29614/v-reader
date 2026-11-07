@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "D:\deepseek harness\Apps\DocReader"

echo ============================================
echo   V 缂栬緫鍣?鈥斺€?涓€閿紑婧愬埌 GitHub
echo ============================================
echo.
echo 鏈剼鏈細锛?echo   1) 鎶婃湰鍦颁唬鐮佹帹鍒?github.com/vv29614/v-editor
echo   2) 棣栨鎺ㄩ€佷細寮瑰嚭娴忚鍣ㄨ浣犵櫥褰?GitHub锛堢櫥褰曚竴娆″嵆鍙級
echo.
echo 鍓嶆彁锛氫綘宸茬粡鍦ㄧ綉椤典笂寤哄ソ杩欎釜绌轰粨搴擄紙涓嶅嬀 README / gitignore锛?echo   寤虹珛鍦板潃锛?https://github.com/new?name=v-editor^&visibility=public
echo.

choice /c YN /m "浠撳簱宸茬粡寤哄ソ浜嗗悧锛圷=缁х画鎺ㄩ€?/ N=鍏堟墦寮€寤轰粨椤甸潰锛?
if errorlevel 2 (
  start "" "https://github.com/new?name=v-editor&visibility=public"
  echo.
  echo 宸插湪娴忚鍣ㄦ墦寮€寤轰粨椤甸潰锛歊epository name 濉?v-editor锛岄€?Public锛屼笉瑕佸嬀浠讳綍鍒濆鍖栭€夐」锛岀偣 Create repository銆?  echo 寤哄ソ鍚庨噸鏂拌繍琛屾湰鑴氭湰銆?  pause
  exit /b 0
)

git branch -M main
git remote remove origin 2>nul
git remote add origin https://github.com/vv29614/v-editor.git

echo.
echo 姝ｅ湪鎺ㄩ€侊紙鑻ュ脊鍑?GitHub 鐧诲綍绐楀彛锛岃鎺堟潈锛?..
echo.
git push -u origin main

if errorlevel 1 (
  echo.
  echo [鎺ㄩ€佸け璐 甯歌鍘熷洜锛?  echo   - 浠撳簱杩樻病寤猴紝鎴栧悕瀛椾笉鏄?v-editor
  echo   - 鐧诲綍绐楀彛琚叧鎺変簡锛堥噸璺戞湰鑴氭湰鍗冲彲锛?  echo   - 缃戠粶涓嶉€氾紙鍙厛寮€浠ｇ悊鍐嶈瘯锛?  echo.
  pause
  exit /b 1
)

echo.
echo [鎴愬姛] 浠ｇ爜宸叉帹閫佸埌 https://github.com/vv29614/v-editor
echo.
echo 涓嬩竴姝ワ細鍙戝竷瀹夎鍖咃紙鎶?exe 鎸傚埌 Releases锛?echo   1. 鎵撳紑 https://github.com/vv29614/v-editor/releases/new
echo   2. Tag 濉?v1.1.0锛屾爣棰樺～ V 缂栬緫鍣?1.1.0
echo   3. 鎶婁笅闈㈣繖涓枃浠舵嫋杩涢檮浠跺尯锛?echo      D:\deepseek harness\Apps\DocReader\release\VEditor-Setup-1.1.0.exe
echo   4. 鐐?Publish release
echo.
start "" "https://github.com/vv29614/v-editor/releases/new"
pause
