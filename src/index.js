const express = require('express');
const path = require('path');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const dotenv = require('dotenv');
const prisma = require('./config/db');
dotenv.config();
require('./jobs/cron.jobs'); // Initialize cron jobs after loading .env
const telegramService = require('./services/telegram.service');
telegramService.startPolling(); // Start listening to direct Telegram clicks

const app = express();
const server = http.createServer(app);

// Socket.io Setup
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST", "PUT", "DELETE"]
  }
});

// Middleware
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// DB Prisma instance globally accessible (usually we'd put this in a separate file, but for simplicity we can export it or just use it in controllers)

// Make io accessible via req
app.use((req, res, next) => {
  req.io = io;
  req.prisma = prisma;
  next();
});

// Initialize socket handler
const setupSockets = require('./socket/socket.handler');
setupSockets(io);

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/workspaces', require('./routes/workspace.routes'));
app.use('/api/projects', require('./routes/project.routes'));
app.use('/api/tasks', require('./routes/task.routes'));
app.use('/api/comments', require('./routes/comment.routes'));
app.use('/api/timelog', require('./routes/timelog.routes'));
app.use('/api/reports', require('./routes/report.routes'));
app.use('/api/invites', require('./routes/invite.routes'));
app.use('/api/activity', require('./routes/activity.routes'));
app.use('/api/debug-db', require('./routes/debug.routes'));

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
