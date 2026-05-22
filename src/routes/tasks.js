const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const prisma = require("../prisma");
const auth = require("../middleware/auth");
const projectAccess = require("../middleware/projectAccess");
const permission = require("../middleware/permission");
const logActivity = require("../services/logActivity");
const sendTelegram = require("../services/telegram");

// File upload config
const uploadDir = path.join(__dirname, "..", "..", "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "_"))
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

async function ensureAssigneeInProject(projectId, assignedTo) {
  if (!assignedTo) return true;
  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: assignedTo } }
  });
  return !!member;
}

// Create task
router.post("/", auth, projectAccess, permission("canCreateTask"), async (req, res) => {
  const project = await prisma.project.findUnique({ where: { id: req.body.projectId } });

  if (req.body.assignedTo && req.body.assignedTo !== req.user.id && !req.projectMember.canAssignTask && req.user.role !== "ADMIN") {
    return res.status(403).json({ message: "You do not have permission to assign task to another user" });
  }

  const validAssignee = await ensureAssigneeInProject(req.body.projectId, req.body.assignedTo);
  if (!validAssignee) return res.status(400).json({ message: "Assigned user is not member of this project" });

  const task = await prisma.task.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      status: req.body.status || "TODO",
      priority: req.body.priority || "MEDIUM",
      deadline: req.body.deadline ? new Date(req.body.deadline) : null,
      estimatedHours: req.body.estimatedHours ? parseFloat(req.body.estimatedHours) : null,
      assignedTo: req.body.assignedTo || req.user.id,
      projectId: req.body.projectId,
      workspaceId: project.workspaceId,
      createdBy: req.user.id
    }
  });

  if (req.body.remindAt) {
    await prisma.reminder.create({
      data: { taskId: task.id, remindAt: new Date(req.body.remindAt) }
    });
  }

  await logActivity({
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    userId: req.user.id,
    action: "TASK_CREATED",
    message: `Task created: ${task.title}`,
    newValue: task
  });

  await sendTelegram(`📌 <b>New Task</b>\n${task.title}\nPriority: ${task.priority}`);

  req.app.get("io").to(task.projectId).emit("task_changed", task);
  res.json(task);
});

// Get tasks for project
router.get("/project/:projectId", auth, projectAccess, async (req, res) => {
  const tasks = await prisma.task.findMany({
    where: { projectId: req.params.projectId },
    include: {
      comments: { include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
      files: true,
      timeLogs: { include: { user: { select: { id: true, name: true } } } }
    },
    orderBy: { createdAt: "desc" }
  });
  res.json(tasks);
});

// Update task
router.put("/:id", auth, async (req, res) => {
  const oldTask = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!oldTask) return res.status(404).json({ message: "Task not found" });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: oldTask.projectId, userId: req.user.id } }
  });

  if (!member && req.user.role !== "ADMIN") return res.status(403).json({ message: "Access denied" });
  if (req.user.role !== "ADMIN" && !member.canEditTask) return res.status(403).json({ message: "No edit permission" });

  if (req.body.assignedTo && req.body.assignedTo !== oldTask.assignedTo) {
    if (req.user.role !== "ADMIN" && !member.canAssignTask) {
      return res.status(403).json({ message: "No assign permission" });
    }
    const validAssignee = await ensureAssigneeInProject(oldTask.projectId, req.body.assignedTo);
    if (!validAssignee) return res.status(400).json({ message: "Assigned user is not member of this project" });
  }

  const task = await prisma.task.update({
    where: { id: req.params.id },
    data: {
      title: req.body.title ?? oldTask.title,
      description: req.body.description ?? oldTask.description,
      status: req.body.status ?? oldTask.status,
      priority: req.body.priority ?? oldTask.priority,
      deadline: req.body.deadline ? new Date(req.body.deadline) : oldTask.deadline,
      estimatedHours: req.body.estimatedHours !== undefined ? parseFloat(req.body.estimatedHours) : oldTask.estimatedHours,
      assignedTo: req.body.assignedTo ?? oldTask.assignedTo
    }
  });

  await logActivity({
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    userId: req.user.id,
    action: "TASK_UPDATED",
    message: `Task updated: ${task.title}`,
    oldValue: oldTask,
    newValue: task
  });

  req.app.get("io").to(task.projectId).emit("task_changed", task);
  res.json(task);
});

// Add comment
router.post("/:id/comments", auth, async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ message: "Task not found" });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: task.projectId, userId: req.user.id } }
  });
  if (!member && req.user.role !== "ADMIN") return res.status(403).json({ message: "Access denied" });

  const comment = await prisma.taskComment.create({
    data: { taskId: task.id, userId: req.user.id, message: req.body.message },
    include: { user: { select: { id: true, name: true } } }
  });

  await logActivity({
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    userId: req.user.id,
    action: "COMMENT_ADDED",
    message: `Comment added on: ${task.title}`,
    newValue: comment
  });

  req.app.get("io").to(task.projectId).emit("comment_added", comment);
  res.json(comment);
});

// Upload file to task
router.post("/:id/files", auth, upload.single("file"), async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ message: "Task not found" });

  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: task.projectId, userId: req.user.id } }
  });
  if (!member && req.user.role !== "ADMIN") return res.status(403).json({ message: "Access denied" });

  const fileRecord = await prisma.taskFile.create({
    data: {
      taskId: task.id,
      fileName: req.file.originalname,
      fileUrl: `/uploads/${req.file.filename}`,
      fileSize: req.file.size
    }
  });

  await logActivity({
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    userId: req.user.id,
    action: "FILE_UPLOADED",
    message: `File uploaded: ${req.file.originalname}`,
    newValue: fileRecord
  });

  req.app.get("io").to(task.projectId).emit("task_changed", task);
  res.json(fileRecord);
});

// Delete task
router.delete("/:id", auth, async (req, res) => {
  const task = await prisma.task.findUnique({ where: { id: req.params.id } });
  if (!task) return res.status(404).json({ message: "Task not found" });

  const member = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId: task.projectId, userId: req.user.id } }
  });

  if (req.user.role !== "ADMIN" && (!member || !member.canDeleteTask)) {
    return res.status(403).json({ message: "No delete permission" });
  }

  await prisma.task.delete({ where: { id: req.params.id } });

  await logActivity({
    workspaceId: task.workspaceId,
    projectId: task.projectId,
    taskId: task.id,
    userId: req.user.id,
    action: "TASK_DELETED",
    message: `Task deleted: ${task.title}`,
    oldValue: task
  });

  req.app.get("io").to(task.projectId).emit("task_deleted", task.id);
  res.json({ message: "Deleted" });
});

module.exports = router;
