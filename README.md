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

1) 폴더 이동
```bash
cd erp-system\backend
