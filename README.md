🚀 ERP System (Frontend + Backend + JSON DB)
단일 HTML/LocalStorage 기반 ERP를 Frontend / Backend / DB(JSON) 형태로 완전 분리한 버전입니다.

📂 폴더 구조 (Project Structure)
Plaintext
erp-system/
├── backend/
│   ├── config/database.js
│   ├── controllers/
│   ├── models/database.json
│   ├── routes/
│   ├── server.js
│   └── package.json
├── frontend/
│   ├── css/style.css
│   ├── js/*.js
│   └── index.html
└── README.md
🛠️ 실행 방법 (Windows)
1. 백엔드 실행 (Express)
백엔드 서버를 구동하기 위해 아래 명령어를 순서대로 입력하세요.

해당 폴더로 이동 (CMD 또는 터미널)

Bash
cd erp-system/backend
의존성 설치 및 실행

Bash
npm install
npm start
2. 프론트엔드 실행 (Python Server)
프론트엔드 정적 파일을 브라우저에서 확인하기 위해 로컬 서버를 실행합니다.

해당 폴더로 이동

Bash
cd erp-system/frontend
로컬 서버 실행 (Port: 5500)

Bash
python -m http.server 5500
서버 실행 후 브라우저에서 http://localhost:5500으로 접속하세요.
