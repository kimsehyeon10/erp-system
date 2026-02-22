#!/bin/bash
set -e

echo "================================"
echo "ERP 재고관리 시스템 시작 (Backend only)"
echo "================================"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

# Node.js / npm 체크
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js가 설치되어 있지 않습니다."
  echo "   https://nodejs.org 에서 LTS를 설치하세요."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "❌ npm을 찾을 수 없습니다."
  exit 1
fi

echo "[1/2] 백엔드 의존성 확인..."
cd backend
if [ ! -d "node_modules" ]; then
  echo " - node_modules 없음 → npm install 실행"
  npm install
else
  echo " - 이미 설치됨"
fi

echo ""
echo "[2/2] 백엔드 서버 시작..."
echo " - Open: http://localhost:5000"
echo " - Network: http://[YOUR-IP]:5000"
echo ""

# Ctrl+C 종료 처리
trap 'echo ""; echo "🛑 종료 중..."; kill 0; exit 0' INT TERM

npm start
