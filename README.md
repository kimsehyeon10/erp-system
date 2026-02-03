# ERP System (Frontend + Backend + JSON DB)

단일 HTML/LocalStorage 기반 ERP를
frontend / backend / db(JSON) 형태로 완전 분리한 버전입니다.

## 폴더 구조

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

---

## 1) 실행 방법 (Windows)

### 1-1. 백엔드 실행 (Express)

1) 백엔드 폴더 이동
cd erp-system\backend(예시)
  -backend 폴더까지 간 후 cmd를 연다
  -또는 cd erp-system\backend를 통해 해달 폴더로 이동한다
  -npm start를 cmd에서 입력한다

요약
cd erp-system\backend
npm install
npm start

  
2)프론트 엔드 폴더 이동
cd erp-system\frontend(예시)
  -frontend 폴더까지 간 후 cmd를 연다
  -또는 cd erp-system\frontend를 통해 해달 폴더로 이동한다
  -python -m http.server 5500

 요약
 cd erp-system\frontend
python -m http.server 5500

