const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

const authRoutes       = require("./routes/auth");
const productRoutes    = require("./routes/products");
const historyRoutes    = require("./routes/history");
const approvalRoutes   = require("./routes/approvals");
const ledgerRoutes     = require("./routes/ledger");
const productionRoutes = require("./routes/production");
const aiRiskRoutes     = require("./routes/ai.risk");

// ✅ 서버 시작 시 DB 스키마 자동 마이그레이션
try {
  require("./scripts/migrate");
} catch (e) {
  console.warn("⚠️  Migration warning:", e.message);
}

const app = express();
const server = http.createServer(app);

// Multer 설정: 이미지 업로드 (선택사항)
let upload = null;
try {
  const multer = require("multer");
  
  const uploadsDir = path.join(__dirname, "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
      const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}${path.extname(file.originalname)}`;
      cb(null, uniqueName);
    }
  });

  upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
    fileFilter: (req, file, cb) => {
      const allowed = /jpeg|jpg|png|gif|webp/;
      const ext = allowed.test(path.extname(file.originalname).toLowerCase());
      const mime = allowed.test(file.mimetype);
      if (ext && mime) {
        cb(null, true);
      } else {
        cb(new Error("이미지 파일만 업로드 가능합니다."));
      }
    }
  });
  
  console.log("✅ Multer initialized for image uploads");
} catch (err) {
  console.warn("⚠️  Multer not installed - image upload disabled (optional feature)");
}

// Socket.IO 설정 (CORS 포함)
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Express 미들웨어
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ✅ 프론트엔드 정적 서빙
// - 다른 PC에서 http://[SERVER-IP]:5000 으로 접속하면 그대로 사용 가능
// - 프론트가 별도 서버(예: python http.server)로 돌아갈 필요 없음
app.use(express.static(path.join(__dirname, "../frontend")));

// 이미지 파일 정적 서빙 (uploads 폴더) - 서버 시작 시 폴더 자동 생성 후 항상 등록
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
app.use("/uploads", express.static(uploadsDir));

// Socket.IO 인스턴스를 req에 주입
app.use((req, res, next) => {
  req.io = io;
  next();
});

// 이미지 업로드 엔드포인트 (multer가 설치된 경우에만)
if (upload) {
  app.post("/uploads/image", upload.single("image"), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ ok: false, message: "파일이 없습니다." });
    }
    
    const imageUrl = `/uploads/${req.file.filename}`;
    return res.json({ ok: true, url: imageUrl, filename: req.file.filename });
  });
}

// 라우트 등록
app.get("/", (req, res) => {
  // 프론트(index.html) 제공
  return res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/history", historyRoutes);
app.use("/approvals", approvalRoutes);
app.use("/ledger", ledgerRoutes);
app.use("/production", productionRoutes);
app.use("/ai", aiRiskRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not Found" });
});

// Socket.IO 연결 처리
io.on("connection", (socket) => {
  console.log(`🔌 Client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`🔌 Client disconnected: ${socket.id}`);
  });

  // 클라이언트가 특정 이벤트를 구독
  socket.on("subscribe", (data) => {
    console.log(`📡 Subscribe:`, data);
  });
});

// 서버 시작
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; // 외부 접속 허용 (8️⃣ 요구사항)

server.listen(PORT, HOST, () => {
  console.log(`\n🚀 =======================================`);
  console.log(`   ERP Backend v2.0 Running!`);
  console.log(`   HTTP  : http://localhost:${PORT}`);
  console.log(`   Network: http://[Your-IP]:${PORT}`);
  console.log(`   Socket: ws://localhost:${PORT}`);
  console.log(`   Features: Real-time, Approvals, AI`);
  console.log(`=======================================\n`);
});

// 글로벌 io 인스턴스 export
module.exports = { io };
