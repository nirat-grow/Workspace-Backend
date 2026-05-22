require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  "http://localhost:5173",
  "http://192.168.0.51:5173",
  process.env.FRONTEND_URL
].filter(Boolean);

const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});

app.set("io", io);

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json());

// Serve uploaded files
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/", (req, res) => res.json({ ok: true, app: "Lite Jira SaaS v2" }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));
app.use("/api/workspaces", require("./routes/workspaces"));
app.use("/api/projects", require("./routes/projects"));
app.use("/api/tasks", require("./routes/tasks"));
app.use("/api/invites", require("./routes/invites"));
app.use("/api/activity", require("./routes/activity"));
app.use("/api/reports", require("./routes/reports"));
app.use("/api/timelogs", require("./routes/timelogs"));

io.on("connection", (socket) => {
  socket.on("join_project", (projectId) => socket.join(projectId));
});

require("./services/reminderService");
require("./services/dailyReportService");

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Backend running on ${PORT}`));
