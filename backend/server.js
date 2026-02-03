const express = require("express");
const cors = require("cors");
const path = require("path");

const authRoutes = require("./routes/auth");
const productRoutes = require("./routes/products");
const historyRoutes = require("./routes/history");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "ERP Backend is running",
    endpoints: ["/auth/login", "/products", "/products/adjust", "/history"],
  });
});

app.use("/auth", authRoutes);
app.use("/products", productRoutes);
app.use("/history", historyRoutes);

app.use((req, res) => {
  res.status(404).json({ ok: false, message: "Not Found" });
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`✅ Backend running: http://localhost:${PORT}`);
});
