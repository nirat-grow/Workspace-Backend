const router = require("express").Router();
const prisma = require("../prisma");
const auth = require("../middleware/auth");
const logActivity = require("../services/logActivity");

// Log time for a task
router.post("/", auth, async (req, res) => {
  const { taskId, hours, note, logDate } = req.body;
  if (!taskId || !hours) return res.status(400).json({ message: "taskId and hours required" });

  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) return res.status(404).json({ message: "Task not found" });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: task.projectId, userId: req.user.id } }
  });
  if (!member && req.user.role !== "ADMIN") return res.status(403).json({ message: "Access denied" });

  const timeLog = await prisma.timeLog.create({
    data: {
      taskId,
      userId: req.user.id,
      hours: parseFloat(hours),
      note: note || null,
      logDate: logDate ? new Date(logDate) : new Date()
    }
  });

  await logActivity({
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    userId: req.user.id,
    action: "TIME_LOGGED",
    message: `Logged ${hours}h on: ${task.title}`,
    newValue: timeLog
  });

  req.app.get("io").to(task.projectId).emit("task_changed", task);
  res.json(timeLog);
});

// Get time logs for a task
router.get("/task/:taskId", auth, async (req, res) => {
  const logs = await prisma.timeLog.findMany({
    where: { taskId: req.params.taskId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { logDate: "desc" }
  });
  res.json(logs);
});

// Get project hours summary
router.get("/project/:projectId/summary", auth, async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { projectId: req.params.projectId },
    include: {
      timeLogs: { include: { user: { select: { id: true, name: true } } } }
    }
  });

  let totalHours = 0;
  let totalEstimated = 0;
  const byUser = {};

  tasks.forEach(task => {
    totalEstimated += task.estimatedHours || 0;
    task.timeLogs.forEach(log => {
      totalHours += log.hours;
      if (!byUser[log.user.name]) byUser[log.user.name] = 0;
      byUser[log.user.name] += log.hours;
    });
  });

  res.json({ totalHours: Math.round(totalHours * 100) / 100, totalEstimated, byUser, taskCount: tasks.length });
});

module.exports = router;
